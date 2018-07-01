/*eslint-env node */
const { promisify } = require('util');
const path = require('path');
const readFile = promisify(require('fs').readFile);
const argv = require('yargs')
    .array('id')
    .demandOption('id')
    .argv;
const fastify = require('fastify')({
    logger: true
});

(async () => {
    fastify.register(require('./backend.js'), {
        cred_options: {
            valid_ids: argv.id,
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
})();
