/*eslint-env node */
const { promisify } = require('util');
const { Fido2Lib } = require('fido2-lib');
const { BufferToArrayBuffer, fix_assertion_types } = require('./common.js');
const schemas = require('./schemas.js').cred();
const default_user = 'Anonymous User';

module.exports = async function (fastify, options) {
    options = options.cred_options || /* istanbul ignore next */ options;
    const valid_ids = new Set(options.valid_ids.filter(id => id));
    fastify.log.info(`valid ids: ${Array.from(valid_ids)}`);
    const challenge_timeout = options.challenge_timeout || 60000;

    const fido2_options = options.fido2_options || /* istanbul ignore next */ {};
    const fido2lib = new Fido2Lib(fido2_options.new_options);

    const ks = options.keystore;
    const get_uris = promisify(ks.get_uris.bind(ks));
    const add_pub_key = promisify(ks.add_pub_key.bind(ks));
    const remove_pub_key = promisify(ks.remove_pub_key.bind(ks));
    const get_pub_key_by_uri = promisify((uri, cb) => {
        ks.get_pub_key_by_uri(uri, (err, pub_key, issuer_id) => {
            cb(err, { pub_key, issuer_id });
        });
    });

    // Delete pub keys that aren't passed as argument
    for (const id of await get_uris()) {
        if (!valid_ids.has(id)) {
            fastify.log.info(`removing pub key for id: ${id}`);
            await remove_pub_key(id);
        }
    }

    fastify.register(require('fastify-secure-session'), options.secure_session_options);

    function check_time(request, name) {
        const challengeTime = request.session.get(name);
        if (!challengeTime) {
            const err = new Error('no challenge timestamp');
            err.statusCode = 400;
            throw err;
        }
        if ((challengeTime + challenge_timeout) <= Date.now('dummy' /* for test */)) {
            const err = new Error('challenge timed out');
            err.statusCode = 400;
            throw err;
        }
    }

    for (const id of valid_ids) {
        fastify.log.info(`setting up routes for id: ${id}`);

        fastify.get(`/${id}/`, { schema: schemas.get }, async (request, reply) => {
            const { pub_key, issuer_id } = await get_pub_key_by_uri(id);
            if (pub_key === null) {
                reply.code(404);
                const attestation_options = await fido2lib.attestationOptions(fido2_options.attestation_options);
                attestation_options.challenge = Array.from(Buffer.from(attestation_options.challenge));
                attestation_options.user = Object.assign({
                    name: default_user,
                    displayName: default_user,
                    id: default_user
                }, attestation_options.user, fido2_options.user);
                request.session.set('attestationChallenge', attestation_options.challenge);
                request.session.set('attestationChallengeTime', Date.now());
                return attestation_options;
            }
            const assertion_options = await fido2lib.assertionOptions(fido2_options.assertion_options);
            const challenge = Array.from(Buffer.from(assertion_options.challenge));
            request.session.set('assertionChallenge', challenge);
            request.session.set('assertionChallengeTime', Date.now());
            return {
                cred_id: pub_key.cred_id,
                issuer_id,
                challenge
            };
        });

        fastify.put(`/${id}/`, { schema: schemas.put }, async request => {
            check_time(request, 'attestationChallengeTime');
            const cred = request.body;
            cred.id = BufferToArrayBuffer(Buffer.from(cred.id, 'base64'));
            cred.response.attestationObject = BufferToArrayBuffer(Buffer.from(cred.response.attestationObject));
            cred.response.clientDataJSON = BufferToArrayBuffer(Buffer.from(cred.response.clientDataJSON));
            let cred_response;
            try {
                cred_response = await fido2lib.attestationResult(
                    cred,
                    Object.assign({
                        // fido2-lib expects https
                        origin: `https://${request.headers.host}`,
                        // session is signed and we never set attestationChallengeTime without attestationChallenge
                        challenge: request.session.get('attestationChallenge'),
                        factor: 'either'
                    }, fido2_options.attestation_expectations));
            } catch (ex) {
                ex.statusCode = 400;
                throw ex;
            }
            const cred_id = Array.from(Buffer.from(cred_response.authnrData.get('credId')));
            const issuer_id = await add_pub_key(id, {
                pub_key: cred_response.authnrData.get('credentialPublicKeyPem'),
                cred_id: cred_id
            });
            return { cred_id, issuer_id };
        });

        fastify.post(`/${id}/`, { schema: schemas.post }, async (request, reply) => {
            const { pub_key } = await get_pub_key_by_uri(id);
            if (pub_key === null) {
                const err = new Error('no public key');
                err.statusCode = 404;
                throw err;
            }
            check_time(request, 'assertionChallengeTime');
            const assertion = fix_assertion_types(request.body);
            const userHandle = assertion.response.userHandle;
            try {
                await fido2lib.assertionResult(
                    assertion,
                    Object.assign({
                        // fido2-lib expects https
                        origin: `https://${request.headers.host}`,
                        // session is signed and we never set assertionChallengeTime without assertionChallenge
                        challenge: request.session.get('assertionChallenge'),
                        factor: 'either',
                        prevCounter: 0,
                        // not all authenticators can store user handles
                        userHandle: userHandle === undefined ? /* istanbul ignore next */ null : userHandle,
                        publicKey: pub_key.pub_key
                    }, fido2_options.assertion_expectations));
            } catch (ex) {
                ex.statusCode = 400;
                throw ex;
            }
            reply.code(204);
        });
    }
};