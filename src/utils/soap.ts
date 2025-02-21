import { Errors } from 'moleculer';
import { Client, ISoapFaultError } from 'soap';

import { isConnectionResetError, isNotFoundError } from './system-error.js';

function isSoapError(error: any): error is ISoapFaultError {
    return 'Fault' in error;
}

export async function executeSoapRequest<R, P extends {} = {}>(
    client: Client,
    method: string,
    args: P,
    options: Object,
    extraHeaders?: HeadersInit,
): Promise<[Error, null, null] | [null, R, string]> {
    const methodName = `${method}Async`;
    if (!(methodName in client)) {
        throw new TypeError(`Unknown request method - ${methodName}`);
    }
    try {
        const [content, rawContent] = await client[methodName](args, options, extraHeaders);
        return [null, content, rawContent];
    } catch (error) {
        let err;
        if (error instanceof TypeError || isConnectionResetError(error) || isNotFoundError(error)) {
            err = new Errors.MoleculerRetryableError('Network connection error');
        } else if (isSoapError(error)) {
            const fault = error.Fault;
            const message = 'faultstring' in fault ? fault.faultstring : fault.Reason.Text;
            const details = 'detail' in fault ? fault.detail : undefined;
            err = new Errors.MoleculerServerError(
                message,
                fault.statusCode || 500,
                'SOAP_ERROR',
                details,
            );
        } else {
            err = error as Error;
        }
        return [err, null, null];
    }
}
