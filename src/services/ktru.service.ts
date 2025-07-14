import { XMLParser } from 'fast-xml-parser';
import * as Minio from 'minio';
import { action, lifecycle, method, service, started } from 'moldecor';
import { Context, Service } from 'moleculer';
import CronMixin from 'moleculer-cron';
import DbService from 'moleculer-db';
import SqlAdapter from 'moleculer-db-adapter-sequelize';
import path from 'node:path/posix';
import { Readable } from 'node:stream';
import pLimit from 'p-limit';
import Sequelize from 'sequelize';
import Unzip from 'unzip-stream';

import TasksMixin, { task, withTask } from '../mixins/tasks-mixin.js';
import { FzTypes, NSIKinds } from '../types/eis-docs.js';
import { runConcurrently } from '../utils/concurrency.js';
import { defineSettings } from '../utils/index.js';
import { job } from '../utils/job.js';
import { getS3EnvConfig } from '../utils/s3.js';
import { GetNsiRequestParams, GetNsiResponse } from './eis-docs.service.js';

export type SyncParams = {
    type?: NSIKinds;
    force?: boolean;
};
export type FetchDataParams = {
    type?: NSIKinds;
    force?: boolean;
};
export type ProcessDataParams = {};

export type SyncResponse = {
    started: boolean;
};
export type FetchDataResponse = {
    started: boolean;
};
export type ProcessDataResponse = {
    started: boolean;
};

enum KTRUTypes {
    Actual = 'actual',
    NotActual = 'not-actual',
}

type KTRUFilenameStructure = {
    code: string;
    type: string;
    index: string;
    format: string;
} & (
    | {
          kind: NSIKinds.all;
          date: Date;
      }
    | {
          kind: NSIKinds.inc;
          startDate: Date;
          endDate: Date;
      }
);

interface KTRUPosition {
    data: {
        code: string;
        versionCode?: string;
        version?: string;
        inclusionDate?: string;
        publishDate?: string;
        updateDate?: string;
        name?: string;
        OKPD2: {
            code: string;
            name: string;
        };
        status?: string;
        actual?: boolean;
        applicationDateStart?: string;
        applicationDateEnd?: string;
        OKEIs?: any[];
        NSI?: any[];
        characteristics?: any[];
        products?: any[];
        rubricators?: any[];
        attachments?: any[];
        cancelInfo?: {
            cancelDate: string;
            cancelReason: string;
        };
        nsiDescription?: string;
        isTemplate?: boolean;
        parentPositionInfo?: {
            code: string;
            version?: string;
            externalCode?: string;
        };
        externalCode?: string;
        noNewFeatures?: boolean;
        noNewFeaturesReason?: string;
    };
    signData?: any;
    printForm?: any;
}

interface KTRURecord {
    code: string;
    versionCode?: string;
    version?: string;
    inclusionDate?: Date;
    publishDate?: Date;
    updateDate?: Date;
    name?: string;
    OKPD2?: string;
    status?: string;
    actual?: boolean;
    applicationDateStart?: Date;
    applicationDateEnd?: Date;
    nsiDescription?: string;
    isTemplate?: boolean;
    externalCode?: string;
    noNewFeatures?: boolean;
    noNewFeaturesReason?: string;
    raw: any;
}

function splitStringBy(string: string, chunkSizes: number[]) {
    let start = 0;
    return chunkSizes.map((size) => {
        const part = string.slice(start, start + size);
        start += size;
        return part;
    });
}

function formatFilenameStringToDate(value: string) {
    const [year, month, day, hour, minute, second] = splitStringBy(value, [4, 2, 2, 2, 2, 2]).map(
        Number,
    );
    return new Date(year, month - 1, day, hour, minute, second);
}

function parseNsiKTRUFilename(filename: string): KTRUFilenameStructure {
    const [name, format] = filename.split('.');
    const [code, kind, type, startPeriod, ...rest] = name.split('_');

    if (kind === NSIKinds.all) {
        return {
            code,
            kind,
            type,
            date: formatFilenameStringToDate(startPeriod),
            index: rest[0],
            format,
        };
    } else if (kind === NSIKinds.inc) {
        const [endPeriod, index] = rest;
        return {
            code,
            kind,
            type,
            startDate: formatFilenameStringToDate(startPeriod),
            endDate: formatFilenameStringToDate(endPeriod),
            index,
            format,
        };
    }

    throw new Error('Unknown filename type');

    // nsiKTRUNew_all_actual_20250301020002_001.xml
    // nsiKTRUNew_inc_not-actual_20250301040002_20250301060002_001.xml

    // XXX_all_дата-время выгрузки_nnn.xml.zip
    // XXX_inc_начало-периода_конец-периода_nnn.xml.zip
}

async function fetchArchiveFile(url: string, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url);

            if (!response.ok) {
                console.error(`HTTP error: ${response.status} ${response.statusText}`);
                return undefined;
            }

            const contentLength = Number(response.headers.get('content-length') || 0);
            if (contentLength !== 0) {
                // console.log(`File size: ${contentLength ? `${contentLength} bytes` : 'Unknown'}`);
                if (contentLength === 22) {
                    // console.log(`Empty file`);
                    return response.body;
                }
            }

            return response.body;
        } catch (error: any) {
            const message = error?.message || '';
            if (message.includes('fetch failed')) {
                console.warn(`Fetch failed (attempt ${attempt} of ${maxRetries}). Retrying...`);
                if (attempt === maxRetries) {
                    console.error(`Max retries reached. Giving up.`);
                    return undefined;
                }
            } else {
                console.error(`Unexpected network error: ${message}`);
                return undefined;
            }
        }
    }

    return undefined;
}

type This = KTRUService & DbService & typeof CronMixin & TasksMixin;

const settings = defineSettings({
    s3: getS3EnvConfig('S3', 'KTRU', {
        defaultBucketName: 'ktru',
    }),
});

@service({
    name: 'ktru',

    metadata: {
        $description: `Сервис отдачи документов из хранилища документов ЕИС`,
        $author: 'Mikhail Tregub',
    },

    settings,

    mixins: [DbService, CronMixin, TasksMixin],
    adapter: new SqlAdapter({
        dialect: 'sqlite',
        storage: './.data/ktru.sqlite',
        logging: false,
    }),

    model: {
        name: 'ktru',
        define: {
            file: Sequelize.TEXT,
            code: Sequelize.STRING(25),
            versionCode: Sequelize.STRING(27),
            version: Sequelize.INTEGER,
            inclusionDate: Sequelize.DATE,
            publishDate: Sequelize.DATE,
            updateDate: Sequelize.DATE,
            name: Sequelize.TEXT('long'),
            OKPD2: Sequelize.STRING(20),
            status: Sequelize.ENUM('ACTIVE', 'INACTIVE', 'TERMINATED'),
            actual: Sequelize.BOOLEAN,
            applicationDateStart: Sequelize.DATE,
            applicationDateEnd: Sequelize.DATE,
            // OKEIs,
            // NSI,
            // characteristics,
            // products,
            // rubricators,
            // industryClassifier,
            // attachments,
            // cancelInfo,
            nsiDescription: Sequelize.TEXT('long'),
            isTemplate: Sequelize.BOOLEAN,
            // parentPositionInfo,
            externalCode: Sequelize.STRING(40),
            noNewFeatures: Sequelize.BOOLEAN,
            noNewFeaturesReason: Sequelize.TEXT('long'),
            raw: Sequelize.JSON,
        },
        options: {
            // Options from http://docs.sequelizejs.com/manual/tutorial/models-definition.html
            indexes: [
                {
                    fields: ['code', 'version'],
                },
                {
                    fields: ['OKPD2'],
                },
            ],
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
export default class KTRUService extends Service<typeof settings> {
    declare private adapter: SqlAdapter & { db: Sequelize.Sequelize };
    declare private s3Client: Minio.Client;

    /*
     *  Jobs
     */

    @job('0 0 */2 * * *') // Each Sunday at 09:00
    public jobSyncAll(this: This) {
        this.logger.info(`Start syncing KTRU 'all' files`);
        console.log('YOLO');
    }

    @job('0 0 */2 * * *') // Every 2 hours except Sunday
    public jobSyncInc(this: This) {
        this.logger.info(`Start syncing KTRU 'inc' files`);
        console.log('YOLO');
    }

    @job('0 30 8 * * *') // Each Sunday at 02:00
    public async jobCleanStaleData(this: This) {
        this.logger.info('Start cleaning stale data');
        const task = withTask(this.cleanStaleData());
        await task?.promise;
    }

    /*
     *  Actions
     */

    @action({
        name: 'sync',
        params: {
            type: {
                type: 'enum',
                optional: true,
                values: [NSIKinds.all, NSIKinds.inc],
            },
            force: 'boolean|optional',
        },
    })
    public actionSync(this: This, ctx: Context<SyncParams>): SyncResponse {
        const pendingTask = withTask(this.sync(ctx.params.type, ctx.params.force, ctx));
        return {
            started: !!pendingTask && pendingTask.running,
        };
    }

    @action({
        name: 'fetchData',
        params: {
            type: {
                type: 'enum',
                optional: true,
                values: [NSIKinds.all, NSIKinds.inc],
            },
            force: 'boolean|optional',
        },
    })
    public actionFetchData(this: This, ctx: Context<FetchDataParams>): FetchDataResponse {
        const pendingTask = withTask(this.fetchData(ctx.params.type, ctx.params.force, ctx));
        return {
            started: !!pendingTask && pendingTask.running,
        };
    }

    @action({
        name: 'processData',
        params: {},
    })
    public actionProcessData(this: This, ctx: Context<ProcessDataParams>): ProcessDataResponse {
        const pendingTask = withTask(this.processData());
        return {
            started: !!pendingTask && pendingTask.running,
        };
    }

    /*
     *  Methods
     */

    @task()
    @method
    private async sync(this: This, type?: NSIKinds, force?: boolean, ctx?: Context) {}

    @task()
    @method
    private async fetchData(this: This, type?: NSIKinds, force?: boolean, ctx?: Context) {
        const task = this.getCurrentTask();

        this.logger.info(`Start loading KTRU files from EIS`);

        const kinds = type ? [type] : [NSIKinds.all, NSIKinds.inc];

        const existingFilesInStorage = (
            await Promise.all(kinds.map((kind) => this.listStoredFilenames(kind)))
        )
            .flat()
            .map((v) => v.name);
        if (force === true) {
            this.logger.info(`Removing stored KTRU files from s3 storage`);
            task?.setProgress(`Removing stored KTRU files from s3 storage`);
            await this.s3Client.removeObjects(
                this.settings.s3.defaultBucketName,
                existingFilesInStorage,
            );
        }

        const files = (
            await Promise.all(kinds.map((kind) => this.listKTRUFiles(kind, KTRUTypes.Actual, ctx)))
        )
            .flat()
            .filter(({ name, kind }) => !existingFilesInStorage.includes(`${kind}/${name}.zip`));

        if (files.length === 0) {
            this.logger.info('No KTRU files selected to be loaded.');
            task?.setProgress(`No files to load`);
            return;
        }

        this.logger.info(`Selected ${files.length} to load`);

        await runConcurrently(files, 10, async ({ url, name, kind }, index) => {
            task?.setProgress(`Downloading ${index + 1}/${files.length}: ${name}`);
            const stream = await fetchArchiveFile(url);
            if (!stream) {
                this.logger.warn(`Cannot load file - ${name}`);
                return;
            }
            await this.s3Client.putObject(
                this.settings.s3.defaultBucketName,
                `${kind}/${name}.zip`,
                Readable.from(stream),
            );
        });

        task?.setProgress(`Fetching finished`);
    }

    @task()
    @method
    private async processData(this: This) {
        const task = this.getCurrentTask();

        this.logger.info('Removing all KTRU records from db');
        task?.setProgress('Removing all KTRU records from db');
        await this.adapter.clear();

        const parsingFiles = (
            await Promise.all(
                [NSIKinds.all, NSIKinds.inc].map((kind) => this.listStoredFilenames(kind)),
            )
        )
            .flat()
            .filter(({ name, size }) => {
                if (size <= 22 || !name.endsWith('.zip')) {
                    return false;
                }
                // We only need actual KTRUs
                return (
                    parseNsiKTRUFilename(path.basename(name, '.zip')).type !== KTRUTypes.NotActual
                );
            })
            .map((v) => v.name);

        if (parsingFiles.length === 0) {
            this.logger.info('No KTRU files selected to be processed.');
            task?.setProgress(`No files to process`);
            return;
        }

        this.logger.info(`Selected ${parsingFiles.length} to process`);

        const parser = new XMLParser({
            removeNSPrefix: true,
        });

        const writeLimit = pLimit(5);
        const pendingWrites: Promise<any>[] = [];
        await runConcurrently(parsingFiles, 2, async (name, index) => {
            task?.setProgress(`Processing ${index + 1}/${parsingFiles.length}: ${name}`);
            const stream = await this.s3Client.getObject(this.settings.s3.defaultBucketName, name);

            const unzipStream = Unzip.Parse();
            stream.pipe(unzipStream);

            for await (const entry of unzipStream as AsyncIterable<Unzip.Entry>) {
                if (!entry.path.endsWith('xml')) {
                    entry.autodrain();
                    continue;
                }

                const buffer = Buffer.concat(await Array.fromAsync(entry));
                const parsed = parser.parse(buffer);

                const items = (parsed.export.nsiKTRUs.position as KTRUPosition[])
                    .filter(({ data }) => !data.isTemplate)
                    .map(this.adaptRecord);

                pendingWrites.push(writeLimit(() => this.insertInTransation(items)));
            }
        });

        await Promise.all(pendingWrites);
        task?.setProgress(`Processing finished`);
    }

    @method
    private async listKTRUFiles(this: This, kind: NSIKinds, type?: KTRUTypes, ctx?: Context) {
        const response = await (ctx || this.broker).call<GetNsiResponse, GetNsiRequestParams>(
            'eis-docs.getNsi',
            {
                fzType: FzTypes.fz44,
                nsiCode: 'nsiKTRUNew',
                nsiKind: kind,
            },
            { timeout: 120000 },
        );

        const items = response.items.map(({ name, ...rest }) => ({
            ...parseNsiKTRUFilename(name),
            ...rest,
            name,
        }));

        return !type ? items : items.filter((v) => v.type === type);
    }

    @method
    private async listStoredFilenames(this: This, kind: NSIKinds) {
        const listStream = await this.s3Client.listObjectsV2(
            this.settings.s3.defaultBucketName,
            `${kind}/`,
        );
        const objectsList: { name: string; size: number }[] = [];
        for await (const { name, size } of listStream) {
            if (name) {
                objectsList.push({ name, size });
            }
        }
        return objectsList;
    }

    @method
    private adaptRecord(this: This, { data }: KTRUPosition): KTRURecord {
        data.name = String(data.name).replaceAll('&#13;', '');
        if (data.nsiDescription) {
            data.nsiDescription = String(data.nsiDescription).replaceAll('&#13;', '');
        }

        return {
            code: data.code,
            versionCode: data.versionCode,
            version: data.version,
            inclusionDate: data.inclusionDate ? new Date(data.inclusionDate) : undefined,
            publishDate: data.publishDate ? new Date(data.publishDate) : undefined,
            updateDate: data.updateDate ? new Date(data.updateDate) : undefined,
            name: data.name,
            OKPD2: data.OKPD2.code,
            status: data.status,
            actual: data.actual,
            applicationDateStart: data.applicationDateStart
                ? new Date(data.applicationDateStart)
                : undefined,
            applicationDateEnd: data.applicationDateEnd
                ? new Date(data.applicationDateEnd)
                : undefined,
            nsiDescription: data.nsiDescription,
            isTemplate: data.isTemplate,
            externalCode: data.externalCode,
            noNewFeatures: data.noNewFeatures,
            noNewFeaturesReason: data.noNewFeaturesReason,
            raw: data,
        };
    }

    @method
    private async insertInTransation(this: This, items: KTRURecord[]) {
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
    protected async started(this: This) {
        await this.initS3();
    }
}
