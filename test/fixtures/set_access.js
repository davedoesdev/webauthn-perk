/* eslint-env browser */

import { ExamplePerkWorkflow, show_error, jwt_encode } from './common.js';

window.addEventListener('load', async function () {
    try {
        // Start the workflow
        const workflow = new ExamplePerkWorkflow();
        const encrypted_credentials = await workflow.authenticate(true);

        let data;
        if (encrypted_credentials.length === 0) {
            data = [['', '']];
        } else {
            data = encrypted_credentials.map(c => [
                c.id,
                `${c.encrypted_credential.ciphertext},${c.encrypted_credential.nonce}`
            ]);
        }

        const div = document.createElement('div');
        document.body.appendChild(div);

        const table = jexcel(div, {
            data,
            columns: [
                { type: 'text', title: 'User', width: 200 },
                { type: 'text', title: 'Registration code', width: 300 }
            ],
            allowInsertColumn: false
        });

        const set_button = document.createElement('input');
        set_button.setAttribute('type', 'button');
        set_button.setAttribute('value', 'Set allowed users');
        document.body.appendChild(set_button);

        set_button.addEventListener('click', async function () {
            const encrypted_credentials = table.getData().filter(c => c[0] && c[1]).map(c => {
                const split = c[1].split(',');
                return {
                    id: c[0],
                    encrypted_credential: {
                        ciphertext: split[0],
                        nonce: split[1]
                    }
                };
            });

            const now = Math.floor(Date.now() / 1000);
            const jwt = jwt_encode({
                alg: 'none',
                typ: 'JWT'
            }, {
                iat: now,
                nbf: now,
                exp: now + 60, // 1 minute
                encrypted_credentials
            });

            await workflow.set_access(jwt);
        });
    } catch (ex) {
        show_error(ex);
    }
});
