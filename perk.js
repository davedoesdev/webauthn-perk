/*eslint-env node */
const url = require('url');
const { promisify } = require('util');
const { fix_assertion_types } = require('./common.js');

module.exports = async function (fastify, options) {
    options = options.perk_options || /* istanbul ignore next */ options;

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

    const schemas = require('./schemas.js').perk(options);

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
        const assertion = fix_assertion_types(request.body.assertion);
        // complete_webauthn_token passed to authorize-jwt can override these
        const expectations = Object.assign({
            // fido2-lib expects https
            origin: `https://${request.headers.host}`,
            factor: 'either',
            prevCounter: 0,
            // not all authenticators can store user handles
            userHandle: assertion.response.userHandle
        }, options.assertion_expectations);
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
};