/*eslint-env shared-node-browser */

export function byte_array(nullable) {
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

const non_nullable_byte_array = byte_array(false);
const nullable_byte_array = byte_array(true);

const signed_challenge = {
    type: 'object',
    required: [
        'data',
        'signature',
        'version'
    ],
    additionalProperties: false,
    properties: {
        data: { type: 'string' },
        signature: { type: 'string' },
        version: { type: 'integer' }
    }
};

function assertion(signed_challenge) {
    const r = {
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
    };
    if (signed_challenge) {
        r.required.push('signed_challenge');
        r.properties.signed_challenge = signed_challenge;
    }
    return r;
}

export const cred = {
    get: {
        response: {
            200: {
                type: 'object',
                required: [
                    'assertion_options',
                    'signed_challenge',
                    'cred_id',
                    'issuer_id'
                ],
                additionalProperties: false,
                properties: {
                    assertion_options: {
                        type: 'object',
                        required: [
                            'challenge'
                        ],
                        additionalProperties: false,
                        properties: {
                            challenge: non_nullable_byte_array,
                            timeout: { type: 'integer' },
                            rpId: { type: 'string' },
                            attestation: { type: 'string' },
                            userVerification: { type: 'string' },
                            rawChallenge: non_nullable_byte_array,
                            extensions: { type: 'object' }
                        }
                    },
                    signed_challenge,
                    cred_id: non_nullable_byte_array,
                    issuer_id: { type: 'string' }
                }
            },
            404: {
                type: 'object',
                required: [
                    'attestation_options',
                    'signed_challenge'
                ],
                additionalProperties: false,
                properties: {
                    attestation_options: {
                        type: 'object',
                        required: [
                            'rp',
                            'user',
                            'challenge',
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
                                    id: { type: 'string' }
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
                            },
                            authenticatorSelection: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    attachment: { type: 'string' },
                                    requireResidentKey: { type: 'boolean' },
                                    userVerification: { type: 'string' }
                                }
                            },
                            rawChallenge: non_nullable_byte_array,
                            extensions: { type: 'object' }
                        }
                    },
                    signed_challenge
                }
            }
        }
    },

    put: {
        body: {
            type: 'object',
            required: [
                'id',
                'response',
                'signed_challenge'
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
                },
                signed_challenge
            }
        },
        response: {
            200: {
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
            }
        }
    },

    post: {
        body: assertion(true) 
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
                    assertion: assertion(false)
                }
            },
            response: options.response_schema
        }
    };
}
