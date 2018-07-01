/*eslint-env node */
const path = require('path');
const readFile = require('fs').promises.readFile;
const fastify = require('fastify')({
    logger: true
});

(async () => {
    if (!process.env.CONFERKIT_VALID_IDS) {
        fastify.log.error('Please specify valid IDs in environment variable CONFERKIT_VALID_IDS');
        process.exit(1);
    }

    fastify.register(require('./backend.js'), {
        cred_options: {
            valid_ids: process.env.CONFERKIT_VALID_IDS.split(','),
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
