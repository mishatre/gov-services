// eis-docs util types
import { BasicResponse, BasicResponseWithNoData } from './basic.js';

interface IndexRequestType {
    id: string;
    createDateTime: string;
    mode: 'PROD' | 'TEST';
}

interface IndexResponseType {
    id: string;
    refId: string;
    createDateTime: string;
    mode: 'PROD' | 'TEST';
}

export enum SubsystemType {
    // Подсистемы 44-ФЗ:
    // Актуальные значения для передачи:
    BTK = 'BTK', // - Библиотека типовых контрактов;
    PRIZ = 'PRIZ', // - подсистема размещения извещений (без протоколов со сведениями об участниках);
    PRIZP = 'PRIZP', // - подсистема размещения извещений (протоколы со сведениями об участниках);
    RPEC = 'RPEC', // - подсистема заключения контрактов;
    PZKLKP = 'PZKLKP', // - подсистема заключения контрактов в ЛКП;
    RPGZ = 'RPGZ', // - реестр планов графиков с 2020 года;
    RPNZ = 'RPNZ', // - Реестр правил нормирования закупок;
    RDI = 'RDI', // - Реестр дополнительной информации о закупках и контрактах;
    RGK = 'RGK', // - реестр контрактов;
    RBG = 'RBG', // - реестр независимой гарантий;
    EA = 'EA', // - Электронное актирование;
    REC = 'REC', // - Реестр электронных контрактов;
    RJ = 'RJ', // - Реестр жалоб;
    RPP = 'RPP', // - Реестр плановых проверок;
    RVP = 'RVP', // - Реестр внеплановых проверок;
    RRK = 'RRK', // - Реестр результатов контроля;
    RRA = 'RRA', // - Реестр результатов аудита;
    RNP = 'RNP', // - Реестр недобросовестных поставщиков;
    RKPO = 'RKPO', // - Реестр квалифицированных подрядных организаций;
    PPRF615 = 'PPRF615', // - Реестр извещений и протоколов 615;
    RD615 = 'RD615', // - Реестр договоров 615;
    LKOK = 'LKOK', // - Личный кабинет органа контроля;
    OZ = 'OZ', // - Отчеты заказчика.

    // Подсистемы 223-ФЗ:
    OD223 = 'OD223', // - Отчетность по договорам;
    RD223 = 'RD223', // - Реестр договоров;
    RJ223 = 'RJ223', // - Реестр жалоб;
    RPP223 = 'RPP223', // - Реестр плановых проверок;
    RPZ223 = 'RPZ223', // - Реестр планов закупок;
    RI223 = 'RI223', // - Реестр извещений о закупках;
    RZ223 = 'RZ223', // - Реестр заказчиков;
    OV223 = 'OV223', // - Информация об объеме выручки;
    TPOZ223 = 'TPOZ223', // - Типовые положения о закупках;
    POZ223 = 'POZ223', // - Положения о закупках;
    RNP223 = 'RNP223', // - Реестр недобросовестных поставщиков;
    POM223 = 'POM223', // - Подсистема оценки и мониторинга;
    RBG223 = 'RBG223', // - Реестр независимых гарантий
}

export enum FzTypes {
    fz44 = '44',
    fz223 = '223',
}

export interface EISDocsResponse<R> {
    index: IndexResponseType;
    dataInfo: R;
}

// eis-docs requests

export interface EISGetDocsByReestrNumberRequest {
    index: IndexRequestType;
    selectionParams: {
        subsystemType: SubsystemType;
        reestrNumber: string;
    };
}

export interface EISGetDocsByOrgRegionRequest {
    index: IndexRequestType;
    selectionParams: {
        orgRegion: string;
        subsystemType: SubsystemType;
        periodInfo: {
            exactDate: string;
        };
        reestrNumber?: string;
        documentType44?: string;
        documentType223?: string;
    };
}

export type EISGetDocSignaturesByUrlRequest = {
    index: IndexRequestType;
    archiveUrl: string[];
};

export type EISGetNsiRequest = {
    index: IndexRequestType;
    selectionParams: {
        nsiCode44?: 'nsiAllList' | string;
        nsiCode223?: 'nsiAllList' | string;
        nsiKind: 'all' | 'inc';
    };
};

// eis-docs responses

export type EISGetDocsByReestrNumberResponse = EISDocsResponse<
    BasicResponseWithNoData<{
        archiveUrl: string[];
    }>
>;

export type EISGetDocsByOrgRegionResponse = EISDocsResponse<
    BasicResponseWithNoData<{
        archiveUrl: string[];
    }>
>;

export type EISGetDocSignaturesByUrlResponse = EISDocsResponse<
    BasicResponse<{
        docSignaturesInfo: {
            archiveUrl: string;
            archiveWithSignaturesUrl: string;
        };
    }>
>;

export type EISGetNsiResponse = EISDocsResponse<
    BasicResponseWithNoData<{
        nsiArchiveInfo: {
            archiveUrl: string;
            archiveName: string;
        }[];
    }>
>;
