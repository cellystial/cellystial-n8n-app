import {
  IHookFunctions,
  IWebhookFunctions,
  IDataObject,
  INodeType,
  INodeTypeDescription,
  IWebhookResponseData,
  NodeOperationError,
} from 'n8n-workflow';
import * as crypto from 'crypto';
import { CELLYSTIAL_API_BASE_URL } from '../../constants';

const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Verifies a Cellystial `X-Cellystial-Signature` header against the raw body.
 *
 * Mirrors the signing scheme in the backend's `webhook-signature.util` and the
 * published SDKs' `verifyWebhook`: header is `t=<unix>,v1=<hex>` and the HMAC is
 * `HMAC_SHA256(secret, "<t>.<rawBody>")`, compared in constant time, with a
 * timestamp-tolerance window to bound replay.
 *
 * `rawBody` MUST be the exact bytes received (a Buffer is preferred so multi-byte
 * UTF-8 is never re-encoded); the HMAC is fed `${t}.` then the body bytes, which
 * is identical to hashing the single concatenated string the backend signs.
 */
function verifySignature(rawBody: Buffer | string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret) return false;

  const parts: Record<string, string> = {};
  for (const segment of signatureHeader.split(',')) {
    const idx = segment.indexOf('=');
    if (idx === -1) continue;
    const key = segment.slice(0, idx).trim();
    if (key) parts[key] = segment.slice(idx + 1).trim();
  }
  const t = Number(parts.t);
  if (!parts.t || !Number.isFinite(t) || !parts.v1) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Cellystial Trigger — starts a workflow when a Cellystial event fires.
 *
 * Uses n8n's webhook-registration lifecycle: on activation it registers this
 * node's webhook URL as a Cellystial subscription (POST /api/v1/webhooks) for
 * the chosen events, and on deactivation it deletes it (DELETE /api/v1/webhooks/:id).
 * Cellystial then POSTs signed event payloads straight to n8n.
 */
export class CellystialTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Cellystial Trigger',
    name: 'cellystialTrigger',
    icon: 'file:cellystial.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"]}}',
    description: 'Starts the workflow on a Cellystial event (PDF generated, batch completed, template changes)',
    defaults: {
      name: 'Cellystial Trigger',
    },
    inputs: [],
    outputs: ['main'],
    credentials: [
      {
        name: 'cellystialApi',
        required: true,
      },
    ],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        default: ['pdf.generated'],
        description: 'Which Cellystial events should start this workflow',
        options: [
          { name: 'Batch Completed', value: 'batch.completed', description: 'A bulk batch finished generating' },
          { name: 'PDF Generated', value: 'pdf.generated', description: 'A single PDF finished generating' },
          { name: 'Template Created', value: 'template.created', description: 'A template was created' },
          { name: 'Template Deleted', value: 'template.deleted', description: 'A template was deleted' },
          { name: 'Template Updated', value: 'template.updated', description: 'A template was updated' },
        ],
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const webhookData = this.getWorkflowStaticData('node');
        return typeof webhookData.subscriptionId === 'string' && webhookData.subscriptionId.length > 0;
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const webhookUrl = this.getNodeWebhookUrl('default');
        if (!webhookUrl) {
          throw new NodeOperationError(this.getNode(), 'Could not resolve the n8n webhook URL for this node.');
        }
        const events = this.getNodeParameter('events') as string[];

        let response: { id?: string; secret?: string } | undefined;
        try {
          response = await this.helpers.httpRequestWithAuthentication.call(this, 'cellystialApi', {
            method: 'POST',
            url: `${CELLYSTIAL_API_BASE_URL}/api/v1/webhooks`,
            body: { url: webhookUrl, events, description: 'n8n' },
            json: true,
          });
        } catch (error) {
          throw new NodeOperationError(this.getNode(), error as Error, {
            message: 'Could not register the Cellystial webhook subscription. Check that your API key is valid.',
          });
        }

        if (!response?.id) {
          throw new NodeOperationError(
            this.getNode(),
            'Cellystial did not return a subscription id when registering the webhook.',
          );
        }

        // The signing secret is returned exactly once, here, and is required to verify
        // deliveries. If it's missing we can't trust this subscription — roll it back and
        // fail loudly rather than register one whose deliveries we'd have to reject.
        if (typeof response.secret !== 'string' || !response.secret) {
          try {
            await this.helpers.httpRequestWithAuthentication.call(this, 'cellystialApi', {
              method: 'DELETE',
              url: `${CELLYSTIAL_API_BASE_URL}/api/v1/webhooks/${encodeURIComponent(response.id)}`,
              json: true,
            });
          } catch (error) {
            // Best-effort rollback of the just-created subscription.
          }
          throw new NodeOperationError(
            this.getNode(),
            'Cellystial did not return a webhook signing secret, so deliveries cannot be verified. Please try again.',
          );
        }

        const webhookData = this.getWorkflowStaticData('node');
        webhookData.subscriptionId = response.id;
        webhookData.signingSecret = response.secret;
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const webhookData = this.getWorkflowStaticData('node');
        const subscriptionId = webhookData.subscriptionId as string | undefined;
        if (!subscriptionId) {
          return true;
        }
        try {
          await this.helpers.httpRequestWithAuthentication.call(this, 'cellystialApi', {
            method: 'DELETE',
            url: `${CELLYSTIAL_API_BASE_URL}/api/v1/webhooks/${encodeURIComponent(subscriptionId)}`,
            json: true,
          });
        } catch (error) {
          // Subscription may already be gone server-side; clear local state regardless.
        }
        delete webhookData.subscriptionId;
        delete webhookData.signingSecret;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const webhookData = this.getWorkflowStaticData('node');
    const secret = typeof webhookData.signingSecret === 'string' ? webhookData.signingSecret : '';

    const req = this.getRequestObject();
    // n8n buffers the exact request bytes into req.rawBody before webhook() runs (for
    // application/json). readRawBody() is idempotent; guard it so a read failure becomes
    // a clean 401 below rather than an uncaught throw.
    if (typeof req.readRawBody === 'function' && !req.rawBody) {
      try {
        await req.readRawBody();
      } catch (error) {
        // leave rawBody unset → rejected below
      }
    }
    const rawBody = req.rawBody;
    const signature = (this.getHeaderData()['x-cellystial-signature'] as string) || '';

    // Every delivery must carry a valid signature over the EXACT received bytes; we never
    // re-serialize the parsed body (key/whitespace/number drift would break the HMAC).
    // create() guarantees a signing secret is captured, so a missing secret is anomalous —
    // fail closed.
    if (!secret || !rawBody || rawBody.length === 0 || !verifySignature(rawBody, signature, secret)) {
      const res = this.getResponseObject();
      res.status(401).send('Invalid signature');
      return { noWebhookResponse: true };
    }

    return {
      workflowData: [this.helpers.returnJsonArray([this.getBodyData() as IDataObject])],
    };
  }
}
