import { Cellystial } from '../Cellystial.node';
import { ILoadOptionsFunctions, IExecuteFunctions, IHttpRequestOptions } from 'n8n-workflow';
import nock from 'nock';

describe('Cellystial Node', () => {
  let node: Cellystial;

  beforeEach(() => {
    node = new Cellystial();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe('loadOptions', () => {
    it('should fetch templates and format them correctly', async () => {
      nock('https://api.cellystial.com')
        .get('/api/v1/integration/templates')
        .reply(200, [
          { id: 't1', name: 'Invoice Template', description: 'desc1' },
          { id: 't2', name: 'Receipt Template', description: 'desc2' },
        ]);

      // Mock n8n ILoadOptionsFunctions context
      const mockContext = {
        helpers: {
          requestWithAuthentication: async function(credentialType: string, options: IHttpRequestOptions) {
            // Mimic the n8n request wrapper behavior using native fetch/axios/request
            const fetch = require('node-fetch');
            const res = await fetch(options.url, { method: options.method });
            return await res.json();
          }
        }
      } as unknown as ILoadOptionsFunctions;

      const getTemplates = node.methods!.loadOptions!.getTemplates.bind(mockContext);
      const result = await getTemplates();

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ name: 'Invoice Template', value: 't1', description: 'desc1' });
      expect(result[1]).toEqual({ name: 'Receipt Template', value: 't2', description: 'desc2' });
    });
  });

  describe('execute', () => {
    it('should successfully generate a PDF and return a binary buffer', async () => {
      const mockPdfBuffer = Buffer.from('%PDF-1.4 mock pdf content');

      nock('https://api.cellystial.com')
        .post('/api/v1/generate', { templateId: 't1', data: { amount: 100 } })
        .reply(200, mockPdfBuffer, { 'Content-Type': 'application/pdf' });

      let binaryDataAdded = false;

      // Mock n8n IExecuteFunctions context
      const mockContext = {
        getInputData: () => [{ json: {} }], // 1 item
        getNodeParameter: (paramName: string, itemIndex: number) => {
          if (paramName === 'operation') return 'generatePdf';
          if (paramName === 'templateId') return 't1';
          if (paramName === 'payload') return { amount: 100 };
          return undefined;
        },
        helpers: {
          requestWithAuthentication: async function(credentialType: string, options: IHttpRequestOptions) {
            const fetch = require('node-fetch');
            const res = await fetch(options.url, {
              method: options.method,
              body: options.body,
              headers: options.headers
            });
            return await res.buffer();
          },
          prepareBinaryData: async (buffer: Buffer, fileName: string, mimeType: string) => {
            expect(fileName).toBe('document.pdf');
            expect(mimeType).toBe('application/pdf');
            binaryDataAdded = true;
            return { data: buffer.toString('base64'), mimeType, fileName };
          }
        },
        continueOnFail: () => false,
      } as unknown as IExecuteFunctions;

      const result = await node.execute.bind(mockContext)();

      expect(binaryDataAdded).toBe(true);
      expect(result).toHaveLength(1); // 1 array of items (since it returns INodeExecutionData[][])
      expect(result[0]).toHaveLength(1); // 1 item
      expect(result[0][0].json).toEqual({ success: true });
      expect(result[0][0].binary!.data).toBeDefined();
    });

    it('should handle API errors and parse the JSON error message', async () => {
      nock('https://api.cellystial.com')
        .post('/api/v1/generate')
        .reply(400, Buffer.from(JSON.stringify({ message: ['Invalid payload missing amount'] })));

      const mockContext = {
        getInputData: () => [{ json: {} }],
        getNodeParameter: (paramName: string, itemIndex: number) => {
          if (paramName === 'operation') return 'generatePdf';
          if (paramName === 'templateId') return 't1';
          if (paramName === 'payload') return { amount: null };
          return undefined;
        },
        helpers: {
          requestWithAuthentication: async function(credentialType: string, options: IHttpRequestOptions) {
            const error = new Error('400 Bad Request') as Error & { response?: { body?: Buffer } };
            error.response = { body: Buffer.from(JSON.stringify({ message: ['Invalid payload missing amount'] })) };
            throw error;
          }
        },
        getNode: () => ({ id: '1', name: 'Cellystial', type: 'cellystial', typeVersion: 1, position: [0, 0], parameters: {} }),
        continueOnFail: () => false,
      } as unknown as IExecuteFunctions;

      await expect(node.execute.bind(mockContext)()).rejects.toThrow('Invalid payload missing amount');
    });
    
    it('should continue on fail if set', async () => {
      nock('https://api.cellystial.com')
        .post('/api/v1/generate')
        .reply(400, Buffer.from(JSON.stringify({ message: ['Invalid payload missing amount'] })));

      const mockContext = {
        getInputData: () => [{ json: {} }],
        getNodeParameter: (paramName: string, itemIndex: number) => {
          if (paramName === 'operation') return 'generatePdf';
          if (paramName === 'templateId') return 't1';
          if (paramName === 'payload') return { amount: null };
          return undefined;
        },
        helpers: {
          requestWithAuthentication: async function(credentialType: string, options: IHttpRequestOptions) {
            const error = new Error('400 Bad Request') as Error & { response?: { body?: Buffer } };
            error.response = { body: Buffer.from(JSON.stringify({ message: ['Invalid payload missing amount'] })) };
            throw error;
          }
        },
        continueOnFail: () => true, // SET TO TRUE
      } as unknown as IExecuteFunctions;

      const result = await node.execute.bind(mockContext)();
      
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(1);
      expect(result[0][0].json).toEqual({ error: 'Invalid payload missing amount' });
    });
  });

  describe('execute - batch', () => {
    it('aggregates all items into one /generate/batch call and returns the batch id', async () => {
      let capturedUrl: string | undefined;
      let capturedBody: unknown;

      const mockContext = {
        getInputData: () => [{ json: { name: 'A' } }, { json: { name: 'B' } }],
        getNodeParameter: (paramName: string, itemIndex: number, fallback?: unknown) => {
          if (paramName === 'operation') return 'generatePdfBatch';
          if (paramName === 'templateId') return 't1';
          if (paramName === 'webhookUrl') return fallback ?? '';
          if (paramName === 'rowData') return itemIndex === 0 ? { name: 'A' } : { name: 'B' };
          return undefined;
        },
        helpers: {
          requestWithAuthentication: async function(credentialType: string, options: IHttpRequestOptions) {
            capturedUrl = options.url;
            capturedBody = options.body;
            return { batchId: 'batch_123', status: 'queued' };
          }
        },
        getNode: () => ({ id: '1', name: 'Cellystial', type: 'cellystial', typeVersion: 1, position: [0, 0], parameters: {} }),
        continueOnFail: () => false,
      } as unknown as IExecuteFunctions;

      const result = await node.execute.bind(mockContext)();

      expect(capturedUrl).toMatch(/\/api\/v1\/generate\/batch$/);
      const body = capturedBody as { templateId: string; data: Array<Record<string, unknown>>; webhookUrl?: string };
      expect(body.templateId).toBe('t1');
      expect(body.data).toHaveLength(2);
      expect(body.data[0]).toEqual({ name: 'A' });
      expect(body.webhookUrl).toBeUndefined();
      expect(result[0]).toHaveLength(1);
      expect(result[0][0].json).toEqual({ batchId: 'batch_123', status: 'queued' });
    });
  });

  describe('execute - getBatchStatus', () => {
    it('emits one item per row from the batch status results', async () => {
      let capturedUrl: string | undefined;
      let capturedMethod: string | undefined;

      const mockContext = {
        getInputData: () => [{ json: {} }],
        getNodeParameter: (paramName: string, itemIndex: number) => {
          if (paramName === 'operation') return 'getBatchStatus';
          if (paramName === 'batchId') return 'batch_123';
          return undefined;
        },
        helpers: {
          requestWithAuthentication: async function(credentialType: string, options: IHttpRequestOptions) {
            capturedUrl = options.url;
            capturedMethod = options.method;
            return {
              id: 'batch_123',
              status: 'completed',
              total: 2,
              completed: 2,
              failed: 0,
              results: [
                { rowIndex: 0, status: 'completed', downloadUrl: 'https://files/0.pdf' },
                { rowIndex: 1, status: 'completed', downloadUrl: 'https://files/1.pdf' },
              ],
              zipUrl: 'https://files/batch_123.zip',
            };
          }
        },
        getNode: () => ({ id: '1', name: 'Cellystial', type: 'cellystial', typeVersion: 1, position: [0, 0], parameters: {} }),
        continueOnFail: () => false,
      } as unknown as IExecuteFunctions;

      const result = await node.execute.bind(mockContext)();

      expect(capturedMethod).toBe('GET');
      expect(capturedUrl).toContain('/api/v1/generate/batch/batch_123');
      expect(result[0]).toHaveLength(2);
      expect(result[0][0].json).toMatchObject({ rowIndex: 0, downloadUrl: 'https://files/0.pdf', zipUrl: 'https://files/batch_123.zip', batchId: 'batch_123' });
      expect(result[0][1].json).toMatchObject({ rowIndex: 1, downloadUrl: 'https://files/1.pdf' });
    });
  });
});
