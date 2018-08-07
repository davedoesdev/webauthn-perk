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
        200: ajv.compile(schemas.put.response[200])
    }
};

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

    async register() {
        // Unpack the options
        const attestation_options = this.get_result;
        attestation_options.challenge = Uint8Array.from(attestation_options.challenge);
        attestation_options.user.id = new TextEncoder('utf-8').encode(attestation_options.user.id);

        // Create a new credential and sign the challenge.
        const cred = await navigator.credentials.create({ publicKey: attestation_options });

        // Register
        const attestation_result = {
            id: cred.id,
            response: {
                attestationObject: Array.from(new Uint8Array(cred.response.attestationObject)),
                clientDataJSON: new TextDecoder('utf-8').decode(cred.response.clientDataJSON)
            }
        };

        const put_response = await this.options.axios.put(this.options.cred_path, attestation_result);
        validate(response_schemas.put[put_response.status], put_response);

        ({ cred_id: this.cred_id, issuer_id: this.issuer_id } = put_response.data);

        this.cred_id = Uint8Array.from(this.cred_id);
    }

    unpack_result() {
        // Unpack the IDs and challenge
        let challenge;
        ({ cred_id: this.cred_id, issuer_id: this.issuer_id, challenge } = this.get_result);
        this.cred_id = Uint8Array.from(this.cred_id);
        return challenge;
    }

    async verify() {
        // Sign challenge with credential
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: Uint8Array.from(this.unpack_result()),
                allowCredentials: [{
                    id: this.cred_id,
                    type: 'public-key'
                }]
            }
        });
            
        // Authenticate
        const assertion_result = {
            id: assertion.id,
            response: {
                authenticatorData: Array.from(new Uint8Array(assertion.response.authenticatorData)),
                clientDataJSON: new TextDecoder('utf-8').decode(assertion.response.clientDataJSON),
                signature: Array.from(new Uint8Array(assertion.response.signature)),
                userHandle: assertion.response.userHandle ? Array.from(new Uint8Array(assertion.response.userHandle)) : null
            }
        };
        await this.options.axios.post(this.options.cred_path, assertion_result);
    }

    async perk(jwt) {
        // Sign JWT
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: new TextEncoder('utf-8').encode(jwt),
                allowCredentials: [{
                    id: this.cred_id,
                    type: 'public-key'
                }]
            }
        });

        // Make perk URL
        const assertion_result = {
            issuer_id: this.issuer_id,
            assertion: {
                id: assertion.id,
                response: {
                    authenticatorData: Array.from(new Uint8Array(assertion.response.authenticatorData)),
                    clientDataJSON: new TextDecoder('utf-8').decode(assertion.response.clientDataJSON),
                    signature: Array.from(new Uint8Array(assertion.response.signature)),
                    userHandle: assertion.response.userHandle ? Array.from(new Uint8Array(assertion.response.userHandle)) : null
                }
            }
        };
        const perk_url = new URL(location.href);
        perk_url.pathname = this.options.perk_path;
        const params = new URLSearchParams();
        params.set('assertion_result', JSON.stringify(assertion_result));
        perk_url.search = params.toString();

        return perk_url;
    }

    async authenticate() {
        // Check if someone has registered
        if (await this.check_registration()) {
            // Already registered so verify it was us
            await this.before_verify();
            await this.verify();
            await this.after_verify();
        } else {
            // Not registered
            await this.before_register();
            await this.register();
            await this.after_register();
        }
        // Now we have the credential ID (identifying the private key)
        // and the issuer ID (identifying the public key)
    }

    async before_verify() {}
    async after_verify() {}
    async before_register() {}
    async after_register() {}
}

export { Ajv };
