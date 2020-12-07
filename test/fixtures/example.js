/* eslint-env browser */

import { ExamplePerkWorkflow, show_error, jwt_encode } from './common.js';

window.addEventListener('load', async function () {
    try {
        // Start the workflow
        const workflow = new ExamplePerkWorkflow({
            assertion_options: {
                //userVerification: 'required'
            }
        });
        await workflow.authenticate();

        // Generate assertions
        const message_label = document.createElement('label');
        message_label.setAttribute('for', 'message');
        document.body.appendChild(message_label);

        const generate_text = document.createTextNode('Please enter a message and click Generate');
        message_label.appendChild(generate_text);

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
                const jwt = jwt_encode({
                    alg: 'none',
                    typ: 'JWT'
                }, {
                    iat: now,
                    nbf: now,
                    exp: now + 10 * 60, // 10 minutes
                    message: message_input.value
                });

                // Sign JWT and get perk URL
                const perk_url = await workflow.perk(jwt);

                // Display the perk URL to the user
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
