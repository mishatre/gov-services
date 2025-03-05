import { action, method, service, started } from 'moldecor';
import { Context, Service as MoleculerService } from 'moleculer';
import { parse } from 'node-html-parser';

import { NotFoundError } from '../errors.js';
import { documentKind } from '../utils/index.js';
import { GetObjectListRequest, GetObjectListResponse } from './elact-docs.service.js';

interface Settings {}

interface ExtractPrintFormsProps {
    url: string;
}

type ExtractPrintFormsReturnType = Array<{
    name: string;
    documentKind: string;
    isAppendix: boolean;
    title: string;
    content: string;
}>;

const DOCUMENT_MAP = {
    defaultOpen: 'ON_NSCHFDOPPR',
    'Информация о поставке': 'PRIL_ON_NSCHFDOPPR',
    'Извещение о получении электронного документа': 'DP_IZVPOL',
    'Подтверждение даты отправки документа': 'DP_PDPOL',
    'Уведомление об уточнении электронного документа': 'DP_UVUTOCH',
    'Мотивированный отказ': 'PRIL_ON_NSCHFDOPPOK',
} as Readonly<{ [key: string]: string }>;

@service({
    name: 'elact-utils',

    metadata: {
        $description: `ЕИС дополнительная функциональность`,
        $author: 'Mikhail Tregub',
    },

    dependencies: [],
})
export default class ElactDocsService extends MoleculerService<Settings> {
    @action({
        name: 'getObjectStatus',
        params: {
            $$root: true,
            type: 'object',
            strict: true,
            params: {
                regNum: 'string|numeric|length:8',
                documentKind: { type: 'enum', values: documentKind },
                objectId: 'uuid',
            },
        },
    })
    public async getObjectStatus(
        ctx: Context<{ regNum: string; documentKind: string; objectId: string }>,
    ) {
        const foundObjects = await ctx.call<GetObjectListResponse, GetObjectListRequest>(
            'elact-docs.getObjectList',
            ctx.params,
        );

        if (foundObjects.items.length === 0) {
            throw new NotFoundError();
        }

        const item = foundObjects.items[0];

        return {
            objectId: item.objectId,
            documentKind: item.documentKind,
            versionNumber: item.versionNumber,
            status: item.status,
        };
    }

    @action({
        name: 'downloadFile',
        params: {
            url: 'string|no-empty',
        },
    })
    public async downloadFile(ctx: Context<{ url: string }>) {
        const data = await fetch(ctx.params.url);

        return Buffer.from(await data.text()).toString('base64');
    }

    @action({
        name: 'downloadFiles',
        params: {
            type: 'array',
            $$root: true,
            strict: true,
            // @ts-expect-error
            min: 1,
            // @ts-expect-error
            max: 20,
            items: 'string',
        },
    })
    public async downloadFiles(ctx: Context<string[]>) {
        const urls = Array.from(new Set(ctx.params));

        const result = await Promise.all(
            urls.map((url) =>
                this.actions
                    .downloadFile({ url }, { parentCtx: ctx })
                    .then((result) => [url, result]),
            ),
        );

        return Object.fromEntries(result);
    }

    @action({
        name: 'extractPrintForms',
        params: {
            url: 'string',
        },
        description: 'Получение всех доступных форм ЕИС по ссылке на печатные формы',
    })
    public async extractPrintForms(
        ctx: Context<ExtractPrintFormsProps>,
    ): Promise<ExtractPrintFormsReturnType> {
        try {
            const res = await fetch(ctx.params.url);

            if (!res.ok) {
                return [];
            }

            const content = await res.text();

            return await this.extractHTMLFilesFromHTMLPage(content);
        } catch (error) {
            console.log(error);
        }

        return [];
    }

    @action({
        name: 'bulkExtractPrintForms',
        params: {
            type: 'array',
            $$root: true,
            items: {
                type: 'object',
                params: {
                    url: 'string',
                },
            },
        },
        description: 'Получение всех доступных форм ЕИС по ссылке на печатные формы',
    })
    public async bulkExtractPrintForms(
        ctx: Context<ExtractPrintFormsProps[]>,
    ): Promise<{ url: string; items: ExtractPrintFormsReturnType }> {
        const urls = Array.from(new Set(ctx.params.map(({ url }) => url)));

        const result = await Promise.all(
            urls.map((url) =>
                this.actions
                    .extractPrintForms(
                        { url },
                        {
                            parentCtx: ctx,
                            timeout: 0,
                        },
                    )
                    .then((result) => [url, result]),
            ),
        );

        return Object.fromEntries(result);
    }

    @method
    private async extractHTMLFilesFromHTMLPage(
        htmlString: string,
    ): Promise<ExtractPrintFormsReturnType> {
        const root = parse(htmlString);
        if (!root) {
            return [];
        }

        const elements = root.getElementsByTagName('button') || [];

        const tasks = elements.map(async (element) => {
            const url = this.extractURLFromString(element.attrs.onclick);

            if (!url || !(element.id in DOCUMENT_MAP)) {
                return null;
            }

            const documentKind = DOCUMENT_MAP[element.id];
            const isAppendix = documentKind.startsWith('PRIL_');

            const content = await this.fetchHtmlAsBase64(url);
            if (!content) {
                return null;
            }

            return {
                name: documentKind === 'ON_NSCHFDOPPR' ? 'Документ о приемке' : element.id,
                documentKind: isAppendix ? documentKind.replace('PRIL_', '') : documentKind,
                isAppendix,
                title: element.innerText,
                content,
            };
        });

        return (await Promise.all(tasks)).filter(Boolean) as ExtractPrintFormsReturnType; // Remove `null` values
    }

    @method
    private async fetchHtmlAsBase64(url: string) {
        try {
            const res = await fetch(url);

            if (!res.ok) {
                return undefined;
            }

            const content = await res.text();

            if (this.isJSON(content)) {
                return undefined;
            }

            return Buffer.from(content).toString('base64');
        } catch (error) {
            return undefined;
        }
    }

    @method
    private isJSON(string: string) {
        try {
            JSON.parse(string);
            return true;
        } catch (error) {
            return false;
        }
    }

    @method
    private extractURLFromString(string: string) {
        const pattern =
            /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;
        return pattern.exec(string)?.[0];
    }

    @started
    public async started() {}
}
