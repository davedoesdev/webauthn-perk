/*eslint-env node */
const { promisify } = require('util');
const path = require('path');
const readFile = promisify(require('fs').readFile);
const authorize_jwt = promisify(require('authorize-jwt'));
const argv = require('yargs')
    .array('id')
    .demandOption('id')
    .argv;
const fastify = require('fastify')({
    logger: true
});

const start = async () => {
    const authz = await authorize_jwt({
        db_type: 'pouchdb',
        db_for_update: true,
        no_updates: true,
        WEBAUTHN_MODE: true,
    });

    fastify.register(require('./cred.js'), {
        prefix: '/cred',
        cred: {
            valid_ids: argv.id,
            keystore: authz.keystore,
            secure_session_options: {
                key: await readFile(path.join(__dirname, 'secret-session-key'))
            }
        }
    });

    try {
        await fastify.listen(3000);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
