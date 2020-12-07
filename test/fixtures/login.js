
import { ExamplePerkWorkflow, show_error } from './common.js';

window.addEventListener('load', async function () {
    try {
        try {
            document.getElementById('authenticate').addEventListener('click', async function () {
                const value = document.getElementById('username').value;
                if (value) {
                POST with access=value
                    console.log(value);
                }
            });
        } catch (ex) {
            show_error(ex);
        }
    } catch (ex) {
        show_error(ex);
    }
});
