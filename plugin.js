/*eslint-env node */
import { promisify } from 'util';
import mod_authorize_jwt from 'authorize-jwt';
import perk from './perk.js';
import cred from './cred.js';
const authorize_jwt = promisify(mod_authorize_jwt);

export default async function (fastify, options) {
    options = options.webauthn_perk_options || options;

    const cred_options = Object.assign({
        prefix: '/cred/',
        valid_ids: [],
        store_prefix: false,
        registration_options: [],
        login_options: []
    }, options.cred_options);
   
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

    cred_options.keystore = authz.keystore;
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
        valid_ids: cred_options.valid_ids
    });

    fastify.register(perk, {
        prefix: perk_options.prefix,
        perk_options
    });
}
