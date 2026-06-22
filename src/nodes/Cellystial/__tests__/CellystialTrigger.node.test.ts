import { CellystialTrigger } from '../CellystialTrigger.node';
import { IHookFunctions, IWebhookFunctions, IDataObject } from 'n8n-workflow';

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
            return { id: 'wh_1' };
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
  });

  describe('webhookMethods.checkExists', () => {
    it('is false before registration and true after', async () => {
      const before = { getWorkflowStaticData: () => ({}) } as unknown as IHookFunctions;
      const after = { getWorkflowStaticData: () => ({ subscriptionId: 'wh_1' }) } as unknown as IHookFunctions;
      expect(await node.webhookMethods.default.checkExists.call(before)).toBe(false);
      expect(await node.webhookMethods.default.checkExists.call(after)).toBe(true);
    });
  });

  describe('webhookMethods.delete', () => {
    it('deletes the stored subscription and clears local state', async () => {
      const staticData: IDataObject = { subscriptionId: 'wh_1' };
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
    });
  });

  describe('webhook', () => {
    it('emits the incoming event body as workflow data', async () => {
      const ctx = {
        getBodyData: () => ({ event: 'pdf.generated', filename: 'a.pdf' }),
        helpers: {
          returnJsonArray: (data: IDataObject[]) => data.map((json) => ({ json })),
        },
      } as unknown as IWebhookFunctions;

      const res = await node.webhook.call(ctx);
      expect(res.workflowData).toBeDefined();
      expect(res.workflowData![0][0].json).toMatchObject({ event: 'pdf.generated', filename: 'a.pdf' });
    });
  });
});
