import path from 'node:path'
import iconv from 'iconv-lite'
import { action, method, service, started } from 'moldecor'
import { type Context, Service } from 'moleculer'
import { createClientAsync, type Client as SoapClient } from 'soap'

import pkg from '../../package.json' with { type: 'json' }
import TokenServiceMixin from '../mixins/token-service-mixin.js'
import type {
    LKPGetProcessingResultRequest,
    LKPReceiveFileRequest,
    LKPResultResponse,
} from '../types/elact-upload.js'
import {
    defineSettings,
    getHighestVersionFolder,
    getRequestShim,
    useCustomDispatcher,
} from '../utils/index.js'
import { executeSoapRequest } from '../utils/soap.js'

export interface ReceiveFileRequest {
    regNum: string
    packetUrl: string
}
export interface GetProcessingResultRequest {
    regNum: string
    packetId: string
    fileId?: string
}

export type ReceiveFileResponse = LKPResultResponse
export type GetProcessingResultResponse = LKPResultResponse

type This = ElactUploadService & typeof TokenServiceMixin

const settings = defineSettings({
    tokenService: process.env.ELACT_TOKEN_SERVICE || 'elact-eruz',
    elact: {
        schemas: './schemas/elact',
        wsdl: 'WSDL/actWSIncoming.wsdl',
        endpoint:
            process.env.ELACT_SUPPLIER_UPLOAD ??
            'https://int44.zakupki.gov.ru/eis-integration/elact/supplier-upload',
    },
    formatVersion: '1.21',
})

useCustomDispatcher({ connectTimeout: 60000 })

@service({
    name: 'elact-upload',

    metadata: {
        $description: `Отправка и проверка отправки электронных документов в ЛКП (ЭлАкт)`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings,
    mixins: [TokenServiceMixin],

    hooks: {
        before: {
            '*': ['resolveUserToken'],
        },
    },
})
export default class ElactUploadService extends Service<typeof settings> {
    private declare soapClient: SoapClient

    /*
     *  Actions
     */

    @action({
        name: 'receiveFile',
        params: {
            regNum: 'string|numeric|length:8',
            packetUrl: 'string',
        },
    })
    public async receiveFile(this: This, ctx: Context<ReceiveFileRequest>) {
        // TODO: add file validation
        const res = await fetch(ctx.params.packetUrl)
        const arrayBuffer = await res.arrayBuffer()

        const body = this.soapClient.wsdl.xmlToObject(
            iconv.decode(Buffer.from(arrayBuffer), 'windows-1251'),
        )
        delete body['ФайлПакет'].attributes['xsi:noNamespaceSchemaLocation']

        const [error, content] = await executeSoapRequest<LKPResultResponse, LKPReceiveFileRequest>(
            this.soapClient,
            'receiveFile',
            body,
            {
                encoding: 'windows-1251',
                stripRequestTag: 'receiveFileRequest',
                appendRootResponseTag: 'resultResponse',
            },
            {
                'Content-Type': 'text/xml;charset=windows-1251',
                Connection: 'keep-alive',
                usertoken: ctx.locals.usertoken,
            },
        )
        if (error) {
            throw error
        }
        return content
    }

    @action({
        name: 'getProcessingResult',
        params: {
            regNum: 'string|numeric|length:8',
            packetId: 'string|trim',
            fileId: 'string|trim|optional',
        },
    })
    public async getProcessingResult(this: This, ctx: Context<GetProcessingResultRequest>) {
        const { packetId, fileId } = ctx.params
        const [error, content] = await executeSoapRequest<
            LKPResultResponse,
            LKPGetProcessingResultRequest
        >(
            this.soapClient,
            'getProcessingResult',
            this.processingResultQuery(packetId, fileId),
            {
                encoding: 'windows-1251',
                stripRequestTag: 'getProcessingResultRequest',
                appendRootResponseTag: 'resultResponse',
            },
            {
                'Content-Type': 'text/xml;charset=windows-1251',
                usertoken: ctx.locals.usertoken,
            },
        )
        if (error) {
            throw error
        }
        return content
    }

    @method
    private processingResultQuery(packetId: string, fileId?: string) {
        return {
            ФайлЗапросРезул: {
                attributes: {
                    ИдФайл: fileId || this.broker.generateUid(),
                    СистОтпр: 'LKP',
                    СистПол: 'RK',
                    ДатаВрФормир: new Date().toISOString(),
                    ВерсПрог: pkg.version,
                    ВерсФорм: this.settings.formatVersion,
                },
                Документ: {
                    attributes: {
                        ИдТрПакет: packetId,
                    },
                },
            },
        }
    }

    /*
     *  Lifecycle methods
     */

    @started
    protected async started(this: This) {
        const highestVersionFolder = await getHighestVersionFolder(this.settings.elact.schemas)

        const pathToWSDL = path.join(
            this.settings.elact.schemas,
            highestVersionFolder,
            this.settings.elact.wsdl,
        )

        this.soapClient = await createClientAsync(pathToWSDL, {
            request: getRequestShim(),
            envelopeKey: 'soapenv',
            useEmptyTag: true,
        })
        this.soapClient.setEndpoint(this.settings.elact.endpoint)
    }
}
