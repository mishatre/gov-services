import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import * as Minio from 'minio'
import { action, method, service, started } from 'moldecor'
import { type Context, Service } from 'moleculer'

import TokenServiceMixin from '../mixins/token-service-mixin.js'
import { UnAuthorizedError } from '../utils/errors.js'
import { defineSettings } from '../utils/index.js'
import { getS3EnvConfig } from '../utils/s3.js'

type UploadFileParams = {
    regNum: string
}

type UploadFileFromStorageParams = {
    regNum: string
    filename: string
    bucketName: string
    objectName: string
}

type UploadFileFromUrlParams = {
    regNum: string
}

type UploadFileResponse = Promise<{}>

type UploadFileFromStorageResponse = Promise<any>

type UploadFileFromUrlResponse = Promise<{}>

function tryGetFileSize(stream: Readable) {
    if (
        'headers' in stream &&
        !!stream.headers &&
        typeof stream.headers === 'object' &&
        'content-length' in stream.headers
    ) {
        const value = Number(stream.headers['content-length'])
        if (!Number.isNaN(value)) {
            return value
        }
    }
    return undefined
}

async function* readByFixedChunks(stream: Readable, chunkSize: number) {
    let buffer = Buffer.alloc(0)

    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk])

        while (buffer.length >= chunkSize) {
            yield buffer.slice(0, chunkSize)
            buffer = buffer.slice(chunkSize)
        }
    }

    // Yield any remaining bytes
    if (buffer.length > 0) {
        yield buffer
    }
}

type This = ElactFilestoreService & typeof TokenServiceMixin

const settings = defineSettings({
    tokenService: process.env.ELACT_TOKEN_SERVICE || 'elact-eruz',
    filestore: {
        url:
            process.env.ELACT_FILESTORE_URL ??
            'https://5-241.tail11e41.ts.net/eruz/lkp/filestore/integration/upload/FS_EACTS/new',
    },
    s3: getS3EnvConfig('S3', 'ELACT_FILESTORE'),
    MAX_CHUNK_SIZE: 9940000,
    MIN_CHUNK_SIZE: 1000000,
})

@service({
    name: 'elact-filestore',
    version: 2,

    metadata: {
        $description: `Отправка файлов в файловое хранилище ЕИС (ЭлАкт)`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings,
    mixins: [TokenServiceMixin],

    hooks: {
        before: {
            'upload*': 'resolveUserToken',
        },
    },
})
export default class ElactFilestoreService extends Service<typeof settings> {
    private declare s3Client: Minio.Client
    private useTokenService = false

    /*
     *  Actions
     */

    @action({
        name: 'uploadFile',
        params: {
            regNum: 'string|numeric|length:8',
            filename: 'string',
        },
    })
    public async actionUploadFile(this: This, ctx: Context<UploadFileParams>): UploadFileResponse {
        return this.uploadFile()
    }

    @action({
        name: 'uploadFileFromStorage',
        params: {
            regNum: 'string|numeric|length:8',
            filename: 'string',
            bucketName: 'string',
            objectName: 'string',
        },
    })
    public async uploadFileFromStorage(
        this: This,
        ctx: Context<UploadFileFromStorageParams>,
    ): UploadFileFromStorageResponse {
        const { filename, bucketName, objectName } = ctx.params
        const token = ctx.locals.usertoken

        const { stream, filesize, digest } = await this.getObjectWithMetadata(
            bucketName,
            objectName,
        )

        return this.uploadFile(stream, filename, filesize, digest, token)
    }

    @action({
        name: 'uploadFileFromUrl',
        params: {
            regNum: 'string|numeric|length:8',
            filename: 'string',
            url: 'string',
        },
    })
    public async uploadFileFromUrl(
        this: This,
        ctx: Context<UploadFileFromUrlParams>,
    ): UploadFileFromUrlResponse {
        return this.uploadFile()
    }

    /*
     *  Methods
     */

    @method
    private async uploadFile(
        this: This,
        stream: Readable,
        filename: string,
        filesize: number,
        digest: string,
        token: string,
    ) {
        const authHeaders = {
            Authorization: `Basic ${Buffer.from(token, 'utf-8').toString('base64')}`,
        }
        const payload = {
            name: filename,
            size: filesize,
            digest,
        }

        const startResult = await this.startUpload(payload, authHeaders)

        if (!startResult.success) {
            throw startResult.error
        } else if (startResult.uploaded) {
            return startResult.contentId
        } else if (!startResult.url) {
            throw new Error()
        }

        const url = startResult.url

        let offset = 0
        for await (const chunk of readByFixedChunks(stream, this.settings.MAX_CHUNK_SIZE)) {
            const [uploaded, error] = await this.uploadRange(
                url,
                chunk,
                offset,
                filesize,
                authHeaders,
            )
            if (!uploaded) {
                throw error
            }
            offset += chunk.byteLength
        }

        const [success, error] = await this.markUploadCompleted(url, authHeaders)
        if (!success) {
            throw error
        }

        return startResult.contentId
    }

    @method
    private async startUpload(
        this: This,
        payload: unknown,
        headers: Headers | { [key: string]: string },
    ) {
        const body = JSON.stringify(payload)

        try {
            const response = await fetch(this.settings.filestore.url, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json; charset=UTF-8',
                    // "Content-Length": AdditionalParameters.Data.Size()
                },
                body: JSON.stringify(payload),
            })

            if (response.status === 401) {
                return {
                    success: false,
                    error: new UnAuthorizedError('INVALID_TOKEN_KEY'),
                }
            }

            if (response.status >= 400) {
                const data = await response.text()
                const error = new Error('Unsucessfull upload')
                // error.status = response.status;
                // error.data = data;
                return {
                    success: false,
                    error,
                }
            }

            const data = await response.json()

            const contentId = data.file_content_id

            if (response.status === 201) {
                return {
                    success: true,
                    uploaded: true,
                    contentId,
                }
            }

            const location = response.headers.get('Location')
            if (!location) {
                throw new Error()
            }

            return {
                success: true,
                uploaded: false,
                contentId,
                url: location?.replace('FS_EACTS', 'FS_EACTS/session'),
            }
        } catch (error) {
            return {
                success: false,
                error,
            }
        }
    }

    @method
    private async uploadRange(
        this: This,
        url: string,
        body: Buffer,
        offset: number,
        filesize: number,
        headers: Headers | { [key: string]: string },
    ) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/octet-stream',
                    'Content-Range': `bytes ${offset}-${offset + body.length - 1}/${filesize}`,
                },
                body,
            })

            if (response.status !== 202) {
                throw new Error()
            }

            return [true, undefined] as const
        } catch (error) {
            return [false, error] as const
        }
    }

    @method
    private async markUploadCompleted(
        this: This,
        url: string,
        headers: Headers | { [key: string]: string },
    ) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                },
                body: 'status=completed',
            })

            if (response.status !== 201) {
                throw new Error()
            }

            return [true, undefined] as const
        } catch (error) {
            return [false, error] as const
        }
    }

    @method
    private async getObjectWithMetadata(this: This, bucketName: string, objectName: string) {
        // const stream = createReadStream('/Users/mt/Downloads/gispdata-current-pp719-products-structure (1).csv');
        const stream = await this.s3Client.getObject(bucketName, objectName)
        const filesize = tryGetFileSize(stream)

        const hash = createHash('sha256')

        let size = 0
        for await (const chunk of stream) {
            size += chunk.byteLength
            hash.update(chunk)
        }

        // const outputStream = createReadStream('/Users/mt/Downloads/gispdata-current-pp719-products-structure (1).csv');
        const outputStream = await this.s3Client.getObject(bucketName, objectName)

        return {
            stream: outputStream,
            filesize: filesize || size,
            digest: hash.digest('hex'),
        }
    }

    @method
    private async initS3(this: This) {
        this.s3Client = new Minio.Client(this.settings.s3)
    }

    /*
     *  Lifecycle methods
     */

    @started
    public async started(this: This) {
        await Promise.all([this.initS3()])
    }
}
