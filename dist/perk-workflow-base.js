/* eslint-env browser */

import Ajv from './ajv.bundle.js';
import { cred as schemas } from './schemas.js';

const ajv = new Ajv();
const response_schemas = {
    get: {
        200: ajv.compile(schemas.get.response[200]),
        404: ajv.compile(schemas.get.response[404])
    },
    put: {
        201: ajv.compile(schemas.put.response[201])
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
        const id = parts[index];
        const prefix = parts.slice(0, index).join('/');
        this.options = Object.assign({
            cred_path: `${prefix}/cred/${id}/`,
            perk_path: `${prefix}/perk/`
        }, options);
    }

    async check_registration() {
        const get_response = await this.options.axios.get(this.options.cred_path, {
            validateStatus: status => status === 404 || status === 200
        });
        validate(response_schemas.get[get_response.status], get_response);

        this.get_result = get_response.data;

        return get_response.status === 200;
    }

    async register(signal) {
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

        const put_response = await this.options.axios.put(this.options.cred_path, {
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
        validate(response_schemas.put[put_response.status], put_response);

        ({ options: this.cred_options, issuer_id: this.issuer_id } = put_response.data);
        decodeLoginOptions(this.cred_options);
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

    async verify(signal) {
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
        await this.options.axios.post(this.options.cred_path, {
            car: this.make_car(assertion),
            session_data
        });
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

    async authenticate() {
        // Check if someone has registered
        if (await this.check_registration()) {
            // Already registered so verify it was us
            await this.before_verify();
            try {
                await this.verify();
            } finally {
                await this.after_verify();
            }
        } else {
            // Not registered
            await this.before_register();
            try {
                await this.register();
            } finally {
                await this.after_register();
            }
        }
        // Now we have the credential options (identifying the private key)
        // and the issuer ID (identifying the public key)
    }

    async before_register() {}
    async after_register() {}
    async before_verify() {}
    async after_verify() {}
    async before_perk() {}
    async after_perk() {}
}

export { Ajv, ajv, validate };
