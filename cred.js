/*eslint-env node */
import { promisify } from 'util';
import { Fido2Lib } from '@davedoesdev/fido2-lib';
import { Crypt } from 'simple-crypt';
import crypto from 'crypto';
import clone from 'deep-copy';
import { toArrayBuffer, fix_assertion_types } from './common.js';
import { cred as schemas } from './dist/schemas.js';
const default_user = 'Anonymous User';

function toArray(obj, prop) {
    let v = prop ? obj[prop] : obj;
    if (v) {
        v = Array.from(Buffer.from(v));
        if (prop) {
            obj[prop] = v;
        }
    }
    return v;
}

export default async function (fastify, options) {
    options = options.cred_options || /* istanbul ignore next */ options;
    const valid_ids = new Set(Object.assign({
        valid_ids: []
    }, options).valid_ids.filter(id => id));
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
    const deploy = promisify(ks.deploy.bind(ks));

    const complete_assertion_expectations = Object.assign({
        async complete_assertion_expectations(assertion, assertion_expectations) {
            return assertion_expectations;
        }
    }, fido2_options).complete_assertion_expectations;

    // Delete pub keys that aren't passed as argument
    for (const id of await get_uris()) {
        if (!valid_ids.has(id)) {
            fastify.log.info(`removing pub key for id: ${id}`);
            await remove_pub_key(id);
        }
    }

    const generateKeyPair = promisify(crypto.generateKeyPair);
    const challenge_keypair = options.challenge_keypair || await generateKeyPair('rsa', { modulusLength: 3072 });

    const sign_encrypt_sign = promisify(Crypt.sign_encrypt_sign.bind(Crypt));
    const verify_decrypt_verify = promisify(Crypt.verify_decrypt_verify.bind(Crypt));

    async function sign_challenge(id, type, challenge) {
        return await sign_encrypt_sign(
            { key: challenge_keypair.privateKey, is_private: true },
            { key: challenge_keypair.publicKey, is_public: true },
            [ id, type, challenge, Date.now() ]);
    }

    async function verify_challenge(expected_id, expected_type, obj) {
        try {
            const signed_challenge = obj.signed_challenge;
            delete obj.signed_challenge;
            const [ id, type, challenge, timestamp ] = await verify_decrypt_verify(
                { key: challenge_keypair.privateKey, is_private: true },
                { key: challenge_keypair.publicKey, is_public: true },
                signed_challenge);
            if (id !== expected_id) {
                throw new Error('wrong ID');
            }
            if (type !== expected_type) {
                throw new Error('wrong type');
            }
            if ((timestamp + challenge_timeout) <= Date.now('dummy' /* for test */)) {
                throw new Error('challenge timed out');
            }
            return challenge;
        } catch (ex) {
            ex.statusCode = 400;
            throw ex;
        }
    }

    for (const id of valid_ids) { // eslint-disable-line require-atomic-updates
        fastify.log.info(`setting up routes for id: ${id}`);

        fastify.get(`/${id}/`, { schema: schemas.get }, async (request, reply) => {
            const { pub_key, issuer_id } = await get_pub_key_by_uri(id);
            if (pub_key === null) {
                reply.code(404);
                const attestation_options = await fido2lib.attestationOptions(fido2_options.attestation_options);
                toArray(attestation_options, 'challenge');
                toArray(attestation_options, 'rawChallenge');
                attestation_options.user = Object.assign({
                    name: default_user,
                    displayName: default_user,
                    id: default_user
                }, attestation_options.user, fido2_options.user);
                const signed_challenge = await sign_challenge(id, 'attestation', attestation_options.challenge);
                return { attestation_options, signed_challenge };
            }
            const assertion_options = await fido2lib.assertionOptions(fido2_options.assertion_options);
            toArray(assertion_options, 'challenge');
            toArray(assertion_options, 'rawChallenge');
            const signed_challenge = await sign_challenge(id, 'assertion', assertion_options.challenge);
            return {
                assertion_options,
                signed_challenge,
                cred_id: pub_key.cred_id,
                issuer_id
            };
        });

        fastify.put(`/${id}/`, { schema: schemas.put }, async request => {
            const cred = clone(request.body);
            const challenge = await verify_challenge(id, 'attestation', cred);
            toArrayBuffer(cred, 'id', 'base64');
            toArrayBuffer(cred.response, 'attestationObject');
            toArrayBuffer(cred.response, 'clientDataJSON');
            let cred_response;
            try {
                cred_response = await fido2lib.attestationResult(
                    cred,
                    Object.assign({
                        // fido2-lib expects https
                        origin: `https://${request.headers.host}`,
                        challenge,
                        factor: 'either'
                    }, fido2_options.attestation_expectations));
            } catch (ex) {
                ex.statusCode = 400;
                throw ex;
            }
            const cred_id = toArray(cred_response.authnrData.get('credId'));
            const issuer_id = await add_pub_key(id, {
                pub_key: cred_response.authnrData.get('credentialPublicKeyPem'),
                cred_id: cred_id
            });
            await deploy();
            return { cred_id, issuer_id };
        });

        fastify.post(`/${id}/`, { schema: schemas.post }, async (request, reply) => {
            const { pub_key } = await get_pub_key_by_uri(id);
            if (pub_key === null) {
                const err = new Error('no public key');
                err.statusCode = 404;
                throw err;
            }
            const assertion = clone(request.body);
            const challenge = await verify_challenge(id, 'assertion', assertion);
            fix_assertion_types(assertion);
            const userHandle = Object.assign({
                // not all authenticators can store user handles
                userHandle: null
            }, assertion.response).userHandle;
            const assertion_expectations = Object.assign({
                // fido2-lib expects https
                origin: `https://${request.headers.host}`,
                challenge,
                factor: 'either',
                prevCounter: 0,
                userHandle: userHandle,
                publicKey: pub_key.pub_key
            }, fido2_options.assertion_expectations);
            try {
                await fido2lib.assertionResult(
                    assertion,
                    await complete_assertion_expectations(assertion, assertion_expectations));
            } catch (ex) {
                ex.statusCode = 400;
                throw ex;
            }
            reply.code(204);
        });
    }
}
