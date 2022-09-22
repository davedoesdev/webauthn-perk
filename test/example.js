/* eslint-env node */
/* eslint-disable no-console */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { promisify } from 'util';
import mod_fastify from 'fastify';
import fastify_static from '@fastify/static';
import webauthn_perk from '../plugin.js';
const readFile = fs.promises.readFile;
const randomBytes = promisify(crypto.randomBytes);
const __dirname = dirname(fileURLToPath(import.meta.url));

const port = 3000;
const origin = `https://localhost:${port}`;

(async function () {
    const fastify = mod_fastify({
        logger: true,
        https: {
            key: await readFile(join(__dirname, 'keys', 'server.key')),
            cert: await readFile(join(__dirname, 'keys', 'server.crt'))
        }
    });

    const id = (await randomBytes(64)).toString('hex');

    fastify.register(webauthn_perk, {
        authorize_jwt_options: {
            db_dir: join(__dirname, 'store'),
            RPDisplayName: 'example',
            RPID: 'localhost',
            RPOrigin: origin
        },
        cred_options: {
            valid_ids: [id],
        },
        perk_options: {
            response_schema: {
                200: {
                    type: 'string'
                }
            },
            async handler (info) {
                return info.payload.message;
            }
        }
    });

    fastify.register(fastify_static, {
        root: join(__dirname, 'fixtures'),
        prefix: `/${id}`,
        index: 'example.html'
    });

    fastify.register(fastify_static, {
        root: join(__dirname, '..', 'dist'),
        prefix: `/${id}/dist`,
        decorateReply: false
    });

    await fastify.listen({ port: 3000 });

    console.log(`Please visit ${origin}/${id}/`);
})();
