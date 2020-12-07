/*eslint-env node */
import url from 'url';
import Ajv from 'ajv';
import { ErrorWithStatus, make_authorize } from './common.js';
import { perk as make_perk_schemas } from './dist/schemas.js';

export default async function (fastify, options) {
    const {
        valid_ids,
        authz,
        keystore,
        sodium,
        schemas: perk_schemas,
        payload_schema,
        response_schema,
        handler,
        session_data_key,
        session_data_timeout,
        get_login_page,
        login_options
    } = Object.assign({
        async handler() {
            throw new Error('missing handler');
        }
    }, options.perk_options);

    const authorize = await make_authorize(authz, sodium, valid_ids);

    const ajv = new Ajv();
    function compile(schema) {
        return schema ? ajv.compile(schema) : null;
    }
    const schemas = perk_schemas || make_perk_schemas(response_schema, !!session_data_key);
    const validate_payload = compile(schemas.payload || payload_schema);

    fastify.get('/', { schema: schemas.get }, async (request, reply) => {
        if (session_data_key) {
            reply.type('text/html');
            return get_login_page();
        }
        const post_response = await fastify.inject({
            method: 'POST',
            url: url.parse(request.raw.url).pathname,
            payload: {
                assertion: request.query.assertion
            },
            headers: {
                'content-type': 'application/json',
                'host': request.headers.host
            }
        });
        reply.code(post_response.statusCode);
        reply.type(post_response.headers['content-type']);
        reply.serializer(x => x);
        return post_response.payload;
    });

    fastify.post('/', { schema: schemas.post }, async (request, reply) => {
        let info;
        try {
            info = await authorize(request.body.assertion);
        } catch (ex) {
            ex.statusCode = 400;
            throw ex;
        }
        if (session_data_key) {
            console.log(info);
            if (request.body.access.car) {
                //beginLogin
                /*await login(
                    keystore, authz.webAuthn, sodium,
                    id, hash, request.body.access, session_data_key, session_data_timeout);*/
            }
            //finishLogin
        }
        if (validate_payload && !validate_payload(info.payload)) {
            throw new ErrorWithStatus(ajv.errorsText(validate_payload.errors), 400);
        }
        return await handler(info, request, reply);
    });
}
