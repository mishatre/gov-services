import { BasicResponse, FilePacket } from './basic.js';

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
    ФайлПакет: FilePacket;
}>;
