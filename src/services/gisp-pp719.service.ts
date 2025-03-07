import { Temporal } from '@js-temporal/polyfill';
import dns from 'dns';
import * as Minio from 'minio';
import { action, created, method, service, started } from 'moldecor';
import { Context, Errors, Service as MoleculerService } from 'moleculer';
import DbService from 'moleculer-db';
import SqlAdapter from 'moleculer-db-adapter-sequelize';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { PassThrough, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import Papa from 'papaparse';
import Sequelize from 'sequelize';
import { Agent, fetch } from 'undici';
import Unzip from 'unzip-stream';

import { fromShortDate } from '../utils/date.js';

interface Settings {
    bootstrapCSV: string;
    bucketName: string;
    dataUrl: string;
    gqlUrl: string;
    minio: {
        endPoint: string;
        port: number;
        useSSL: boolean;
        accessKey: string;
        secretKey: string;
    };
}

interface PP719RawRecord {
    Nameoforg: string;
    OGRN: string;
    INN: string;
    Orgaddr: string;
    Productmanufaddress: string;
    Regnumber: string;
    Ektrudp: string;
    Docdate: string;
    Docvalidtill: string;
    Enddate: string;
    Registernumber: string;
    Productname: string;
    OKPD2: string;
    TNVED: string;
    Nameofregulations: string;
    Score: string;
    Percentage: string;
    Scoredesc: string;
    Iselectronicproduct: string;
    Isai: string;
    ElectronicProductLevel: string;
    Docname: string;
    Docdatebasis: string;
    Docnum: string;
    Docvalidtilltpp: string;
    Mptdep: string;
    Resdocnum: string;
}

interface PP719Record {
    organizationName: string;
    ogrn: string;
    inn: string;
    organizationAddress: string;
    productManufacturerAddress: string;
    regNumber: string;
    ektrudp: string;
    endDate: Date;
    registerNumber: string;
    productName: string;
    okpd2: string;
    tnved: string;
    nameOfRegulations: string;
    score: number;
    percentage: number;
    scoreDescription: string;
    isElectronicProduct: boolean;
    isAI: boolean;
    electronicProductLevel: string;
    documentName: string;
    documentDateBasis: Date;
    documentNumber: string;
    documentDate: Date;
    documentValidUntill: Date;
    documentValidUntillTpp: Date;
    mtdep: string;
    resDocumentNumber: string;
}
interface GQLResponse {
    ok: boolean;
    total_count: number;
    items: {
        gisp_url: string;
        product_gisp_url: string;
        org_name: string;
        org_inn: string;
        org_ogrn: string;
        product_reg_number_2022: string;
        product_reg_number_2023: string;
        ektru_dp: string | null;
        res_date: string;
        res_valid_till: string;
        res_end_date: string | null;
        product_writeout_url: string;
        product_name: string;
        product_okpd2: string;
        product_tnved: string;
        product_spec: string;
        product_score_value: string | null;
        product_percentage: string | null;
        product_score_desc: string | null;
        is_ai_tpp: string | null;
        basedondoc_name: string;
        basedondoc_date: string;
        basedondoc_num: string;
        basedondoc_exp: string | null;
        res_mptdep_name: string;
        res_number: string;
        res_scan_url: string;
    }[];
}

const convertMap = {
    Nameoforg: 'organizationName',
    OGRN: 'ogrn',
    INN: 'inn',
    Orgaddr: 'organizationAddress',
    Productmanufaddress: 'productManufacturerAddress',
    Regnumber: 'regNumber',
    Ektrudp: 'ektrudp',
    Enddate: 'endDate',
    Registernumber: 'registerNumber',
    Productname: 'productName',
    OKPD2: 'okpd2',
    TNVED: 'tnved',
    Nameofregulations: 'nameOfRegulations',
    Score: 'score',
    Percentage: 'percentage',
    Scoredesc: 'scoreDescription',
    Iselectronicproduct: 'isElectronicProduct',
    Isai: 'isAI',
    ElectronicProductLevel: 'electronicProductLevel',
    Docname: 'documentName',
    Docdatebasis: 'documentDateBasis',
    Docnum: 'documentNumber',
    Docdate: 'documentDate',
    Docvalidtill: 'documentValidUntill',
    Docvalidtilltpp: 'documentValidUntillTpp',
    Mptdep: 'mtdep',
    Resdocnum: 'resDocumentNumber',
} as const;

const booleanKeys = new Set(['isAI', 'isElectronicProduct']);

const dateKeys = new Set([
    'documentDate',
    'documentDateBasis',
    'documentValidUntill',
    'documentValidUntillTpp',
]);

const numberKeys = new Set(['score', 'percentage']);

function convertValue(value: string, key: string) {
    if (booleanKeys.has(key)) {
        if (value === '-') {
            return undefined;
        }
        return value.toLowerCase() !== 'Нет'.toLowerCase();
    } else if (dateKeys.has(key)) {
        if (value === '-') {
            return undefined;
        }
        return fromShortDate(value);
    } else if (numberKeys.has(key)) {
        if (value === '-') {
            return undefined;
        }
        return parseFloat(value);
    } else if (value === '-') {
        return '';
    }

    return value;
}

function getStartOfDayUTCInTimezone(timezone: string) {
    // Get the current date/time in the specified timezone
    const zonedDateTime = Temporal.Now.zonedDateTimeISO(timezone);
    // Get the start of that day (i.e. midnight in that timezone)
    const startOfDayInZone = zonedDateTime.startOfDay();
    // Convert that local midnight to an Instant (a UTC point in time)
    const instantUTC = startOfDayInZone.toInstant();
    return instantUTC.toString({ fractionalSecondDigits: 3 }); // ISO string in UTC
}

const agent = new Agent({
    connect: {
        family: 4,
        lookup: (hostname, options, callback) => {
            // Custom DNS lookup to force IPv4
            dns.lookup(hostname, { family: 4 }, callback);
        },
    },
});

@service({
    name: 'gisp-pp719',

    metadata: {
        $description: `Сервис работы с ГИСП - Реестр российской промышленной продукции (ПП РФ 719 от 17.07.2015)`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings: {
        bucketName: process.env.MINIO_BUCKET_NAME ?? 'gisp-pp719',
        dataUrl: 'https://gisp.gov.ru/opendata/files/gispdata-current-pp719-products-structure.csv',
        gqlUrl: 'https://gisp.gov.ru/pp719v2/pub/prod/b/',
        minio: {
            endPoint: process.env.S3_ENDPOINT ?? '192.168.101.106',
            port: 9000,
            useSSL: process.env.S3_USESSL ? process.env.S3_USESSL.toLowerCase() === 'true' : false,
            accessKey: process.env.S3_ACCESS_KEY ?? 'LB4NYbgquAz01yFVjt7y',
            secretKey: process.env.S3_SECRET_KEY ?? 'kdxQ3fTMBNucKwTR7haQV4zfqcyQB08qDZOdfcqg',
        },
    },

    mixins: [DbService],
    adapter: new SqlAdapter({
        dialect: 'sqlite',
        storage: './.data/gisp.sqlite',
        logging: false,
    }),

    model: {
        name: 'pp719s',
        define: {
            organizationName: Sequelize.STRING,
            ogrn: Sequelize.STRING,
            inn: Sequelize.STRING,
            organizationAddress: Sequelize.STRING,
            productManufacturerAddress: Sequelize.STRING,
            regNumber: Sequelize.STRING,
            ektrudp: Sequelize.STRING,
            endDate: Sequelize.DATE,
            registerNumber: Sequelize.STRING,
            productName: Sequelize.STRING,
            okpd2: Sequelize.STRING,
            tnved: Sequelize.STRING,
            nameOfRegulations: Sequelize.STRING,
            score: Sequelize.NUMBER,
            percentage: Sequelize.NUMBER,
            scoreDescription: Sequelize.STRING,
            isElectronicProduct: Sequelize.BOOLEAN,
            isAI: Sequelize.BOOLEAN,
            electronicProductLevel: Sequelize.STRING,
            documentName: Sequelize.STRING,
            documentDateBasis: Sequelize.DATE,
            documentNumber: Sequelize.STRING,
            documentDate: Sequelize.DATE,
            documentValidUntill: Sequelize.DATE,
            documentValidUntillTpp: Sequelize.DATE,
            mtdep: Sequelize.STRING,
            resDocumentNumber: Sequelize.STRING,
        },
        options: {
            // Options from http://docs.sequelizejs.com/manual/tutorial/models-definition.html
        },
    },

    // Disable unnecessary moleculer-db actions
    actions: {
        create: false,
        insert: false,
        update: false,
        remove: false,
    },
})
export default class GispPP719Service extends MoleculerService<Settings> {
    private adapter!: SqlAdapter & { db: Sequelize.Sequelize };
    // @ts-expect-error
    private minioClient: Minio.Client;

    @action({
        name: 'updateData',
        params: {
            force: 'boolean|optional',
        },
    })
    public async updateData(ctx: Context<{ force: boolean }>) {
        const isStale = await this.isDataStale();
        if (!isStale && !ctx.params.force) {
            throw new Error('Data is not stale');
        }

        await this.adapter.clear();

        const res = await fetch(this.settings.dataUrl, {
            dispatcher: agent,
        });

        if (!res.ok || !res.body) {
            return;
        }

        await this.saveData(Readable.from(res.body));
    }

    @action({
        name: 'getWriteout',
        params: {
            regNum: 'string|trim',
        },
        circuitBreaker: {
            enabled: true,
            threshold: 2,
        },
    })
    public async getWriteout(ctx: Context<{ regNum: string }>) {
        let filename: string;
        const objectName = `${ctx.params.regNum}.pdf`;

        try {
            const statInfo = await this.minioClient.statObject(
                this.settings.bucketName,
                objectName,
            );
            filename = decodeURIComponent(statInfo.metaData.filename);

            const validUntill = new Date(statInfo.metaData.validuntill);
            const currentDate = new Date();
            currentDate.setHours(0, 0, 0);

            if (validUntill > currentDate) {
                const url = await this.generateWriteoutUrl(objectName, filename!);
                return {
                    filename,
                    url,
                };
            }

            await this.minioClient.removeObject(this.settings.bucketName, objectName);
        } catch (error) {
            if (error instanceof Minio.S3Error) {
                if (error.code !== 'NotFound') {
                    throw error;
                }
            } else {
                throw error;
            }
        }

        const info = await this.getInfoByRegNum(ctx.params.regNum);
        const res1 = await fetch(info.product_writeout_url, {
            method: 'GET',
            dispatcher: agent,
        });
        const stream = Readable.from(res1.body!, { emitClose: false });

        const self = this;
        await pipeline(stream, Unzip.Parse(), async function* (stream) {
            for await (const entry of stream as AsyncIterable<Unzip.Entry>) {
                if (!entry.path.endsWith('pdf')) {
                    continue;
                }
                await self.minioClient.putObject(
                    self.settings.bucketName,
                    objectName,
                    entry,
                    entry.size,
                    {
                        url: info.product_writeout_url,
                        filename: encodeURIComponent(entry.path),
                        validuntill: fromShortDate(info.res_valid_till),
                    },
                );
                filename = entry.path;
            }
        });

        const url = await this.generateWriteoutUrl(objectName, filename!);

        return {
            filename: filename!,
            url,
        };
    }

    @method
    private async cleanStaleWriteouts() {
        let counter = 0;
        const list = await this.minioClient.listObjectsV2(this.settings.bucketName);
        const pending = [];
        for await (const item of list) {
            pending.push(
                new Promise<void>(async (resolve) => {
                    const statInfo = await this.minioClient.statObject(
                        this.settings.bucketName,
                        item.name,
                    );
                    const validUntill = new Date(statInfo.metaData.validuntill);
                    const currentDate = new Date();
                    currentDate.setHours(0, 0, 0);

                    if (validUntill <= currentDate) {
                        await this.minioClient.removeObject(this.settings.bucketName, item.name);
                        counter++;
                    }
                    resolve();
                }),
            );
            if (pending.length > 5) {
                await Promise.all(pending);
                pending.length = 0;
            }
        }
        this.logger.debug(`Removed ${counter} stored stale writeouts`);
    }

    @method
    private async generateWriteoutUrl(objectName: string, filename: string) {
        return this.minioClient.presignedGetObject(this.settings.bucketName, objectName, 60 * 60, {
            'response-content-type': 'application/pdf',
            'response-content-disposition': `inline; filename="${encodeURIComponent(filename!)}"`,
        });
    }

    @method
    private async getInfoByRegNum(regNum: string) {
        const body = {
            opt: {
                sort: null,
                requireTotalCount: true,
                searchOperation: 'contains',
                searchValue: null,
                skip: 0,
                take: 10,
                userData: {},
                filter: [
                    ['res_valid_till', '>=', getStartOfDayUTCInTimezone('Europe/Moscow')],
                    'and',
                    ['res_end_date', '=', null],
                    'and',
                    ['product_reg_number_2023', '=', regNum],
                ],
            },
        };
        const res = await fetch(this.settings.gqlUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
            dispatcher: agent,
        });

        if (!res.ok) {
            throw new Error();
        }

        const data = (await res.json()) as GQLResponse;
        if (!data || !data.ok) {
            throw new Error('NO_DATA');
        }

        if (data.total_count !== 1) {
            throw new Error('MULTIPLE_DATA');
        }

        const record = data.items[0];

        return record;
    }

    @method
    private async saveData(stream: Readable) {
        const self = this;
        const parser = Papa.parse(Papa.NODE_STREAM_INPUT, { header: true });

        await pipeline(
            stream,
            parser,
            // Should be more than 1 chank of data
            new PassThrough({ objectMode: true, highWaterMark: 128 }),
            async function* (stream) {
                const pendingInserts = [];
                let acc = [];
                let i = 0;
                performance.mark('test-start');
                for await (const value of stream as AsyncIterable<PP719RawRecord>) {
                    i++;

                    acc.push(self.convertPP719Value(value));

                    if (acc.length % 1000 === 0) {
                        pendingInserts.push(self.adapter.insertMany(acc));
                        if (pendingInserts.length >= 10) {
                            // Limit concurrent inserts
                            await Promise.all(pendingInserts);
                            pendingInserts.length = 0;
                        }
                        acc.length = 0;
                    }
                }
                if (acc.length > 0) {
                    await self.adapter.insertMany(acc);
                    acc.length = 0;
                }
                performance.mark('test-end');
                const measure = performance.measure('test', 'test-start', 'test-end');
                self.logger.warn('Done: ', measure);
            },
        );
    }

    @method
    private convertPP719Value(value: PP719RawRecord) {
        let newKey: string;
        let key: keyof typeof value;
        for (key in value) {
            newKey = convertMap[key];
            (value as any)[newKey] = convertValue(value[key], newKey); // Assign to new key
            delete value[key]; // Remove old key
        }

        return value as unknown as PP719Record;
    }

    @method
    private async isDataStale() {
        const updateDate = await this.getLastUpdateDate();
        if (!updateDate) {
            return true;
        }

        updateDate.setUTCHours(24, 0, 0, 0);

        return new Date() > updateDate;
    }

    @method
    private async getLastUpdateDate() {
        const res = (await this.adapter.findOne({
            searchFields: ['createdAt'],
            sort: ['createdAt'],
        })) as { createdAt: Date };
        if (!res) {
            return undefined;
        }
        return res.createdAt;
    }

    @method
    private async initMinio() {
        this.minioClient = new Minio.Client(this.settings.minio);

        const bucketExists = await this.minioClient.bucketExists(this.settings.bucketName);
        if (!bucketExists) {
            await this.minioClient.makeBucket(this.settings.bucketName);
        }
    }

    @method
    private async initDatabase() {
        if (!this.settings.bootstrapCSV) {
            return;
        }

        const count = await this.adapter.count();
        if (count !== 0) {
            return;
        }

        const statInfo = await stat(this.settings.bootstrapCSV);
        if (!statInfo.isFile()) {
            return;
        }

        const stream = createReadStream(this.settings.bootstrapCSV);
        await this.saveData(stream);
    }

    @created
    public created() {
        // rmSync('./.data/gisp.sqlite');
    }

    @started
    public async started() {
        await Promise.all([this.initDatabase(), this.initMinio()]);
        await this.cleanStaleWriteouts();
    }
}

// https://gisp.gov.ru/pp719v2/mptapp/view/dl/production/
// https://gisp.gov.ru/pp719v2/mptapp/view/dl/production_res_valid_only/

// https://gisp.gov.ru/pp719v2/pub/prod/b/
// {"opt":{"sort":null,"requireTotalCount":true,"searchOperation":"contains",}"searchValue":null,"skip":0,"take":10,"userData":{},"filter":[["res_valid_till",">=","2025-03-03T21:00:00.000Z"],"and",["res_end_date","=",null]]}}
