import _ from 'lodash';
import { action, event, method, service, started } from 'moldecor';
import { BrokerNode, Context, Errors, Service as MoleculerService } from 'moleculer';
import path from 'node:path/posix';
import { Client, createClientAsync } from 'soap';

import { TokenNotFoundError, TokenNotProvidedError } from '../errors.js';
import {
    ExcludeErrorInfo,
    FilePacket,
    LkpGetContractsListRequest,
    LkpGetContractsListResponse,
    LkpGetObjectInfoRequest,
    LkpGetObjectInfoResponse,
    LkpGetObjectListRequest,
    LkpGetObjectListResponse,
    LkpGetParticipantInfoResponse,
} from '../types.js';
import {
    documentKind,
    getHighestVersionFolder,
    getRequestShim,
    mapToObject,
} from '../utils/index.js';
import { executeSoapRequest } from '../utils/soap.js';

interface ElactDocsServiceSettings {
    tokenService: string;
    elact: {
        schemas: string;
        wsdl: string;
        endpoint: string;
    };
}

// Actions

export type GetContractsListRequest = LkpGetContractsListRequest;
export type GetObjectListRequest = LkpGetObjectListRequest;
export type GetObjectInfoRequest = LkpGetObjectInfoRequest;

export type GetContractsListResponse = {
    items: ExcludeErrorInfo<LkpGetContractsListResponse>['contractList']['contractInfo'];
};
export type GetObjectListResponse = {
    items: ExcludeErrorInfo<LkpGetObjectListResponse>['objectList']['objectInfo'];
};
export type GetObjectInfoResponse = {
    objectInfo: ExcludeErrorInfo<LkpGetObjectInfoResponse>['objectInfo'];
    ФайлПакет: FilePacket;
};

@service({
    name: 'elact-docs',

    metadata: {
        $description: `Запросы в ЛКП (ЭлАкт)`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings: {
        tokenService: process.env.ELACT_DOCS_TOKEN_SERVICE || 'elact-eruz',
        elact: {
            schemas: './schemas/elact',
            wsdl: 'WSDL/WebServiceElactsDocsLKP.wsdl',
            endpoint: process.env.ELACT_SUPPLIER_DOCS ?? '',
        },
    },

    hooks: {
        before: {
            'get*': ['resolveUserToken', 'convertDateParams'],
            'send*': 'resolveUserToken',
        },
    },
})
export default class ElactDocsService extends MoleculerService<ElactDocsServiceSettings> {
    // @ts-expect-error
    private clientDocuments: Client;
    private useTokenService = false;

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
                    },
                },
                {
                    type: 'object',
                    strict: true,
                    props: {
                        regNum: 'string|numeric|length:8',
                        contractRegNum: 'string|min:1|max:19',
                    },
                },
            ],
        },
        description: 'Запрос сведений о контрактах поставщика',
    })
    public async getContractsList(
        ctx: Context<GetContractsListRequest>,
    ): Promise<GetContractsListResponse> {
        const [error, content] = await this.executeRequest<LkpGetContractsListResponse>(
            'lkpGetContractsList',
            ctx,
        );
        if (error) {
            throw error;
        }
        return {
            items: content.contractList?.contractInfo || [],
        };
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
    public async getParticipantInfo(ctx: Context<{ regNum: string }>) {
        const [error, content] = await this.executeRequest<LkpGetParticipantInfoResponse>(
            'lkpGetParticipantInfo',
            ctx,
        );
        if (error) {
            throw error;
        }

        const { signersInfo, ...participantInfo } = content.participantInfo;
        return {
            ...participantInfo,
            signersInfo: signersInfo.signerInfo.map(({ authoritysInfo, ...signer }) => ({
                ...signer,
                authorityInfo: authoritysInfo.authorityInfo,
            })),
        };
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
    public async getObjectList(ctx: Context<GetObjectListRequest>): Promise<GetObjectListResponse> {
        const [error, content] = await this.executeRequest<LkpGetObjectListResponse>(
            'lkpGetObjectList',
            ctx,
        );
        if (error) {
            throw error;
        }
        return {
            items: content.objectList?.objectInfo ?? [],
        };
    }

    @action({
        name: 'getObjectInfo',
        params: {
            regNum: 'string|numeric|length:8',
            documentUid: 'uuid',
            documentKind: { type: 'enum', values: documentKind },
        },
        description:
            'Запрос сведений о частично подписанном / подписанном документе электронного актирования',
    })
    public async getObjectInfo(ctx: Context<GetObjectInfoRequest>): Promise<GetObjectInfoResponse> {
        const [error, content, rawContent] = await this.executeRequest<LkpGetObjectInfoResponse>(
            'lkpGetObjectInfo',
            ctx,
        );
        if (error) {
            throw error;
        }

        return content;
    }

    @method
    private async executeRequest<R, P extends {} = {}>(method: string, ctx: Context<P>) {
        let [error, content, rawContent] = await executeSoapRequest<R, P>(
            this.clientDocuments,
            method,
            this.enforceParametersOrder(ctx.params, method),
            {},
            {
                'Content-Type': 'text/xml;charset=windows-1251',
                usertoken: ctx.locals.usertoken,
            },
        );
        if (!error) {
            if (!content || 'Body' in (content as Object)) {
                error = new Errors.MoleculerError('Empty response', 500, 'EMPTY_RESPONSE');
            } else if ('errorInfo' in (content as Object)) {
                const { message, code } = (content as any).errorInfo;
                error = new Errors.MoleculerClientError(message, code, 'ELACT_ERROR');
            }
        }
        return [error, content as ExcludeErrorInfo<NonNullable<R>>, rawContent as string] as const;
    }

    @method
    protected async resolveUserToken(ctx: Context<{ regNum: string }, { token?: string }>) {
        if (ctx.meta.token) {
            ctx.locals.usertoken = ctx.meta.token;
            delete ctx.meta.token;
        } else if (this.useTokenService) {
            const usertoken = await ctx.call(`${this.settings.tokenService}.getToken`, {
                regNum: ctx.params.regNum,
            });
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

    @method
    protected convertDateParams(ctx: Context<any>) {
        if ('fromDate' in ctx.params && typeof ctx.params.fromDate === 'object') {
            ctx.params.fromDate = ctx.params.fromDate.toISOString();
        }
        if ('toDate' in ctx.params && typeof ctx.params.toDate === 'object') {
            ctx.params.toDate = ctx.params.toDate.toISOString();
        }
    }

    @method
    private enforceParametersOrder(params: object, method: string) {
        let order: string[] = [];
        const orderedParams = new Map<string, any>();

        switch (method) {
            case 'lkpGetContractsList': {
                order.push(
                    'regNum',
                    'contractRegNum',
                    'fromDate',
                    'toDate',
                    'customerInfo.INN',
                    'customerInfo.KPP',
                );
                break;
            }
            case 'lkpGetParticipantInfo': {
                order.push('regNum');
                break;
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
                );
                break;
            }
            case 'lkpGetObjectInfo': {
                order.push('regNum', 'documentUid', 'documentKind');
                break;
            }
        }

        for (const property of order) {
            const parts = property.split('.');
            if (parts.length === 1) {
                if (_.has(params, property)) {
                    orderedParams.set(property, _.get(params, property));
                }
            } else {
                let current = null;
                let pathParts = [];
                for (let i = 0; i < parts.length; i++) {
                    const part = parts[i];
                    pathParts.push(part);
                    if (i === parts.length - 1) {
                        if (_.has(params, pathParts.join('.'))) {
                            current.set(part, _.get(params, pathParts.join('.')));
                        }
                    } else {
                        if (!_.has(params, part)) {
                            break;
                        }
                        if (!orderedParams.has(part)) {
                            orderedParams.set(part, new Map());
                        }
                        current = orderedParams.get(part);
                    }
                }
            }
        }

        return mapToObject(orderedParams);
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
    public async started() {
        const highestVersionFolder = await getHighestVersionFolder(this.settings.elact.schemas);

        const pathToWSDL = path.join(
            this.settings.elact.schemas,
            highestVersionFolder,
            this.settings.elact.wsdl,
        );

        this.clientDocuments = await createClientAsync(pathToWSDL, {
            request: getRequestShim(),
        });
        this.clientDocuments.setEndpoint(this.settings.elact.endpoint);

        this.setIsTokenServiceAvailable();
    }
}
