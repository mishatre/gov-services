export type BasicResponse<R> =
    | {
          errorInfo: {
              code: number;
              message: string;
          };
      }
    | R;

export type BasicResponseWithNoData<R> =
    | {
          noData: true;
      }
    | BasicResponse<R>;

export type ExcludeErrorInfo<T> = Exclude<T, { errorInfo: any }>;
export type ExcludeNoData<T> = Exclude<T, { noData: any }>;

interface LkpObjectInfoType {
    id: string;
    externalId?: string;
    objectId?: string;
    idFile?: string;
    documentKind: string;
    documentDate: string;
    schemeVersion: string;
    versionNumber?: string;
    status?: string;
}

// elact-docs requests

export interface LkpGetContractsListRequest {
    regNum: string;
    contractRegNum?: string;
    fromDate?: string | number | Date;
    toDate?: string | number | Date;
    customerInfo?: {
        INN: string;
        KPP: string;
    };
}

export interface LkpGetParticipantInfoRequest {
    regNum: string;
}

export interface LkpGetObjectListRequest {
    regNum: string;
    documentKind?: string;
    fromDate?: string | number | Date;
    toDate?: string | number | Date;
    customerInfo?: {
        INN: string;
        KPP: string;
    };
    externalId?: string;
    objectId?: string;
    contractRegNum?: string;
}

export interface LkpGetObjectInfoRequest {
    regNum: string;
    documentKind: string;
    documentUid: string;
}

// elact-docs responses

export type LkpGetContractsListResponse = BasicResponse<{
    contractList: {
        contractInfo: {
            id: string;
            externalId?: string;
            publishDate: string;
            regNumber: string;
            EDOAddInfo: {
                customerID: string;
                IGK?: string;
            };
            url: string;
        }[];
    };
}>;

export type LkpGetParticipantInfoResponse = BasicResponse<{
    participantInfo: {
        supplierID: string;
        regNum: string;
        cabinetGUID: string;
        fullName: string;
        signersInfo: {
            signerInfo: {
                userId: number;
                commonInfo: {
                    regDate: string;
                    modificationDate: string;
                    status: 'A' | 'B';
                };
                nameInfo: {
                    lastName: string;
                    firstName: string;
                    middleName?: string;
                };
                authoritysInfo: {
                    authorityInfo: {
                        authorityArea: string;
                        authorityFoundation: string;
                    }[];
                };
                signerType: {
                    individualPersonInfo?: {
                        INN: string;
                    };
                    individualEntrepreneurInfo?: {
                        INN: string;
                    };
                    legalEntityInfo?: {
                        fullName: string;
                        INN: string;
                        position: string;
                    };
                };
                isActual: boolean;
            }[];
        };
    };
}>;

export type LkpGetObjectListResponse = BasicResponse<{
    objectList: {
        objectInfo: LkpObjectInfoType[];
    };
}>;

export type LkpGetObjectInfoResponse = BasicResponse<{
    objectInfo: LkpObjectInfoType;
    [key: string]: any;
}>;

// eis-docs util types

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

enum SubsystemType {
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

export interface GetDocsByReestrNumberRequest {
    index: IndexRequestType;
    selectionParams: {
        subsystemType: SubsystemType;
        reestrNumber: string;
    };
}

export interface GetDocsByOrgRegionRequest {
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

export type GetDocSignaturesByUrlRequest = {
    index: IndexRequestType;
    archiveUrl: string[];
};

export type GetNsiRequest = {
    index: IndexRequestType;
    selectionParams: {
        nsiCode44?: 'nsiAllList' | string;
        nsiCode223?: 'nsiAllList' | string;
        nsiKind: 'all' | 'inc';
    };
};

// eis-docs responses

export type GetDocsByReestrNumberResponse = EISDocsResponse<
    BasicResponseWithNoData<{
        archiveUrl: string[];
    }>
>;

export type GetDocsByOrgRegionResponse = EISDocsResponse<
    BasicResponseWithNoData<{
        archiveUrl: string[];
    }>
>;

export type GetDocSignaturesByUrlResponse = EISDocsResponse<
    BasicResponse<{
        docSignaturesInfo: {
            archiveUrl: string;
            archiveWithSignaturesUrl: string;
        };
    }>
>;

export type GetNsiResponse = EISDocsResponse<
    BasicResponseWithNoData<{
        nsiArchiveInfo: {
            archiveUrl: string;
            archiveName: string;
        }[];
    }>
>;
