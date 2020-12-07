/*eslint-env node */
import { promisify } from 'util';

export async function hash_id(sodium, id) {
    return (await sodium.crypto_generichash(id)).toString('hex');
}

export class ErrorWithStatus extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}

// Use shared-key authenticated encryption for challenges
export async function generate_secret_session_data_key(sodium) {
    return await sodium.crypto_secretbox_keygen();
}

export async function make_secret_session_data(sodium, id, type, session_data, key) {
    const nonce = await sodium.randombytes_buf(sodium.CRYPTO_SECRETBOX_NONCEBYTES);
    return {
        ciphertext: (await sodium.crypto_secretbox(
            JSON.stringify([ id, type, session_data, Date.now() ]),
            nonce,
            key)).toString('base64'),
        nonce: nonce.toString('base64')
    };
}

export async function get_secret_session_data_id_and_type(
    sodium, secret_session_data, key) {

    try {
        const [ id, type ] = JSON.parse(
            await sodium.crypto_secretbox_open(
                Buffer.from(secret_session_data.ciphertext, 'base64'),
                Buffer.from(secret_session_data.nonce, 'base64'),
                key));
        return { id, type };
    } catch (ex) {
        ex.statusCode = 400;
        throw ex;
    }
}

export async function verify_secret_session_data(
    sodium, expected_id, expected_type, secret_session_data, key, timeout) {

    try {
        const [ id, type, session_data, timestamp ] = JSON.parse(
            await sodium.crypto_secretbox_open(
                Buffer.from(secret_session_data.ciphertext, 'base64'),
                Buffer.from(secret_session_data.nonce, 'base64'),
                key));
        if (id !== expected_id) {
            throw new Error('wrong ID');
        }
        if (type !== expected_type) {
            throw new Error('wrong type');
        }
        if ((timestamp + timeout) <= Date.now('dummy' /* for test */)) {
            throw new Error('session timed out');
        }
        return session_data;
    } catch (ex) {
        ex.statusCode = 400;
        throw ex;
    }
}

export async function make_authorize(authz, sodium, valid_ids) {
    const valid_hashmap = new Map();
    for (const [id, prefixed_id] of valid_ids) {
        valid_hashmap.set(`id:${await hash_id(sodium, prefixed_id)}`, id);
    }

    return promisify((authz_token, cb) => {
        authz.authorize(authz_token, [], (err, payload, hash, rev, credential) => {
            if (err) {
                return cb(err);
            }
            const uri = valid_hashmap.get(hash);
            if (uri === undefined) {
                return cb(new Error(`no matching id for hash: ${hash}`));
            }
            cb(err, { payload, hash: hash.split(':')[1], uri, rev, credential });
        });
    });
}

export async function register(
    keystore, webAuthn, sodium, empty_user, login_options,
    id, hash, body, session_data_key, session_data_timeout) {

    const session_data = await verify_secret_session_data(
        sodium, id, 'registration', body.session_data, session_data_key, session_data_timeout);
    let credential;
    try {
        credential = await webAuthn.finishRegistration(empty_user, session_data, body.ccr);
    } catch (ex) {
        ex.statusCode = 400;
        throw ex;
    }
    const user = Object.assign({}, empty_user, {
        credentials: [credential]
    });
    const issuer_id = await keystore.add_pub_key(`id:${hash}`, user);
    await keystore.deploy();
    const { options } = await webAuthn.beginLogin(user, ...login_options);
    return { issuer_id, options };
}

export async function login(
    keystore, webAuthn, sodium,
    id, hash, body, session_data_key, session_data_timeout) {

    const { obj: user } = await keystore.get_pub_key_by_uri(`id:${hash}`);
    if (user === null) {
        throw new ErrorWithStatus('no user', 404);
    }
    const session_data = await verify_secret_session_data(
        sodium, id, 'login', body.session_data, session_data_key, session_data_timeout);
    let credential;
    try {
        credential = await webAuthn.finishLogin(user, session_data, body.car);
    } catch (ex) {
        ex.statusCode = 400;
        throw ex;
    }
    if (credential.Authenticator.CloneWarning) {
        throw new ErrorWithStatus('credential appears to be cloned', 403);
    }
    // Note we don't update SignCount because the credential is expected to be used
    // to sign assertions which are given out as perks, which (a) may be duplicated
    // and (b) may be used in any order.
}
