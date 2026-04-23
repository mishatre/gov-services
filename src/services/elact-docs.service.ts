import path from 'node:path/posix'
import { Readable } from 'node:stream'
import _ from 'lodash'
import * as Minio from 'minio'
import { action, method, service, started } from 'moldecor'
import { type Context, Errors, Service } from 'moleculer'
import { createClientAsync, type Client as SoapClient } from 'soap'

import TokenServiceMixin from '../mixins/token-service-mixin.js'
import type { ExcludeErrorInfo } from '../types/basic.js'
import type {
    LkpGetContractsListRequest,
    LkpGetContractsListResponse,
    LkpGetObjectInfoRequest,
    LkpGetObjectInfoResponse,
    LkpGetObjectListRequest,
    LkpGetObjectListResponse,
    LkpGetParticipantInfoRequest,
    LkpGetParticipantInfoResponse,
} from '../types/elact-docs.js'
import {
    defineSettings,
    documentKind,
    getHighestVersionFolder,
    getRequestShim,
    mapToObject,
    useCustomDispatcher,
} from '../utils/index.js'
import { getS3EnvConfig } from '../utils/s3.js'
import { executeSoapRequest } from '../utils/soap.js'

export type BulkGetContractsListRequest = {
    regNum: string
    items: LkpGetContractsListRequest[]
}
export type BulkGetObjectInfoRequest = {
    regNum: string
    items: LkpGetObjectListRequest[]
}

// Actions

export type GetContractsListParams = LkpGetContractsListRequest & { cacheFiles: boolean }
export type GetParticipantInfoParams = LkpGetParticipantInfoRequest
export type GetObjectListParams = LkpGetObjectListRequest
export type GetObjectInfoParams = LkpGetObjectInfoRequest

export type GetContractsListResponse = {
    items: ExcludeErrorInfo<LkpGetContractsListResponse>['contractList']['contractInfo']
}
export type GetParticipantInfoResponse = ExcludeErrorInfo<LkpGetParticipantInfoResponse>
export type GetObjectListResponse = {
    items: ExcludeErrorInfo<LkpGetObjectListResponse>['objectList']['objectInfo']
}
export type GetObjectInfoResponse = ExcludeErrorInfo<LkpGetObjectInfoResponse>

type This = ElactDocsService & typeof TokenServiceMixin

const settings = defineSettings({
    $secureSettings: ['s3.secretKey'],
    tokenService: process.env.ELACT_TOKEN_SERVICE || 'elact-eruz',
    elact: {
        schemas: './schemas/elact',
        wsdl: 'WSDL/WebServiceElactsDocsLKP.wsdl',
        endpoint:
            process.env.ELACT_SUPPLIER_DOCS ??
            'https://int44.zakupki.gov.ru/eis-integration/elact/supplier-docs',
    },
    s3: getS3EnvConfig('S3', 'ELACT_DOCS', {
        defaultBucketName: 'elact-docs',
    }),
})

useCustomDispatcher({ connectTimeout: 60000 })

@service({
    name: 'elact-docs',

    metadata: {
        $description: `Запросы в ЛКП (ЭлАкт)`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings,
    mixins: [TokenServiceMixin],

    hooks: {
        before: {
            'get*': ['resolveUserToken', 'convertDateParams'],
            'send*': 'resolveUserToken',
        },
    },
})
export default class ElactDocsService extends Service<typeof settings> {
    private declare soapClient: SoapClient
    private declare s3Client: Minio.Client

    /*
     *  Actions
     */

    // BULK
    @action({
        name: 'bulkGetContractsList',
        params: {
            regNum: 'string|numeric|length:8',
            items: {
                type: 'array',
                items: 'string|min:1|max:19',
            },
        },
        description:
            'Запрос сведений о частично подписанном / подписанном документе электронного актирования',
    })
    public async bulkGetContractsList(
        this: This,
        ctx: Context<BulkGetContractsListRequest>,
    ): Promise<GetContractsListResponse[]> {
        return await Promise.all(
            ctx.params.items.map((contractRegNum) =>
                this.actions.getContractsList(
                    {
                        regNum: ctx.params.regNum,
                        contractRegNum,
                    },
                    {
                        parentCtx: ctx,
                    },
                ),
            ),
        )
    }

    @action({
        name: 'bulkGetObjectInfo',
        params: {
            regNum: 'string|numeric|length:8',
            items: {
                type: 'array',
                items: {
                    type: 'object',
                    params: {
                        documentUid: 'string',
                        documentKind: { type: 'enum', values: documentKind },
                    },
                },
            },
        },
        description:
            'Запрос сведений о частично подписанном / подписанном документе электронного актирования',
    })
    public async bulkGetObjectInfo(
        this: This,
        ctx: Context<BulkGetObjectInfoRequest>,
    ): Promise<GetObjectInfoResponse[]> {
        return await Promise.all(
            ctx.params.items.map((item) =>
                this.actions.getObjectInfo(
                    { ...item, regNum: ctx.params.regNum },
                    {
                        parentCtx: ctx,
                        timeout: 20000,
                    },
                ),
            ),
        )
    }

    @action({
        name: 'getContractsList',
        params: {
            $$root: true,
            type: 'multi',
            rules: [
                {
                    type: 'object',
                    strict: true,
                    props: {
                        regNum: 'string|numeric|length:8',
                        fromDate: 'date|convert',
                        toDate: 'date|convert',
                        customerInfo: {
                            type: 'object',
                            optional: true,
                            strict: true,
                            props: {
                                INN: 'string|min:10|max:12',
                                KPP: 'string',
                            },
                        },
                        cacheFiles: 'boolean|optional|default:false',
                    },
                },
                {
                    type: 'object',
                    strict: true,
                    props: {
                        regNum: 'string|numeric|length:8',
                        contractRegNum: 'string|min:1|max:19',
                        cacheFiles: 'boolean|optional|default:false',
                    },
                },
            ],
        },
        description: 'Запрос сведений о контрактах поставщика',
    })
    public async getContractsList(
        this: This,
        ctx: Context<GetContractsListParams>,
    ): Promise<GetContractsListResponse> {
        const [error, content] = await this.executeRequest<LkpGetContractsListResponse>(
            'lkpGetContractsList',
            ctx,
        )
        if (error) {
            throw error
        }

        const items = content.contractList?.contractInfo || []
        if (ctx.params.cacheFiles) {
            for (const item of items) {
                try {
                    const res = await fetch(item.url)
                    if (!res.ok || !res.body) {
                        throw new Error('Incorrect response')
                    }
                    await this.s3Client.putObject(
                        this.settings.s3.defaultBucketName,
                        item.regNumber,
                        Readable.from(res.body),
                    )
                    item.url = await this.s3Client.presignedGetObject(
                        this.settings.s3.defaultBucketName,
                        item.regNumber,
                    )
                } catch (error) {
                    this.logger.error(`Couldn't download file - ${item.url}`, error)
                }
            }
        }

        return {
            items,
        }
    }

    @action({
        name: 'getParticipantInfo',
        params: {
            regNum: 'string|numeric|length:8',
        },
        retryPolicy: {
            enabled: true,
            retries: 3,
        },
        description: 'Запрос сведений о поставщике и его подписантах',
    })
    public async getParticipantInfo(
        this: This,
        ctx: Context<GetParticipantInfoParams>,
    ): Promise<GetParticipantInfoResponse> {
        const [error, content] = await this.executeRequest<
            LkpGetParticipantInfoResponse,
            LkpGetParticipantInfoRequest
        >('lkpGetParticipantInfo', ctx)
        if (error) {
            throw error
        }

        return content
    }

    @action({
        name: 'getObjectList',
        params: {
            $$root: true,
            type: 'multi',
            rules: [
                {
                    type: 'object',
                    strict: true,
                    props: {
                        regNum: 'string|numeric|length:8',
                        documentKind: { type: 'enum', optional: true, values: documentKind },
                        fromDate: 'date|convert',
                        toDate: 'date|convert',
                        customerInfo: {
                            type: 'object',
                            strict: true,
                            optional: true,
                            props: {
                                INN: 'string|min:10|max:12',
                                KPP: 'string',
                            },
                        },
                    },
                },
                {
                    type: 'object',
                    strict: true,
                    props: {
                        regNum: 'string|numeric|length:8',
                        documentKind: { type: 'enum', optional: true, values: documentKind },
                        externalId: 'string|min:1|max:40',
                    },
                },
                {
                    type: 'object',
                    strict: true,
                    props: {
                        regNum: 'string|numeric|length:8',
                        documentKind: { type: 'enum', optional: true, values: documentKind },
                        objectId: 'uuid',
                    },
                },
                {
                    type: 'object',
                    strict: true,
                    props: {
                        regNum: 'string|numeric|length:8',
                        documentKind: { type: 'enum', optional: true, values: documentKind },
                        contractRegNum: 'string|min:1|max:19',
                    },
                },
            ],
        },
        description:
            'Запрос сведений о частично подписанных / подписанных документах электронного актирования',
    })
    public async getObjectList(
        this: This,
        ctx: Context<GetObjectListParams>,
    ): Promise<GetObjectListResponse> {
        const [error, content] = await this.executeRequest<LkpGetObjectListResponse>(
            'lkpGetObjectList',
            ctx,
        )
        if (error) {
            throw error
        }
        return {
            items: content.objectList?.objectInfo ?? [],
        }
    }

    @action({
        name: 'getObjectInfo',
        params: {
            regNum: 'string|numeric|length:8',
            documentUid: 'string',
            documentKind: { type: 'enum', values: documentKind },
        },
        description:
            'Запрос сведений о частично подписанном / подписанном документе электронного актирования',
    })
    public async getObjectInfo(
        this: This,
        ctx: Context<GetObjectInfoParams>,
    ): Promise<GetObjectInfoResponse> {
        const [error, content, rawContent] = await this.executeRequest<LkpGetObjectInfoResponse>(
            'lkpGetObjectInfo',
            ctx,
        )
        if (error) {
            throw error
        }

        return content
    }

    /*
     *  Methods
     */

    @method
    private async executeRequest<R, P extends {} = {}>(
        this: This,
        requestMethod: string,
        ctx: Context<P>,
    ) {
        let [error, content, rawContent] = await executeSoapRequest<R, P>(
            this.soapClient,
            requestMethod,
            this.enforceParametersOrder(ctx.params, requestMethod),
            {},
            {
                'Content-Type': 'text/xml;charset=windows-1251',
                usertoken: ctx.locals.usertoken,
            },
        )
        if (!error) {
            if (!content || 'Body' in (content as Object)) {
                error = new Errors.MoleculerError('Empty response', 500, 'EMPTY_RESPONSE')
            } else if ('errorInfo' in (content as Object)) {
                const { message, code } = (content as any).errorInfo
                error = new Errors.MoleculerClientError(message, code, 'ELACT_ERROR')
            }
        }
        return [error, content as ExcludeErrorInfo<NonNullable<R>>, rawContent as string] as const
    }

    @method
    protected convertDateParams(this: This, ctx: Context<any>) {
        if ('fromDate' in ctx.params && typeof ctx.params.fromDate === 'object') {
            ctx.params.fromDate = ctx.params.fromDate.toISOString()
        }
        if ('toDate' in ctx.params && typeof ctx.params.toDate === 'object') {
            ctx.params.toDate = ctx.params.toDate.toISOString()
        }
    }

    @method
    private enforceParametersOrder(this: This, params: object, requestMethod: string) {
        const order: string[] = []
        const orderedParams = new Map<string, any>()

        switch (requestMethod) {
            case 'lkpGetContractsList': {
                order.push(
                    'regNum',
                    'contractRegNum',
                    'fromDate',
                    'toDate',
                    'customerInfo.INN',
                    'customerInfo.KPP',
                )
                break
            }
            case 'lkpGetParticipantInfo': {
                order.push('regNum')
                break
            }
            case 'lkpGetObjectList': {
                order.push(
                    'regNum',
                    'documentKind',
                    'externalId',
                    'objectId',
                    'contractRegNum',
                    'fromDate',
                    'toDate',
                    'customerInfo.INN',
                    'customerInfo.KPP',
                )
                break
            }
            case 'lkpGetObjectInfo': {
                order.push('regNum', 'documentUid', 'documentKind')
                break
            }
        }

        for (const property of order) {
            const parts = property.split('.')
            if (parts.length === 1) {
                if (_.has(params, property)) {
                    orderedParams.set(property, _.get(params, property))
                }
            } else {
                let current = null
                const pathParts = []
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i]
                    pathParts.push(part)
                    if (i === parts.length - 1) {
                        if (_.has(params, pathParts.join('.'))) {
                            current.set(part, _.get(params, pathParts.join('.')))
                        }
                    } else {
                        if (!_.has(params, part)) {
                            break
                        }
                        if (!orderedParams.has(part)) {
                            orderedParams.set(part, new Map())
                        }
                        current = orderedParams.get(part)
                    }
                }
            }
        }

        return mapToObject(orderedParams)
    }

    @method
    private async initS3(this: This) {
        if (!this.settings.s3) {
            return
        }
        this.s3Client = new Minio.Client(this.settings.s3)

        const bucketExists = await this.s3Client.bucketExists(this.settings.s3.defaultBucketName)
        if (!bucketExists) {
            await this.s3Client.makeBucket(this.settings.s3.defaultBucketName)
        }
    }

    /*
     *  Lifecycle methods
     */

    @started
    public async started(this: This) {
        const highestVersionFolder = await getHighestVersionFolder(this.settings.elact.schemas)

        const pathToWSDL = path.join(
            this.settings.elact.schemas,
            highestVersionFolder,
            this.settings.elact.wsdl,
        )

        this.soapClient = await createClientAsync(pathToWSDL, {
            request: getRequestShim(),
        })
        this.soapClient.setEndpoint(this.settings.elact.endpoint)

        await this.initS3()
    }
}
