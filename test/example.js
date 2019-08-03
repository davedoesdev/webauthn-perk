/* eslint-env node */
/* eslint-disable no-console */

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { promisify } from 'util';
import mod_fastify from 'fastify';
import fastify_static from 'fastify-static';
import webauthn_perk from '..';
const readFile = fs.promises.readFile;
const randomBytes = promisify(crypto.randomBytes);

(async function () {
    const fastify = mod_fastify({
        logger: true,
        https: {
            key: await readFile(path.join(__dirname, 'keys', 'server.key')),
            cert: await readFile(path.join(__dirname, 'keys', 'server.crt'))
        }
    });

    const id = (await randomBytes(64)).toString('hex');

    fastify.register(webauthn_perk, {
        authorize_jwt_options: {
            db_dir: path.join(__dirname, 'store')
        },
        cred_options: {
            valid_ids: [id],
            fido2_options: {
                new_options: {
                    attestation: 'none',
                    authenticatorUserVerification: 'required'
                },
                assertion_expectations: {
                    factor: 'first'
                },
                attestation_expectations: {
                    factor: 'first'
                }
            }
        },
        perk_options: {
            fido2_options: {
                assertion_expectations: {
                    factor: 'first'
                }
            },
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
        root: path.join(__dirname, 'fixtures'),
        prefix: `/${id}`,
        index: 'example.html'
    });

    fastify.register(fastify_static, {
        root: path.join(__dirname, '..', 'dist'),
        prefix: `/${id}/dist`,
        decorateReply: false
    });

    await fastify.listen(3000);

    console.log(`Please visit https://localhost:3000/${id}/`);
})();
