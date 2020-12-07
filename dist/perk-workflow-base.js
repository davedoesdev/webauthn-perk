/* eslint-env browser */

import Ajv from './ajv.bundle.js';
import * as schemas from './schemas.js';

const ajv = new Ajv();
const response_schemas = {
    cred: {
        get: {
            200: ajv.compile(schemas.cred.get.response[200]),
            404: ajv.compile(schemas.cred.get.response[404])
        },
        put: {
            201: ajv.compile(schemas.cred.put.response[201])
        }
    },
    access: {
        get: {
            200: ajv.compile(schemas.access.get.response[200])
        },
        post: {
            200: ajv.compile(schemas.access.post.response[200]),
            201: ajv.compile(schemas.access.post.response[201])
        }
    }
};

// Base64 to ArrayBuffer
function bufferDecode(value) {
    return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}

// ArrayBuffer to URLBase64
function bufferEncode(value) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(value)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

function decodeRegistrationOptions(options) {
    const { publicKey } = options;
    publicKey.challenge = bufferDecode(publicKey.challenge);
    publicKey.user.id = bufferDecode(publicKey.user.id);
    if (publicKey.excludeCredentials) {
        for (const c of publicKey.excludeCredentials) {
            c.id = bufferDecode(c.id);
        }
    }
}

function decodeLoginOptions(options) {
    const { publicKey } = options;
    publicKey.challenge = bufferDecode(publicKey.challenge);
    for (const c of publicKey.allowCredentials) {
        c.id = bufferDecode(c.id);
    }
}

function validate(schema, response) {
    if (!schema(response.data)) {
        throw new Error(ajv.errorsText(schema.errors));
    }
}

export class PerkWorkflowBase {
    constructor(options) {
        const path = window.location.pathname;
        const parts = path.split('/');
        const index = parts.length - (path.endsWith('/') ? 2 : 1);
        const id = parts[index].split('!')[0];
        const prefix = parts.slice(0, index).join('/');
        this.options = Object.assign({
            cred_path: `${prefix}/cred/${id}/`,
            perk_path: `${prefix}/perk/`,
            access_path: `${prefix}/access/`
        }, options);
    }

    async check_registration() {
        const get_response = await this.options.axios.get(this.options.cred_path, {
            validateStatus: status => status === 404 || status === 200
        });
        validate(response_schemas.cred.get[get_response.status], get_response);

        this.get_result = get_response.data;

        return get_response.status === 200;
    }

    async register(access, signal) {
        // Unpack the options
        const { options, session_data } = this.get_result;
        decodeRegistrationOptions(options);

        // Create a new credential and sign the challenge.
        const credential = await navigator.credentials.create({
            ...options,
            ...{
                publicKey: {
                    ...options.publicKey,
                    ...this.options.attestation_options,
                }
            },
            signal
        });

        // Register
        const { id, rawId, type, response: cred_response } = credential;
        const { attestationObject, clientDataJSON } = cred_response;

        const data = {
            ccr: {
                id,
                rawId: bufferEncode(rawId),
                type,
                response: {
                    attestationObject: bufferEncode(attestationObject),
                    clientDataJSON: bufferEncode(clientDataJSON)
                }
            },
            session_data
        };

        let response;
        if (access) {
            // Get allowed credentials
            response = await this.options.axios.post(this.options.access_path, data);
            validate(response_schemas.access.post[response.status], response);
        } else {
            response = await this.options.axios.put(this.options.cred_path, data);
            validate(response_schemas.cred.put[response.status], response);
        }

        ({ options: this.cred_options, issuer_id: this.issuer_id } = response.data);
        decodeLoginOptions(this.cred_options);

        if (access) {
            return response.data.encrypted_credentials;
        }
    }

    unpack_result() {
        // Unpack the IDs
        ({ options: this.cred_options, issuer_id: this.issuer_id } = this.get_result);
        decodeLoginOptions(this.cred_options);
    }

    make_car(assertion) {
        const { id, rawId, type, response: assertion_response } = assertion;
        const { authenticatorData, clientDataJSON, signature, userHandle } = assertion_response;
        return {
            id,
            rawId: bufferEncode(rawId),
            type,
            response: {
                authenticatorData: bufferEncode(authenticatorData),
                clientDataJSON: bufferEncode(clientDataJSON),
                signature: bufferEncode(signature),
                userHandle: bufferEncode(userHandle)
            }
        };
    }

    async verify(access, signal) {
        this.unpack_result();

        const { session_data } = this.get_result;

        // Sign challenge with credential
        const assertion = await navigator.credentials.get({
            ...this.cred_options,
            ...{
                publicKey: {
                    ...this.cred_options.publicKey,
                    ...this.options.assertion_options,
                }
            },
            signal
        });
            
        // Authenticate
        const data = {
            car: this.make_car(assertion),
            session_data
        };

        let response;
        if (access) {
            // Get allowed credentials
            response = await this.options.axios.post(this.options.access_path, data);
            validate(response_schemas.access.post[response.status], response);
        } else {
            response = await this.options.axios.post(this.options.cred_path, data);
        }

        return response.data;
    }

    async perk_assertion(jwt, signal) {
        // Sign JWT
        return {
            issuer_id: this.issuer_id,
            car: this.make_car(await navigator.credentials.get({
                ...this.cred_options,
                ...{
                    publicKey: {
                        ...this.cred_options.publicKey,
                        ...this.options.assertion_options,
                        challenge: new TextEncoder().encode(jwt)
                    }
                },
                signal
            }))
        };
    }

    async perk(jwt) {
        await this.before_perk();
        try {
            // Make perk URL
            const perk_url = new URL(location.href);
            perk_url.pathname = this.options.perk_path;
            const params = new URLSearchParams();
            params.set('assertion', JSON.stringify(await this.perk_assertion(jwt)));
            perk_url.search = params.toString();
            return perk_url;
        } finally {
            await this.after_perk();
        }
    }

    async authenticate(access) {
        // Check if someone has registered
        if (await this.check_registration()) {
            // Already registered so verify it was us
            await this.before_verify();
            try {
                return await this.verify(access);
            } finally {
                await this.after_verify();
            }
        } else {
            // Not registered
            await this.before_register();
            try {
                return await this.register(access);
            } finally {
                await this.after_register();
            }
        }
        // Now we have the credential options (identifying the private key)
        // and the issuer ID (identifying the public key)
    }

    async get_access(signal) {
        await this.before_get_access();
        try {
            // Get credential creation options
            const get_response = await this.options.axios.get(this.options.access_path);
            validate(response_schemas.access.get[get_response.status], get_response);

            // Unpack the options
            const { options, session_data } = get_response.data;
            decodeRegistrationOptions(options);

            // Create a new credential and sign the challenge.
            const credential = await navigator.credentials.create({
                ...options,
                ...{
                    publicKey: {
                        ...options.publicKey,
                        ...this.options.attestation_options,
                    }
                },
                signal
            });

            // Get the encrypted credential from the server
            const { id, rawId, type, response: cred_response } = credential;
            const { attestationObject, clientDataJSON } = cred_response;

            const post_response = await this.options.axios.post(this.options.access_path, {
                ccr: {
                    id,
                    rawId: bufferEncode(rawId),
                    type,
                    response: {
                        attestationObject: bufferEncode(attestationObject),
                        clientDataJSON: bufferEncode(clientDataJSON)
                    }
                },
                session_data
            });
            validate(response_schemas.access.post[post_response.status], post_response);

            return post_response.data[0].encrypted_credential;
        } finally {
            await this.after_get_access();
        }
    }

    async set_access(jwt, signal) {
        await this.before_set_access();
        try {
            // Set allowed credentials
            const post_response = await this.options.axios.post(this.options.access_path, {
                assertion: await this.perk_assertion(jwt)
            });
            validate(response_schemas.access.post[post_response.status], post_response);
            return post_response.data; 
        } finally {
            await this.after_set_access();
        }
    }

    async before_register() {}
    async after_register() {}
    async before_verify() {}
    async after_verify() {}
    async before_perk() {}
    async after_perk() {}
    async before_get_access() {}
    async after_get_access() {}
    async before_set_access() {}
    async after_set_access() {}
}

export { Ajv, ajv, validate };
