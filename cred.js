/*eslint-env node */
import {
    hash_id,
    make_secret_session_data,
    register,
    login
} from './common.js';
import { cred as schemas } from './dist/schemas.js';

export default async function (fastify, options) {
    const {
        keystore,
        webAuthn,
        sodium,
        session_data_key,
        session_data_timeout,
        valid_ids,
        empty_user,
        registration_options,
        login_options
    } = options.cred_options;

    // Store hash of the IDs so path can't be determined from database
    const valid_hashes = new Set();
    const valid_hashmap = new Map();
    for (const [id, prefixed_id] of valid_ids) {
        const hash = await hash_id(sodium, prefixed_id);
        valid_hashes.add(hash);
        valid_hashmap.set(id, hash);
    }

    // Delete pub keys that aren't passed as argument
    for (const uri of await keystore.get_uris()) {
        if (!valid_hashes.has(uri.split(':')[1])) {
            fastify.log.info(`removing entry: ${uri}`);
            await keystore.remove_pub_key(uri);
        }
    }

    for (const [id, hash] of valid_hashmap) { // eslint-disable-line require-atomic-updates
        fastify.log.info(`setting up routes for id: ${id}, hash: ${hash}`);

        fastify.get(`/${id}/`, { schema: schemas.get }, async (request, reply) => {
            const { obj: user, issuer_id } = await keystore.get_pub_key_by_uri(`id:${hash}`);
            if (user === null) {
                reply.code(404);
                const {
                    options,
                    sessionData
                } = await webAuthn.beginRegistration(empty_user, ...registration_options);
                return {
                    options,
                    session_data: await make_secret_session_data(
                        sodium, id, 'registration', sessionData, session_data_key)
                };
            }
            const { options, sessionData } = await webAuthn.beginLogin(user, ...login_options);
            return {
                issuer_id,
                options,
                session_data: await make_secret_session_data(
                    sodium, id, 'login', sessionData, session_data_key)
            };
        });

        fastify.put(`/${id}/`, { schema: schemas.put }, async (request, reply) => {
            const r = await register(
                keystore, webAuthn, sodium, empty_user, login_options,
                id, hash, request.body, session_data_key, session_data_timeout);
            reply.code(201);
            return r;
        });

        fastify.post(`/${id}/`, { schema: schemas.post }, async (request, reply) => {
            await login(
                keystore, webAuthn, sodium,
                id, hash, request.body, session_data_key, session_data_timeout);
            reply.code(204);
        });
    }
}
