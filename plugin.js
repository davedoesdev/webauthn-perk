/*eslint-env node */
const { promisify } = require('util');
const authorize_jwt = promisify(require('authorize-jwt'));

module.exports = async function (fastify, options) {
    options = options.webauthn_perk_options || options;
    
    const authorize_jwt_options = Object.assign({
        db_type: 'pouchdb',
        db_for_update: true,
        no_changes: true,
        no_updates: true,
        WEBAUTHN_MODE: true,
        async on_authz(unused_authz) {}
    }, options.authorize_jwt_options);

    const authz = await authorize_jwt(authorize_jwt_options);
    await authorize_jwt_options.on_authz(authz);

    fastify.addHook('onClose', async function () {
        const ks = authz.keystore;
        const close = promisify(ks.close.bind(ks));
        await close();
    });

    const perk_options = Object.assign({
        prefix: '/perk/',
        authz
    }, options.perk_options);

    fastify.register(require('./perk.js'), {
        prefix: perk_options.prefix,
        perk_options: perk_options
    });

    const cred_options = Object.assign({
        prefix: '/cred/',
        keystore: authz.keystore
    }, options.cred_options);

    fastify.register(require('./cred.js'), {
        prefix: cred_options.prefix,
        cred_options: cred_options
    });
};
