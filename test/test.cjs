/* eslint-env node, mocha, browser */
/* global browser, PerkWorkflow, jwt_encode, bufferEncode, bufferDecode */

const { promisify } = require('util');
const path = require('path');
const { readFile } = require('fs').promises;
const { Agent } = require('https');
let expect;
const crypto = require('crypto');
const mod_fastify = require('fastify');
const fastify_static = require('@fastify/static');
const axios = require('axios');
const { SodiumPlus } = require('sodium-plus');
const randomBytes = promisify(crypto.randomBytes);
const port = 3000;
const origin = `https://localhost:${port}`;
const audience = 'urn:webauthn-perk:test';
const valid_ids = [];
const urls = [];

let hash_id;
let keystore;
let webAuthn;
let fastify;
let extra_fastifies;

const webauthn_perk_path = '../plugin.js';

async function make_fastify(port, options) {
    const webauthn_perk = (await import(webauthn_perk_path)).default;
    ({ hash_id } = await import('../common.js'));

    options = Object.assign({
        valid_ids,
        async handler (info) {
            return {
                uri: info.uri,
                issuer_id: info.credential.issuer_id,
                payload: info.payload
            };
        },
        async on_authz(authz) {
            keystore = authz.keystore;
            webAuthn = authz.webAuthn;
        },
        payload_schema: {
            type: 'object',
            required: [
                'foo'
            ],
            properties: {
                foo: { type: 'integer' }
            }
        }
    }, options);

    const f = mod_fastify({
        logger: true,
        https: {
            key: await readFile(path.join(__dirname, 'keys', 'server.key')),
            cert: await readFile(path.join(__dirname, 'keys', 'server.crt'))
        }
    });

    const plugin_options = {
        authorize_jwt_options: {
            db_dir: path.join(__dirname, 'store'),
            complete_webauthn_token: options.complete_webauthn_token,
            on_authz: options.on_authz,
            audience,
            RPDisplayName: 'webauthn-perk',
            RPID: 'localhost',
            RPOrigin: `https://localhost:${port}`
        },
        cred_options: {
            valid_ids: options.valid_ids,
            store_prefix: options.store_prefix,
        },
        perk_options: {
            response_schema: {
                200: {
                    type: 'object',
                    required: [
                        'uri',
                        'issuer_id',
                        'payload'
                    ],
                    properties: {
                        uri: { type: 'string' },
                        issuer_id: { type: 'string' },
                        payload: {
                            type: 'object',
                            required: [
                                'aud',
                                'foo',
                                'exp',
                                'iat',
                                'jti',
                                'nbf'
                            ],
                            additionalProperties: false,
                            properties: {
                                aud: {
                                    type: 'string',
                                    const: audience
                                },
                                foo: {
                                    type: 'integer',
                                    const: 90
                                },
                                exp: { type: 'integer' },
                                iat: { type: 'integer' },
                                jti: { type: 'string' },
                                nbf: { type: 'integer' }
                            }
                        }
                    }
                }
            },
            payload_schema: options.payload_schema,
            handler: options.handler
        }
    };

    if (plugin_options.perk_options.handler === undefined) {
        delete plugin_options.perk_options.handler;
    }

    if (plugin_options.authorize_jwt_options.complete_webauthn_token === undefined) {
        delete plugin_options.authorize_jwt_options.complete_webauthn_token;
    }

    f.register(webauthn_perk, {
        webauthn_perk_options: plugin_options,
        ... options.prefix === undefined ? {} : { prefix: options.prefix }
    });

    f.register(fastify_static, {
        root: path.join(__dirname, 'fixtures'),
        prefix: '/test'
    });

    f.register(fastify_static, {
        root: path.join(__dirname, '..', 'dist'),
        prefix: '/test/dist',
        decorateReply: false
    });

    await f.listen({ port });

    if (fastify) {
        extra_fastifies.push(f);
    } else {
        fastify = f;
    }
}

async function load(url) {
    await browser.url(url);
    await browser.waitUntil(
        () => browser.execute(() => typeof axios !== 'undefined'),
        { timeout: 60000 });
}

before(async function () {
    ({ expect } = await import('chai'));

    for (let i = 0; i < 3; ++i) {
        const id = (await randomBytes(64)).toString('hex');
        valid_ids.push(id);
        urls.push(`${origin}/cred/${id}/`);
    }

    await browser.addVirtualAuthenticator('ctap2_1', 'usb');

    await make_fastify(port);

    browser.options.after.push(async function () {
        await fastify.close();
    });
});

beforeEach(async function () {
    extra_fastifies = [];
    await load(`${origin}/test/test.html`);
});

afterEach(async function () {
    for (const f of extra_fastifies) {
        await f.close();
    }
});

async function executeAsync(f, ...args) {
    const r = await browser.executeAsync(function (f, ...args) {
        (async function () {
            const done = args[args.length - 1];
            function b64url(s) {
                return btoa(s)
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=/g, '');
            }
            window.jwt_encode = function (header, payload) {
                return b64url(JSON.stringify(header)) + '.' +
                       b64url(JSON.stringify(payload)) + '.';
            };
            window.bufferDecode = function (value, modify) {
                return Uint8Array.from(atob(value
                    .replace(/-/g, '+')
                    .replace(/_/g, '/')), c => c.charCodeAt(0) ^ (modify ? 1 : 0));
            };
            window.bufferEncode = function (value) {
                return b64url(String.fromCharCode.apply(null, new Uint8Array(value)));
            };
            try {
                // We need to use window.eval to stop esm rewriting eval
                done(await window.eval(f)(...args.slice(0, -1)));
            } catch (ex) {
                done({ error: ex.message + ex.stack }); 
            }
        })();
    }, f.toString(), ...args);

    if (r && r.error) {
        throw new Error(r.error);
    }

    return r;
}

async function auth(url, options) {
    options = Object.assign({
        valid_status: 201
    }, options);

    return await executeAsync(async (url, options) => {
        const get_response = await axios(options.cred_url || url, {
            validateStatus: status => status === 404
        });

        if (options.interleave_get_url) {
            await axios(options.interleave_get_url, {
                validateStatus: status => status === 404
            });
        }

        const { options: reg_options, session_data } = get_response.data;
        const { publicKey } = reg_options;
        publicKey.challenge = bufferDecode(publicKey.challenge, options.modify_challenge);
        publicKey.user.id = bufferDecode(publicKey.user.id);
        if (publicKey.excludeCredentials) {
            for (const c of publicKey.excludeCredentials) {
                c.id = bufferDecode(c.id);
            }
        }

        const credential = await navigator.credentials.create(reg_options);

        const { id, rawId, type, response: cred_response } = credential;
        const { attestationObject, clientDataJSON } = cred_response;

        const ccr = {
            id: options.no_cred_id ? undefined : id,
            rawId: bufferEncode(rawId),
            type,
            response: {
                attestationObject: bufferEncode(attestationObject),
                clientDataJSON: bufferEncode(clientDataJSON)
            }
        };

        const put_response = await axios.put(url, { ccr, session_data }, {
            validateStatus: status => status === options.valid_status
        });

        return [
            ccr,
            put_response.data,
            put_response.status,
            session_data
        ];
    }, url, options);
}

async function verify(url, options) {
    options = Object.assign({
        valid_status: 204,
        verify_url: url
    }, options);

    await executeAsync(async (url, options) => {
        let { options: cred_options, session_data} = (await axios(url)).data;

        if (options.cred_url) {
            ({ options: cred_options } = (await axios(options.cred_url)).data);
        }

        if (options.session_data) {
            session_data = options.session_data;
        }

        const { publicKey } = cred_options;
        publicKey.challenge = bufferDecode(publicKey.challenge, options.modify_challenge);
        for (const c of publicKey.allowCredentials) {
            c.id = bufferDecode(c.id);
        }

        const assertion = await navigator.credentials.get(cred_options);
        const { id, rawId, type, response: assertion_response } = assertion;
        const { authenticatorData, clientDataJSON, signature, userHandle } = assertion_response;

        await axios.post(options.verify_url, {
            car: {
                id,
                rawId: bufferEncode(rawId),
                type,
                response: {
                    authenticatorData: bufferEncode(authenticatorData),
                    clientDataJSON: bufferEncode(clientDataJSON),
                    signature: bufferEncode(signature),
                    userHandle: bufferEncode(userHandle)
                }
            },
            session_data
        }, {
            validateStatus: status => status === options.valid_status
        });
    }, url, options);
}

async function perk(cred_url, perk_origin, options) {
    options = Object.assign({
        valid_status: 200,
        audience
    }, options);

    return await executeAsync(async (cred_url, audience, perk_url, options) => {
        function generateJWT(claims, expires) {
            const header = { alg: 'none', typ: 'JWT' };
            const new_claims = Object.assign({}, claims);
            const now = new Date();
            const jti = new Uint8Array(64);

            window.crypto.getRandomValues(jti);

            new_claims.jti = Array.from(jti).map(x => String.fromCharCode(x)).join('');
            new_claims.iat = Math.floor(now.getTime() / 1000);
            new_claims.nbf = Math.floor(now.getTime() / 1000);

            if (expires) {
                new_claims.exp = Math.floor(expires.getTime() / 1000);
            }

            return jwt_encode(header, new_claims);
        }

        const payload = {
            aud: audience,
            foo: options.wrong_type ? 'hello' : 90
        };

        const expires = new Date();
        expires.setSeconds(expires.getSeconds() + 10);

        const jwt = generateJWT(payload, expires);

        let { options: cred_options, issuer_id } = (await axios(cred_url)).data;

        if (options.issuer_url) {
            ({ issuer_id } = (await axios(options.issuer_url)).data);
        }

        const { publicKey } = cred_options;
        for (const c of publicKey.allowCredentials) {
            c.id = bufferDecode(c.id);
        }

        const assertion = await navigator.credentials.get({
            ...cred_options,
            publicKey: {
                ...cred_options.publicKey,
                challenge: new TextEncoder('utf-8').encode(jwt),
            }
        });
        const { id, rawId, type, response: assertion_response } = assertion;
        const { authenticatorData, clientDataJSON, signature, userHandle } = assertion_response;

        const assertion_result = {
            issuer_id,
            car: {
                id,
                rawId: bufferEncode(rawId),
                type,
                response: {
                    authenticatorData: bufferEncode(authenticatorData),
                    clientDataJSON: bufferEncode(clientDataJSON),
                    signature: bufferEncode(signature),
                    userHandle: bufferEncode(userHandle)
                }
            }
        };

        const get_response = await axios(perk_url, {
            params: {
                assertion: JSON.stringify(assertion_result)
            },
            validateStatus: status => status === options.valid_status
        });

        if (get_response.data.payload) {
            delete get_response.data.payload.jti; // binary string so causes terminal escapes when logged in test
        }

        return [get_response.data, get_response.status, issuer_id];
    }, cred_url, options.audience, `${perk_origin}/perk/`, options);
}

describe('credentials', function () {
    this.timeout(5 * 60 * 1000);

    before(function () {
        browser.setTimeout({ script: 5 * 60 * 1000 });
    });

    it('should return 404', async function () {
        expect(await executeAsync(async url => {
            return (await axios(url, {
                validateStatus: status => status === 404
            })).status;
        }, urls[0])).to.equal(404);
    });

    it('should return 400 for invalid signature', async function () {
        const [unused_ccr, unused_key_info, status] = await auth(urls[0], {
            valid_status: 400,
            modify_challenge: true
        });
        expect(status).to.equal(400);
    });

    it('should return 400 for expired challenge', async function () {
        const orig_now = Date.now;
        Date.now = function (dummy) {
            let now = orig_now.call(this);
            if (dummy === 'dummy') {
                now += 60000;
            }
            return now;
        };

        try {
            const [unused_ccr, unused_key_info, status] = await auth(urls[0], {
                valid_status: 400
            });
            expect(status).to.equal(400);
        } finally {
            Date.now = orig_now; // eslint-disable-line require-atomic-updates
        }
    });

    it('should return 400 when try to verify missing assertion', async function () {
        await executeAsync(async url => {
            await axios.post(url, undefined, {
                validateStatus: status => status === 400
            });
        }, urls[0]);
    });

    it('should return 400 when schema not satisfied', async function () {
        let [unused_ccr, error, status] = await auth(urls[0], {
            no_cred_id: true,
            valid_status: 400
        });
        expect(status).to.equal(400);
        expect(error.message).to.equal("body/ccr must have required property 'id'");
    });

    let ccr, key_info, session_data;

    it('should return challenge and add public key', async function () {
        let status;
        [ccr, key_info, status, session_data] = await auth(urls[0]);
        expect(status).to.equal(201);
    });

    it('should return key info', async function () {
        const key_info2 = await executeAsync(async url => {
            return (await axios(url)).data;
        }, urls[0]);
        delete key_info2.session_data;
        key_info2.options.publicKey.challenge = key_info.options.publicKey.challenge;
        expect(key_info2).to.eql(key_info);
    });

    it('should return 409', async function () {
        expect(await executeAsync(async (url, ccr, session_data) => {
            return (await axios.put(url, { ccr, session_data }, {
                validateStatus: status => status === 409
            })).status;
        }, urls[0], ccr, session_data)).to.equal(409);
    });

    it('should be able to use key info to sign assertion for authorize-jwt', async function () {
        const [ data, status, issuer_id ] = await perk(urls[0], origin);
        expect(status).to.equal(200);
        expect(data.uri).to.equal(valid_ids[0]);
        expect(data.issuer_id).to.equal(issuer_id);
        expect(data.payload.aud).to.equal(audience);
        expect(data.payload.foo).to.equal(90);
    });

    it('should verify payload against schema', async function () {
        const [ data, status ] = await perk(urls[0], origin, {
            wrong_type: true,
            valid_status: 400
        });
        expect(status).to.equal(400);
        expect(data.message).to.equal('data/foo must be integer');
    });

    it('should verify assertion so client knows it successfully registered', async function () {
        await verify(urls[0]);
    });

    it('should detect cloned credential', async function () {
        const orig_finishLogin = webAuthn.finishLogin;
        webAuthn.finishLogin = async function(user, session_data, car) {
            user.credentials[0].Authenticator.SignCount = 100;
            return orig_finishLogin.call(this, user, session_data, car);
        };
        try {
            await verify(urls[0], {
                valid_status: 403
            });
        } finally {
            webAuthn.finishLogin = orig_finishLogin;
        }
    });

    it('should not be able to use assertion challenge to verify', async function () {
        await verify(urls[0], {
            session_data,
            valid_status: 400
        });
    });

    it('should return 400 when try to verify invalid assertion', async function () {
        await verify(urls[0], {
            modify_challenge: true,
            valid_status: 400
        });
    });

    it('should return 404 when try to verify assertion with no public key', async function () {
        await verify(urls[0], {
            verify_url: urls[1],
            valid_status: 404
        });
    });

    it('should delete keys not in valid ID list', async function () {
        const webauthn_perk = (await import(webauthn_perk_path)).default;
        const onCloses = [];

        const dummy_fastify = {
            addHook(name, f) {
                if (name === 'onClose') {
                    onCloses.push(f);
                }
            },
            register(f, opts) {
                if (!this.f) { // cred is registered first
                    this.f = f;
                    this.opts = opts;
                }
            },
            log: fastify.log,
            get() {},
            put() {},
            post() {},
            setValidatorCompiler() {}
        };

        // first check we don't delete valid ID
        await webauthn_perk(dummy_fastify, {
            authorize_jwt_options: {
                db_dir: path.join(__dirname, 'store'),
                RPDisplayName: 'webauthn-perk',
                RPID: 'localhost',
                RPOrigin: origin,
                keystore
            },
            cred_options: {
                valid_ids
            }
        });
        await dummy_fastify.f(dummy_fastify, dummy_fastify.opts);
        const key_info2 = await executeAsync(async url => {
            return (await axios(url)).data;
        }, urls[0]);
        delete key_info2.session_data;
        key_info2.options.publicKey.challenge = key_info.options.publicKey.challenge;
        expect(key_info2).to.eql(key_info);

        // then check we delete invalid IDs
        delete dummy_fastify.f;
        delete dummy_fastify.opts;
        await webauthn_perk(dummy_fastify, {
            authorize_jwt_options: {
                db_dir: path.join(__dirname, 'store'),
                RPDisplayName: 'webauthn-perk',
                RPID: 'localhost',
                RPOrigin: origin,
                keystore
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

        for (const onClose of onCloses) {
            await onClose();
        }
    });
    
    it('should return 404 on invalid URL', async function () {
        expect(await executeAsync(async url => {
            return (await axios(url, {
                validateStatus: status => status === 404
            })).status;
        }, 'foobar')).to.equal(404);

        expect(await executeAsync(async (url, ccr, session_data) => {
            return (await axios.put(url, { ccr, session_data }, {
                validateStatus: status => status === 404
            })).status;
        }, 'foobar', ccr, session_data)).to.equal(404);
    });

    it('should return 404 on second URL', async function () {
        expect(await executeAsync(async url => {
            return (await axios(url, {
                validateStatus: status => status === 404
            })).status;
        }, urls[1])).to.equal(404);
    });

    it('should return 400 on second URL', async function () {
        expect(await executeAsync(async (url, ccr, session_data) => {
            return (await axios.put(url, { ccr, session_data }, {
                validateStatus: status => status === 400
            })).status;
        }, urls[1], ccr, session_data)).to.equal(400);
    });

    it('should fail to use challenge from different ID', async function () {
        await auth(urls[0], {
            cred_url: urls[1],
            valid_status: 400
        });
    });

    it('should return challenges per ID', async function () {
        const [unused_ccr, key_info2] = await auth(urls[0], {
            interleave_get_url: urls[1]
        });
        expect(key_info2).not.to.eql(key_info);
        key_info = key_info2;
    });

    it('should return different key info for second URL', async function () {
        const [unused_ccr, key_info2] = await auth(urls[1]);
        expect(key_info2).not.to.eql(key_info);
    });

    it('should fail to use issuer ID from second URL', async function () {
        const [ data, status ] = await perk(urls[0], origin, {
            issuer_url: urls[1],
            valid_status: 400
        });
        expect(status).to.equal(400);
        expect(data.message).to.equal('User does not own the credential returned');
    });

    it('should not verify token with wrong audience', async function () {
        const [ data, status ] = await perk(urls[0], origin, {
            audience: 'urn:webauthn-perk:test2',
            valid_status: 400
        });
        expect(status).to.equal(400);
        expect(data.message).to.equal('unexpected "aud" claim value');
    });

    it('should fail to use cred ID from second URL', async function () {
        await verify(urls[0], {
            cred_url: urls[1],
            valid_status: 400
        });
    });

    it('should check undefined assertion_result', async function () {
        await executeAsync(async perk_url => {
            await axios(perk_url, {
                validateStatus: status => status === 400
            });
        }, `${origin}/perk/`);
    });

    it('should provide workflow object (register)', async function () {
        const [
            perk_url,
            before_verify_called,
            after_verify_called,
            before_register_called,
            after_register_called,
            issuer_id,
            jti
        ] = await executeAsync(async (cred_path, perk_path, audience) => {
            // Start the workflow
            const workflow = new (class extends PerkWorkflow {
                async before_verify() {
                    this.before_verify_called = true;
                }

                async after_verify() {
                    this.after_verify_called = true;
                }

                async before_register() {
                    this.before_register_called = true;
                }

                async after_register() {
                    this.after_register_called = true;
                }
            })({ cred_path, perk_path });
            await workflow.authenticate();

            // Generate JWT containing message as a claim
            const now = Math.floor(Date.now() / 1000);
            let jti = new Uint8Array(64);
            window.crypto.getRandomValues(jti);
            jti = btoa(Array.from(jti).map(x => String.fromCharCode(x)).join(''));
            const jwt = jwt_encode({
                alg: 'none',
                typ: 'JWT'
            }, {
                aud: audience,
                jti,
                iat: now,
                nbf: now,
                exp: now + 10 * 60, // 10 minutes
                foo: 123456
            });

            // Sign JWT and get perk URL
            return [
                await workflow.perk(jwt),
                workflow.before_verify_called,
                workflow.after_verify_called,
                workflow.before_register_called,
                workflow.after_register_called,
                workflow.issuer_id,
                jti
            ];
        }, `/cred/${valid_ids[2]}/`, '/perk/', audience);

        // Present the assertion and get the perk
        const perk_response = await axios(perk_url, {
            httpsAgent: new Agent({
                ca: await readFile(path.join(__dirname, 'keys', 'ca.crt'))
            })
        });

        expect(before_verify_called).to.be.null;
        expect(after_verify_called).to.be.null;
        expect(before_register_called).to.be.true;
        expect(after_register_called).to.be.true;

        expect(perk_response.status).to.equal(200);
        expect(perk_response.data.uri).to.equal(valid_ids[2]);
        expect(perk_response.data.issuer_id).to.equal(issuer_id);
        expect(perk_response.data.payload.aud).to.equal(audience);
        expect(perk_response.data.payload.jti).to.equal(jti);
        expect(perk_response.data.payload.foo).to.equal(90);
    });

    it('should provide workflow object (verify)', async function () {
        const [
            perk_url,
            before_verify_called,
            after_verify_called,
            before_register_called,
            after_register_called,
            issuer_id,
            jti
        ] = await executeAsync(async (cred_path, perk_path, audience) => {
            // Start the workflow
            const workflow = new (class extends PerkWorkflow {
                async before_verify() {
                    this.before_verify_called = true;
                }

                async after_verify() {
                    this.after_verify_called = true;
                }

                async before_register() {
                    this.before_register_called = true;
                }

                async after_register() {
                    this.after_register_called = true;
                }
            })({ cred_path, perk_path });
            await workflow.authenticate();

            // Generate JWT containing message as a claim
            const now = Math.floor(Date.now() / 1000);
            let jti = new Uint8Array(64);
            window.crypto.getRandomValues(jti);
            jti = btoa(Array.from(jti).map(x => String.fromCharCode(x)).join(''));
            const jwt = jwt_encode({
                alg: 'none',
                typ: 'JWT'
            }, {
                aud: audience,
                jti,
                iat: now,
                nbf: now,
                exp: now + 10 * 60, // 10 minutes
                foo: 4574321
            });

            // Sign JWT and get perk URL
            return [
                await workflow.perk(jwt),
                workflow.before_verify_called,
                workflow.after_verify_called,
                workflow.before_register_called,
                workflow.after_register_called,
                workflow.issuer_id,
                jti
            ];
        }, `/cred/${valid_ids[2]}/`, '/perk/', audience);

        // Present the assertion and get the perk
        const perk_response = await axios(perk_url, {
            httpsAgent: new Agent({
                ca: await readFile(path.join(__dirname, 'keys', 'ca.crt'))
            })
        });

        expect(before_verify_called).to.be.true;
        expect(after_verify_called).to.be.true;
        expect(before_register_called).to.be.null;
        expect(after_register_called).to.be.null;

        expect(perk_response.status).to.equal(200);
        expect(perk_response.data.uri).to.equal(valid_ids[2]);
        expect(perk_response.data.issuer_id).to.equal(issuer_id);
        expect(perk_response.data.payload.aud).to.equal(audience);
        expect(perk_response.data.payload.jti).to.equal(jti);
        expect(perk_response.data.payload.foo).to.equal(90);
    });

    it('should throw missing handler error', async function () {
        const port2 = port + 1;
        const id2 = (await randomBytes(64)).toString('hex');
        await make_fastify(port2, {
            valid_ids: [id2],
            handler: undefined
        });
        const origin2 = `https://localhost:${port2}`;
        const cred_url2 = `${origin2}/cred/${id2}/`;

        await load(`${origin2}/test/test.html`);
        await auth(cred_url2);
        const [data, status] = await perk(cred_url2, origin2, { valid_status: 500 });
        expect(data.message).to.equal('missing handler');
        expect(status).to.equal(500);
    });

    it('should call complete_webauthn_token', async function () {
        let called = false;
        function complete_webauthn_token(token, cb) {
            called = true;
            cb(null, token);
        }

        const port3 = port + 2;
        const id3 = (await randomBytes(64)).toString('hex');
        await make_fastify(port3, {
            valid_ids: [id3],
            complete_webauthn_token
        });
        const origin3 = `https://localhost:${port3}`;
        const cred_url3 = `${origin3}/cred/${id3}/`;

        await load(`${origin3}/test/test.html`);
        await auth(cred_url3);
        await perk(cred_url3, origin3);

        expect(called).to.be.true;
    });

    it('should call on_authz', async function () {
        let ks;
        async function on_authz(authz) {
            ks = authz.keystore;
        }

        const port5 = port + 4;
        const id5 = (await randomBytes(64)).toString('hex');
        await make_fastify(port5, {
            valid_ids: [id5],
            on_authz
        });
        const origin5 = `https://localhost:${port5}`;
        const cred_url5 = `${origin5}/cred/${id5}/`;

        await load(`${origin5}/test/test.html`);
        await auth(cred_url5);

        expect(ks).to.exist;
        const get_uris = promisify(ks.get_uris.bind(ks));
        const sodium = await SodiumPlus.auto();
        expect(await get_uris()).to.eql([await hash_id(sodium, id5)]);
    });

    it('should by default not verify payload', async function () {
        const port6 = port + 5;
        const id6 = (await randomBytes(64)).toString('hex');
        await make_fastify(port6, {
            valid_ids: [id6],
            payload_schema: undefined
        });
        const origin6 = `https://localhost:${port6}`;
        const cred_url6 = `${origin6}/cred/${id6}/`;

        await load(`${origin6}/test/test.html`);

        await auth(cred_url6, {
            wrong_type: true
        });
        await perk(cred_url6, origin6);
    });

    it('should work on prefix', async function () {
        let ks;
        async function on_authz(authz) {
            ks = authz.keystore;
        }

        const port7 = port + 6;
        const id7 = (await randomBytes(64)).toString('hex');
        await make_fastify(port7, {
            valid_ids: [id7],
            on_authz,
            prefix: '/prefix7'
        });
        const origin7 = `https://localhost:${port7}`;
        const cred_url7 = `${origin7}/prefix7/cred/${id7}/`;

        await load(`${origin7}/test/test.html`);
        await auth(cred_url7);

        expect(ks).to.exist;
        const get_uris = promisify(ks.get_uris.bind(ks));
        const sodium = await SodiumPlus.auto();
        expect(await get_uris()).to.eql([await hash_id(sodium, id7)]);

        await perk(cred_url7, `${origin7}/prefix7`);
    });

    it('should be able to use prefix when storing public keys', async function () {
        let ks;
        async function on_authz(authz) {
            ks = authz.keystore;
        }

        const port8 = port + 7;
        const id8 = (await randomBytes(64)).toString('hex');
        await make_fastify(port8, {
            valid_ids: [id8],
            on_authz,
            prefix: '/prefix8',
            store_prefix: true
        });
        const origin8 = `https://localhost:${port8}`;
        const cred_url8 = `${origin8}/prefix8/cred/${id8}/`;

        await load(`${origin8}/test/test.html`);
        await auth(cred_url8);

        expect(ks).to.exist;
        const get_uris = promisify(ks.get_uris.bind(ks));
        const sodium = await SodiumPlus.auto();
        expect(await get_uris()).to.eql([await hash_id(sodium, `/prefix8/cred/${id8}`)]);

        await perk(cred_url8, `${origin8}/prefix8`);
    });

    it('should error if stored hash is unrecognised', async function () {
        const sodium = await SodiumPlus.auto();
        const port9 = port + 8;
        const id9 = (await randomBytes(64)).toString('hex');

        const orig_auto = SodiumPlus.auto;
        let count = 0;
        SodiumPlus.auto = async function () {
            let r = orig_auto.apply(this, arguments);
            if (++count === 2) {
                r = await r;
                const orig_crypto_generichash = r.crypto_generichash;
                r.crypto_generichash = async function (id) {
                    expect(id).to.equal(id9);
                    return orig_crypto_generichash.call(this, 'dummy');
                };
            }
            return r;
        };
        try {
            await make_fastify(port9, {
                valid_ids: [id9]
            });
            const origin9 = `https://localhost:${port9}`;
            const cred_url9 = `${origin9}/cred/${id9}/`;

            await load(`${origin9}/test/test.html`);
            await auth(cred_url9);

            const [ data, status ] = await perk(cred_url9, origin9, {
                valid_status: 400
            });
            expect(status).to.equal(400);
            expect(data.message).to.equal(`no matching id for hash: ${await hash_id(sodium, id9)}`);
        } finally {
            SodiumPlus.auto = orig_auto;
        }
    });
});
