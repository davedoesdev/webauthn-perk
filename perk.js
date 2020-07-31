/*eslint-env node */
import url from 'url';
import { promisify } from 'util';
import Ajv from 'ajv';
import sodium_plus from 'sodium-plus';
const { SodiumPlus } = sodium_plus;
import { hash_id, ErrorWithStatus } from './common.js';
import { perk as make_perk_schemas } from './dist/schemas.js';

const ajv = new Ajv();

function compile(schema) {
    return schema ? ajv.compile(schema) : null;
}

export default async function (fastify, options) {
    const {
        valid_ids,
        authz,
        schemas: perk_schemas,
        payload_schema,
        response_schema,
        handler
    } = Object.assign({
        async handler() {
            throw new Error('missing handler');
        }
    }, options.perk_options);

    const sodium = await SodiumPlus.auto();
    const valid_hashmap = new Map();
    for (const [id, prefixed_id] of valid_ids) {
        valid_hashmap.set(await hash_id(sodium, prefixed_id), id);
    }

    const authorize = promisify((authz_token, cb) => {
        authz.authorize(authz_token, [], (err, payload, hash, rev, credential) => {
            if (err) {
                return cb(err);
            }
            const uri = valid_hashmap.get(hash);
            if (uri === undefined) {
                return cb(new Error(`no matching id for hash: ${hash}`));
            }
            cb(err, { payload, uri, rev, credential });
        });
    });

    const schemas = perk_schemas || make_perk_schemas(response_schema);
    const validate_payload = compile(schemas.payload || payload_schema);

    fastify.get('/', { schema: schemas.get }, async (request, reply) => {
        const post_response = await fastify.inject({
            method: 'POST',
            url: url.parse(request.raw.url).pathname,
            payload: request.query.assertion,
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
        let info;
        try {
            info = await authorize(request.body);
        } catch (ex) {
            ex.statusCode = 400;
            throw ex;
        }
        if (validate_payload && !validate_payload(info.payload)) {
            throw new ErrorWithStatus(ajv.errorsText(validate_payload.errors), 400);
        }
        return await handler(info, request, reply);
    });
}
