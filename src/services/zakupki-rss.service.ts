import { action, method, service, started } from 'moldecor';
import { Context, Service as MoleculerService } from 'moleculer';
import Parser from 'rss-parser';

import { fromShortDate, makeShortDate } from '../utils/date.js';

export type SearchContractsInfoRequest = {
    fromDate?: string | number | Date;
    toDate?: string | number | Date;
    regNum?: string;
    contractNumber?: string;
    supplier?: string;
};

export type SearchContractsInfoResponse = {
    regNum: string;
    contractNumber: string;
    contractDate: Date;
    client: string;
    price: number;
    currency: string;
    status: ContractStatus;
    invalidated: boolean;
    publishedAt: Date;
    updatedAt: Date;
    url: string;
}[];

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

enum RSSType {
    Contract,
    Order,
}

enum ContractStatus {
    Execution = 'EXECUTION',
    ExecutionTerminated = 'EXECUTION_TERMINATED',
    ExecutionCompleted = 'EXECUTION_COMPLETED',
    Invalidated = 'INVALIDATED',
    Unknown = 'UNKNOWN',
}

interface ZakupkiRSSServiceSettings {
    baseUrl: string;
    rss: {
        contract: string;
        order: string;
    };
}

@service({
    name: 'zakupki-rss',
    settings: {
        baseUrl: 'https://zakupki.gov.ru/',
        rss: {
            contract: '/epz/contract/search/rss',
            order: '/epz/order/extendedsearch/rss.html',
        },
    },
})
export default class ZakupkiRSSService extends MoleculerService<ZakupkiRSSServiceSettings> {
    @action({
        name: 'searchContractsInfo',
        params: {
            fromDate: 'date|convert|optional',
            toDate: 'date|convert|optional',
            regNum: 'string|optional',
            contractNumber: 'string|optional',
            supplier: 'string|optional',
        },
    })
    public async searchContractsInfo(
        ctx: Context<SearchContractsInfoRequest>,
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
            recordsPerPage: '_200',
            showLotsInfoHidden: 'false',
        });

        if ('fromDate' in ctx.params && ctx.params.fromDate) {
            searchParams.set('updateDateFrom', makeShortDate(ctx.params.fromDate as Date));
        }
        if ('toDate' in ctx.params && ctx.params.toDate) {
            searchParams.set('updateDateFrom', makeShortDate(ctx.params.toDate as Date));
        }
        if ('regNum' in ctx.params && ctx.params.regNum) {
            searchParams.set('searchString', ctx.params.regNum);
        }
        if ('contractNumber' in ctx.params && ctx.params.contractNumber) {
            searchParams.set('contractInputNameContractNumber', ctx.params.contractNumber);
        }
        if ('supplier' in ctx.params && ctx.params.supplier) {
            searchParams.set('supplierTitle', ctx.params.supplier);
        }

        const url = this.buildURL(RSSType.Contract, searchParams);

        const response = await fetch(url, {
            method: 'GET',
        });

        const text = await response.text();

        const parser = new Parser();
        const result = await parser.parseString(text);

        const contracts = [];
        for (const item of result.items) {
            if (!item.contentSnippet || !item.title) {
                continue;
            }

            const content = this.parseContent(item.contentSnippet);
            const foundResult = content.get('Найденный результат');
            if (!foundResult) {
                continue;
            }

            const regNum = item.title.replace('№', '').trim();
            const [contractNumber, contractDate] = foundResult.get('Контракт №').split(' от ');
            const price = foundResult.get('Цена контракта');
            const invalidated =
                foundResult.get('Контракт признан недействительным')?.toLowerCase() !== 'нет';
            const published = foundResult.get('Размещено');
            const updated = foundResult.get('Обновлено');

            const link =
                item.link || `/epz/contract/contractCard/common-info.html?reestrNumber=${regNum}`;

            contracts.push({
                regNum,
                contractNumber,
                contractDate: fromShortDate(contractDate),
                client: foundResult.get('Заказчик'),
                price: parseFloat(price.replace(/\s/g, '').replace(',', '.')),
                currency: foundResult.get('Валюта'),
                status: this.parseContractStatus(foundResult.get('Статус контракта')),
                invalidated,
                publishedAt: item.isoDate ? new Date(item.isoDate) : fromShortDate(published),
                updatedAt: updated && fromShortDate(updated),
                url: new URL(link, this.settings.baseUrl).toString(),
            });
        }

        return contracts;
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

        if ('participant' in ctx.params && ctx.params.participant) {
            searchParams.set('participantName', ctx.params.participant);
        }
        if ('fromDate' in ctx.params && ctx.params.fromDate) {
            searchParams.set('updateDateFrom', makeShortDate(ctx.params.fromDate));
        }
        if ('toDate' in ctx.params && ctx.params.toDate) {
            searchParams.set('updateDateTo', makeShortDate(ctx.params.toDate));
        }

        const url = this.buildURL(RSSType.Order, searchParams);

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
    private buildURL(type: RSSType, searchParams: URLSearchParams) {
        const url = new URL(this.getRSSPartByType(type), this.settings.baseUrl);
        url.search = searchParams.toString();

        return url;
    }

    @method
    private getRSSPartByType(type: RSSType) {
        switch (type) {
            case RSSType.Order:
                return this.settings.rss.order;
            case RSSType.Contract:
                return this.settings.rss.contract;
            default:
                throw new Error('Incorrect RSS type');
        }
    }

    @method
    private parseContent(content: string) {
        const parts = content.split('\n');

        const rootContentMap = new Map<string, any>();
        let currengContentMap = rootContentMap;
        for (const part of parts) {
            const [key, value] = part
                .trim()
                .split(':')
                .map((v) => v.trim());
            if (!value) {
                currengContentMap = new Map<string, string>();
                rootContentMap.set(key, currengContentMap);
            } else {
                currengContentMap.set(key, value);
            }
        }

        return rootContentMap;
    }

    @method
    private parseContractStatus(status: string) {
        switch (status.toLowerCase()) {
            case 'Исполнение'.toLowerCase():
                return ContractStatus.Execution;
            case 'Исполнение завершено'.toLowerCase():
                return ContractStatus.ExecutionTerminated;
            case 'Исполнение прекращено'.toLowerCase():
                return ContractStatus.ExecutionCompleted;
            case 'Аннулировано'.toLowerCase():
                return ContractStatus.Invalidated;
            default:
                return ContractStatus.Unknown;
        }
    }

    @started
    protected async started() {}
}
