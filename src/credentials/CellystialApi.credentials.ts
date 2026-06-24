import {
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';
import { CELLYSTIAL_API_BASE_URL } from '../constants';

export class CellystialApi implements ICredentialType {
  name = 'cellystialApi';
  displayName = 'Cellystial API';
  // Points at our own docs site; the n8n lint rule assumes docs live on docs.n8n.io.
  // eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased
  documentationUrl = 'https://cellystial.com/docs';

  authenticate = {
    type: 'generic' as const,
    properties: {
      headers: {
        'Authorization': '=Bearer {{$credentials.apiKey}}'
      }
    }
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: CELLYSTIAL_API_BASE_URL,
      url: '/api/v1/users/me',
      method: 'GET',
    },
  };

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: {
        password: true,
      },
      default: '',
      description: 'The API Key to connect to Cellystial (starts with sk_prod_ or sk_test_).',
    }
  ];
}
