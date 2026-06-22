"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CellystialTrigger = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const constants_1 = require("../../constants");
/**
 * Cellystial Trigger — starts a workflow when a Cellystial event fires.
 *
 * Uses n8n's webhook-registration lifecycle: on activation it registers this
 * node's webhook URL as a Cellystial subscription (POST /api/v1/webhooks) for
 * the chosen events, and on deactivation it deletes it (DELETE /api/v1/webhooks/:id).
 * Cellystial then POSTs signed event payloads straight to n8n.
 */
class CellystialTrigger {
    constructor() {
        this.description = {
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
        this.webhookMethods = {
            default: {
                async checkExists() {
                    const webhookData = this.getWorkflowStaticData('node');
                    return typeof webhookData.subscriptionId === 'string' && webhookData.subscriptionId.length > 0;
                },
                async create() {
                    const webhookUrl = this.getNodeWebhookUrl('default');
                    if (!webhookUrl) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Could not resolve the n8n webhook URL for this node.');
                    }
                    const events = this.getNodeParameter('events');
                    let response;
                    try {
                        response = await this.helpers.requestWithAuthentication.call(this, 'cellystialApi', {
                            method: 'POST',
                            url: `${constants_1.CELLYSTIAL_API_BASE_URL}/api/v1/webhooks`,
                            body: { url: webhookUrl, events, description: 'n8n' },
                            json: true,
                        });
                    }
                    catch (error) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), error, {
                            message: 'Could not register the Cellystial webhook subscription. Check that your API key is valid.',
                        });
                    }
                    if (!(response === null || response === void 0 ? void 0 : response.id)) {
                        throw new n8n_workflow_1.NodeOperationError(this.getNode(), 'Cellystial did not return a subscription id when registering the webhook.');
                    }
                    const webhookData = this.getWorkflowStaticData('node');
                    webhookData.subscriptionId = response.id;
                    return true;
                },
                async delete() {
                    const webhookData = this.getWorkflowStaticData('node');
                    const subscriptionId = webhookData.subscriptionId;
                    if (!subscriptionId) {
                        return true;
                    }
                    try {
                        await this.helpers.requestWithAuthentication.call(this, 'cellystialApi', {
                            method: 'DELETE',
                            url: `${constants_1.CELLYSTIAL_API_BASE_URL}/api/v1/webhooks/${encodeURIComponent(subscriptionId)}`,
                            json: true,
                        });
                    }
                    catch (error) {
                        // Subscription may already be gone server-side; clear local state regardless.
                    }
                    delete webhookData.subscriptionId;
                    return true;
                },
            },
        };
    }
    async webhook() {
        const body = this.getBodyData();
        return {
            workflowData: [this.helpers.returnJsonArray([body])],
        };
    }
}
exports.CellystialTrigger = CellystialTrigger;
