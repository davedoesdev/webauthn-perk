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
    for (let i = 0; i < 2; ++i) {
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
                new_options: {
                    attestation: 'none'
                }
            }
        }
    });

    fastify.register(require('fastify-static'), {
        root: path.join(__dirname, 'fixtures'),
        prefix: '/test'
    });

    await fastify.listen(port);

    browser.on('end', function () {
        (async function () {
            await fastify.close();
        })();
    });

    await browser.url(`${origin}/test/cred.html`);
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

async function auth(url, options) {
    options = Object.assign({
        valid_status: 200
    }, options);

    return await executeAsync(async (url, options) => {
        const get_response = await axios(url, {
            validateStatus: status => status === 404
        });

        const attestation_options = get_response.data;
        attestation_options.challenge = Uint8Array.from(attestation_options.challenge,
            x => options.modify_challenge ? x ^ 1 : x);
        attestation_options.user.id = new TextEncoder('utf-8').encode(attestation_options.user.id);

        const cred = await navigator.credentials.create({ publicKey: attestation_options });

        const assertion_result = {
            id: cred.id,
            response: {
                attestationObject: Array.from(new Uint8Array(cred.response.attestationObject)),
                clientDataJSON: new TextDecoder('utf-8').decode(cred.response.clientDataJSON)
            }
        };

        if (options.expire_session) {
            document.cookie = 'session=; Path=/cred/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        }

        const put_response = await axios.put(url, assertion_result, {
            validateStatus: status => status === options.valid_status
        });

        return [assertion_result, put_response.data, put_response.status];
    }, url, options);
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

    it('should return 400 for invalid signature', async function () {
        const [unused_assertion_result, unused_key_info, status] = await auth(urls[0], {
            valid_status: 400,
            modify_challenge: true });
        expect(status).to.equal(400);
    });

    it('should return 400 for expired session', async function () {
        const [unused_assertion_result_, unused_key_info, status] = await auth(urls[0], {
            valid_status: 400,
            expire_session: true });
        expect(status).to.equal(400);
    });

    let assertion_result, key_info;

    it('should return challenge and add public key', async function () {
        let status;
        [assertion_result, key_info, status] = await auth(urls[0]);
        expect(status).to.equal(200);
    });

    it('should return key info', async function () {
        expect(await executeAsync(async url => {
            return (await axios(url)).data;
        }, urls[0])).to.eql(key_info);
    });

    it('should return 409', async function () {
        expect(await executeAsync(async (url, assertion_result) => {
            return (await axios.put(url, assertion_result, {
                validateStatus: status => status === 409
            })).status;
        }, urls[0], assertion_result)).to.equal(409);
    });

    it('should delete keys not in valid ID list', async function () {
        const dummy_fastify = {
            addHook() {},
            register(f, opts) {
                this.f = f;
                this.opts = opts;
            },
            log: fastify.log,
            get() {},
            put() {}
        };

        // first check we don't delete valid ID
        await require('../backend.js')(dummy_fastify, {
            authorize_jwt_options: {
                db_dir: path.join(__dirname, 'store'),
            },
            cred_options: {
                valid_ids: valid_ids
            }
        });
        await dummy_fastify.f(dummy_fastify, dummy_fastify.opts);
        expect(await executeAsync(async url => {
            return (await axios(url)).data;
        }, urls[0])).to.eql(key_info);

        // then check we delete invalid IDs
        await require('../backend.js')(dummy_fastify, {
            authorize_jwt_options: {
                db_dir: path.join(__dirname, 'store'),
            },
            cred_options: {
                valid_ids: valid_ids.slice(1)
            }
        });
        await dummy_fastify.f(dummy_fastify, dummy_fastify.opts);
        expect(await executeAsync(async url => {
            return (await axios(url, {
                validateStatus: status => status === 404
            })).status;
        }, urls[0])).to.equal(404);
    });
    
    it('should return 404 on invalid URL', async function () {
        expect(await executeAsync(async url => {
            return (await axios(url, {
                validateStatus: status => status === 404
            })).status;
        }, 'foobar')).to.equal(404);

        expect(await executeAsync(async (url, assertion_result) => {
            return (await axios.put(url, assertion_result, {
                validateStatus: status => status === 404
            })).status;
        }, 'foobar', assertion_result)).to.equal(404);
    });

    it('should return 404 on second URL', async function () {
        expect(await executeAsync(async url => {
            return (await axios(url, {
                validateStatus: status => status === 404
            })).status;
        }, urls[1])).to.equal(404);
    });

    it('should return 400 on second URL', async function () {
        expect(await executeAsync(async (url, assertion_result) => {
            return (await axios.put(url, assertion_result, {
                validateStatus: status => status === 400
            })).status;
        }, urls[1], assertion_result)).to.equal(400);
    });

    it('should return different key info for second URL', async function () {
        const [unused_assertion_result, key_info2] = await auth(urls[1]);
        expect(key_info2).not.to.eql(key_info);
    });


    // test challenge timeout
    // use to sign JWT (need issuer_id)
    // check > 1 ID and that don't affect each other (use second key info to auth to first)
    // if CI is true, replay IO
    // add schemas for requests and responses + test invalid inc undefined assertion result (415)
});