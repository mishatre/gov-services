import { getSystemErrorMap } from 'node:util';
import { isNativeError } from 'node:util/types';

/** https://nodejs.org/docs/latest-v20.x/api/errors.html#class-systemerror */
export interface BaseSystemError<Code extends string = string> extends Error {
    /** The string error code */
    code: Code;

    /** The system-provided error number */
    errno: number;

    /** A system-provided human-readable description of the error */
    message: string;

    /** The name of the system call that triggered the error */
    syscall: string;
}

/** https://nodejs.org/docs/latest-v20.x/api/errors.html#class-systemerror */
export interface SystemError<Code extends string = string> extends BaseSystemError<Code> {
    /** If present, the address to which a network connection failed */
    address?: string;

    /** If present, the file path destination when reporting a file system error */
    dest?: string;

    /** If present, extra details about the error condition */
    info?: Record<string, unknown>;

    /** If present, the file path when reporting a file system error */
    path?: string;

    /** If present, the network connection port that is not available */
    port?: number;
}

// Memo (lazily initialized):
// https://nodejs.org/docs/latest-v20.x/api/util.html#utilgetsystemerrormap
let systemErrorMap: ReturnType<typeof getSystemErrorMap> | undefined;

type JsType =
    | 'bigint'
    | 'boolean'
    | 'function'
    | 'number'
    | 'object'
    | 'string'
    | 'symbol'
    | 'undefined';

export function isSystemError(value: unknown): value is SystemError {
    // https://nodejs.org/docs/latest-v20.x/api/util.html#utiltypesisnativeerrorvalue
    if (!isNativeError(value)) return false;

    for (const [key, jsType] of [
        ['code', 'string'],
        ['errno', 'number'],
        ['syscall', 'string'],
    ] satisfies [keyof SystemError, JsType][]) {
        if (typeof (value as SystemError)[key] !== jsType) return false;
    }

    systemErrorMap ??= getSystemErrorMap();
    return systemErrorMap.has((value as SystemError).errno);
}

export function isSystemErrorWithCode<T extends string>(
    value: unknown,
    code: T,
): value is SystemError<T> {
    return isSystemError(value) && value.code === code;
}

// You can also define type guards for any specific system errors that you want to discriminate…
// https://nodejs.org/docs/latest-v20.x/api/errors.html#common-system-errors

export function isConnectionResetError(value: unknown): value is SystemError<'ECONNRESET'> {
    return isSystemErrorWithCode(value, 'ECONNRESET');
}

export function isNotFoundError(value: unknown): value is SystemError<'ENOTFOUND'> {
    return isSystemErrorWithCode(value, 'ENOTFOUND');
}

// …etc.
