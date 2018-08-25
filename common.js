/*eslint-env node */

export function BufferToArrayBuffer(buf) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export function fix_assertion_types(assertion) {
    assertion.id = BufferToArrayBuffer(Buffer.from(assertion.id, 'base64'));
    assertion.response.authenticatorData = BufferToArrayBuffer(Buffer.from(assertion.response.authenticatorData));
    assertion.response.clientDataJSON = BufferToArrayBuffer(Buffer.from(assertion.response.clientDataJSON));
    assertion.response.signature = BufferToArrayBuffer(Buffer.from(assertion.response.signature));
    /* istanbul ignore if */
    if (assertion.response.userHandle) {
        assertion.response.userHandle = BufferToArrayBuffer(Buffer.from(assertion.response.userHandle));
    } else {
        delete assertion.response.userHandle;
    }
}