/*eslint-env shared-node-browser */

import schemas from './schemas.webauthn4js.js';
const { definitions } = schemas;

const issuer_id = { type: 'string' };

const encrypted_data = {
    type: 'object',
    required: [
        'ciphertext',
        'nonce'
    ],
    additionalProperties: false,
    properties: {
        ciphertext: {
            type: 'string',
            contentEncoding: 'base64'
        },
        nonce: {
            type: 'string',
            contentEncoding: 'base64'
        }
    }
};

const session_data = encrypted_data;

const encrypted_credentials = {
    type: 'array',
    items: {
        type: 'object',
        required: [
            'id',
            'encrypted_credential'
        ],
        additionalProperties: false,
        properties: {
            id: { type: 'string' },
            encrypted_credential: encrypted_data
        }
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
            201: {
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

export function perk(response_schema, access) {
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
            response: access ? undefined : response_schema
        },
        post: {
            body: {
                type: 'object',
                required: [
                    'assertion',
                    ...(access ? ['access'] : [])
                ],
                additionalProperties: false,
                properties: {
                    assertion: {
                        type: 'object',
                        required: [
                            'issuer_id',
                            'car'
                        ],
                        additionalProperties: false,
                        properties: {
                            issuer_id,
                            car: definitions.CredentialAssertionResponse
                        }
                    },
                    ...(access ? {
                        access: {
                            oneOf: [
                                cred.post.body,
                                { type: 'string' }
                            ]
                        }
                    } : {})
                },
                definitions
            },
            response: response_schema
        }
    };
}

export const access = {
    get: {
        response: {
            200: cred.get.response[404]
        }
    },
    post: {
        body: {
            oneOf: [
                { ...cred.put.body, additionalProperties: true },
                { ...cred.post.body, additionalProperties: true },
                { ...perk().post.body, additionalProperties: true }
            ],
            definitions
        },
        response: {
            200: encrypted_credentials,
            201: {
                ...cred.put.response[201],
                required: [
                    ...cred.put.response[201].required,
                    'encrypted_credentials'
                ],
                properties: {
                    ...cred.put.response[201].properties,
                    encrypted_credentials
                }
            }
        }
    },
    post_payload: {
        type: 'object',
        required: [
            'encrypted_credentials'
        ],
        properties: {
            encrypted_credentials
        }
    }
};
