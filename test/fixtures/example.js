/* eslint-env browser */
/* global axios */

async function onload() {
    // Get the unguessable ID from the page's URL.
    const parts = window.location.pathname.split('/');
    const id = parts[parts.length - 2];
    const cred_path = `/cred/${id}/`;

    // Get the challenge.
    // TODO: Cope with 200 - check by POSTing
    const attestation_options = (await axios(cred_path, {
        validateStatus: status => status === 404
    })).data;
    attestation_options.challenge = Uint8Array.from(attestation_options.challenge);
    attestation_options.user.id = new TextEncoder('utf-8').encode(attestation_options.user.id);

    // Create a new credential and sign the challenge.
    const cred = await navigator.credentials.create({ publicKey: attestation_options });
    const attestation_result = {
        id: cred.id,
        response: {
            attestationObject: Array.from(new Uint8Array(cred.response.attestationObject)),
            clientDataJSON: new TextDecoder('utf-8').decode(cred.response.clientDataJSON)
        }
    };

    //console.log(attestation_options);
}