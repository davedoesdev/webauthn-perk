/*eslint-env node */

exports.BufferToArrayBuffer = function (buf) {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};