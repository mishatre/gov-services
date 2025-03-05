import iconv from 'iconv-lite';
import { readdir } from 'node:fs/promises';
import { createClientAsync } from 'soap';
import { ProxyAgent } from 'undici';

// @ts-expect-error
const defaultDispatcher = global[Symbol.for('undici.globalDispatcher.1')];

export function useProxy() {
    // @ts-expect-error
    global[Symbol.for('undici.globalDispatcher.1')] = new ProxyAgent({
        uri: 'http://localhost:1507',
        allowH2: true,
    });
}

export function disableProxy() {
    // @ts-expect-error
    global[Symbol.for('undici.globalDispatcher.1')] = defaultDispatcher;
}

type ShimType = NonNullable<NonNullable<Parameters<typeof createClientAsync>[1]>['request']>;

export function getRequestShim() {
    return async function (options: any): Promise<any> {
        if ('stripRequestTag' in options) {
            options.data = options.data
                .replace(`<${options.stripRequestTag}>`, '')
                .replace(`</${options.stripRequestTag}>`, '');
        }

        if ('encoding' in options) {
            options.data = options.data.replace('utf-8', options.encoding);
            options.data = iconv.encode(options.data, options.encoding);
            options.headers['Content-Length'] = options.data.length;
        }

        const response = await fetch(options.url, {
            method: options.method,
            headers: options.headers,
            body: options.data,
        });
        const arrayBuffer = await response.arrayBuffer();
        let data = iconv.decode(Buffer.from(arrayBuffer), 'windows-1251');

        if ('appendRootResponseTag' in options) {
            data = data
                .replace('<soap:Body>', `<soap:Body><${options.appendRootResponseTag}>`)
                .replace('</soap:Body>', `</${options.appendRootResponseTag}></soap:Body>`);
        }

        return {
            data,
        };
    } as unknown as ShimType;
}

export function getRequestTestShim() {
    return async function (options: any): Promise<any> {
        // options.data = options.data
        //     .replace(`xmlns:mis`, 'xmlns:ws')
        //     .replace(`<mis:`, '<ws:')
        //     .replace(`</mis:`, '</ws:');
        // options.headers['Content-Length'] = options.data.length;

        console.log(options.data);
        const response = await fetch(options.url, {
            method: options.method,
            headers: options.headers,
            body: options.data,
        });
        const arrayBuffer = await response.arrayBuffer();

        return {
            data: Buffer.from(arrayBuffer).toString(),
        };
    } as unknown as ShimType;
}

export function fromBase64(str: string) {
    return Buffer.from(str, 'base64').toString('utf-8');
}

export function mapToObject(map: Map<any, any>): any {
    const obj: any = {};
    for (const [key, value] of map) {
        if (value instanceof Map) {
            obj[key] = mapToObject(value); // Recursively convert nested Maps
        } else {
            obj[key] = value; // Assign primitive or other values directly
        }
    }
    return obj;
}

export async function getHighestVersionFolder(dirPath: string) {
    // Read the folders in the specified directory
    const folders = await readdir(dirPath, { withFileTypes: true }).then((items) =>
        items.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name),
    );

    // Sort folders as versions
    folders.sort((a, b) => {
        const versionA = a
            .split('-')
            .map((v) => v.split('.'))
            .flat();
        const versionB = b
            .split('-')
            .map((v) => v.split('.'))
            .flat();

        // Compare major versions first, then sub-versions if present
        for (let i = 0; i < Math.max(versionA.length, versionB.length); i++) {
            const partA = versionA[i] || 0;
            const partB = versionB[i] || 0;

            if (partA > partB) return -1;
            if (partA < partB) return 1;
        }
        return 0;
    });

    // Return the highest version folder
    return folders[0];
}

export const documentKind = [
    'ON_NSCHFDOPPR',
    'ON_NSCHFDOPPOK',
    'ON_KORSCHFDOPPR',
    'ON_KORSCHFDOPPOK',
    'ON_NKORSCHFDOPPR',
    'ON_NKORSCHFDOPPOK',
    'DP_IZVUCH',
    'DP_UVUTOCH',
    'DP_UVOBZH',
    'DP_PROTZ',
    'DP_PDPOL',
    'DP_IZVPOL',
    'DP_KVITIZMSTATUS',
    'ON_AKTREZRABP',
    'ON_AKTREZRABZ',
    'elActUnstructuredSupplierTitle',
    'elActUnstructuredCustomerTitle',
];
