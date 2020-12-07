/*eslint-env node */
import Ajv from 'ajv';
import sodium_plus from 'sodium-plus';
const { CryptographyKey } = sodium_plus;
import {
    make_secret_session_data,
    verify_secret_session_data,
    make_authorize,
    ErrorWithStatus,
    get_secret_session_data_id_and_type,
    hash_id,
    register,
    login
} from './common.js';
import { access as schemas } from './dist/schemas.js';

export default async function (fastify, options) {
    const {
        authz,
        keystore,
        sodium,
        session_data_key,
        session_data_timeout,
        valid_ids,
        empty_user,
        registration_options,
        login_options,
        credential_secret_key_buf
    } = options.access_options;

    fastify.log.info('setting up access control');

    const credential_secret_key = new CryptographyKey(credential_secret_key_buf);

    const authorize = await make_authorize(authz, sodium, valid_ids);

    const ajv = new Ajv();
    const validate_payload = ajv.compile(schemas.post_payload);

    async function get_encrypted_credentials(keystore, hash) {
        const r = [];
        const { obj: encrypted_ids } = await keystore.get_pub_key_by_uri(`access:${hash}`);
        if (encrypted_ids) {
            const ids = JSON.parse(await sodium.crypto_secretbox_open(
                Buffer.from(encrypted_ids.ciphertext, 'base64'),
                Buffer.from(encrypted_ids.nonce, 'base64'),
                credential_secret_key));
            for (const id of ids) {
                const uri = `credential:${hash}:${await hash_id(sodium, id)}`;
                const { obj: encrypted_credential } = await keystore.get_pub_key_by_uri(uri);
                r.push({ id, encrypted_credential });
            }
        }
        return r;
    }

    fastify.get('/', { schema: schemas.get }, async () => {
        const {
            options,
            sessionData
        } = await authz.webAuthn.beginRegistration(empty_user, ...registration_options);
        return {
            options,
            session_data: await make_secret_session_data(
                sodium, 'access', 'access', sessionData, session_data_key)
        };
    });

    fastify.post('/', { schema: schemas.post }, async (request, reply) => {
        if (request.body.assertion) {
            // Signed request to set allowed credentials
            let info;
            try {
                info = await authorize(request.body.assertion);
            } catch (ex) {
                ex.statusCode = 400;
                throw ex;
            }
            if (!validate_payload(info.payload)) {
                throw new ErrorWithStatus(ajv.errorsText(validate_payload.errors), 400);
            }
            const encrypted_credentials = info.payload.encrypted_credentials;
            const nonce = await sodium.randombytes_buf(sodium.CRYPTO_SECRETBOX_NONCEBYTES);
            await keystore.add_pub_key(`access:${info.hash}`, {
                ciphertext: (await sodium.crypto_secretbox(
                    JSON.stringify(encrypted_credentials.map(c => c.id)),
                    nonce,
                    credential_secret_key)).toString('base64'),
                nonce: nonce.toString('base64')
            }, { allow_update: true });
            for (const ec of encrypted_credentials) {
                const c = JSON.parse(await sodium.crypto_secretbox_open(
                    Buffer.from(ec.encrypted_credential.ciphertext, 'base64'),
                    Buffer.from(ec.encrypted_credential.nonce, 'base64'),
                    credential_secret_key));
                const hash = await hash_id(sodium, ec.id);
                await keystore.add_pub_key(
                    `credential:${info.hash}:${hash}`,
                    ec.encrypted_credential,
                    { allow_update: true });
                await keystore.add_pub_key(
                    `sign_count:${info.hash}:${hash}`,
                    c.Authenticator.SignCount);
            }
            return encrypted_credentials;
        }

        const { id, type } = await get_secret_session_data_id_and_type(
            sodium, request.body.session_data, session_data_key);

        if (request.body.ccr) {
            if (type === 'access') {
                // Get encrypted credential the user has supplied so it can be sent to admin
                const session_data = await verify_secret_session_data(
                    sodium, 'access', 'access', request.body.session_data, session_data_key, session_data_timeout);
                let credential;
                try {
                    credential = await authz.webAuthn.finishRegistration(
                        empty_user, session_data, request.body.ccr);
                } catch (ex) {
                    ex.statusCode = 400;
                    throw ex;
                }
                const nonce = await sodium.randombytes_buf(sodium.CRYPTO_SECRETBOX_NONCEBYTES);
                return [{
                    id: '',
                    encrypted_credential: {
                        ciphertext: (await sodium.crypto_secretbox(
                            JSON.stringify(credential),
                            nonce,
                            credential_secret_key)).toString('base64'),
                        nonce: nonce.toString('base64')
                    }
                }];
            }

            // Register the admin and return list of allowed credentials
            const hash = await hash_id(sodium, id);
            const r = await register(
                keystore, authz.webAuthn, sodium, empty_user, login_options,
                id, hash, request.body, session_data_key, session_data_timeout);
            const encrypted_credentials = await get_encrypted_credentials(keystore, hash);
            reply.code(201);
            return { ...r, encrypted_credentials };
        }

        // Authenticate the admin and return list of allowed credentials
        const hash = await hash_id(sodium, id);
        await login(
            keystore, authz.webAuthn, sodium,
            id, hash, request.body, session_data_key, session_data_timeout);
        return await get_encrypted_credentials(keystore, hash);
    });
}
