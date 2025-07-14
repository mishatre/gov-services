import iconv from 'iconv-lite';
import { action, service, started } from 'moldecor';
import { Context, Service } from 'moleculer';
import path from 'node:path';
import { Client as SoapClient, createClientAsync } from 'soap';

import pkg from '../../package.json' with { type: 'json' };
import TokenServiceMixin from '../mixins/token-service-mixin.js';
import {
    LKPGetProcessingResultRequest,
    LKPReceiveFileRequest,
    LKPResultResponse,
} from '../types/elact-upload.js';
import { defineSettings, getHighestVersionFolder, getRequestShim } from '../utils/index.js';
import { executeSoapRequest } from '../utils/soap.js';

export interface ReceiveFileRequest {
    regNum: string;
    packetUrl: string;
}
export interface GetProcessingResultRequest {
    regNum: string;
    packetId: string;
    fileId?: string;
}

export type ReceiveFileResponse = LKPResultResponse;
export type GetProcessingResultResponse = LKPResultResponse;

type This = ElactUploadService & typeof TokenServiceMixin;

const settings = defineSettings({
    tokenService: process.env.ELACT_TOKEN_SERVICE || 'elact-eruz',
    elact: {
        schemas: './schemas/elact',
        wsdl: 'WSDL/actWSIncoming.wsdl',
        endpoint:
            process.env.ELACT_SUPPLIER_UPLOAD ??
            'https://int44.zakupki.gov.ru/eis-integration/elact/supplier-upload',
    },
});

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
    declare private soapClient: SoapClient;

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
        const res = await fetch(ctx.params.packetUrl);
        const arrayBuffer = await res.arrayBuffer();

        const body = this.soapClient.wsdl.xmlToObject(
            iconv.decode(Buffer.from(arrayBuffer), 'windows-1251'),
        );
        delete body['ФайлПакет'].attributes['xsi:noNamespaceSchemaLocation'];

        let [error, content] = await executeSoapRequest<LKPResultResponse, LKPReceiveFileRequest>(
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
        );
        if (error) {
            throw error;
        }
        return content;
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
        const body = {
            ФайлЗапросРезул: {
                attributes: {
                    ИдФайл: ctx.params.fileId || this.broker.generateUid(),
                    СистОтпр: 'LKP',
                    СистПол: 'RK',
                    ДатаВрФормир: new Date().toISOString(),
                    ВерсПрог: pkg.version,
                    ВерсФорм: '1.19',
                },
                Документ: {
                    attributes: {
                        ИдТрПакет: ctx.params.packetId,
                    },
                },
            },
        };
        let [error, content] = await executeSoapRequest<
            LKPResultResponse,
            LKPGetProcessingResultRequest
        >(
            this.soapClient,
            'getProcessingResult',
            body,
            {
                encoding: 'windows-1251',
                stripRequestTag: 'getProcessingResultRequest',
                appendRootResponseTag: 'resultResponse',
            },
            {
                'Content-Type': 'text/xml;charset=windows-1251',
                usertoken: ctx.locals.usertoken,
            },
        );
        if (error) {
            throw error;
        }
        return content;
    }

    /*
     *  Lifecycle methods
     */

    @started
    protected async started(this: This) {
        const highestVersionFolder = await getHighestVersionFolder(this.settings.elact.schemas);

        const pathToWSDL = path.join(
            this.settings.elact.schemas,
            highestVersionFolder,
            this.settings.elact.wsdl,
        );

        this.soapClient = await createClientAsync(pathToWSDL, {
            request: getRequestShim(),
            envelopeKey: 'soapenv',
            useEmptyTag: true,
        });
        this.soapClient.setEndpoint(this.settings.elact.endpoint);
    }
}
