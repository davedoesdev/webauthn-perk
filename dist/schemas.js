import schemas from './schemas.webauthn4js.js';

const { $defs, $schema } = schemas;

const issuer_id = { type: 'string' };

const session_data = {
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
                    options: $defs.CredentialAssertion,
                    session_data
                },
                $defs,
                $schema
            },
            404: {
                type: 'object',
                required: [
                    'options',
                    'session_data'
                ],
                additionalProperties: false,
                properties: {
                    options: $defs.CredentialCreation,
                    session_data
                },
                $defs,
                $schema
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
                ccr: $defs.CredentialCreationResponse,
                session_data
            },
            $defs,
            $schema
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
                    options: $defs.CredentialAssertion
                },
                $defs,
                $schema
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
                car: $defs.CredentialAssertionResponse,
                session_data
            },
            $defs,
            $schema
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
                    car: $defs.CredentialAssertionResponse
                },
                $defs,
                $schema
            },
            response: response_schema
        }
    };
}
