import _ from 'lodash';
import { action, event, method, service, started } from 'moldecor';
import { Context, Errors, Service as MoleculerService } from 'moleculer';
import path from 'node:path/posix';
import { Client, createClientAsync } from 'soap';

import { TokenNotFoundError } from '../errors.js';
import {
    ExcludeErrorInfo,
    LkpGetContractsListRequest,
    LkpGetContractsListResponse,
    LkpGetObjectInfoRequest,
    LkpGetObjectInfoResponse,
    LkpGetObjectListRequest,
    LkpGetObjectListResponse,
    LkpGetParticipantInfoResponse,
} from '../types.js';
import { combineDateTimeString } from '../utils/date.js';
import { getHighestVersionFolder, getRequestShim, mapToObject } from '../utils/index.js';
import { executeSoapRequest } from '../utils/soap.js';

enum SignerType {
    JuridicalPerson = 'ЮЛ',
    SoleProprietor = 'ИП',
    IndividualPerson = 'ФЛ',
}

type PacketSigningAuthorityType =
    | {
          ЮЛ: {
              attributes: {
                  Должн: string;
                  ИННЮЛ: string;
                  ИныеСвед: string;
              };
              ФИО: {
                  Фамилия: string;
                  Имя: string;
                  Отчество: string;
              };
          };
      }
    | {
          ИП: {
              attributes: {
                  СвГосРегИП: string;
                  ИННФЛ: string;
                  ИныеСвед: string;
              };
              ФИО: {
                  Фамилия: string;
                  Имя: string;
                  Отчество: string;
              };
          };
      }
    | {
          ФЛ: {
              attributes: {
                  ИННФЛ: string;
                  ИныеСвед: string;
              };
              ФИО: {
                  Фамилия: string;
                  Имя: string;
                  Отчество: string;
              };
          };
      };

type PacketSigningInfo = {
    attributes: {
        ВремПодписан: string;
        ДатаПодписан: string;
        ОблПолн: string;
        ОснПолн: string;
        Статус: string;
    };
    Подпись: string;
} & PacketSigningAuthorityType;

type AttachmentContent =
    | { Ссылк: string }
    | {
          ОтносКонтента: {
              КонтентИд: string;
              ТипФХ: 'ЛКП' | 'РК';
          };
      }
    | { Контент: string };

interface Packet {
    attributes: {
        ИдТрПакет: string;
        СистОтпр: string;
        СистПол: string;
        ИдОбъект: string;
        ВнешИд: string;
        ИдФайл: string;
        ИдПрилож: string;
        РеестрНомКонт: string;
        ДатаВрФормир: string;
        ТипПрилож: string;
        ВерсФорм: string;
        ИдОтпр: string;
        ИдПол: string;
    };
    Документ?: {
        attributes: {
            ДокументИд: string;
        };
        Контент: string;
        ПодписьДокумент: PacketSigningInfo | PacketSigningInfo[];
    };
    Прилож?: {
        attributes: {
            ДокументИд: string;
        };
        Контент: string;
        ПодписьПрилож: PacketSigningInfo | PacketSigningInfo[];
    };
    Вложен?: ({
        attributes: {
            КонтентИд: string;
            ВнешКонтентИд: string;
            ИмяФайл: string;
            РазмерФайл: string;
            Ссылка: string;
        };
        ПодписьВлож: PacketSigningInfo | PacketSigningInfo[];
    } & AttachmentContent)[];
    ПечатнФорм?: { Ссылка: string } | { Контент: string };
}

type ParsedPacket = {
    id: string;
    info: {};
    printForm?: {
        type: 'url' | 'base64';
        content: string;
    };
    files: {
        type: 'document' | 'appendix' | 'attachment';
        appendixType?: string;
        id: string;
        fileName: string;
        content: string;
        signingInfo: any;
        fileSize?: string;
        url?: string;
    }[];
    document?: {
        id: string;
        fileName: string;
        content: string;
        signingInfo: any;
    };
    appendix?: {
        id: string;
        fileName: string;
        type: string;
        content: string;
        signingInfo: any;
    };
    attachments?: {
        fileName: string;
        contentId: string;
        fileSize: string;
        url: string;
        signingInfo: any;
        storageType: 'url' | 'base64' | 'fileStore';
        content: string | { contentId: string; storageType: string };
    }[];
};

type ParsedSigningInfo = {
    date: Date;
    authority: {
        type: string;
        basis: string;
    };
    status: string;
    signer?: ParsedSigner;
    signature: string;
};

type ParsedSigner =
    | {
          type: SignerType.JuridicalPerson;
          inn: string;
          position: string;
          otherInfo: string;
          fio: {
              firstName: string;
              lastName: string;
              middleName: string;
          };
      }
    | {
          type: SignerType.SoleProprietor;
          inn: string;
          regNumber: string;
          otherInfo: string;
          fio: {
              firstName: string;
              lastName: string;
              middleName: string;
          };
      }
    | {
          type: SignerType.IndividualPerson;
          inn: string;
          otherInfo: string;
          fio: {
              firstName: string;
              lastName: string;
              middleName: string;
          };
      };

interface ElactDocsServiceSettings {
    elact: {
        schemas: string;
        wsdl: string;
        endpoint: string;
    };
}

// Actions

export type GetContractsListRequest = LkpGetContractsListRequest;
export type GetObjectListRequest = LkpGetObjectListRequest;

export type BulkGetContractsListRequest = {
    regNum: string;
    items: LkpGetContractsListRequest[];
};
export type BulkGetObjectInfoRequest = {
    regNum: string;
    items: GetObjectListRequest[];
};

export type GetObjectInfoRequest = LkpGetObjectInfoRequest;
export type GetContractsListResponse = {
    items: ExcludeErrorInfo<LkpGetContractsListResponse>['contractList']['contractInfo'];
};
export type GetObjectListResponse = {
    items: ExcludeErrorInfo<LkpGetObjectListResponse>['objectList']['objectInfo'];
};
export type GetObjectInfoResponse = {
    objectInfo: ExcludeErrorInfo<LkpGetObjectInfoResponse>['objectInfo'];
    packet: ParsedPacket;
    rawPacket: string;
};

const documentKind = [
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

// useProxy();

@service({
    name: 'elact-docs-test',

    metadata: {
        $description: `Запросы в ЛКП ЕИС`,
        $author: 'Mikhail Tregub',
    },

    settings: {
        elact: {
            schemas: './schemas/elact',
            wsdl: 'WSDL/WebServiceElactsDocsLKP.wsdl',
            endpoint: process.env.ELACT_SUPPLIER_DOCS ?? '',
        },
    },

    dependencies: ['eruz'],

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
        );
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
            signers: signersInfo.signerInfo.map(({ authoritysInfo, ...signer }) => ({
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
        const rawPacket = /(<ФайлПакет.*\/ФайлПакет>)/gs.exec(rawContent)?.[1]!;
        const packet = this.processPacket(content.ФайлПакет);

        return {
            objectInfo: content.objectInfo,
            packet,
            rawPacket,
        };
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
                        documentUid: 'uuid',
                        documentKind: { type: 'enum', values: documentKind },
                    },
                },
            },
        },
        description:
            'Запрос сведений о частично подписанном / подписанном документе электронного актирования',
    })
    public async bulkGetObjectInfo(
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
        );
    }

    @event({
        name: 'eruz#newRecord',
        params: {
            regNum: 'string|numeric|length:8',
            token: 'uuid',
        },
        group: 'eruz',
        context: true,
    })
    protected async handleNewEruzRecords(ctx: Context<{ regNum: string; token: string }>) {
        const { regNum, token } = ctx.params;
        const response = await this.actions.getParticipantInfo({ regNum }, { meta: { token } });
        ctx.emit('eruz.participantInfo', { info: response }, { group: 'eruz' });
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
    private processPacket({ attributes, Документ, Прилож, Вложен, ПечатнФорм }: Packet) {
        const packet: ParsedPacket = {
            id: attributes.ИдТрПакет,
            info: {
                formVersion: attributes.ВерсФорм,
                createdAt: attributes.ДатаВрФормир,
                objectId: attributes.ИдОбъект,
                senderId: attributes.ИдОтпр,
                receiverId: attributes.ИдПол,
                contractRegNum: attributes.РеестрНомКонт,
                senderSystem: attributes.СистОтпр,
                receiverSystem: attributes.СистПол,
            },
            files: [],
        };

        if (ПечатнФорм) {
            packet.printForm = {
                type: 'Ссылка' in ПечатнФорм ? 'url' : 'base64',
                content: 'Ссылка' in ПечатнФорм ? ПечатнФорм.Ссылка : ПечатнФорм.Контент,
            };
        }

        if (Документ) {
            packet.files.push({
                type: 'document',
                id: Документ?.attributes?.ДокументИд,
                fileName: attributes.ИдФайл,
                content: Документ.Контент,
                signingInfo: this.processSigningInfo(Документ.ПодписьДокумент),
            });
        }

        if (Прилож) {
            packet.files.push({
                type: 'appendix',
                appendixType: attributes.ТипПрилож,
                id: Прилож?.attributes?.ДокументИд,
                fileName: attributes.ИдФайл,
                content: Прилож.Контент,
                signingInfo: this.processSigningInfo(Прилож.ПодписьПрилож),
            });
        }

        if (Вложен) {
            if (!Array.isArray(Вложен)) {
                Вложен = [Вложен];
            }
            packet.files.push(
                ...Вложен.map(
                    ({ attributes, ПодписьВлож, ...attachment }) =>
                        ({
                            type: 'attachment',
                            fileName: attributes.ИмяФайл,
                            id: attributes.КонтентИд,
                            fileSize: attributes.РазмерФайл,
                            signingInfo: this.processSigningInfo(ПодписьВлож),
                            url:
                                attributes.Ссылка ||
                                ('Ссылк' in attachment ? attachment.Ссылк : ''),
                            content: 'Контент' in attachment ? attachment.Контент : '',
                        }) as const,
                ),
            );
        }

        return packet;
    }

    @method
    private processSigningInfo(
        signingInfo: PacketSigningInfo | PacketSigningInfo[],
    ): ParsedSigningInfo | ParsedSigningInfo[] {
        if (Array.isArray(signingInfo)) {
            return signingInfo.map(this.processSigningInfo) as ParsedSigningInfo[];
        }
        const { attributes, Подпись } = signingInfo;
        return {
            date: combineDateTimeString(attributes.ДатаПодписан, attributes.ВремПодписан),
            authority: {
                type: attributes.ОблПолн,
                basis: attributes.ОснПолн,
            },
            status: attributes.Статус,
            signer: this.parseSignerInfo(signingInfo),
            signature: Подпись,
        };
    }

    @method
    private parseSignerInfo(signingInfo: PacketSigningInfo): ParsedSigner | undefined {
        if ('ЮЛ' in signingInfo) {
            const fio = signingInfo.ЮЛ.ФИО;
            return {
                type: SignerType.JuridicalPerson,
                inn: signingInfo.ЮЛ.attributes.ИННЮЛ,
                position: signingInfo.ЮЛ.attributes.Должн,
                otherInfo: signingInfo.ЮЛ.attributes.ИныеСвед,
                fio: {
                    firstName: fio.Имя,
                    lastName: fio.Фамилия,
                    middleName: fio.Отчество,
                },
            };
        } else if ('ИП' in signingInfo) {
            const fio = signingInfo.ИП.ФИО;
            return {
                type: SignerType.SoleProprietor,
                inn: signingInfo.ИП.attributes.ИННФЛ,
                regNumber: signingInfo.ИП.attributes.СвГосРегИП,
                otherInfo: signingInfo.ИП.attributes.ИныеСвед,
                fio: {
                    firstName: fio.Имя,
                    lastName: fio.Фамилия,
                    middleName: fio.Отчество,
                },
            };
        } else if ('ФЛ' in signingInfo) {
            const fio = signingInfo.ФЛ.ФИО;
            return {
                type: SignerType.IndividualPerson,
                inn: signingInfo.ФЛ.attributes.ИННФЛ,
                otherInfo: signingInfo.ФЛ.attributes.ИныеСвед,
                fio: {
                    firstName: fio.Имя,
                    lastName: fio.Фамилия,
                    middleName: fio.Отчество,
                },
            };
        }

        return undefined;
    }

    @method
    protected async resolveUserToken(ctx: Context<{ regNum: string }, { token?: string }>) {
        if (ctx.meta.token) {
            ctx.locals.usertoken = ctx.meta.token;
            delete ctx.meta.token;
        } else {
            const usertoken = await ctx.call('eruz.getToken', { regNum: ctx.params.regNum });
            if (!usertoken) {
                throw new TokenNotFoundError();
            }
            ctx.locals.usertoken = usertoken;
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
    }
}
