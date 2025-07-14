import dns from 'dns';
import * as Minio from 'minio';
import { action, lifecycle, method, service, started, stopped } from 'moldecor';
import { Context, Errors, Service } from 'moleculer';
import CronMixin from 'moleculer-cron';
import DbService from 'moleculer-db';
import SqlAdapter from 'moleculer-db-adapter-sequelize';
import { PassThrough, Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import pLimit from 'p-limit';
import Papa from 'papaparse';
import Sequelize from 'sequelize';
import { Agent, fetch } from 'undici';
import Unzip from 'unzip-stream';

import TasksMixin, { Task, task, withTask } from '../mixins/tasks-mixin.js';
import { runConcurrently } from '../utils/concurrency.js';
import { fromShortDate, getStartOfDayUTCInTimezone } from '../utils/date.js';
import { defineSettings } from '../utils/index.js';
import { job } from '../utils/job.js';
import { getS3EnvConfig } from '../utils/s3.js';

export type SyncParams = {
    force?: boolean;
    skipFetch?: boolean;
};

export type CleanStaleWriteoutsParams = {
    force?: boolean;
};

export type GetWriteoutsParams = {
    regNum: number;
    documentDate: Date;
};

export type SyncResponse = {
    started: boolean;
};

export type CleanStaleWriteoutsResponse = {
    started: boolean;
};

export type GetWriteoutsResponse = Promise<
    {
        filename: string;
        url: string;
    }[]
>;

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

const convertKeys = {
    boolean: new Set(['isAI', 'isElectronicProduct']),
    date: new Set([
        'documentDate',
        'documentDateBasis',
        'documentValidUntill',
        'documentValidUntillTpp',
    ]),
    number: new Set(['score', 'percentage']),
};

function convertValue(value: string, key: string) {
    if (convertKeys.boolean.has(key)) {
        if (value === '-') {
            return undefined;
        }
        return value.toLowerCase() !== 'Нет'.toLowerCase();
    } else if (convertKeys.date.has(key)) {
        if (value === '-') {
            return undefined;
        }
        return fromShortDate(value);
    } else if (convertKeys.number.has(key)) {
        if (value === '-') {
            return undefined;
        }
        return parseFloat(value);
    } else if (value === '-') {
        return '';
    }

    return value;
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

const model = {
    organizationName: Sequelize.TEXT,
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
};

type This = GispPP719Service & DbService & typeof CronMixin & TasksMixin;

const settings = defineSettings({
    dataUrl: 'https://gisp.gov.ru/opendata/files/gispdata-current-pp719-products-structure.csv',
    gqlUrl: 'https://gisp.gov.ru/pp719v2/pub/prod/b/',
    s3: getS3EnvConfig('S3', 'GISP_PP719', {
        defaultBucketName: 'gisp-pp719',
    }),
});

@service({
    name: 'gisp-pp719',

    metadata: {
        $description: `Сервис работы с ГИСП - Реестр российской промышленной продукции (ПП РФ 719 от 17.07.2015)`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings,

    mixins: [DbService, CronMixin, TasksMixin],
    adapter: new SqlAdapter({
        dialect: 'sqlite',
        storage: './.data/gisp-pp719.sqlite',
        logging: false,
    }),

    model: {
        name: 'pp719s',
        define: model,
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
export default class GispPP719Service extends Service<typeof settings> {
    declare private adapter: SqlAdapter & { db: Sequelize.Sequelize };
    declare private s3Client: Minio.Client;

    /*
     *  Jobs
     */

    @job('0 0 9 * * *') // Every day at 09:00
    public async jobSync(this: This) {
        if (this.hasRunningTask('sync')) {
            this.logger.info('Sync is already in progress. Skipping cron-job');
            return;
        }

        this.logger.info('Start sync data job');
        const task = withTask(this.sync());
        await task?.promise;
    }

    @job('0 30 8 * * *') // Each day at 08:30
    public async jobCleanStaleWriteouts(this: This) {
        this.logger.info('Start cleaning stale writeouts job');
        const task = withTask(this.cleanStaleWriteouts());
        await task?.promise;
    }

    /*
     *  Actions
     */

    @action({
        name: 'sync',
        params: {
            force: 'boolean|optional',
            skipFetch: 'boolean|optional',
        },
    })
    public actionSync(this: This, ctx: Context<SyncParams>): SyncResponse {
        const pendingTask = withTask(this.sync(ctx.params.force, ctx.params.skipFetch));
        return {
            started: !!pendingTask && pendingTask.running,
        };
    }

    @action({
        name: 'cleanStaleWriteouts',
        params: {
            force: 'boolean|optional',
        },
    })
    public actionCleanStaleWriteouts(
        this: This,
        ctx: Context<CleanStaleWriteoutsParams>,
    ): CleanStaleWriteoutsResponse {
        const pendingTask = withTask(this.cleanStaleWriteouts(ctx.params.force));
        return {
            started: !!pendingTask,
        };
    }

    @action({
        name: 'getWriteouts',
        params: {
            regNum: 'string|trim',
            documentDate: 'date|convert',
        },
        circuitBreaker: {
            enabled: true,
            threshold: 2,
        },
    })
    public async getWriteouts(this: This, ctx: Context<GetWriteoutsParams>): GetWriteoutsResponse {
        const items = (await this.adapter.find({
            query: {
                registerNumber: ctx.params.regNum,
                documentDate: ctx.params.documentDate,
            },
        })) as PP719Record[];

        if (items.length === 0) {
            throw new Errors.MoleculerError('Not found', 404, 'NOT_FOUND');
        }

        const productsInfo = await this.getActualProductsInfo(items[0].registerNumber);

        const result: { filename: string; url: string }[] = [];

        await runConcurrently(items, 10, async (item) => {
            const productInfo = productsInfo.find((v) => {
                const date1 = new Date(v.res_date);
                date1.setHours(0, 0, 0, 0);
                const date2 = item.documentDate;
                date2.setHours(0, 0, 0, 0);
                return date1.getTime() === date2.getTime();
            });

            if (!productInfo) {
                throw new Errors.MoleculerError('Not found', 404, 'NOT_FOUND');
            }

            const objectName = `writeout/${item.registerNumber}_${item.documentDate.getTime()}.pdf`;
            const objectInfo = await this.getWriteoutFileStat(objectName);
            if (objectInfo) {
                const currentDate = new Date();
                currentDate.setHours(0, 0, 0);

                if (objectInfo.validUntill > currentDate) {
                    return result.push({
                        filename: objectInfo.filename,
                        url: await this.generateWriteoutUrl(objectName, objectInfo.filename),
                    });
                }

                await this.s3Client.removeObject(this.settings.s3.defaultBucketName, objectName);
            }

            try {
                const res = await fetch(productInfo.product_writeout_url, {
                    method: 'GET',
                    dispatcher: agent,
                });

                if (!res.ok) {
                    throw new Errors.MoleculerError(res.statusText, res.status);
                }

                if (!res.body) {
                    throw new Errors.MoleculerError('Empty body', 500, 'EMPTY_BODY');
                }

                const stream = Readable.from(res.body, { emitClose: false });

                const unzipStream = Unzip.Parse();
                stream.pipe(unzipStream);

                let filename;

                for await (const entry of unzipStream as AsyncIterable<Unzip.Entry>) {
                    if (!entry.path.endsWith('pdf')) {
                        entry.autodrain();
                        continue;
                    }
                    await this.s3Client.putObject(
                        this.settings.s3.defaultBucketName,
                        objectName,
                        entry,
                        entry.size,
                        {
                            url: productInfo.product_writeout_url,
                            filename: encodeURIComponent(entry.path),
                            validuntill: fromShortDate(productInfo.res_valid_till),
                        },
                    );
                    filename = entry.path;
                }

                if (!filename) {
                    throw new Error(
                        `No PDF file found in archive from ${productInfo.product_writeout_url}`,
                    );
                }

                const url = await this.generateWriteoutUrl(objectName, filename);

                result.push({
                    filename: filename!,
                    url,
                });
            } catch (error) {
                throw error;
            }
        });

        return result;
    }

    /*
     *  Methods
     */

    @method
    private async getActualProductsInfo(this: This, regNum: string) {
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

        let data = undefined;

        try {
            const res = await fetch(this.settings.gqlUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                dispatcher: agent,
            });

            if (!res.ok) {
                throw new Errors.MoleculerError(res.statusText, res.status);
            }

            data = (await res.json()) as GQLResponse;
        } catch (error) {
            throw error;
        }

        if (!data || !data.ok) {
            throw new Errors.MoleculerError('Not found', 404, 'NOT_FOUND');
        }

        return data.items;
    }

    @method
    private async getWriteoutFileStat(this: This, objectName: string) {
        try {
            const statInfo = await this.s3Client.statObject(
                this.settings.s3.defaultBucketName,
                objectName,
            );
            const filename = decodeURIComponent(statInfo.metaData.filename);

            return {
                filename,
                validUntill: new Date(statInfo.metaData.validuntill),
            };
        } catch (error) {
            if (error instanceof Minio.S3Error) {
                if (error.code === 'NotFound') {
                    return undefined;
                }
            }
            throw error;
        }
    }

    @task()
    @method
    private async sync(this: This, force?: boolean, skipFetch?: boolean) {
        const task = this.getCurrentTask();

        const isStale = await this.isDataStale();
        if (!isStale && !force) {
            task?.setProgress('Sync skipped - data not stale');
            return {
                success: false,
                reason: 'not_stale',
            };
        }

        if (skipFetch === true) {
            this.logger.warn('Fetching skipped');
        } else {
            try {
                const pendingTask = withTask(this.fetchData());
                if (!pendingTask) {
                    return;
                }
                const result = await pendingTask.promise;
                if (result === false) {
                    this.logger.warn('Fetching data failed!');
                    return;
                }
            } catch (error) {
                this.logger.error('Error during data fetch', error);
                return;
            }
        }

        try {
            const pendingTask = withTask(this.processData());
            if (!pendingTask) {
                return;
            }
            await pendingTask.promise;
        } catch (error) {
            this.logger.error('Error during data processing', error);
            return;
        }

        task?.setProgress('Sync finished');

        return {
            success: true,
        };
    }

    @task()
    @method
    private async fetchData(this: This) {
        this.logger.info('Fetching data');

        const task = this.getCurrentTask();

        const res = await fetch(this.settings.dataUrl, {
            dispatcher: agent,
            signal: task?.signal,
        });

        if (!res.ok || !res.body) {
            return false;
        }

        const contentLength = Number(res.headers.get('content-length'));
        let downloaded = 0;

        // Transform stream that counts bytes
        const progressStream = new Transform({
            transform: (chunk, encoding, callback) => {
                downloaded += chunk.length;
                if (contentLength) {
                    const percent = ((downloaded / contentLength) * 100).toFixed(2);
                    task?.setProgress(`Fetching: ${percent}%`);
                } else {
                    task?.setProgress(`Fetching: ${downloaded} bytes`);
                }
                callback(null, chunk);
            },
        });

        // const stream = createReadStream('/Users/mt/Downloads/gispdata-current-pp719-products-structure.csv');
        const stream = Readable.from(res.body).pipe(progressStream);

        await this.s3Client.putObject(
            this.settings.s3.defaultBucketName,
            `gispdata-current-pp719-products-structure.csv`,
            stream,
            contentLength,
        );

        return true;
    }

    @task()
    @method
    private async processData(this: This) {
        this.logger.info('Processing data');

        const task = this.getCurrentTask() as Task<ReturnType<typeof this.processData>>;

        const objectName = 'gispdata-current-pp719-products-structure.csv';

        await this.adapter.clear();

        task?.setProgress(`Fething object - '${objectName}'`);

        const stream = await this.s3Client.getObject(
            this.settings.s3.defaultBucketName,
            objectName,
        );
        // const stream = createReadStream("/Users/mt/Downloads/gispdata-current-pp719-products-structure (1).csv");

        const BATCH_INSERT_LIMIT = 1000;
        const parser = Papa.parse(Papa.NODE_STREAM_INPUT, { header: true });

        const writeLimit = pLimit(3);
        let counter = 0;
        const pendingWrites: Promise<any>[] = [];

        const fn = async (stream: AsyncIterable<PP719RawRecord>) => {
            const items: PP719Record[] = [];
            for await (const value of stream) {
                if (task?.signal.aborted) {
                    // Don't and insert any more rows in db
                    return;
                }
                items.push(this.adaptRecord(value));
                if (items.length >= BATCH_INSERT_LIMIT) {
                    const batch = items.slice();
                    pendingWrites.push(
                        writeLimit(async () => {
                            await this.insertInTransation(batch);
                            counter += batch.length;
                            task?.setProgress(`Processing record - ${counter}/...`);
                        }),
                    );
                    items.length = 0;
                }
            }
            if (items.length > 0) {
                const batch = items.slice();
                pendingWrites.push(
                    writeLimit(async () => {
                        await this.insertInTransation(batch);
                        counter += batch.length;
                        task?.setProgress(`Processing record - ${counter}/...`);
                    }),
                );
                items.length = 0;
            }
        };

        await pipeline(
            stream,
            parser,
            // Should have more than 1 chunk of data
            new PassThrough({ objectMode: true, highWaterMark: 128 }),
            fn,
        );

        if (task?.signal.aborted) {
        }

        await Promise.all(pendingWrites);
    }

    @method
    private async isDataStale(this: This) {
        const updateDate = await this.getLastUpdateDate();
        if (!updateDate) {
            return true;
        }

        updateDate.setUTCHours(24, 0, 0, 0);

        return new Date() > updateDate;
    }

    @method
    private async getLastUpdateDate(this: This) {
        const res = (await this.adapter.findOne({
            searchFields: ['createdAt'],
            sort: ['createdAt'],
        })) as { createdAt: Date };
        if (!res) {
            return undefined;
        }
        return res.createdAt;
    }

    @task()
    @method
    private async cleanStaleWriteouts(this: This, force?: boolean) {
        let counter = 0;
        const list = await this.s3Client.listObjectsV2(
            this.settings.s3.defaultBucketName,
            'writeout/',
            false,
        );

        const items: string[] = [];
        for await (const item of list) {
            if (!item.name) {
                continue;
            }
            items.push(item.name);
        }

        await runConcurrently(items, 10, async (objectName) => {
            const objectInfo = await this.getWriteoutFileStat(objectName);
            if (!objectInfo) {
                return;
            }
            const currentDate = new Date();
            currentDate.setHours(0, 0, 0);

            if (objectInfo.validUntill <= currentDate || force === true) {
                await this.s3Client.removeObject(this.settings.s3.defaultBucketName, objectName);
                counter++;
            }
        });
        this.logger.debug(`Removed ${counter} stored stale writeouts`);
    }

    @method
    private async generateWriteoutUrl(this: This, objectName: string, filename: string) {
        return this.s3Client.presignedGetObject(
            this.settings.s3.defaultBucketName,
            objectName,
            60 * 60,
            {
                'response-content-type': 'application/pdf',
                'response-content-disposition': `inline; filename="${encodeURIComponent(filename!)}"`,
            },
        );
    }

    @method
    private adaptRecord(this: This, value: PP719RawRecord) {
        const keysToDelete: string[] = [];

        let key: keyof typeof value;
        for (key in value) {
            const newKey = convertMap[key];
            if (newKey) {
                (value as any)[newKey] = convertValue(value[key], newKey); // Assign to new key
            } else {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            delete (value as any)[key];
        }

        return value as unknown as PP719Record;
    }

    @method
    private async insertInTransation(this: This, items: PP719Record[]) {
        await this.adapter.db.transaction(async (transaction) => {
            await this.adapter.insertMany(items, {
                transaction,
                validate: false,
                individualHooks: false,
                ignoreDuplicates: false,
            });
        });
    }

    @method
    private async initS3(this: This) {
        this.s3Client = new Minio.Client(this.settings.s3);

        const bucketExists = await this.s3Client.bucketExists(this.settings.s3.defaultBucketName);
        if (!bucketExists) {
            await this.s3Client.makeBucket(this.settings.s3.defaultBucketName);
        }
    }

    /*
     *  Lifecycle methods
     */

    @lifecycle
    public async afterConnected(this: This) {
        await this.adapter.db.query('PRAGMA journal_mode=WAL;');
    }

    @started
    public async started(this: This) {
        await this.initS3();
    }
}
