/*eslint-env shared-node-browser */

function byte_array(nullable) {
    const types = ['array'];
    if (nullable) {
        types.push('null');
    }
    return {
        type: types,
        items: {
            type: 'integer',
            minimum: 0,
            maximum: 255
        }
    };
}

export const non_nullable_byte_array = byte_array(false);
export const nullable_byte_array = byte_array(true);

function key_info(challenge) {
    const r = {
        type: 'object',
        required: [
            'cred_id',
            'issuer_id'
        ],
        additionalProperties: false,
        properties: {
            cred_id: non_nullable_byte_array,
            issuer_id: { type: 'string' }
        }
    };
    if (challenge) {
        r.required.push('challenge');
        r.properties.challenge = non_nullable_byte_array;
    }
    return r;
}

export const cred = {
    get: {
        response: {
            200: key_info(true),
            404: {
                type: 'object',
                required: [
                    'rp',
                    'user',
                    'challenge',
                    'pubKeyCredParams',
                    'timeout',
                    'attestation'
                ],
                additionalProperties: false,
                properties: {
                    rp: {
                        type: 'object',
                        required: [
                            'name'
                        ],
                        addtionalProperties: false,
                        properties: {
                            name: { type: 'string' },
                        }
                    },
                    user: {
                        type: 'object',
                        required: [
                            'name',
                            'displayName',
                            'id'
                        ],
                        additionalProperties: false,
                        properties: {
                            name: { type: 'string' },
                            displayName: { type: 'string' },
                            id: { type: 'string' }
                        }
                    },
                    challenge: non_nullable_byte_array,
                    pubKeyCredParams: {
                        type: 'array',
                        items: {
                            type: 'object',
                            required: [
                                'type',
                                'alg'
                            ],
                            additionalProperties: false,
                            properties: {
                                type: {
                                    type: 'string',
                                    const: 'public-key'
                                },
                                alg: { type: 'integer' }
                            }
                        }
                    },
                    timeout: { type: 'integer' },
                    attestation: {
                        type: 'string',
                        enum: [
                            'direct',
                            'indirect',
                            'none'
                        ]
                    }
                }
            }
        }
    },

    put: {
        body: {
            type: 'object',
            required: [
                'id',
                'response'
            ],
            additionalProperties: false,
            properties: {
                id: { type: 'string' },
                response: {
                    type: 'object',
                    required: [
                        'attestationObject',
                        'clientDataJSON'
                    ],
                    additionalProperties: false,
                    properties: {
                        attestationObject: non_nullable_byte_array,
                        clientDataJSON: { type: 'string' }
                    }
                }
            }
        },
        response: {
            200: key_info(false)
        }
    },

    post: {
        body: {
            type: 'object',
            required: [
                'id',
                'response'
            ],
            additionalProperties: false,
            properties: {
                id: { type: 'string' },
                response: {
                    type: 'object',
                    required: [
                        'authenticatorData',
                        'clientDataJSON',
                        'signature',
                        'userHandle'
                    ],
                    additionalProperties: false,
                    properties: {
                        authenticatorData: non_nullable_byte_array,
                        clientDataJSON: { type: 'string' },
                        signature: non_nullable_byte_array,
                        userHandle: nullable_byte_array
                    }
                }
            }
        }
    }
};

export function perk(options) {
    return {
        get: {
            querystring: {
                type: 'object',
                required: [
                    'assertion_result'
                ],
                additionalProperties: false,
                properties: {
                    assertion_result: { type: 'string' }
                }
            },
            response: options.response_schema
        },

        post: {
            body: {
                type: 'object',
                required: [
                    'issuer_id',
                    'assertion'
                ],
                additionalProperties: false,
                properties: {
                    issuer_id: { type: 'string' },
                    assertion: cred.post.body
                }
            },
            response: options.response_schema
        }
    };
}
