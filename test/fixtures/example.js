/* eslint-env browser */

import { PerkWorkflow } from './dist/perk-workflow.js';
import KJUR from './dist/jsrsasign-all-min.js';

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

function show_error(ex) {
    const error_div = document.createElement('div');
    const error_text = document.createTextNode(`Error: ${ex.message}`);
    error_div.appendChild(error_text);
    document.body.appendChild(error_div);
}

window.addEventListener('load', async function () {
    try {
        // Start the workflow
        const workflow = new ExamplePerkWorkflow();
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
            try {
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
            } catch (ex) {
                show_error(ex);
            }
        });
    } catch (ex) {
        show_error(ex);
    }
});
