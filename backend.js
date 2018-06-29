const { promisify } = require('util');
const pub_keystore = promisify(require('pub-keystore'));
const argv = require('yargs')
    .array('id')
    .demandOption('id')
    .argv;
const fastify = require('fastify')({
    logger: true
});

const start = async () => {
    // TODO: We might need to use authorize-jwt's keystore
    const ks = await pub_keystore({
        db_type: 'pouchdb',
        db_for_update: true,
        no_updates: true
    });

    fastify.register(require('./cred.js'), {
        prefix: '/cred',
        cred: {
            valid_ids: argv.id,
            keystore: ks
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
