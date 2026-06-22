"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CellystialApi = void 0;
const constants_1 = require("../constants");
class CellystialApi {
    constructor() {
        this.name = 'cellystialApi';
        this.displayName = 'Cellystial API';
        this.documentationUrl = 'https://cellystial.com/docs';
        this.authenticate = {
            type: 'generic',
            properties: {
                headers: {
                    'Authorization': '=Bearer {{$credentials.apiKey}}'
                }
            }
        };
        this.test = {
            request: {
                baseURL: constants_1.CELLYSTIAL_API_BASE_URL,
                url: '/api/v1/users/me',
                method: 'GET',
            },
        };
        this.properties = [
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
}
exports.CellystialApi = CellystialApi;
