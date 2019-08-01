/*eslint-env node */

function BufferToArrayBuffer(buf) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export function toArrayBuffer(obj, prop, encoding) {
    const v = obj[prop];
    if (v) {
        obj[prop] = BufferToArrayBuffer(Buffer.from(v, encoding));
    } else {
        delete obj[prop];
    }
}

export function fix_assertion_types(assertion) {
    toArrayBuffer(assertion, 'id', 'base64');
    toArrayBuffer(assertion.response, 'authenticatorData');
    toArrayBuffer(assertion.response, 'clientDataJSON');
    toArrayBuffer(assertion.response, 'signature');
    toArrayBuffer(assertion.response, 'userHandle');
}
