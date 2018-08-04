/* eslint-env node, mocha, browser */
/* global browser, KJUR, PerkWorkflow */

import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { Agent } from 'https';
import { expect } from 'chai';
import crypto from 'crypto';
import webauthn_perk from '..';
import mod_fastify from 'fastify';
import fastify_static from 'fastify-static';
import axios from 'axios';
const readFile = fs.promises.readFile;
const randomBytes = promisify(crypto.randomBytes);
const port = 3000;
const origin = `https://localhost:${port}`;
const audience = 'urn:webauthn-perk:test';
const valid_ids = [];
const urls = [];

async function make_fastify(port, options) {
    options = Object.assign({
        valid_ids,
        async handler (info) {
            return {
                uri: info.uri,
                payload: info.payload
            };
        }
    }, options);

    const fastify = mod_fastify({
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
            on_authz: options.on_authz
        },
        cred_options: {
            valid_ids: options.valid_ids,
            secure_session_options: {
                key: await readFile(path.join(__dirname, 'secret-session-key'))
            },
            fido2_options: {
                new_options: {
                    attestation: 'none'
                },
                complete_assertion_expectations: options.complete_assertion_expectations
            }
        },
        perk_options: {
            response_schema: {
                200: {
                    type: 'object',
                    required: [
                        'uri',
                        'payload'
                    ],
                    properties: {
                        uri: { type: 'string' },
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
            handler: options.handler
        }
    };

    if (plugin_options.authorize_jwt_options.on_authz === undefined) {
        delete plugin_options.authorize_jwt_options.on_authz;
    }

    if (plugin_options.cred_options.fido2_options.complete_assertion_expectations === undefined) {
        delete plugin_options.cred_options.fido2_options.complete_assertion_expectations;
    }

    if (plugin_options.perk_options.handler === undefined) {
        delete plugin_options.perk_options.handler;
    }

    fastify.register(webauthn_perk, {
        webauthn_perk_options: plugin_options
    });

    fastify.register(fastify_static, {
        root: path.join(__dirname, 'fixtures'),
        prefix: '/test'
    });

    fastify.register(fastify_static, {
        root: path.join(__dirname, '..', 'dist'),
        prefix: '/test/dist',
        decorateReply: false
    });

    await fastify.listen(port);

    browser.on('end', function () {
        (async function () {
            await fastify.close();
        })();
    });

    return fastify;
}

let fastify;

before(async function () {
    for (let i = 0; i < 3; ++i) {
        const id = (await randomBytes(64)).toString('hex');
        valid_ids.push(id);
        urls.push(`${origin}/cred/${id}/`);
    }

    fastify = await make_fastify(port);

    await browser.url(`${origin}/test/test.html`);
});

async function executeAsync(f, ...args) {
    const r = (await browser.executeAsync(function (f, ...args) {
        (async function () {
            let done = args[args.length - 1];
            try {
                // We need to use window.eval to stop esm rewriting eval
                done(await window.eval(f)(...args.slice(0, -1)));
            } catch (ex) {
                done({ error: ex.message }); 
            }
        })();
    }, f.toString(), ...args)).value;

    if (r && r.error) {
        throw new Error(r.error);
    }

    return r;
}

async function auth(url, options) {
    options = Object.assign({
        valid_status: 200
    }, options);

    return await executeAsync(async (url, options) => {
        const get_response = await axios(options.challenge_url || url, {
            validateStatus: status => status === 404
        });

        if (options.interleave_get_url) {
            await axios(options.interleave_get_url, {
                validateStatus: status => status === 404
            });
        }

        const attestation_options = get_response.data;
        attestation_options.challenge = Uint8Array.from(attestation_options.challenge,
            x => options.modify_challenge ? x ^ 1 : x);
        attestation_options.user.id = new TextEncoder('utf-8').encode(attestation_options.user.id);

        const cred = await navigator.credentials.create({ publicKey: attestation_options });

        const attestation_result = {
            id: options.no_cred_id ? undefined : cred.id,
            response: {
                attestationObject: Array.from(new Uint8Array(cred.response.attestationObject)),
                clientDataJSON: new TextDecoder('utf-8').decode(cred.response.clientDataJSON)
            }
        };

        if (options.expire_session_path) {
            document.cookie = `session=; Path=${options.expire_session_path}; Expires=Thu, 01 Jan 1970 00:00:01 GMT;`;
        }

        const put_response = await axios.put(url, attestation_result, {
            validateStatus: status => status === options.valid_status
        });

        return [attestation_result, put_response.data, put_response.status];
    }, url, options);
}

async function verify(url, options) {
    options = Object.assign({
        valid_status: 204
    }, options);

    await executeAsync(async (url, options) => {
        let { cred_id, challenge } = (await axios(url)).data;

        if (options.cred_url) {
            ({ cred_id } = (await axios(options.cred_url)).data);
        }

        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: Uint8Array.from(challenge,
                    x => options.modify_challenge ? x ^ 1 : x),
                allowCredentials: [{
                    id: Uint8Array.from(cred_id),
                    type: 'public-key'
                }]
            }
        });

        const assertion_result = {
            id: assertion.id,
            response: {
                authenticatorData: Array.from(new Uint8Array(assertion.response.authenticatorData)),
                clientDataJSON: new TextDecoder('utf-8').decode(assertion.response.clientDataJSON),
                signature: Array.from(new Uint8Array(assertion.response.signature)),
                userHandle: assertion.response.userHandle ? Array.from(new Uint8Array(assertion.response.userHandle)) : null
            }
        };

        await axios.post(url, assertion_result, {
            validateStatus: status => status === options.valid_status
        });
    }, url, options);
}

async function perk(cred_url, perk_origin, options) {
    options = Object.assign({
        valid_status: 200
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

            return KJUR.jws.JWS.sign(null, header, new_claims);
        }

        const payload = {
            aud: audience,
            foo: 90
        };

        const expires = new Date();
        expires.setSeconds(expires.getSeconds() + 10);

        const jwt = generateJWT(payload, expires);

        let { cred_id, issuer_id } = (await axios(cred_url)).data;

        if (options.issuer_url) {
            ({ issuer_id } = (await axios(options.issuer_url)).data);
        }

        const assertion = await navigator.credentials.get({
            publicKey: {
                challenge: new TextEncoder('utf-8').encode(jwt),
                allowCredentials: [{
                    id: Uint8Array.from(cred_id),
                    type: 'public-key'
                }]
            }
        });

        const assertion_result = {
            issuer_id,
            assertion: {
                id: assertion.id,
                response: {
                    authenticatorData: Array.from(new Uint8Array(assertion.response.authenticatorData)),
                    clientDataJSON: new TextDecoder('utf-8').decode(assertion.response.clientDataJSON),
                    signature: Array.from(new Uint8Array(assertion.response.signature)),
                    userHandle: assertion.response.userHandle ? Array.from(new Uint8Array(assertion.response.userHandle)) : null
                }
            }
        };

        const get_response = await axios(perk_url, {
            params: {
                assertion_result: JSON.stringify(assertion_result)
            },
            validateStatus: status => status === options.valid_status
        });

        if (get_response.data.payload) {
            delete get_response.data.payload.jti; // binary string so causes terminal escapes when logged in test
        }

        return [get_response.data, get_response.status];
    }, cred_url, audience, `${perk_origin}/perk/`, options);
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
        const [unused_attestation_result, unused_key_info, status] = await auth(urls[0], {
            valid_status: 400,
            modify_challenge: true
        });
        expect(status).to.equal(400);
    });

    it('should return 400 for expired session', async function () {
        const [unused_attestation_result, unused_key_info, status] = await auth(urls[0], {
            valid_status: 400,
            expire_session_path: `/cred/${valid_ids[0]}/`
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
            const [unused_attestation_result, unused_key_info, status] = await auth(urls[0], {
                valid_status: 400
            });
            expect(status).to.equal(400);
        } finally {
            Date.now = orig_now;
        }
    });

    it('should return 400 when try to verify assertion with no public key', async function () {
        await executeAsync(async url => {
            await axios.post(url, undefined, {
                validateStatus: status => status === 404
            });
        }, urls[0]);
    });

    it('should return 400 when schema not satisfied', async function () {
        let [unused_attestation_result, error, status] = await auth(urls[0], {
            no_cred_id: true,
            valid_status: 400
        });
        expect(status).to.equal(400);
        expect(error.message).to.equal("body should have required property 'id'");
    });

    let attestation_result, key_info;

    it('should return challenge and add public key', async function () {
        let status;
        [attestation_result, key_info, status] = await auth(urls[0]);
        expect(status).to.equal(200);
    });

    it('should return key info', async function () {
        const key_info2 = await executeAsync(async url => {
            return (await axios(url)).data;
        }, urls[0]);
        delete key_info2.challenge;
        expect(key_info2).to.eql(key_info);
    });

    it('should return 409', async function () {
        expect(await executeAsync(async (url, attestation_result) => {
            return (await axios.put(url, attestation_result, {
                validateStatus: status => status === 409
            })).status;
        }, urls[0], attestation_result)).to.equal(409);
    });

    it('should be able to use key info to sign assertion for authorize-jwt', async function () {
        const [ data, status ] = await perk(urls[0], origin);
        expect(status).to.equal(200);
        expect(data.uri).to.equal(valid_ids[0]);
        expect(data.payload.aud).to.equal(audience);
        expect(data.payload.foo).to.equal(90);
    });

    it('should verify assertion so client knows it successfully registered', async function () {
        await verify(urls[0]);
    });

    it('should return 400 when try to verify invalid assertion', async function () {
        await verify(urls[0], {
            modify_challenge: true,
            valid_status: 400
        });
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
            put() {},
            post() {}
        };

        // first check we don't delete valid ID
        await webauthn_perk(dummy_fastify, {
            authorize_jwt_options: {
                db_dir: path.join(__dirname, 'store'),
            },
            cred_options: {
                valid_ids: valid_ids
            }
        });
        await dummy_fastify.f(dummy_fastify, dummy_fastify.opts);
        const key_info2 = await executeAsync(async url => {
            return (await axios(url)).data;
        }, urls[0]);
        delete key_info2.challenge;
        expect(key_info2).to.eql(key_info);

        // then check we delete invalid IDs
        await webauthn_perk(dummy_fastify, {
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

        expect(await executeAsync(async (url, attestation_result) => {
            return (await axios.put(url, attestation_result, {
                validateStatus: status => status === 404
            })).status;
        }, 'foobar', attestation_result)).to.equal(404);
    });

    it('should return 404 on second URL', async function () {
        expect(await executeAsync(async url => {
            return (await axios(url, {
                validateStatus: status => status === 404
            })).status;
        }, urls[1])).to.equal(404);
    });

    it('should return 400 on second URL', async function () {
        expect(await executeAsync(async (url, attestation_result) => {
            return (await axios.put(url, attestation_result, {
                validateStatus: status => status === 400
            })).status;
        }, urls[1], attestation_result)).to.equal(400);
    });

    it('should fail to use challenge from different ID', async function () {
        await auth(urls[0], {
            challenge_url: urls[1],
            valid_status: 400
        });
    });

    it('should keep session per ID', async function () {
        const [unused_attestation_result, key_info2] = await auth(urls[0], {
            interleave_get_url: urls[1]
        });
        expect(key_info2).not.to.eql(key_info);
        key_info = key_info2;
    });

    it('should return different key info for second URL', async function () {
        const [unused_attestation_result, key_info2] = await auth(urls[1]);
        expect(key_info2).not.to.eql(key_info);
    });

    it('should fail to use issuer ID from second URL', async function () {
        const [ data, status ] = await perk(urls[0], origin, {
            issuer_url: urls[1],
            valid_status: 400
        });
        expect(status).to.equal(400);
        expect(data.message).to.equal('signature validation failed');
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
            after_register_called
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
            })(axios, cred_path, perk_path);
            await workflow.authenticate();

            // Generate JWT containing message as a claim
            const now = Math.floor(Date.now() / 1000);
            const jti = new Uint8Array(64);
            window.crypto.getRandomValues(jti);
            const jwt = KJUR.jws.JWS.sign(null, {
                alg: 'none',
                typ: 'JWT'
            }, {
                aud: audience,
                jti: Array.from(jti).map(x => String.fromCharCode(x)).join(''),
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
                workflow.after_register_called
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
        expect(perk_response.data.payload.aud).to.equal(audience);
        expect(perk_response.data.payload.foo).to.equal(123456);
    });

    it('should provide workflow object (verify)', async function () {
        const [
            perk_url,
            before_verify_called,
            after_verify_called,
            before_register_called,
            after_register_called
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
            })(axios, cred_path, perk_path);
            await workflow.authenticate();

            // Generate JWT containing message as a claim
            const now = Math.floor(Date.now() / 1000);
            const jti = new Uint8Array(64);
            window.crypto.getRandomValues(jti);
            const jwt = KJUR.jws.JWS.sign(null, {
                alg: 'none',
                typ: 'JWT'
            }, {
                aud: audience,
                jti: Array.from(jti).map(x => String.fromCharCode(x)).join(''),
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
                workflow.after_register_called
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
        expect(perk_response.data.payload.aud).to.equal(audience);
        expect(perk_response.data.payload.foo).to.equal(4574321);
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

        await browser.url(`${origin2}/test/test.html`);
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

        await browser.url(`${origin3}/test/test.html`);
        await auth(cred_url3);
        await perk(cred_url3, origin3);

        expect(called).to.be.true;
    });

    it('should call complete_assertion_expectations', async function () {
        let called = false;
        async function complete_assertion_expectations(assertion, assertion_expectations) {
            called = true;
            return assertion_expectations;
        }

        const port4 = port + 3;
        const id4 = (await randomBytes(64)).toString('hex');
        await make_fastify(port4, {
            valid_ids: [id4],
            complete_assertion_expectations
        });
        const origin4 = `https://localhost:${port4}`;
        const cred_url4 = `${origin4}/cred/${id4}/`;

        await browser.url(`${origin4}/test/test.html`);
        await auth(cred_url4);
        await verify(cred_url4);

        expect(called).to.be.true;
    });

    it('should call on_authz', async function () {
        let called = false;
        async function on_authz(authz) {
            expect(authz.keystore).to.exist;
            called = true;
        }

        const port5 = port + 4;
        const id5 = (await randomBytes(64)).toString('hex');
        await make_fastify(port5, {
            valid_ids: [id5],
            on_authz
        });
        const origin5 = `https://localhost:${port5}`;

        await browser.url(`${origin5}/test/test.html`);

        expect(called).to.be.true;
    });
});
