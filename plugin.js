/*eslint-env node */
import { promisify } from 'util';
import mod_authorize_jwt from 'authorize-jwt';
import sodium_plus from 'sodium-plus';
const { SodiumPlus } = sodium_plus;
import perk from './perk.js';
import cred from './cred.js';
import access from './access.js';
import { generate_secret_session_data_key } from './common.js';
const authorize_jwt = promisify(mod_authorize_jwt);

export default async function (fastify, options) {
    options = options.webauthn_perk_options || options;

    const sodium = await SodiumPlus.auto();
    const session_data_key = await generate_secret_session_data_key(sodium);

    const cred_options = Object.assign({
        prefix: '/cred/',
        valid_ids: [],
        store_prefix: false,
        registration_options: [],
        login_options: [],
        session_data_timeout: 60000,
        default_user: {
            id: 'anonymous',
            name: 'Anonymous',
            displayName: 'Anonymous'
        }
    }, options.cred_options, {
        sodium,
        session_data_key
    });
   
    cred_options.empty_user = Object.assign({}, cred_options.default_user, {
        credentials: []
    });

    const authorize_jwt_options = Object.assign({
        db_type: 'pouchdb',
        db_for_update: true,
        no_changes: true,
        no_updates: true,
        WEBAUTHN_MODE: true,
        async on_authz(unused_authz) {},
        complete_webauthn_token(token, cb) {
            token.opts = cred_options.login_options;
            cb(null, token);
        }
    }, options.authorize_jwt_options);

    const authz = await authorize_jwt(authorize_jwt_options);
    await authorize_jwt_options.on_authz(authz);

    fastify.addHook('onClose', async function () {
        await promisify(authz.close.bind(authz))();
    });

    cred_options.keystore = {
        get_uris: promisify(authz.keystore.get_uris.bind(authz.keystore)),
        add_pub_key: promisify(authz.keystore.add_pub_key.bind(authz.keystore)),
        remove_pub_key: promisify(authz.keystore.remove_pub_key.bind(authz.keystore)),
        get_pub_key_by_uri: promisify((uri, cb) => {
            authz.keystore.get_pub_key_by_uri(uri, (err, obj, issuer_id) => {
                cb(err, { obj, issuer_id });
            });
        }),
        deploy: promisify(authz.keystore.deploy.bind(authz.keystore))
    };
    cred_options.webAuthn = authz.webAuthn;

    cred_options.valid_ids = new Map(cred_options.valid_ids
        .filter(id => id)
        .map(id => [id, cred_options.store_prefix ?
            `${fastify.prefix}${cred_options.prefix}${id}` : id
        ]));
    fastify.log.info(`valid ids: ${Array.from(cred_options.valid_ids.keys())}`);

    fastify.register(cred, {
        prefix: cred_options.prefix,
        cred_options
    });

    const perk_options = Object.assign({
        prefix: '/perk/'
    }, options.perk_options, {
        authz,
        sodium,
        valid_ids: cred_options.valid_ids
    });

    if (options.access_control) {
        const access_options = Object.assign({
            prefix: '/access/'
        }, options.access_options, {
            authz,
            keystore: cred_options.keystore,
            sodium,
            session_data_key,
            session_data_timeout: cred_options.session_data_timeout,
            valid_ids: cred_options.valid_ids,
            empty_user: cred_options.empty_user,
            registration_options: cred_options.registration_options,
            login_options: cred_options.login_options
        });

        fastify.register(access, {
            prefix: access_options.prefix,
            access_options
        });

        perk_options.session_data_key = session_data_key;
        perk_options.session_data_timeout = cred_options.session_data_timeout;
        perk_options.keystore = cred_options.keystore;
        perk_options.login_options = cred_options.login_options;
    }

    fastify.register(perk, {
        prefix: perk_options.prefix,
        perk_options
    });
}
