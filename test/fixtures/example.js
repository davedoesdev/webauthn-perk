/* eslint-env browser */
/* global axios, KJUR */

async function onload() { // eslint-disable-line no-unused-vars 
    try {
        // Get the unguessable ID from the page's URL.
        const parts = window.location.pathname.split('/');
        const id = parts[parts.length - 2];
        const cred_path = `/cred/${id}/`;

        // Check if someone has registered
        const get_response = await axios(cred_path, {
            validateStatus: status => status === 404 || status === 200
        });

        let cred_id, issuer_id;

        if (get_response.status === 404) {
            // 404, not yet registered
            const attestation_options = get_response.data;
            attestation_options.challenge = Uint8Array.from(attestation_options.challenge);
            attestation_options.user.id = new TextEncoder('utf-8').encode(attestation_options.user.id);

            // Ask the user to register
            const register_text = document.createTextNode('Please register using your token');
            document.body.appendChild(register_text);

            // Create a new credential and sign the challenge.
            const cred = await navigator.credentials.create({ publicKey: attestation_options });
            document.body.removeChild(register_text);

            // Register
            const attestation_result = {
                id: cred.id,
                response: {
                    attestationObject: Array.from(new Uint8Array(cred.response.attestationObject)),
                    clientDataJSON: new TextDecoder('utf-8').decode(cred.response.clientDataJSON)
                }
            };
            ({ cred_id, issuer_id } = (await axios.put(cred_path, attestation_result)).data);
            // TODO: If someone happened to register between get_response and put_response then
            // we'll get a 409 status and an exception here. Can we just say this is an error?
            // What if some other browser on the system did it? Do we need to loop and try again
            // (we'll pick up the 200 and fail to verify if it was someone else)?
            // Use another PC to register with another key while waiting here
        } else {
            // 200, already registered so verify it was us
            let challenge;
            ({ cred_id, issuer_id, challenge } = get_response.data);

            // Ask the user to authenticate
            const authenticate_text = document.createTextNode('Please authenticate using your token');
            document.body.appendChild(authenticate_text);

            // Sign challenge with credential
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: Uint8Array.from(challenge),
                    allowCredentials: [{
                        id: Uint8Array.from(cred_id),
                        type: 'public-key'
                    }]
                }
            });
            document.body.removeChild(authenticate_text);

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
            await axios.post(cred_path, assertion_result);
            // TODO: test failure when use different token
        }

        // Now we have the credential ID (identifying the private key) and the issuer ID
        // (identifying the public key), we can generation assertions.

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

            // Sign JWT
            const assertion = await navigator.credentials.get({
                publicKey: {
                    challenge: new TextEncoder('utf-8').encode(jwt),
                    allowCredentials: [{
                        id: Uint8Array.from(cred_id),
                        type: 'public-key'
                    }]
                }
            });
            document.body.removeChild(sign_div);

            // Make perk URL
            const assertion_result = {
                issuer_id,
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
            perk_url.pathname = '/perk/';
            const params = new URLSearchParams();
            params.set('assertion_result', JSON.stringify(assertion_result));
            perk_url.search = params.toString();

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

// TODO: Should we create client-side lib to wrap it all up?