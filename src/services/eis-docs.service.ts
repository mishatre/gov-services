import { randomUUID } from 'crypto';
import { action, method, service, started } from 'moldecor';
import { Context, Errors, Service as MoleculerService } from 'moleculer';
import path from 'node:path/posix';
import { Client, createClientAsync } from 'soap';

import { ExcludeErrorInfo, ExcludeNoData } from '../types/basic.js';
import {
    EISDocsResponse,
    EISGetDocSignaturesByUrlRequest,
    EISGetDocSignaturesByUrlResponse,
    EISGetDocsByOrgRegionRequest,
    EISGetDocsByOrgRegionResponse,
    EISGetDocsByReestrNumberRequest,
    EISGetDocsByReestrNumberResponse,
    EISGetNsiRequest,
    EISGetNsiResponse,
    FzTypes,
    NSIKinds,
    SubsystemType,
} from '../types/eis-docs.js';
import { getHighestVersionFolder, getRequestShim } from '../utils/index.js';
import { executeSoapRequest } from '../utils/soap.js';

interface Settings {
    testMode?: boolean;
    eis: {
        schemas: string;
        wsdl: string;
        endpoint: string;
    };
}

// Actions

export type GetDocsByReestrNumberParams = {
    subsystemType: SubsystemType;
    reestrNumber: string;
};

export type GetDocsByOrgRegionParams = {
    fzType: FzTypes;
    orgRegion: string;
    subsystemType: SubsystemType;
    documentType: string;
    periodInfo: {
        exactDate: string;
    };
    reestrNumber?: string;
};

export type GetNsiRequestParams = {
    fzType: FzTypes;
    nsiCode: string;
    nsiKind: NSIKinds;
};

export type GetDocSignaturesByUrlParams = {
    archiveUrl: string[];
};

export type GetDocsByReestrNumberResponse = {
    items: ExcludeErrorInfo<
        ExcludeNoData<EISGetDocsByReestrNumberResponse['dataInfo']>
    >['archiveUrl'];
};
export type GetDocsByOrgRegionResponse = {
    items: ExcludeErrorInfo<ExcludeNoData<EISGetDocsByOrgRegionResponse['dataInfo']>>['archiveUrl'];
};
export type GetNsiResponse = {
    items: { url: string; name: string }[];
};
export type GetDocSignaturesByUrlResponse = {
    items: ExcludeErrorInfo<
        ExcludeNoData<EISGetDocSignaturesByUrlResponse['dataInfo']>
    >['docSignaturesInfo'];
};

const subsystemTypes = [
    'BTK',
    'PRIZ',
    'PRIZP',
    'RPEC',
    'PZKLKP',
    'RPGZ',
    'RPNZ',
    'RDI',
    'RGK',
    'RBG',
    'EA',
    'RJ',
    'REC',
    'RPP',
    'RVP',
    'RRK',
    'RRA',
    'RNP',
    'RKPO',
    'PPRF615',
    'RD615',
    'LKOK',
    'OZ',
    'OD223',
    'RBG223',
    'RJ223',
    'RPP223',
    'RPZ223',
    'RI223',
    'RZ223',
    'OV223',
    'TPOZ223',
    'POZ223',
    'RNP223',
    'POM223',
    'RBG223',
    'ZC',
] as const;

// useProxy();

@service({
    name: 'eis-docs',

    metadata: {
        $description: `Сервис отдачи документов из хранилища документов ЕИС`,
        $author: 'Mikhail Tregub',
    },

    settings: {
        testMode: false,
        eis: {
            schemas: './schemas/eis',
            wsdl: 'GetDocsWS/GetDocsLegalEntity/WSDL/WebServiceGetDocsLE.wsdl',
            endpoint:
                process.env.EIS_DOCS ??
                'https://eruz.zakupki.gov.ru/eis-integration/services/getDocsLE',
        },
    },
})
export default class EisDocsService extends MoleculerService<Settings> {
    private soapClient!: Client;

    @action({
        name: 'getDocsByReestrNumber',
        params: {
            subsystemType: { type: 'enum', values: subsystemTypes },
            reestrNumber: 'string',
        },
        description: 'Запрос формирования в ХД архивов с документами по реестровому номеру',
    })
    public async getDocsByReestrNumber(
        ctx: Context<GetDocsByReestrNumberParams>,
    ): Promise<GetDocsByReestrNumberResponse> {
        const { subsystemType, reestrNumber } = ctx.params;
        const params = {
            index: this.createIndexData(),
            selectionParams: {
                subsystemType,
                reestrNumber,
            },
        };

        const [error, content] = await this.executeRequest<
            EISGetDocsByReestrNumberResponse,
            EISGetDocsByReestrNumberRequest
        >('getDocsByReestrNumber', params);
        if (error) {
            throw error;
        } else if (!content) {
            throw new Errors.MoleculerClientError(
                'Документы отсутствуют',
                404,
                'DOCUMENTS_NOT_FOUND',
            );
        }
        return {
            items: content.archiveUrl,
        };
    }

    @action({
        name: 'getDocsByOrgRegion',
        params: {
            fzType: {
                type: 'enum',
                optional: true,
                values: [FzTypes.fz44, FzTypes.fz223],
                default: FzTypes.fz44,
            },
            orgRegion: 'string',
            subsystemType: { type: 'enum', values: subsystemTypes },
            documentType: 'string',
            periodInfo: {
                type: 'object',
                params: {
                    exactDate: 'date|convert',
                },
            },
            reestrNumber: 'string|optional',
        },
        description:
            'Запрос формирования в ХД архивов с документами по региону заказчика и типу документа',
    })
    public async getDocsByOrgRegion(
        ctx: Context<GetDocsByOrgRegionParams>,
    ): Promise<GetDocsByOrgRegionResponse> {
        const { fzType, orgRegion, subsystemType, documentType, periodInfo, reestrNumber } =
            ctx.params;
        const params = {
            index: this.createIndexData(),
            selectionParams: {
                orgRegion,
                subsystemType,
                [`documentType${fzType === FzTypes.fz44 ? '44' : '223'}`]: documentType,
                periodInfo,
                reestrNumber,
            },
        };

        const [error, content] = await this.executeRequest<
            EISGetDocsByOrgRegionResponse,
            EISGetDocsByOrgRegionRequest
        >('getDocsByOrgRegion', params);
        if (error) {
            throw error;
        } else if (!content) {
            throw new Errors.MoleculerClientError(
                'Документы отсутствуют',
                404,
                'DOCUMENTS_NOT_FOUND',
            );
        }
        return {
            items: content.archiveUrl,
        };
    }

    @action({
        name: 'getDocSignaturesByUrl',
        params: {
            archiveUrl: ['string'],
        },
        description: 'Запрос формирования в ХД архивов с подписями документов',
    })
    public async getDocSignaturesByUrl(
        ctx: Context<GetDocSignaturesByUrlParams>,
    ): Promise<GetDocSignaturesByUrlResponse> {
        const { archiveUrl } = ctx.params;
        const params = {
            index: this.createIndexData(),
            archiveUrl,
        };

        const [error, content] = await this.executeRequest<
            EISGetDocSignaturesByUrlResponse,
            EISGetDocSignaturesByUrlRequest
        >('getDocSignaturesByUrl', params);
        if (error) {
            throw error;
        }
        return {
            items: content.docSignaturesInfo,
        };
    }

    @action({
        name: 'getNsi',
        params: {
            fzType: {
                type: 'enum',
                optional: true,
                values: [FzTypes.fz44, FzTypes.fz223],
                default: FzTypes.fz44,
            },
            nsiCode: 'string',
            nsiKind: { type: 'enum', values: ['all', 'inc'] },
        },
        description: 'Запрос формирования в хранилище документов (ХД) архивов с данными НСИ',
        cache: {
            enabled: true,
            // all - each sunday between 01:00 and 07:00
            // inc - each day between 03:00 and 04:00 (except KTRU)
            // KTRU - each hour
            ttl: 60 * 60,
        },
    })
    public async getNsi(ctx: Context<GetNsiRequestParams>): Promise<GetNsiResponse> {
        const { fzType, nsiCode, nsiKind } = ctx.params;
        const params = {
            index: this.createIndexData(),
            selectionParams: {
                [`nsiCode${fzType === FzTypes.fz44 ? '44' : '223'}`]: nsiCode,
                nsiKind,
            },
        };

        const [error, content] = await this.executeRequest<EISGetNsiResponse, EISGetNsiRequest>(
            'getNsi',
            params,
        );
        if (error) {
            throw error;
        } else if (!content) {
            throw new Errors.MoleculerClientError(
                'Справочники не найдены',
                404,
                'CATALOGS_NOT_FOUND',
            );
        }
        return {
            items: content.nsiArchiveInfo.map(({ archiveUrl, archiveName }) => ({
                url: this.rewriteURL(archiveUrl),
                name: archiveName,
            })),
        };
    }

    @method
    private async executeRequest<R extends EISDocsResponse<any>, P extends {} = {}>(
        method: string,
        params: P,
    ) {
        let [error, content, rawContent] = await executeSoapRequest<EISDocsResponse<any>, P>(
            this.soapClient,
            method,
            params,
            {},
            {},
        );
        if (!error) {
            if (!content || 'noData' in content.dataInfo) {
                content = null;
            } else if ('errorInfo' in content.dataInfo) {
                const { message, code } = (content as any).errorInfo;
                error = new Errors.MoleculerClientError(message, code, 'EIS_ERROR');
            } else {
                content = content.dataInfo;
            }
        }
        return [
            error,
            content as ExcludeNoData<ExcludeErrorInfo<NonNullable<R['dataInfo']>>>,
            rawContent as string,
        ] as const;
    }

    @method
    protected rewriteURL(url: string) {
        const originalURL = new URL(url);
        const endpointURL = new URL(this.settings.eis.endpoint);

        originalURL.protocol = endpointURL.protocol;
        originalURL.host = endpointURL.host;

        return originalURL.toString();
    }

    @method
    protected createIndexData() {
        const testMode = this.settings.testMode ?? false;
        return {
            id: randomUUID(),
            createDateTime: new Date().toISOString(),
            mode: testMode ? 'TEST' : 'PROD',
        } as const;
    }

    @started
    public async started() {
        const highestVersionFolder = await getHighestVersionFolder(this.settings.eis.schemas);

        const pathToWSDL = path.join(
            this.settings.eis.schemas,
            highestVersionFolder,
            this.settings.eis.wsdl,
        );

        this.soapClient = await createClientAsync(pathToWSDL, {
            request: getRequestShim(),
        });
        this.soapClient.setEndpoint(this.settings.eis.endpoint);
    }
}
