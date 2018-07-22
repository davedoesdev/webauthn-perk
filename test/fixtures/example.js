/* eslint-env browser */
/* global axios, KJUR */

class PerkWorkflow {
    constructor(cred_path, perk_path) {
        this.cred_path = cred_path;
        this.perk_path = perk_path;
    }

    async check_registration() {
        const get_response = await axios(this.cred_path, {
            validateStatus: status => status === 404 || status === 200
        });

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

        ({ cred_id: this.cred_id, issuer_id: this.issuer_id } =
            (await axios.put(this.cred_path, attestation_result)).data);

        this.cred_id = Uint8Array.from(this.cred_id);
    }

    async verify() {
        // Unpack the IDs and challenge
        let challenge;
        ({ cred_id: this.cred_id, issuer_id: this.issuer_id, challenge } = this.get_result);
        this.cred_id = Uint8Array.from(this.cred_id);

        // Sign challenge with credential
        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: Uint8Array.from(challenge),
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
        await axios.post(this.cred_path, assertion_result);
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
        perk_url.pathname = this.perk_path;
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
            // TODO: test failure when use different token
        } else {
            // Not registered
            await this.before_register();
            await this.register();
            await this.after_register();
            // TODO: If someone happened to register between get_response and put_response then
            // we'll get a 409 status and an exception here. Can we just say this is an error?
            // What if some other browser on the system did it? Do we need to loop and try again
            // (we'll pick up the 200 and fail to verify if it was someone else)?
            // Use another PC to register with another key while waiting here
        }
        // Now we have the credential ID (identifying the private key)
        // and the issuer ID (identifying the public key)
    }

    async before_verify() {}
    async after_verify() {}
    async before_register() {}
    async after_register() {}
}

class ExamplePerkWorkflow extends PerkWorkflow {
    async before_verify() {
        // Ask the user to authenticate
        this.authenticate_text = document.createTextNode('Please authenticate using your token');
        document.body.appendChild(this.authenticate_text);
    }

    async after_verify() {
        document.body.removeChild(this.authenticate_text);
    }

    async before_register() {
        // Ask the user to register
        this.register_text = document.createTextNode('Please register using your token');
        document.body.appendChild(this.register_text);
    }

    async after_register() {
        document.body.removeChild(this.register_text);
    }
}

async function onload() { // eslint-disable-line no-unused-vars 
    try {
        // Get the unguessable ID from the page's URL
        const parts = window.location.pathname.split('/');
        const id = parts[parts.length - 2];

        // Start the workflow
        const workflow = new ExamplePerkWorkflow(`/cred/${id}/`, '/perk/');
        await workflow.authenticate();

        // Generate assertions
        const generate_text = document.createTextNode('Please enter a message and click Generate');
        document.body.appendChild(generate_text);

        const message_label = document.createElement('label');
        message_label.setAttribute('for', 'message');
        document.body.appendChild(message_label);

        const message_input = document.createElement('input');
        message_input.id = 'message';
        message_input.setAttribute('type', 'text');
        document.body.appendChild(message_input);

        const generate_button = document.createElement('input');
        generate_button.setAttribute('type', 'button');
        generate_button.setAttribute('value', 'Generate');
        document.body.appendChild(generate_button);

        generate_button.addEventListener('click', async function () {
            // Generate JWT containing message as a claim
            const now = Math.floor(Date.now() / 1000);
            const jwt = KJUR.jws.JWS.sign(null, {
                alg: 'none',
                typ: 'JWT'
            }, {
                iat: now,
                nbf: now,
                exp: now + 10 * 60, // 10 minutes
                message: message_input.value
            });

            // Ask the user to sign
            const sign_div = document.createElement('div');
            const sign_text = document.createTextNode('Please sign using your token');
            sign_div.appendChild(sign_text);
            document.body.appendChild(sign_div);

            // Sign JWT and get perk URL
            const perk_url = await workflow.perk(jwt);
            document.body.removeChild(sign_div);

            const perk_div = document.createElement('div');
            const perk_text = document.createTextNode("Copy the following link's address and open it in a new browser: ");
            perk_div.appendChild(perk_text);
            const a = document.createElement('a');
            a.href = perk_url.toString();
            const a_text = document.createTextNode('link');
            a.appendChild(a_text);
            perk_div.appendChild(a);
            document.body.appendChild(perk_div);
        });
    } catch (ex) {
        const error_div = document.createElement('div');
        const error_text = document.createTextNode(`Error: ${ex.message}`);
        error_div.appendChild(error_text);
        document.body.appendChild(error_div);
    }
}
