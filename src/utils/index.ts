import { readdir } from 'node:fs/promises'
import iconv from 'iconv-lite'
import type { createClientAsync } from 'soap'
import { Agent, ProxyAgent } from 'undici'

import type { ServiceSettingsSchema } from '../types/utils.js'

// @ts-expect-error
const defaultDispatcher = global[Symbol.for('undici.globalDispatcher.1')]

export function useCustomDispatcher(opts?: Agent.Options | undefined) {
    // @ts-expect-error
    global[Symbol.for('undici.globalDispatcher.1')] = new Agent(opts)
}

export function useProxy() {
    // @ts-expect-error
    global[Symbol.for('undici.globalDispatcher.1')] = new Agent({
        connectTimeout: 50000,
    })

    // global[Symbol.for('undici.globalDispatcher.1')] = new ProxyAgent({
    //     uri: 'http://localhost:1507',
    //     connectTimeout: 500,
    //     allowH2: true,
    // });
}

export function useDefaultDispatcher() {
    // @ts-expect-error
    global[Symbol.for('undici.globalDispatcher.1')] = defaultDispatcher
}

type ShimType = NonNullable<NonNullable<Parameters<typeof createClientAsync>[1]>['request']>

export function getRequestShim() {
    return (async (options: any): Promise<any> => {
        if ('stripRequestTag' in options) {
            options.data = options.data
                .replace(`<${options.stripRequestTag}>`, '')
                .replace(`</${options.stripRequestTag}>`, '')
        }

        if ('encoding' in options) {
            options.data = options.data.replace('utf-8', options.encoding)
            options.data = iconv.encode(options.data, options.encoding)
            options.headers['Content-Length'] = options.data.length
        }

        const response = await fetch(options.url, {
            method: options.method,
            headers: options.headers,
            body: options.data,
            signal: AbortSignal.timeout(50000),
        })
        const arrayBuffer = await response.arrayBuffer()
        let data = iconv.decode(Buffer.from(arrayBuffer), 'windows-1251')

        if ('appendRootResponseTag' in options) {
            data = data
                .replace('<soap:Body>', `<soap:Body><${options.appendRootResponseTag}>`)
                .replace('</soap:Body>', `</${options.appendRootResponseTag}></soap:Body>`)
        }

        return {
            data,
        }
    }) as unknown as ShimType
}

export function getRequestTestShim() {
    return (async (options: any): Promise<any> => {
        // options.data = options.data
        //     .replace(`xmlns:mis`, 'xmlns:ws')
        //     .replace(`<mis:`, '<ws:')
        //     .replace(`</mis:`, '</ws:');
        // options.headers['Content-Length'] = options.data.length;

        console.log(options.data)
        const response = await fetch(options.url, {
            method: options.method,
            headers: options.headers,
            body: options.data,
        })
        const arrayBuffer = await response.arrayBuffer()

        return {
            data: Buffer.from(arrayBuffer).toString(),
        }
    }) as unknown as ShimType
}

export function fromBase64(str: string) {
    return Buffer.from(str, 'base64').toString('utf-8')
}

export function mapToObject(map: Map<any, any>): any {
    const obj: any = {}
    for (const [key, value] of map) {
        if (value instanceof Map) {
            obj[key] = mapToObject(value) // Recursively convert nested Maps
        } else {
            obj[key] = value // Assign primitive or other values directly
        }
    }
    return obj
}

export async function getHighestVersionFolder(dirPath: string) {
    // Read the folders in the specified directory
    const folders = await readdir(dirPath, { withFileTypes: true }).then((items) =>
        items.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name),
    )

    // Sort folders as versions
    folders.sort((a, b) => {
        const versionA = a.split('-').flatMap((v) => v.split('.'))
        const versionB = b.split('-').flatMap((v) => v.split('.'))

        // Compare major versions first, then sub-versions if present
        for (let i = 0; i < Math.max(versionA.length, versionB.length); i++) {
            const partA = versionA[i] || 0
            const partB = versionB[i] || 0

            if (partA > partB) return -1
            if (partA < partB) return 1
        }
        return 0
    })

    // Return the highest version folder
    return folders[0]
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
]

export function toFirstUpperCase(str: string) {
    if (typeof str !== 'string' || str.length === 0) return str
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
}

export function defineSettings<T extends object>(settings: ServiceSettingsSchema<T>) {
    return settings
}

export function ensureArray<T>(value: T | T[] | null | undefined): T[] {
    if (value == null) return []
    return Array.isArray(value) ? value : [value]
}
