/* eslint-env node */
/* eslint-disable no-console */

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';
import { promisify } from 'util';
import mod_fastify from 'fastify';
import fastify_static from 'fastify-static';
import sodium_plus from 'sodium-plus';
const { SodiumPlus } = sodium_plus;
import yargs from 'yargs';
import webauthn_perk from '../plugin.js';
const { readFile } = fs.promises;
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
    const sodium = await SodiumPlus.auto();
    const access_control = yargs(process.argv).argv.accessControl;

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
            },
            get_login_page() {
                return fs.createReadStream(join(__dirname, 'fixtures', 'login.html'));
            }
        },
        access_options: {
            credential_secret_key_buf: (await sodium.crypto_secretbox_keygen()).getBuffer() 
        },
        access_control
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

    fastify.register(fastify_static, {
        root: join(__dirname, 'fixtures'),
        prefix: `/${id}!access/`,
        index: 'set_access.html',
        decorateReply: false
    });

    fastify.register(fastify_static, {
        root: join(__dirname, '..', 'dist'),
        prefix: `/${id}!access/dist`,
        decorateReply: false
    });

    fastify.register(fastify_static, {
        root: join(__dirname, '..', 'node_modules', 'jexcel', 'dist'),
        prefix: `/${id}!access/jexcel`,
        decorateReply: false
    });

    fastify.register(fastify_static, {
        root: join(__dirname, '..', 'node_modules', 'jsuites', 'dist'),
        prefix: `/${id}!access/jsuites`,
        decorateReply: false
    });

    fastify.register(fastify_static, {
        root: join(__dirname, 'fixtures'),
        prefix: '/',
        index: 'get_access.html',
        decorateReply: false
    });

    fastify.register(fastify_static, {
        root: join(__dirname, '..', 'dist'),
        prefix: '/dist',
        decorateReply: false
    });

    await fastify.listen(3000);

    console.log(`Please visit ${origin}/${id}/`);
    if (access_control) {
        console.log(`To get access, visit ${origin}`);
        console.log(`To set access, visit ${origin}/${id}!access/`);
    }
})();
