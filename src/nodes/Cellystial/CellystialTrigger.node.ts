import {
  IHookFunctions,
  IWebhookFunctions,
  IDataObject,
  INodeType,
  INodeTypeDescription,
  IWebhookResponseData,
  NodeOperationError,
} from 'n8n-workflow';
import { CELLYSTIAL_API_BASE_URL } from '../../constants';

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
    icon: 'file:cellystial.png',
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
          { name: 'PDF Generated', value: 'pdf.generated', description: 'A single PDF finished generating' },
          { name: 'Batch Completed', value: 'batch.completed', description: 'A bulk batch finished generating' },
          { name: 'Template Created', value: 'template.created', description: 'A template was created' },
          { name: 'Template Updated', value: 'template.updated', description: 'A template was updated' },
          { name: 'Template Deleted', value: 'template.deleted', description: 'A template was deleted' },
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

        let response: { id?: string } | undefined;
        try {
          response = await this.helpers.requestWithAuthentication.call(this, 'cellystialApi', {
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

        const webhookData = this.getWorkflowStaticData('node');
        webhookData.subscriptionId = response.id;
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const webhookData = this.getWorkflowStaticData('node');
        const subscriptionId = webhookData.subscriptionId as string | undefined;
        if (!subscriptionId) {
          return true;
        }
        try {
          await this.helpers.requestWithAuthentication.call(this, 'cellystialApi', {
            method: 'DELETE',
            url: `${CELLYSTIAL_API_BASE_URL}/api/v1/webhooks/${encodeURIComponent(subscriptionId)}`,
            json: true,
          });
        } catch (error) {
          // Subscription may already be gone server-side; clear local state regardless.
        }
        delete webhookData.subscriptionId;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const body = this.getBodyData();
    return {
      workflowData: [this.helpers.returnJsonArray([body as IDataObject])],
    };
  }
}
