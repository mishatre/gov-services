import { load } from 'cheerio';
import { ReadableStream } from 'node:stream/web';
import { Readable } from 'stream';

import { fromBase64 } from './index.js';
import { parse } from './parse-content-disposition.js';

async function retryableFetch(url: string, retry = 1, options?: RequestInit) {
    for (let i = 0; i < retry; i++) {
        try {
            return await fetch(url, options);
        } catch (error) {
            console.debug(error);
        }
    }
}

function parseHTML(buffer: Buffer) {
    const $ = load(buffer);
    const content = $('button#defaultOpen').attr('onclick');

    if (!content) {
        return undefined;
    }

    const url = /\('(.*?)',/.exec(content)?.[1];

    return url;
}

export async function extractPrintForm(
    id: string,
    printForm: { type: 'url' | 'base64'; content: string },
) {
    if (printForm.type === 'url') {
        const response = await retryableFetch(printForm.content, 3, {
            method: 'GET',
        });

        if (!response || !response.ok) {
            return undefined;
        }

        const arrayBuffer = await response.arrayBuffer();
        const printFormUrl = parseHTML(Buffer.from(arrayBuffer));

        if (!printFormUrl) {
            return undefined;
        }

        const printFormResponse = await retryableFetch(printFormUrl, 3, {
            method: 'GET',
        });

        if (!printFormResponse || !printFormResponse.ok || !printFormResponse.body) {
            return undefined;
        }

        let filename = undefined;

        const contentDisposition = printFormResponse.headers.get('Content-disposition');
        if (contentDisposition) {
            const parseResult = parse(contentDisposition);
            if (parseResult.attachment && parseResult.filename) {
                filename = parseResult.filename;
            }
        }

        return {
            content: Readable.fromWeb(printFormResponse.body as ReadableStream<Uint8Array>),
            contentType: 'text/html',
            filename,
        };
    } else if (printForm.type === 'base64') {
        // Content for some reason is double encoded
        return {
            content: fromBase64(fromBase64(printForm.content)),
            filename: `${id}.html`,
            contentType: 'text/html',
        };
    }
    return undefined;
}
