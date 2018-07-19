/* eslint-env node */
/* eslint-disable no-console */

const path = require('path');
const readFile = require('fs').promises.readFile;
const { promisify } = require('util');
const randomBytes = promisify(require('crypto').randomBytes);

(async function () {
    const fastify = require('fastify')({
        logger: true,
        https: {
            key: await readFile(path.join(__dirname, 'keys', 'server.key')),
            cert: await readFile(path.join(__dirname, 'keys', 'server.crt'))
        }
    });

    const id = (await randomBytes(64)).toString('hex');

    fastify.register(require('..'), {
        cred_options: {
            valid_ids: [id],
            secure_session_options: {
                key: await readFile(path.join(__dirname, 'secret-session-key'))
            }
        }
    });

    fastify.register(require('fastify-static'), {
        root: path.join(__dirname, 'fixtures'),
        prefix: `/${id}`
    });

    await fastify.listen(3000);

    console.log(`Please visit https://localhost:3000/${id}/example.html`);
})();
