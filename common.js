/*eslint-env node */

export async function hash_id(sodium, id) {
    return (await sodium.crypto_generichash(id)).toString('hex');
}

export class ErrorWithStatus extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}
