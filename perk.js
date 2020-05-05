/*eslint-env node */
import url from 'url';
import { promisify } from 'util';
import clone from 'deep-copy';
import Ajv from 'ajv';
import { SodiumPlus } from 'sodium-plus';
import { fix_assertion_types, hash_id } from './common.js';
import { perk as perk_schemas } from './dist/schemas.js';

const ajv = new Ajv();

function compile(schema) {
    return schema ? ajv.compile(schema) : null;
}

export default async function (fastify, options) {
    const sodium = await SodiumPlus.auto();
    options = options.perk_options;

    const fido2_options = options.fido2_options || /* istanbul ignore next */ {};

    const valid_hashmap = new Map();
    for (const [id, prefixed_id] of options.valid_ids) {
        valid_hashmap.set(await hash_id(sodium, prefixed_id), id);
    }

    const authorize = promisify((authz_token, cb) => {
        options.authz.authorize(authz_token, [], (err, payload, hash, rev, assertion_result) => {
            if (err) {
                return cb(err);
            }
            const uri = valid_hashmap.get(hash);
            if (uri === undefined) {
                return cb(new Error(`no matching id for hash: ${hash}`));
            }
            cb(err, { payload, uri, rev, assertion_result });
        });
    });

    const handler = Object.assign({
        async handler() {
            throw new Error('missing handler');
        }
    }, options).handler;

    const schemas = options.schemas || perk_schemas(options);
    const payload_schema = compile(schemas.payload || options.payload_schema);

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
        reply.type(post_response.headers['content-type']);
        reply.serializer(x => x);
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
        if (payload_schema && !payload_schema(info.payload)) {
            const ex = new Error(ajv.errorsText(payload_schema.errors));
            ex.statusCode = 400;
            throw ex;
        }
        return await handler(info, request, reply);
    });
}
