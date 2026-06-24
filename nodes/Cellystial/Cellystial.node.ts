import {
  IExecuteFunctions,
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  ILoadOptionsFunctions,
  INodePropertyOptions,
  NodeOperationError,
} from 'n8n-workflow';
import { CELLYSTIAL_API_BASE_URL } from '../../constants';

export class Cellystial implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Cellystial',
    name: 'cellystial',
    icon: 'file:cellystial.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Generate PDFs via Cellystial API',
    defaults: {
      name: 'Cellystial',
    },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [
      {
        name: 'cellystialApi',
        required: true,
      },
    ],
    requestDefaults: {
      baseURL: CELLYSTIAL_API_BASE_URL,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    },
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Generate PDF',
            value: 'generatePdf',
            description: 'Generate a single PDF from a template',
            action: 'Generate a PDF',
          },
          {
            name: 'Generate PDFs (Batch)',
            value: 'generatePdfBatch',
            description: 'Queue a bulk batch of PDFs from many data rows (async)',
            action: 'Generate a PDF batch',
          },
          {
            name: 'Get Batch Status',
            value: 'getBatchStatus',
            description: 'Check a bulk batch and retrieve download URLs',
            action: 'Get batch status',
          },
        ],
        default: 'generatePdf',
      },
      {
        displayName: 'Template Name or ID',
        name: 'templateId',
        type: 'options',
        description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
        typeOptions: {
          loadOptionsMethod: 'getTemplates',
        },
        displayOptions: {
          show: {
            operation: ['generatePdf', 'generatePdfBatch'],
          },
        },
        default: '',
        required: true,
      },
      {
        displayName: 'JSON Payload',
        name: 'payload',
        type: 'json',
        default: '{}',
        description: 'The JSON data to pass into the template schema',
        displayOptions: {
          show: {
            operation: ['generatePdf'],
          },
        },
        required: true,
      },
      {
        displayName: 'File Name',
        name: 'fileName',
        type: 'string',
        default: 'document.pdf',
        description: 'File name for the generated PDF binary',
        displayOptions: {
          show: {
            operation: ['generatePdf'],
          },
        },
      },
      {
        displayName: 'Put Output File in Field',
        name: 'binaryPropertyName',
        type: 'string',
        default: 'data',
        hint: 'The name of the output binary field to put the generated PDF in',
        displayOptions: {
          show: {
            operation: ['generatePdf'],
          },
        },
      },
      {
        displayName: 'Row Data',
        name: 'rowData',
        type: 'json',
        default: '={{ $json }}',
        description: 'The data for one PDF in the batch. Each incoming item becomes one row; by default the whole item is used. Map specific fields if needed.',
        displayOptions: {
          show: {
            operation: ['generatePdfBatch'],
          },
        },
        required: true,
      },
      {
        displayName: 'Document ID',
        name: 'documentId',
        type: 'string',
        default: '',
        description: 'Optional. Your own unique ID for this row, echoed back in the batch results and used as the PDF filename — so you can map each output PDF to its source (e.g. an invoice number). Set it on every row to use this mode, or leave it blank on all rows to map outputs by position instead.',
        displayOptions: {
          show: {
            operation: ['generatePdfBatch'],
          },
        },
      },
      {
        displayName: 'Output Filename',
        name: 'filename',
        type: 'string',
        default: '',
        description: 'Optional. The output PDF filename for this row. Defaults to the Document ID. Only used when Document ID is set.',
        displayOptions: {
          show: {
            operation: ['generatePdfBatch'],
          },
        },
      },
      {
        displayName: 'Completion Webhook URL',
        name: 'webhookUrl',
        type: 'string',
        default: '',
        description: 'Optional URL that Cellystial calls when the batch finishes generating',
        displayOptions: {
          show: {
            operation: ['generatePdfBatch'],
          },
        },
      },
      {
        displayName: 'Batch ID',
        name: 'batchId',
        type: 'string',
        default: '',
        description: 'The batch ID returned by the Generate PDFs (Batch) operation',
        displayOptions: {
          show: {
            operation: ['getBatchStatus'],
          },
        },
        required: true,
      },
    ],
  };

  methods = {
    loadOptions: {
      async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
        let responseData;
        try {
          responseData = await this.helpers.httpRequestWithAuthentication.call(this, 'cellystialApi', {
            method: 'GET',
            url: `${CELLYSTIAL_API_BASE_URL}/api/v1/integration/templates`,
            qs: {
              limit: 1000,
            },
            json: true,
          });
        } catch (error) {
          throw new NodeOperationError(this.getNode(), error as Error, {
            message: 'Could not load Cellystial templates. Check that your API key is valid.',
          });
        }

        if (!Array.isArray(responseData)) {
          throw new NodeOperationError(
            this.getNode(),
            `Expected an array of templates, but received: ${typeof responseData}`,
          );
        }

        return responseData.map((t: { id: string; name: string; description?: string }) => {
          const option: INodePropertyOptions = {
            name: t.name,
            value: t.id,
          };
          if (t.description) {
            option.description = t.description;
          }
          return option;
        });
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const operation = this.getNodeParameter('operation', 0) as string;

    // ── Generate PDFs (Batch): aggregate every item into one async request ──
    if (operation === 'generatePdfBatch') {
      const templateId = this.getNodeParameter('templateId', 0) as string;
      const webhookUrl = (this.getNodeParameter('webhookUrl', 0, '') as string) || '';

      const rows: Array<{ data: object; documentId: string; filename: string }> = [];
      for (let i = 0; i < items.length; i++) {
        const row = this.getNodeParameter('rowData', i) as string | object;
        let data: object;
        if (typeof row === 'string') {
          try {
            data = JSON.parse(row);
          } catch (e) {
            throw new NodeOperationError(this.getNode(), `Item ${i + 1}: "Row Data" is not valid JSON.`, { itemIndex: i });
          }
        } else {
          data = row;
        }
        // A template row must be a JSON object, not an array or scalar — catch it here
        // with a clear message instead of a confusing per-item render failure later.
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          throw new NodeOperationError(this.getNode(), `Item ${i + 1}: "Row Data" must be a JSON object.`, { itemIndex: i });
        }
        const documentId = ((this.getNodeParameter('documentId', i, '') as string) || '').trim();
        const filename = ((this.getNodeParameter('filename', i, '') as string) || '').trim();
        rows.push({ data, documentId, filename });
      }

      if (rows.length === 0) {
        throw new NodeOperationError(
          this.getNode(),
          'No rows to generate — the Generate PDFs (Batch) node received no input items.',
        );
      }

      // If Document IDs are supplied, send the keyed `items` shape (each output maps
      // back by its documentId); otherwise the positional `data` shape (maps by index).
      // The API requires a documentId on every keyed item, so enforce all-or-none here.
      const withId = rows.filter((r) => r.documentId).length;
      let body: Record<string, unknown>;
      if (withId === 0) {
        body = { templateId, data: rows.map((r) => r.data) };
      } else if (withId === rows.length) {
        body = {
          templateId,
          items: rows.map((r) =>
            r.filename
              ? { documentId: r.documentId, filename: r.filename, data: r.data }
              : { documentId: r.documentId, data: r.data },
          ),
        };
      } else {
        throw new NodeOperationError(
          this.getNode(),
          'Set "Document ID" on every row or leave it blank on all of them — the keyed batch shape requires a unique Document ID for each item.',
        );
      }
      if (webhookUrl) {
        body.webhookUrl = webhookUrl;
      }

      const pairedItem = items.map((_, i) => ({ item: i }));

      try {
        const responseData = await this.helpers.httpRequestWithAuthentication.call(this, 'cellystialApi', {
          method: 'POST',
          url: `${CELLYSTIAL_API_BASE_URL}/api/v1/generate/batch`,
          body,
          json: true,
        });
        return [[{ json: responseData, pairedItem }]];
      } catch (error) {
        if (this.continueOnFail()) {
          return [[{ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem }]];
        }
        throw new NodeOperationError(this.getNode(), error as Error, { message: 'Cellystial batch generation failed.' });
      }
    }

    // ── Get Batch Status: one lookup per input item ────────────────────────
    if (operation === 'getBatchStatus') {
      const statusData: INodeExecutionData[] = [];
      for (let i = 0; i < items.length; i++) {
        try {
          const batchId = this.getNodeParameter('batchId', i) as string;
          const responseData = await this.helpers.httpRequestWithAuthentication.call(this, 'cellystialApi', {
            method: 'GET',
            url: `${CELLYSTIAL_API_BASE_URL}/api/v1/generate/batch/${encodeURIComponent(batchId)}`,
            json: true,
          });

          // The backend populates `results` with pending rows as soon as the batch is
          // queued, so row count can't tell "running" from "done" — gate on the batch
          // status instead, matching the documented poll-then-handle flow.
          const status = String(responseData?.status ?? '');
          const running = status === '' || status === 'queued' || status === 'processing';
          const results = Array.isArray(responseData?.results) ? responseData.results : [];
          if (!running && results.length > 0) {
            // Finished — emit one item per row so each generated PDF flows downstream mapped to its source row.
            for (const row of results) {
              statusData.push({
                json: {
                  batchId: responseData.id ?? batchId,
                  batchStatus: responseData.status,
                  zipUrl: responseData.zipUrl,
                  ...row,
                },
                pairedItem: { item: i },
              });
            }
          } else {
            // Still queued/processing (or no rows yet) — emit the summary so the workflow can poll/branch on `status`.
            statusData.push({ json: responseData ?? { batchId, status }, pairedItem: { item: i } });
          }
        } catch (error) {
          if (this.continueOnFail()) {
            statusData.push({ json: { error: error instanceof Error ? error.message : String(error) }, pairedItem: { item: i } });
            continue;
          }
          throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
        }
      }
      return [statusData];
    }

    // ── Generate PDF (single): one PDF per input item ──────────────────────
    const returnData: INodeExecutionData[] = [];
    for (let i = 0; i < items.length; i++) {
      try {
        const templateId = this.getNodeParameter('templateId', i) as string;
        const rawPayload = this.getNodeParameter('payload', i) as string | object;
        const fileName = (this.getNodeParameter('fileName', i, 'document.pdf') as string) || 'document.pdf';
        const binaryPropertyName = (this.getNodeParameter('binaryPropertyName', i, 'data') as string) || 'data';

        // Accept either a JSON string (from the editor) or an already-parsed object.
        let payload: object;
        if (typeof rawPayload === 'string') {
          try {
            payload = JSON.parse(rawPayload);
          } catch (e) {
            throw new NodeOperationError(this.getNode(), 'The "JSON Payload" field does not contain valid JSON.', { itemIndex: i });
          }
        } else {
          payload = rawPayload;
        }

        // Generate the PDF and receive it as a raw binary buffer.
        const responseData = await this.helpers.httpRequestWithAuthentication.call(this, 'cellystialApi', {
          method: 'POST',
          url: `${CELLYSTIAL_API_BASE_URL}/api/v1/generate`,
          body: JSON.stringify({
            templateId,
            data: payload,
          }),
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/pdf',
          },
          encoding: 'arraybuffer', // receive the PDF as a binary buffer (httpRequest/axios convention)
        });

        const binaryData = await this.helpers.prepareBinaryData(Buffer.from(responseData as ArrayBuffer), fileName, 'application/pdf');

        returnData.push({
          // Carry the input item's JSON through so downstream fields aren't lost,
          // and flag success. (The generated PDF rides along as binary data.)
          json: { ...(items[i].json as IDataObject), success: true },
          binary: {
            [binaryPropertyName]: binaryData,
          },
          pairedItem: { item: i },
        });
      } catch (error) {
        const err = error as { message?: string; response?: { body?: unknown } };
        let errorMessage: string = err.message ?? 'PDF generation failed.';

        // Try to surface a meaningful message from the API response buffer (e.g. 400 Bad Request).
        if (err.response && err.response.body) {
          try {
            const bodyStr = Buffer.isBuffer(err.response.body)
              ? err.response.body.toString('utf-8')
              : String(err.response.body);
            const parsed = JSON.parse(bodyStr);
            if (parsed.message) {
              errorMessage = Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message;
            }
          } catch (e) {
            // Response body was not JSON — keep the original message.
          }
        }

        if (this.continueOnFail()) {
          returnData.push({ json: { error: errorMessage }, pairedItem: { item: i } });
          continue;
        }

        throw new NodeOperationError(this.getNode(), errorMessage, { itemIndex: i });
      }
    }

    return [returnData];
  }
}
