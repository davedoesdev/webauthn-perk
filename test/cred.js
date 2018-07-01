/* eslint-env node, mocha, browser */
/* global browser, axios */

const { promisify } = require('util');
const path = require('path');
const readFile = require('fs').promises.readFile;
const { expect } = require('chai');
const randomBytes = promisify(require('crypto').randomBytes);
const port = 3000;
const origin = `https://localhost:${port}`;
const valid_ids = [];
const urls = [];
let fastify;

before(async function () {
    for (let i = 0; i < 5; ++i) {
        const id = (await randomBytes(64)).toString('hex');
        valid_ids.push(id);
        urls.push(`${origin}/cred/${id}`);
    }

    fastify = require('fastify')({
        logger: true,
        https: {
            key: await readFile(path.join(__dirname, 'keys', 'server.key')),
            cert: await readFile(path.join(__dirname, 'keys', 'server.crt'))
        }
    });

    fastify.register(require('../backend.js'), {
        authorize_jwt_options: {
            db_dir: path.join(__dirname, 'store'),
        },
        cred_options: {
            valid_ids: valid_ids,
            secure_session_options: {
                key: await readFile(path.join(__dirname, 'secret-session-key'))
            },
            fido2_options: {
                attestation_expectations: {
                    factor: 'either',
                    origin: origin
                }
            }
        }
    });

    fastify.register(require('fastify-static'), {
        root: path.join(__dirname, 'fixtures'),
        prefix: '/test'
    });

    await fastify.listen(port);

    await browser.url(`${origin}/test/cred.html`);
});

after(async function () {
    await fastify.close();
});

async function executeAsync(f, ...args) {
    const r = (await browser.executeAsync(function (f, ...args) {
        (async function () {
            let done = args[args.length - 1];
            try {
                done(await eval(f)(...args.slice(0, -1)));
            } catch (ex) {
                done({ error: ex.message }); 
            }
        })();
    }, f.toString(), ...args)).value;

    if (r.error) {
        throw new Error(r.error);
    }

    return r;
}

describe('credentials', function () {
    this.timeout(5 * 60 * 1000);
    browser.timeouts('script', 5 * 60 * 1000);

    it('should return 404', async function () {
        expect(await executeAsync(async url => {
            return (await axios(url, {
                validateStatus: status => status === 404
            })).status;
        }, urls[0])).to.equal(404);
    });

    let key_info;

    it('should return challenge and add public key', async function () {
        key_info = await executeAsync(async url => {
            const get_response = await axios(url, {
                validateStatus: status => status === 404
            });

            const attestation_options = get_response.data;
            attestation_options.challenge = Uint8Array.from(attestation_options.challenge);
            attestation_options.user.id = new TextEncoder('utf-8').encode(attestation_options.user.id);

            const cred = await navigator.credentials.create({ publicKey: attestation_options });

            const put_response = await axios.put(url, {
                id: cred.id,
                response: {
                    attestationObject: Array.from(new Uint8Array(cred.response.attestationObject)),
                    clientDataJSON: new TextDecoder('utf-8').decode(cred.response.clientDataJSON)
                }
            });

            return put_response.data;
        }, urls[0]);
    });

    it('should return key info', async function () {
        expect(await executeAsync(async url => {
            return (await axios(url)).data;
        }, urls[0])).to.eql(key_info);
    });

    // 409 when set again
    // use to sign JWT (need issuer_id)
    // bad data - check fails
    // wrong session
    // check > 1 ID and that don't affect each other
    // coverage
});