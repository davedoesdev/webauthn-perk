/*eslint-env node */
import url from 'url';
import { promisify } from 'util';
import clone from 'deep-copy';
import { fix_assertion_types } from './common.js';
import { perk as perk_schemas } from './dist/schemas.js';

export default async function (fastify, options) {
    options = options.perk_options || /* istanbul ignore next */ options;
    const fido2_options = options.fido2_options || /* istanbul ignore next */ {};

    const authorize = promisify((authz_token, cb) => {
        options.authz.authorize(authz_token, [], (err, payload, uri, rev, assertion_result) => {
            cb(err, { payload, uri, rev, assertion_result });
        });
    });

    const handler = Object.assign({
        async handler() {
            throw new Error('missing handler');
        }
    }, options).handler;

    const schemas = options.schemas || perk_schemas(options);

    fastify.get('/', { schema: schemas.get }, async (request, reply) => {
        const post_response = await fastify.inject({
            method: 'POST',
            url: url.parse(request.raw.url).pathname,
            payload: request.query.assertion_result,
            headers: {
                'content-type': 'application/json',
                'host': request.headers.host
            }
        });
        reply.code(post_response.statusCode);
        reply.send(post_response.payload);
    });

    fastify.post('/', { schema: schemas.post }, async (request, reply) => {
        const assertion = clone(request.body.assertion);
        fix_assertion_types(assertion);
        // complete_webauthn_token passed to authorize-jwt can override these
        const expectations = Object.assign({
            // fido2-lib expects https
            origin: `https://${request.headers.host}`,
            factor: 'either',
            prevCounter: 0,
            // not all authenticators can store user handles
            userHandle: assertion.response.userHandle
        }, fido2_options.assertion_expectations);
        const token = {
            issuer_id: request.body.issuer_id,
            assertion,
            request,
            expected_origin: expectations.origin,
            expected_factor: expectations.factor,
            prev_counter: expectations.prevCounter,
            expected_user_handle: expectations.userHandle
        };
        let info;
        try {
            info = await authorize(token);
        } catch (ex) {
            ex.statusCode = 400;
            throw ex;
        }
        return await handler(info, request, reply);
    });
}