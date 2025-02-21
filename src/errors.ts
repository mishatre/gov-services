import { Errors } from 'moleculer';

export enum ErrorTypes {
    ERR_TOKEN_NOT_FOUND = 'ERR_TOKEN_NOT_FOUND',
    ERR_INVALID_TOKEN = 'ERR_INVALID_TOKEN',
}

export class TokenNotFoundError extends Errors.MoleculerError {
    constructor(type?: string, data?: unknown) {
        super('TokenNotFound', 404, type || ErrorTypes.ERR_TOKEN_NOT_FOUND, data);
    }
}

/**
 * Unauthorized HTTP error
 *
 * @class UnAuthorizedError
 * @extends {Error}
 */
export class UnAuthorizedError extends Errors.MoleculerError {
    /**
     * Creates an instance of UnAuthorizedError.
     *
     * @param {String} type
     * @param {any} data
     *
     * @memberOf UnAuthorizedError
     */
    constructor(type?: string, data?: unknown) {
        super('Unauthorized', 401, type || ErrorTypes.ERR_INVALID_TOKEN, data);
    }
}
