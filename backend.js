/*eslint-env node */
const fp = require('fastify-plugin');
const { promisify } = require('util');
const authorize_jwt = promisify(require('authorize-jwt'));

module.exports = fp(async function (fastify, options) {
    options = options.backend_options || options;

    const authz = await authorize_jwt(Object.assign({
        db_type: 'pouchdb',
        db_for_update: true,
        no_updates: true,
        WEBAUTHN_MODE: true,
    }, options.authorize_jwt_options));

    fastify.addHook('onClose', async function () {
        const ks = authz.keystore;
        const close = promisify(ks.close.bind(ks));
        await close();
    });

    fastify.register(require('./cred.js'), {
        prefix: '/cred',
        cred_options: Object.assign({
            keystore: authz.keystore
        }, options.cred_options)
    });
});
