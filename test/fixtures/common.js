/* eslint-env browser */

import { PerkWorkflow } from './dist/perk-workflow.js';

export class ExamplePerkWorkflow extends PerkWorkflow {
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

    async before_perk() {
        // Ask the user to sign
        this.sign_div = document.createElement('div');
        const sign_text = document.createTextNode('Please sign using your token');
        this.sign_div.appendChild(sign_text);
        document.body.appendChild(this.sign_div);
    }

    async after_perk() {
        document.body.removeChild(this.sign_div);
    }

    async before_get_access() {
        // Ask the user to use their token
        this.get_access_text = document.createTextNode('Please use your token to get a registration code');
        document.body.appendChild(this.get_access_text);
    }

    async after_get_access() {
        document.body.removeChild(this.get_access_text);
    }

    async before_set_access() {
        // Ask the user to use their token
        this.set_access_text = document.createTextNode('Please use your token to set access control');
        document.body.appendChild(this.set_access_text);
    }

    async after_set_access() {
        document.body.removeChild(this.set_access_text);
    }
}

export function show_error(ex) {
    console.error(ex);
    const error_div = document.createElement('div');
    const error_text = document.createTextNode(`Error: ${ex.message}`);
    error_div.appendChild(error_text);
    document.body.appendChild(error_div);
}

function b64url(s) {
    return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function jwt_encode(header, payload) {
    return b64url(JSON.stringify(header)) + '.' +
           b64url(JSON.stringify(payload)) + '.';
}
