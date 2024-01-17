/*eslint-env node */
import { promisify } from 'util';
import sodium_plus from 'sodium-plus';
const { SodiumPlus } = sodium_plus;
import { hash_id, ErrorWithStatus } from './common.js';
import { cred as schemas } from './dist/schemas.js';

export default async function (fastify, options) {
    const {
        keystore,
        webAuthn,
        valid_ids,
        session_data_timeout,
        users,
        default_user,
        registration_options,
        login_options
    } = Object.assign({
        session_data_timeout: 60000,
        users: {},
        default_user: {
            id: 'anonymous',
            name: 'Anonymous',
            displayName: 'Anonymous'
        }
    }, options.cred_options);

    const get_uris = promisify(keystore.get_uris.bind(keystore));
    const add_pub_key = promisify(keystore.add_pub_key.bind(keystore));
    const remove_pub_key = promisify(keystore.remove_pub_key.bind(keystore));
    const get_pub_key_by_uri = promisify((uri, cb) => {
        keystore.get_pub_key_by_uri(uri, (err, user, issuer_id) => {
            cb(err, { user, issuer_id });
        });
    });
    const deploy = promisify(keystore.deploy.bind(keystore));

    // Use shared-key authenticated encryption for challenges
    const sodium = await SodiumPlus.auto();
    const session_data_key = await sodium.crypto_secretbox_keygen();

    async function make_secret_session_data(id, type, session_data) {
        const nonce = await sodium.randombytes_buf(
            sodium.CRYPTO_SECRETBOX_NONCEBYTES);
        return {
            ciphertext: (await sodium.crypto_secretbox(
                JSON.stringify([ id, type, session_data, Date.now() ]),
                nonce,
                session_data_key)).toString('base64'),
            nonce: nonce.toString('base64')
        };
    }

    async function verify_secret_session_data(expected_id, expected_type, secret_session_data) {
        try {
            const [ id, type, session_data, timestamp ] = JSON.parse(
                await sodium.crypto_secretbox_open(
                    Buffer.from(secret_session_data.ciphertext, 'base64'),
                    Buffer.from(secret_session_data.nonce, 'base64'),
                    session_data_key));
            if (id !== expected_id) {
                throw new Error('wrong ID');
            }
            if (type !== expected_type) {
                throw new Error('wrong type');
            }
            if ((timestamp + session_data_timeout) <= Date.now('dummy' /* for test */)) {
                throw new Error('session timed out');
            }
            return session_data;
        } catch (ex) {
            ex.statusCode = 400;
            throw ex;
        }
    }

    // Store hash of the IDs so path can't be determined from database
    const valid_hashes = new Set();
    const valid_hashmap = new Map();
    for (const [id, prefixed_id] of valid_ids) {
        const hash = await hash_id(sodium, prefixed_id);
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

        const empty_user = Object.assign({}, users[id] || default_user, {
            credentials: []
        });

        fastify.get(`/${id}/`, { schema: schemas.get }, async (request, reply) => {
            const { user, issuer_id } = await get_pub_key_by_uri(hash);
            if (user === null) {
                reply.code(404);
                const {
                    options,
                    sessionData
                } = await webAuthn.beginRegistration(empty_user, ...registration_options);
                return {
                    options,
                    session_data: await make_secret_session_data(
                        id, 'registration', sessionData)
                };
            }
            const { options, sessionData } = await webAuthn.beginLogin(user, ...login_options);
            return {
                issuer_id,
                options,
                session_data: await make_secret_session_data(
                    id, 'login', sessionData)
            };
        });

        fastify.put(`/${id}/`, { schema: schemas.put }, async (request, reply) => {
            const session_data = await verify_secret_session_data(
                id, 'registration', request.body.session_data);
            let credential;
            try {
                credential = await webAuthn.finishRegistration(
                    empty_user, session_data, request.body.ccr);
            } catch (ex) {
                ex.statusCode = 400;
                throw ex;
            }
            const user = Object.assign({}, empty_user, {
                credentials: [credential]
            });
            const issuer_id = await add_pub_key(hash, user);
            await deploy();
            const { options } = await webAuthn.beginLogin(user, ...login_options);
            reply.code(201);
            return { issuer_id, options };
        });

        fastify.post(`/${id}/`, { schema: schemas.post }, async (request, reply) => {
            const { user } = await get_pub_key_by_uri(hash);
            if (user === null) {
                throw new ErrorWithStatus('no user', 404);
            }
            const session_data = await verify_secret_session_data(
                id, 'login', request.body.session_data);
            let credential;
            try {
                credential = await webAuthn.finishLogin(
                    user, session_data, request.body.car);
            } catch (ex) {
                ex.statusCode = 400;
                throw ex;
            }
            if (credential.authenticator.cloneWarning) {
                throw new ErrorWithStatus('credential appears to be cloned', 403);
            }
            // Note we don't update signCount because the credential is expected to be used
            // to sign assertions which are given out as perks, which (a) may be duplicated
            // and (b) may be used in any order.
            reply.code(204);
        });
    }
}
