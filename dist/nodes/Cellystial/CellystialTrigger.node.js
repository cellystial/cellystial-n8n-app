"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CellystialTrigger = void 0;
const n8n_workflow_1 = require("n8n-workflow");
const crypto = __importStar(require("crypto"));
const constants_1 = require("../../constants");
const SIGNATURE_TOLERANCE_SECONDS = 300;
/**
 * Verifies a Cellystial `X-Cellystial-Signature` header against the raw body.
 *
 * Mirrors the signing scheme in the backend's `webhook-signature.util` and the
 * published SDKs' `verifyWebhook`: header is `t=<unix>,v1=<hex>` and the HMAC is
 * `HMAC_SHA256(secret, "<t>.<rawBody>")`, compared in constant time, with a
 * timestamp-tolerance window to bound replay.
 */
function verifySignature(rawBody, signatureHeader, secret) {
    if (!signatureHeader || !secret)
        return false;
    const parts = {};
    for (const segment of signatureHeader.split(',')) {
        const idx = segment.indexOf('=');
        if (idx === -1)
            continue;
        const key = segment.slice(0, idx).trim();
        if (key)
            parts[key] = segment.slice(idx + 1).trim();
    }
    const t = Number(parts.t);
    if (!parts.t || !Number.isFinite(t) || !parts.v1)
        return false;
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - t) > SIGNATURE_TOLERANCE_SECONDS)
        return false;
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(parts.v1, 'hex');
    if (a.length === 0 || a.length !== b.length)
        return false;
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
                    // The per-subscription signing secret is returned exactly once, here. Store it
                    // so incoming deliveries can be signature-verified (see webhook()).
                    if (typeof response.secret === 'string' && response.secret) {
                        webhookData.signingSecret = response.secret;
                    }
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
                    delete webhookData.signingSecret;
                    return true;
                },
            },
        };
    }
    async webhook() {
        const body = this.getBodyData();
        const webhookData = this.getWorkflowStaticData('node');
        const secret = typeof webhookData.signingSecret === 'string' ? webhookData.signingSecret : '';
        // Verify the delivery signature when we have a stored secret. Subscriptions
        // registered before signature support have no secret stored — we can't verify
        // those, so they pass through (re-activating the workflow re-registers and
        // captures a secret). Newly registered subscriptions are always verified.
        if (secret) {
            const headers = this.getHeaderData();
            const signature = headers['x-cellystial-signature'] || '';
            // Verify against the exact bytes received — re-serializing the parsed body
            // would reorder keys and break the byte-for-byte HMAC.
            const req = this.getRequestObject();
            const rawBody = req && req.rawBody && req.rawBody.length ? req.rawBody.toString('utf8') : JSON.stringify(body);
            if (!verifySignature(rawBody, signature, secret)) {
                const res = this.getResponseObject();
                res.status(401).send('Invalid signature');
                return { noWebhookResponse: true };
            }
        }
        return {
            workflowData: [this.helpers.returnJsonArray([body])],
        };
    }
}
exports.CellystialTrigger = CellystialTrigger;
