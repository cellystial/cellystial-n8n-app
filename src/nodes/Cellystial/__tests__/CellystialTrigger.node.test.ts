import { CellystialTrigger } from '../CellystialTrigger.node';
import { IHookFunctions, IWebhookFunctions, IDataObject } from 'n8n-workflow';
import * as crypto from 'crypto';

/** Builds a valid `t=<unix>,v1=<hex>` signature for the given raw body + secret. */
function sign(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('CellystialTrigger Node', () => {
  const node = new CellystialTrigger();

  describe('webhookMethods.create', () => {
    it('registers a subscription with the node webhook URL + events and stores the id', async () => {
      const staticData: IDataObject = {};
      let captured: { method?: string; url?: string; body?: unknown } = {};

      const ctx = {
        getNodeWebhookUrl: (_name: string) => 'https://n8n.test/webhook/abc',
        getNodeParameter: (name: string) =>
          name === 'events' ? ['pdf.generated', 'batch.completed'] : undefined,
        getWorkflowStaticData: (_type: string) => staticData,
        getNode: () => ({ name: 'Cellystial Trigger' }),
        helpers: {
          requestWithAuthentication: async function (
            credentialType: string,
            options: { method?: string; url?: string; body?: unknown },
          ) {
            captured = options;
            return { id: 'wh_1', secret: 'whsec_1' };
          },
        },
      } as unknown as IHookFunctions;

      const created = await node.webhookMethods.default.create.call(ctx);

      expect(created).toBe(true);
      expect(captured.method).toBe('POST');
      expect(captured.url).toMatch(/\/api\/v1\/webhooks$/);
      expect(captured.body).toEqual({
        url: 'https://n8n.test/webhook/abc',
        events: ['pdf.generated', 'batch.completed'],
        description: 'n8n',
      });
      expect(staticData.subscriptionId).toBe('wh_1');
    });

    it('stores the per-subscription signing secret when the API returns one', async () => {
      const staticData: IDataObject = {};
      const ctx = {
        getNodeWebhookUrl: (_name: string) => 'https://n8n.test/webhook/abc',
        getNodeParameter: (name: string) => (name === 'events' ? ['pdf.generated'] : undefined),
        getWorkflowStaticData: (_type: string) => staticData,
        getNode: () => ({ name: 'Cellystial Trigger' }),
        helpers: {
          requestWithAuthentication: async function () {
            return { id: 'wh_2', secret: 'whsec_abc123' };
          },
        },
      } as unknown as IHookFunctions;

      await node.webhookMethods.default.create.call(ctx);
      expect(staticData.subscriptionId).toBe('wh_2');
      expect(staticData.signingSecret).toBe('whsec_abc123');
    });

    it('rolls back (DELETE) and throws when the API returns no signing secret', async () => {
      const staticData: IDataObject = {};
      const calls: Array<{ method?: string; url?: string }> = [];
      const ctx = {
        getNodeWebhookUrl: (_name: string) => 'https://n8n.test/webhook/abc',
        getNodeParameter: (name: string) => (name === 'events' ? ['pdf.generated'] : undefined),
        getWorkflowStaticData: (_type: string) => staticData,
        getNode: () => ({ name: 'Cellystial Trigger' }),
        helpers: {
          requestWithAuthentication: async function (_c: string, options: { method?: string; url?: string }) {
            calls.push({ method: options.method, url: options.url });
            return options.method === 'POST' ? { id: 'wh_nosecret' } : {};
          },
        },
      } as unknown as IHookFunctions;

      await expect(node.webhookMethods.default.create.call(ctx)).rejects.toThrow(/signing secret/i);
      // The orphan subscription is cleaned up, and nothing partial is persisted.
      expect(calls.map((c) => c.method)).toEqual(['POST', 'DELETE']);
      expect(calls[1].url).toMatch(/\/api\/v1\/webhooks\/wh_nosecret$/);
      expect(staticData.subscriptionId).toBeUndefined();
      expect(staticData.signingSecret).toBeUndefined();
    });
  });

  describe('webhookMethods.checkExists', () => {
    it('is false before registration and true once a subscription id is stored', async () => {
      const before = { getWorkflowStaticData: () => ({}) } as unknown as IHookFunctions;
      const after = { getWorkflowStaticData: () => ({ subscriptionId: 'wh_1' }) } as unknown as IHookFunctions;
      expect(await node.webhookMethods.default.checkExists.call(before)).toBe(false);
      expect(await node.webhookMethods.default.checkExists.call(after)).toBe(true);
    });
  });

  describe('webhookMethods.delete', () => {
    it('deletes the stored subscription and clears local state', async () => {
      const staticData: IDataObject = { subscriptionId: 'wh_1', signingSecret: 'whsec_abc123' };
      let captured: { method?: string; url?: string } = {};

      const ctx = {
        getWorkflowStaticData: (_type: string) => staticData,
        helpers: {
          requestWithAuthentication: async function (credentialType: string, options: { method?: string; url?: string }) {
            captured = options;
            return {};
          },
        },
      } as unknown as IHookFunctions;

      const deleted = await node.webhookMethods.default.delete.call(ctx);

      expect(deleted).toBe(true);
      expect(captured.method).toBe('DELETE');
      expect(captured.url).toMatch(/\/api\/v1\/webhooks\/wh_1$/);
      expect(staticData.subscriptionId).toBeUndefined();
      expect(staticData.signingSecret).toBeUndefined();
    });
  });

  describe('webhook', () => {
    const SECRET = 'whsec_test_secret';
    const payload = { event: 'pdf.generated', filename: 'a.pdf' };
    const rawBody = JSON.stringify(payload);

    // Builds a webhook ctx; captures any response status/body the node sends.
    function makeCtx(opts: {
      signingSecret?: string;
      signature?: string;
      rawBody?: string;
      noRawBody?: boolean;
      lazyRawBody?: string;
      readRawBodyThrows?: boolean;
    }): { ctx: IWebhookFunctions; sent: { status?: number; body?: unknown } } {
      const sent: { status?: number; body?: unknown } = {};
      const getRequestObject = () => {
        if (opts.readRawBodyThrows) {
          return { readRawBody: async () => { throw new Error('stream already consumed'); } };
        }
        if (opts.lazyRawBody !== undefined) {
          // No pre-populated rawBody; readRawBody() lazily buffers it (as n8n would).
          const req: { rawBody?: Buffer; readRawBody: () => Promise<void> } = {
            readRawBody: async () => { req.rawBody = Buffer.from(opts.lazyRawBody as string); },
          };
          return req;
        }
        return opts.noRawBody ? {} : { rawBody: Buffer.from(opts.rawBody ?? rawBody) };
      };
      const ctx = {
        getBodyData: () => payload,
        getWorkflowStaticData: (_type: string) =>
          opts.signingSecret ? { signingSecret: opts.signingSecret } : {},
        getHeaderData: () => ({ 'x-cellystial-signature': opts.signature ?? '' }),
        getRequestObject,
        getResponseObject: () => ({
          status: (code: number) => {
            sent.status = code;
            return { send: (b: unknown) => { sent.body = b; } };
          },
        }),
        helpers: { returnJsonArray: (data: IDataObject[]) => data.map((json) => ({ json })) },
      } as unknown as IWebhookFunctions;
      return { ctx, sent };
    }

    it('emits the event body when the signature is valid', async () => {
      const { ctx, sent } = makeCtx({ signingSecret: SECRET, signature: sign(rawBody, SECRET) });
      const res = await node.webhook.call(ctx);
      expect(res.workflowData).toBeDefined();
      expect(res.workflowData![0][0].json).toMatchObject({ event: 'pdf.generated', filename: 'a.pdf' });
      expect(sent.status).toBeUndefined();
    });

    it('rejects with 401 and does not start the workflow when the signature is invalid', async () => {
      const { ctx, sent } = makeCtx({ signingSecret: SECRET, signature: sign(rawBody, 'wrong_secret') });
      const res = await node.webhook.call(ctx);
      expect(res.workflowData).toBeUndefined();
      expect(res.noWebhookResponse).toBe(true);
      expect(sent.status).toBe(401);
    });

    it('rejects when the signature header is missing', async () => {
      const { ctx, sent } = makeCtx({ signingSecret: SECRET, signature: '' });
      const res = await node.webhook.call(ctx);
      expect(res.workflowData).toBeUndefined();
      expect(sent.status).toBe(401);
    });

    it('rejects a replayed (stale-timestamp) signature', async () => {
      const stale = sign(rawBody, SECRET, Math.floor(Date.now() / 1000) - 3600);
      const { ctx, sent } = makeCtx({ signingSecret: SECRET, signature: stale });
      const res = await node.webhook.call(ctx);
      expect(res.workflowData).toBeUndefined();
      expect(sent.status).toBe(401);
    });

    it('rejects with 401 when the raw body is unavailable (never re-serializes)', async () => {
      const { ctx, sent } = makeCtx({ signingSecret: SECRET, signature: sign(rawBody, SECRET), noRawBody: true });
      const res = await node.webhook.call(ctx);
      expect(res.workflowData).toBeUndefined();
      expect(sent.status).toBe(401);
    });

    it('reads the raw body via readRawBody() when n8n has not pre-populated it', async () => {
      const { ctx, sent } = makeCtx({ signingSecret: SECRET, signature: sign(rawBody, SECRET), lazyRawBody: rawBody });
      const res = await node.webhook.call(ctx);
      expect(res.workflowData).toBeDefined();
      expect(res.workflowData![0][0].json).toMatchObject({ event: 'pdf.generated' });
      expect(sent.status).toBeUndefined();
    });

    it('rejects with 401 (no uncaught throw) when readRawBody() fails', async () => {
      const { ctx, sent } = makeCtx({ signingSecret: SECRET, signature: sign(rawBody, SECRET), readRawBodyThrows: true });
      const res = await node.webhook.call(ctx);
      expect(res.workflowData).toBeUndefined();
      expect(sent.status).toBe(401);
    });

    it('fails closed with 401 when no signing secret is stored', async () => {
      const { ctx, sent } = makeCtx({ signature: 'anything' });
      const res = await node.webhook.call(ctx);
      expect(res.workflowData).toBeUndefined();
      expect(sent.status).toBe(401);
    });
  });
});
