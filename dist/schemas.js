import schema_migrate from 'json-schema-migrate';
import schemas from './schemas.webauthn4js.js';

const { definitions, $schema } = schemas;

function fixup(schema) {
    const to_delete = [];
    const to_add = {};
    for (const key in schema) {
        const val = schema[key];
        if (key === 'additionalProperties') {
            to_add.type = 'object';
            continue;
        }
        if ((key === 'media') && val.binaryEncoding) {
            to_add.contentEncoding = val.binaryEncoding;
            to_delete.push(key);
            continue;
        }
        if (typeof(val) === 'object') {
            fixup(val);
        }
    }
    for (const key of to_delete) {
        delete schema[key];
    }
    Object.assign(schema, to_add);
}

function migrate(schema) {
    schema_migrate.draft7(schema);
    fixup(schema);
    return schema;
}

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
            200: migrate({
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
                definitions,
                $schema
            }),
            404: migrate({
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
                definitions,
                $schema
            })
        }
    },
    put: {
        body: migrate({
            type: 'object',
            required: [
                'ccr',
                'session_data'
            ],
            properties: {
                ccr: definitions.CredentialCreationResponse,
                session_data
            },
            definitions,
            $schema
        }),
        response: {
            201: migrate({
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
                definitions,
                $schema
            })
        }
    },
    post: {
        body: migrate({
            type: 'object',
            required: [
                'car',
                'session_data'
            ],
            properties: {
                car: definitions.CredentialAssertionResponse,
                session_data
            },
            definitions,
            $schema
        })
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
            body: migrate({
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
                definitions,
                $schema
            }),
            response: response_schema
        }
    };
}
