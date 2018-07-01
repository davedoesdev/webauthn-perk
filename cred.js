/*eslint-env node */
const { promisify } = require('util');
const { Fido2Lib } = require('fido2-lib');

module.exports = async function (fastify, options) {
    options = options.cred_options || options;
    fastify.log.info(`valid ids: ${options.valid_ids}`);
    const valid_ids = new Set(options.valid_ids);

    const fido2_options = options.fido2_options || {};
    const fido2lib = new Fido2Lib(fido2_options.new_options);

    const ks = options.keystore;
    const get_uris = promisify(ks.get_uris.bind(ks));
    const remove_pub_key = promisify(ks.remove_pub_key.bind(ks));
    const get_pub_key_by_uri = promisify(ks.get_pub_key_by_uri.bind(ks));
    const add_pub_key = promisify(ks.add_pub_key.bind(ks));

    // Delete pub keys that aren't passed as argument
    for (const id of await get_uris()) {
        if (!valid_ids.has(id)) {
            fastify.log.info(`removing pub key for id: ${id}`);
            await remove_pub_key(id);
        }
    }

    fastify.register(require('fastify-secure-session'), options.secure_session_options);

    for (const id of valid_ids) {
        fastify.log.info(`setting up routes for id: ${id}`);

        fastify.get(`/${id}`, async (request, reply) => {
            const entry = await get_pub_key_by_uri(id);
            if (entry === null) {
                reply.code(404);
                const attestation_options = await fido2lib.attestationOptions(fido2_options.attestation_options);
                attestation_options.challenge = Buffer.from(attestation_options.challenge).toString('base64');
                request.session.set('challenge', attestation_options.challenge);
                return attestation_options;
            }
            return { cred_id: entry.cred_id };
        });

        fastify.put(`/${id}`, async (request, reply) => {
            const cred_response = await fido2lib.attestationResult(
                request.body,
                Object.assign({
                    challenge: request.session.get('challenge')
                }, fido2_options.attestation_expectations));
            const cred_id = Buffer.from(cred_response.authnrData.get('credId')).toString('base64');
            await add_pub_key(id, {
                pub_key: cred_response.authnrData.get('credentialPublicKeyPem'),
                cred_id: cred_id
            });
            return { cred_id: cred_id };

            // catch error verifying

            // catch error adding
        });
    }
};