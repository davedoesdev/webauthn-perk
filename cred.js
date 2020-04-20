/*eslint-env node */
import { promisify } from 'util';
import { Fido2Lib } from '@davedoesdev/fido2-lib';
import { SodiumPlus } from 'sodium-plus';
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
    }, options).valid_ids
        .filter(id => id)
        .map(id => options.store_prefix ? fastify.prefix + id : id));
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

    // Use shared-key authenticated encryption for challenges
    const sodium = await SodiumPlus.auto();
    const challenge_key = await sodium.crypto_secretbox_keygen();

    async function make_challenge(id, type, challenge) {
        const nonce = await sodium.randombytes_buf(
            sodium.CRYPTO_SECRETBOX_NONCEBYTES);
        return {
            ciphertext: toArray(await sodium.crypto_secretbox(
                JSON.stringify([ id, type, challenge, Date.now() ]),
                nonce,
                challenge_key)),
            nonce: toArray(nonce)
        };
    }

    async function verify_challenge(expected_id, expected_type, obj) {
        try {
            const authenticated_challenge = obj.authenticated_challenge;
            delete obj.authenticated_challenge;
            const [ id, type, challenge, timestamp ] = JSON.parse(
                await sodium.crypto_secretbox_open(
                    Buffer.from(authenticated_challenge.ciphertext),
                    Buffer.from(authenticated_challenge.nonce),
                    challenge_key));
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

    // Store hash of the IDs so path can't be determined from database
    const valid_hashes = new Set();
    const valid_hashmap = new Map();
    for (const id of valid_ids) {
        const hash = (await sodium.crypto_generichash(id)).toString('hex');
        valid_hashes.add(hash);
        valid_hashmap.set(id, hash);
    }

    // Delete pub keys that aren't passed as argument
    for (const hash of await get_uris()) {
        if (!valid_hashes.has(hash)) {
            fastify.log.info(`removing pub key for hash: ${hash}`);
            await remove_pub_key(hash);
        }
    }

    for (const [id, hash] of valid_hashmap) { // eslint-disable-line require-atomic-updates
        fastify.log.info(`setting up routes for id: ${id}, hash: ${hash}`);

        fastify.get(`/${id}/`, { schema: schemas.get }, async (request, reply) => {
            const { pub_key, issuer_id } = await get_pub_key_by_uri(hash);
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
                const authenticated_challenge = await make_challenge(id, 'attestation', attestation_options.challenge);
                return { attestation_options, authenticated_challenge };
            }
            const assertion_options = await fido2lib.assertionOptions(fido2_options.assertion_options);
            toArray(assertion_options, 'challenge');
            toArray(assertion_options, 'rawChallenge');
            const authenticated_challenge = await make_challenge(id, 'assertion', assertion_options.challenge);
            return {
                assertion_options,
                authenticated_challenge,
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
            const issuer_id = await add_pub_key(hash, {
                pub_key: cred_response.authnrData.get('credentialPublicKeyPem'),
                cred_id
            });
            await deploy();
            return { cred_id, issuer_id };
        });

        fastify.post(`/${id}/`, { schema: schemas.post }, async (request, reply) => {
            const { pub_key } = await get_pub_key_by_uri(hash);
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
