import iconv from 'iconv-lite';
import { action, event, method, service, started } from 'moldecor';
import { BrokerNode, Context, Service as MoleculerService } from 'moleculer';
import path from 'node:path';
import { Client, createClientAsync } from 'soap';

import pkg from '../../package.json' with { type: 'json' };
import { TokenNotFoundError, TokenNotProvidedError } from '../errors.js';
import {
    LKPGetProcessingResultRequest,
    LKPReceiveFileRequest,
    LKPResultResponse,
} from '../types/elact-upload.js';
import { getHighestVersionFolder, getRequestShim } from '../utils/index.js';
import { executeSoapRequest } from '../utils/soap.js';
import { GetTokenParams, GetTokenResponse } from './elact-eruz.service.js';

interface Settings {
    tokenService: string;
    elact: {
        schemas: string;
        wsdl: string;
        endpoint: string;
    };
}

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

@service({
    name: 'elact-upload',

    metadata: {
        $description: `Отправка и проверка отправки электронных документов в ЛКП (ЭлАкт)`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings: {
        tokenService: process.env.ELACT_TOKEN_SERVICE || 'elact-eruz',
        elact: {
            schemas: './schemas/elact',
            wsdl: 'WSDL/actWSIncoming.wsdl',
            endpoint:
                process.env.ELACT_SUPPLIER_UPLOAD ??
                'https://int44.zakupki.gov.ru/eis-integration/elact/supplier-upload',
        },
    },

    hooks: {
        before: {
            '*': ['resolveUserToken'],
        },
    },
})
export default class ElactUploadService extends MoleculerService<Settings> {
    private soapClient!: Client;
    private useTokenService = false;

    @action({
        name: 'receiveFile',
        params: {
            regNum: 'string|numeric|length:8',
            packetUrl: 'string',
        },
    })
    public async receiveFile(ctx: Context<ReceiveFileRequest>) {
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
    public async getProcessingResult(ctx: Context<GetProcessingResultRequest>) {
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

    @method
    protected async resolveUserToken(ctx: Context<{ regNum: string }, { token?: string }>) {
        if (ctx.meta.token) {
            ctx.locals.usertoken = ctx.meta.token;
            delete ctx.meta.token;
        } else if (this.useTokenService) {
            const usertoken = await ctx.call<GetTokenResponse, GetTokenParams>(
                `${this.settings.tokenService}.getToken`,
                {
                    regNum: ctx.params.regNum,
                },
            );
            if (!usertoken) {
                throw new TokenNotFoundError();
            }
            ctx.locals.usertoken = usertoken;
        } else {
            throw new TokenNotProvidedError();
        }
    }

    @method
    private setIsTokenServiceAvailable() {
        const currentValue = this.useTokenService;

        const list = this.broker.registry.getServiceList({
            skipInternal: true,
            onlyAvailable: true,
        });
        this.useTokenService =
            list.find((v) => v.name.toLowerCase() === this.settings.tokenService.toLowerCase()) !==
            undefined;

        if (currentValue !== this.useTokenService) {
            this.logger.debug(`useTokenService: ${currentValue} -> ${this.useTokenService}`);
        }
    }

    @event({
        name: '$services.changed',
        context: true,
    })
    protected onServiceChanged(ctx: Context<any>) {
        this.setIsTokenServiceAvailable();
    }

    @event({
        name: '$node.disconnected',
        context: true,
    })
    protected onNodeDisconnected(ctx: Context<{ node: BrokerNode; unexpected: boolean }>) {
        if (ctx.params.unexpected) {
            this.setIsTokenServiceAvailable();
        }
    }

    @started
    protected async started() {
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

        this.setIsTokenServiceAvailable();
    }
}
