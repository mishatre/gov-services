import { action, method, service, started } from 'moldecor';
import { Context, Service as MoleculerService } from 'moleculer';
import Parser from 'rss-parser';

import { fromShortDate, makeShortDate } from '../utils/date.js';

export type SearchContractsInfoRequest = {
    fromDate: string | number | Date;
    toDate: string | number | Date;
    contractNumber?: string;
    supplier?: string;
};

export type SearchContractsInfoResponse = Array<{
    url: string | undefined;
    publishedAt: Date | undefined;
    updatedAt: Date | undefined;
    contractRegNum: string;
    contractNum: string | undefined;
    price: string | undefined;
    currency: string | undefined;
    invalidated: boolean;
}>;

export type SearchOrdersInfoRequest = {
    fromDate: string | number | Date;
    toDate: string | number | Date;
    contractNumber?: string;
    participant?: string;
};

export type SearchOrdersInfoResponse = Array<{
    url: string | undefined;
    publishedAt: Date | undefined;
    updatedAt: Date | undefined;
    orderType: string;
    orderNum: string;
    customer: string | undefined;
    stage: string | undefined;
    IKZ: string | undefined;
    purchaseObject: string | undefined;
    fzType: string | undefined;
    initialPrice: string | undefined;
    currency: string | undefined;
    content: Map<string, string>;
}>;

@service({
    name: 'zakupki-rss',
    settings: {},
})
export default class ZakupkiRSSService extends MoleculerService {
    @action({
        name: 'searchContractsInfo',
        params: {
            fromDate: 'date|convert',
            toDate: 'date|convert',
            contractNumber: 'string|optional',
            supplier: 'string|optional',
        },
    })
    public async searchContractsInfo(
        ctx: Context<{ fromDate: Date; toDate: Date; contractNumber?: string; supplier?: string }>,
    ): Promise<SearchContractsInfoResponse> {
        const searchParams = new URLSearchParams({
            morphology: 'on',
            fz44: 'on',
            contractStageList_0: 'on',
            contractStageList_1: 'on',
            contractStageList_2: 'on',
            contractStageList_3: 'on',
            contractStageList: '0,1,2,3',
            sortBy: 'UPDATE_DATE',
            pageNumber: '1',
            sortDirection: 'true',
            recordsPerPage: '_10',
            showLotsInfoHidden: 'false',
        });
        searchParams.set('updateDateFrom', makeShortDate(ctx.params.fromDate));
        searchParams.set('updateDateFrom', makeShortDate(ctx.params.toDate));

        if (ctx.params.contractNumber) {
            searchParams.set('contractInputNameContractNumber', ctx.params.contractNumber);
        }

        if (ctx.params.supplier) {
            searchParams.set('supplierTitle', ctx.params.supplier);
        }

        const url = new URL('https://zakupki.gov.ru/epz/contract/search/rss');
        url.search = searchParams.toString();

        try {
            const response = await fetch(url, {
                method: 'GET',
            });

            const text = await response.text();

            const parser = new Parser();
            const result = await parser.parseString(text);

            const contracts = [];
            for (const item of result.items) {
                if (item.contentSnippet && item.title) {
                    const content = this.parseContent(item.contentSnippet);

                    const contractNum = content.get('Контракт №');
                    const price = content.get('Цена контракта');
                    const currency = content.get('Валюта');
                    const invalidated =
                        content.get('Контракт признан недействительным')?.toLowerCase() !== 'нет';
                    const updated = content.get('Обновлено');

                    contracts.push({
                        url: item.link,
                        publishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
                        updatedAt: updated ? fromShortDate(updated) : undefined,
                        contractRegNum: item.title.replace('№ ', ''),
                        contractNum,
                        price,
                        currency,
                        invalidated,
                    });
                }
            }

            return contracts;
        } catch (error) {
            return [];
        }
    }

    @action({
        name: 'searchOrdersInfo',
        params: {
            fromDate: 'date|convert|optional',
            toDate: 'date|convert|optional',
            participant: 'string|optional',
        },
    })
    public async searchOrdersInfo(
        ctx: Context<{
            fromDate?: Date;
            toDate?: Date;
            participant?: string;
        }>,
    ): Promise<SearchOrdersInfoResponse> {
        const searchParams = new URLSearchParams({
            morphology: 'on',
            sortDirection: 'false',
            showLotsInfoHidden: 'false',
            sortBy: 'PUBLISH_DATE',
            fz44: 'on',
            fz223: 'on',
            af: 'on',
            ca: 'on',
            pc: 'on',
            pa: 'on',
            currencyIdGeneral: '-1',
            OrderPlacementSmallBusinessSubject: 'on',
            OrderPlacementRnpData: 'on',
            OrderPlacementExecutionRequirement: 'on',
            orderPlacement94_0: '0',
            orderPlacement94_1: '0',
            orderPlacement94_2: '0',
        });

        if (ctx.params.participant) {
            searchParams.set('participantName', ctx.params.participant);
        }

        if (ctx.params.fromDate) {
            searchParams.set('updateDateFrom', makeShortDate(ctx.params.fromDate));
        }

        if (ctx.params.toDate) {
            searchParams.set('updateDateTo', makeShortDate(ctx.params.toDate));
        }

        const url = new URL('https://zakupki.gov.ru/epz/order/extendedsearch/rss.html');
        url.search = searchParams.toString();

        try {
            const response = await fetch(url, {
                method: 'GET',
            });

            const text = await response.text();

            const parser = new Parser();
            const result = await parser.parseString(text);

            const orders = [];
            for (const item of result.items) {
                if (item.contentSnippet) {
                    const content = this.parseContent(item.contentSnippet);

                    const updated = content.get('Обновлено');
                    const [orderType, orderNum] = item.title?.split('№') || ['', ''];

                    orders.push({
                        url: item.link,
                        publishedAt: item.isoDate ? new Date(item.isoDate) : undefined,
                        updatedAt: updated ? fromShortDate(updated) : undefined,
                        orderType: orderType.trim(),
                        orderNum: orderNum.trim(),
                        customer: content.get('Наименование Заказчика'),
                        stage: content.get('Этап размещения'),
                        IKZ: content.get('Идентификационный код закупки (ИКЗ)'),
                        purchaseObject: content.get('Наименование объекта закупки'),
                        fzType: content.get('Размещение выполняется по'),
                        initialPrice: content.get('Начальная цена контракта'),
                        currency: '',
                        content,
                    });
                }
            }

            return orders;
        } catch (error) {
            return [];
        }
    }

    @method
    private parseContent(content: string) {
        const parts = content.split('\n');

        const contentMap = new Map<string, string>();
        for (const part of parts) {
            const [key, value] = part.split(':');
            if (!value) {
                contentMap.set('title', key.trim());
            } else {
                contentMap.set(key.trim(), value.trim());
            }
        }

        return contentMap;
    }

    @started
    protected async started() {}
}
