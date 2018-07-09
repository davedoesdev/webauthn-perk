/*eslint-env node */

function BufferToArrayBuffer(buf) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
exports.BufferToArrayBuffer = BufferToArrayBuffer;

exports.fix_assertion_types = function (assertion) {
    assertion.id = BufferToArrayBuffer(Buffer.from(assertion.id, 'base64'));
    assertion.response.authenticatorData = BufferToArrayBuffer(Buffer.from(assertion.response.authenticatorData));
    assertion.response.clientDataJSON = BufferToArrayBuffer(Buffer.from(assertion.response.clientDataJSON));
    assertion.response.signature = BufferToArrayBuffer(Buffer.from(assertion.response.signature));
    assertion.response.userHandle = assertion.response.userHandle ?
        BufferToArrayBuffer(Buffer.from(assertion.response.userHandle)) :
        /* istanbul ignore next */ undefined;
    return assertion;
};