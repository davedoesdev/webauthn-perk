/* eslint-env browser */

import { ExamplePerkWorkflow, show_error } from './common.js';

window.addEventListener('load', async function () {
    try {
        const workflow = new ExamplePerkWorkflow();
        const { ciphertext, nonce } = await workflow.get_access();

        document.body.appendChild(document.createTextNode('Copy the registration code below and give it to the server administrator:'));

        const textarea = document.createElement('textarea');
        textarea.readOnly = true;
        textarea.value = `${ciphertext},${nonce}`;
        textarea.style['overflow-y'] = 'hidden';
        textarea.style.resize = 'none';
        document.body.appendChild(textarea);
        textarea.style.height = textarea.scrollHeight;
        textarea.select();

        const copy_button = document.createElement('input');
        copy_button.setAttribute('type', 'button');
        copy_button.setAttribute('value', 'Copy code to clipboard');
        document.body.appendChild(copy_button);

        copy_button.addEventListener('click', () => {
            textarea.select();
            document.execCommand('copy');
        });
    } catch (ex) {
        show_error(ex);
    }
});
