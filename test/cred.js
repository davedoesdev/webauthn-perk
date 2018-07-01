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
let fastify;

before(async function () {
    for (let i = 0; i < 5; ++i) {
        valid_ids.push((await randomBytes(64)).toString('hex'));
    }
});

beforeEach(async function () {
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
            }
        }
    });

    fastify.register(require('fastify-static'), {
        root: path.join(__dirname, 'fixtures'),
        prefix: '/test'
    });

    await fastify.listen(port);
});

afterEach(async function () {
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

    it('should return 404 and challenge', async function () {
        // browser should axios to backend and GET
        // should get challenge etc
        // load from static

        await browser.url(`${origin}/test/cred.html`);

        const url0 = `${origin}/cred/${valid_ids[0]}`;

        expect(await executeAsync(async url => {
            return (await axios(url, {
                validateStatus: status => status === 404
            })).status;
        }, url0)).to.equal(404);

        const cred = await executeAsync(async url => {
            const response = await axios(url, {
                validateStatus: status => status === 404
            });

            const data = response.data;
            data.challenge = Uint8Array.from(data.challenge);
            data.user.id = new TextEncoder('utf-8').encode(data.user.id);

            const cred = await navigator.credentials.create({
                publicKey: response.data
            });

            return cred;
        }, url0);

        console.log("HELLO", cred);

        // then do the same but use the data to make a credential

    });
});