/*eslint-env shared-node-browser */

import schemas from './schemas.webauthn4js.js';
const { definitions } = schemas;

const issuer_id = { type: 'string' };

const session_data = {
    type: 'object',
    required: [
        'ciphertext',
        'nonce'
    ],
    additionalProperties: false,
    properties: {
        ciphertext: { type: 'string' },
        nonce: { type: 'string' }
    }
};

export const cred = {
    get: {
        response: {
            200: {
                type: 'object',
                required: [
                    'issuer_id',
                    'options',
                    'session_data'
                ],
                additionalProperties: false,
                properties: {
                    issuer_id,
                    options: definitions.CredentialAssertion,
                    session_data
                },
                definitions
            },
            404: {
                type: 'object',
                required: [
                    'options',
                    'session_data'
                ],
                additionalProperties: false,
                properties: {
                    options: definitions.CredentialCreation,
                    session_data
                },
                definitions
            }
        }
    },
    put: {
        body: {
            type: 'object',
            required: [
                'ccr',
                'session_data'
            ],
            properties: {
                ccr: definitions.CredentialCreationResponse,
                session_data
            },
            definitions
        },
        response: {
            200: {
                type: 'object',
                required: [
                    'issuer_id',
                    'options'
                ],
                additionalProperties: false,
                properties: {
                    issuer_id,
                    options: definitions.CredentialAssertion
                },
                definitions
            }
        }
    },
    post: {
        body: {
            type: 'object',
            required: [
                'car',
                'session_data'
            ],
            properties: {
                car: definitions.CredentialAssertionResponse,
                session_data
            },
            definitions
        }
    }
};

export function perk(response_schema) {
    return {
        get: {
            querystring: {
                type: 'object',
                required: [
                    'assertion'
                ],
                additionalProperties: false,
                properties: {
                    assertion: { type: 'string' }
                }
            },
            response: response_schema
        },

        post: {
            body: {
                type: 'object',
                required: [
                    'issuer_id',
                    'car'
                ],
                additionalProperties: false,
                properties: {
                    issuer_id,
                    car: definitions.CredentialAssertionResponse
                },
                definitions
            },
            response: response_schema
        }
    };
}
