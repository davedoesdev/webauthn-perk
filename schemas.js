/*eslint-env node */

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

exports.cred = function () {
    function key_info(challenge) {
        const r = {
            type: 'object',
            properties: {
                cred_id: byte_array(),
                issuer_id: { type: 'string' }
            }
        };
        if (challenge) {
            r.properties.challenge = byte_array();
        }
        return r;
    }
    return {
        get: {
            response: {
                200: key_info(true),
                404: {
                    type: 'object',
                    properties: {
                        rp: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                            }
                        },
                        user: {
                            type: 'object',
                            properties: {
                                name: { type: 'string' },
                                displayName: { type: 'string' },
                                id: { type: 'string' }
                            }
                        },
                        challenge: byte_array(false),
                        pubKeyCredParams: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    type: {
                                        type: 'string',
                                        const: 'publicKey'
                                    },
                                    alg: { type: 'integer' }
                                }
                            }
                        },
                        timeout: { type: 'integer' },
                        attenstation: {
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
                            attestationObject: byte_array(false),
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
                        authenticatorData: byte_array(false),
                        clientDataJSON: { type: 'string' },
                        signature: byte_array(false),
                        userHandle: byte_array(true)
                    }
                }
            }
        }
    };
};

exports.perk = function (options) {
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
                    assertion: exports.cred().post
                }
            },
            response: options.response_schema
        }
    };
};
