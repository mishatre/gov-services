import path from 'node:path/posix'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import Fuse from 'fuse.js'
import iconv from 'iconv-lite'
import * as Minio from 'minio'
import { action, lifecycle, method, service, started, stopped } from 'moldecor'
import { type Context, Errors, Service } from 'moleculer'
import CronMixin from 'moleculer-cron'
import DbService from 'moleculer-db'
import SqlAdapter from 'moleculer-db-adapter-sequelize'
import Papa from 'papaparse'
import Sequelize from 'sequelize'
import { fetch } from 'undici'
import Unzip from 'unzip-stream'

import TasksMixin, { type Task, task, withTask } from '../mixins/tasks-mixin.js'
import { fromReverseShortDate, fromShortDate } from '../utils/date.js'
import { defineSettings, toFirstUpperCase } from '../utils/index.js'
import { getS3EnvConfig } from '../utils/s3.js'

export type SyncParams = {
    force?: boolean
    skipFetch?: boolean
}

export type SearchParams = {
    search: string
    pageSize: number
}

export type ListAncestorsParams = {
    code: string
}

export type SyncResponse = {
    started: boolean
}

export type TNVEDRecord = {
    level: number
    code: string
    parentCode: string
    normalizedCode: string
    order: number
    startDate: Date
    endDate: Date
    name: string
    description: string
    itemsCount: number
    updateDate: Date
}

const model = {
    level: Sequelize.INTEGER,
    code: Sequelize.STRING,
    parentCode: Sequelize.STRING,
    normalizedCode: Sequelize.STRING,
    order: Sequelize.INTEGER,
    startDate: Sequelize.DATE,
    endDate: Sequelize.DATE,
    name: Sequelize.STRING,
    description: Sequelize.STRING,
    itemsCount: Sequelize.INTEGER,
    updateDate: Sequelize.DATE,
}

type This = TnvedService & DbService & typeof CronMixin & TasksMixin

const settings = defineSettings({
    dataUrl: 'https://data.nalog.ru/files/tnved/tnved.ZIP',
    s3: getS3EnvConfig('S3', 'TNVED', {
        defaultBucketName: 'tnved',
    }),
})

@service({
    name: 'tnved',

    metadata: {
        $description: `Сервис работы с Товарной номенклатурой внешнеэкономической деятельности (ТНВЭД)`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings,

    mixins: [DbService, CronMixin, TasksMixin],
    adapter: new SqlAdapter({
        dialect: 'sqlite',
        storage: './.data/tnved.sqlite',
        logging: false,
    }),

    model: {
        name: 'tnved',
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
export default class TnvedService extends Service<typeof settings> {
    private declare adapter: SqlAdapter & { db: Sequelize.Sequelize }
    private declare s3Client: Minio.Client
    private declare fuse: Fuse<TNVEDRecord>

    /*
     *  Jobs
     */

    // @job('0 0 9 * * *') // Every day at 09:00
    // public async jobSync(this: WithMixins) {

    //     if (this.hasRunningTask("sync")) {
    //         this.logger.info('Sync is already in progress. Skipping cron-job');
    //         return;
    //     }

    //     this.logger.info('Start sync data job');
    //     const task = withTask(this.sync());
    //     await task?.promise;
    // }

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
        const pendingTask = withTask(this.sync(ctx.params.force, ctx.params.skipFetch))
        return {
            started: !!pendingTask && pendingTask.running,
        }
    }

    @action({
        name: 'search',
        params: {
            search: 'string|trim',
            pageSize: 'number|default:100',
        },
    })
    public search(this: This, ctx: Context<SearchParams>) {
        const { search, pageSize } = ctx.params
        const normalizedQuery = search.replace(/\s+/g, '')

        if (!this.fuse) {
            this.logger.warn(`Fuse.js wasn't initialized!`)
            return {
                rows: [],
            }
        }

        const result = this.fuse
            .search(search, {
                limit: pageSize,
            })
            .filter((res) => res.score && res.score < 0.8)

        const exactResult = result.filter((res) => {
            return normalizedQuery.includes(res.item.code.replace(/\s+/g, ''))
        })

        return {
            rows: (exactResult.length > 0 ? exactResult : result).map((v) => v.item),
        }
    }

    @action({
        name: 'listAncestors',
        params: {
            code: 'string',
        },
    })
    public async listAncestors(this: This, ctx: Context<ListAncestorsParams>) {
        const { code } = ctx.params

        const items = []

        let current = code
        while (current) {
            // Fetch item with the given code
            const res = await this.actions.list({
                page: 1,
                pageSize: 1,
                query: { code: current },
            })

            const item = res.rows?.[0]
            if (!item) {
                break // Stop if not found
            }

            if (current !== code) {
                items.push(item)
            }
            current = item.parentCode // Move up
        }

        return {
            rows: items,
        }
    }

    /*
     *  Methods
     */

    @task()
    @method
    private async sync(this: This, force?: boolean, skipFetch?: boolean) {
        const task = this.getCurrentTask()

        if (skipFetch === true) {
            this.logger.warn('Fetching skipped')
        } else {
            try {
                const pendingTask = withTask(this.fetchData())
                if (!pendingTask) {
                    return
                }
                const result = await pendingTask.promise
                if (result === false) {
                    this.logger.warn('Fetching data failed!')
                    return
                }
            } catch (error) {
                this.logger.error('Error during data fetch', error)
                return
            }
        }

        try {
            const pendingTask = withTask(this.processData())
            if (!pendingTask) {
                return
            }
            await pendingTask.promise
        } catch (error) {
            this.logger.error('Error during data processing', error)
            return
        }

        task?.setProgress('Sync finished')

        return {
            success: true,
        }
    }

    @task()
    @method
    private async fetchData(this: This) {
        this.logger.info('Fetching data')

        const task = this.getCurrentTask()

        const res = await fetch(this.settings.dataUrl, {
            signal: task?.signal,
        })

        if (!res.ok || !res.body) {
            return false
        }

        const contentLength = Number(res.headers.get('content-length'))
        let downloaded = 0

        // Transform stream that counts bytes
        const progressStream = new Transform({
            transform: (chunk, encoding, callback) => {
                downloaded += chunk.length
                if (contentLength) {
                    const percent = ((downloaded / contentLength) * 100).toFixed(2)
                    task?.setProgress(`Fetching: ${percent}%`)
                } else {
                    task?.setProgress(`Fetching: ${downloaded} bytes`)
                }
                callback(null, chunk)
            },
        })

        const stream = Readable.from(res.body).pipe(progressStream)

        await this.s3Client.putObject(
            this.settings.s3.defaultBucketName,
            `tnved.zip`,
            stream,
            contentLength,
        )

        return true
    }

    @task()
    @method
    private async processData(this: This) {
        this.logger.info('Processing data')

        const task = this.getCurrentTask() as Task<ReturnType<typeof this.processData>>

        const objectName = 'tnved.zip'

        await this.adapter.clear()

        task?.setProgress(`Fething object - '${objectName}'`)

        const stream = await this.s3Client.getObject(this.settings.s3.defaultBucketName, objectName)

        const unzipStream = Unzip.Parse()
        stream.pipe(unzipStream)

        const files = [
            {
                file: 'TNVED1.TXT',
                type: 'Разделы',
                level: 1,
                structure: 'section|name|description|startDate|endDate'.split('|'),
            },
            {
                file: 'TNVED2.TXT',
                type: 'Группы',
                level: 2,
                structure: 'section|group|name|description|startDate|endDate'.split('|'),
            },
            {
                file: 'TNVED3.TXT',
                type: 'Товарные позиции',
                level: 3,
                structure: 'group|position|name|startDate|endDate'.split('|'),
            },
            {
                file: 'TNVED4.TXT',
                type: 'Товарные подпозиции',
                level: 4,
                structure: 'group|position|subposition|name|startDate|endDate'.split('|'),
            },
        ]

        const currentDate = new Date()

        const fileItems = []
        for await (const entry of unzipStream as AsyncIterable<Unzip.Entry>) {
            const filename = path.basename(entry.path)
            const fileInfo = files.find((v) => v.file.toLowerCase() === filename.toLowerCase())
            if (!fileInfo) {
                entry.autodrain()
                continue
            }

            const parser = Papa.parse(Papa.NODE_STREAM_INPUT, {
                header: false,
                delimiter: '|',
                fastMode: true,
            })

            let header:
                | {
                      versionNumber: number
                      versionDate: Date
                  }
                | undefined
            const items: TNVEDRecord[] = []

            await pipeline(
                entry,
                iconv.decodeStream('CP866'),
                parser,
                // output,
                async (stream) => {
                    for await (const chunk of stream) {
                        if (!header) {
                            header = {
                                versionNumber: Number(chunk[0]),
                                versionDate: fromReverseShortDate(chunk[1]),
                            }
                            continue
                        }
                        const record: Record<string, any> = {
                            type: fileInfo.type,
                            level: fileInfo.level,
                            code: '',
                            parentCode: '',
                            itemsCount: 0,
                            updateDate: header.versionDate,
                        }
                        for (const key in chunk as number[]) {
                            const value = String(chunk[key]).trim()
                            const itemKey = fileInfo.structure[key]
                            if (itemKey) {
                                if (['startDate', 'endDate'].includes(itemKey)) {
                                    record[itemKey] =
                                        value === '' ? undefined : fromShortDate(value)
                                } else {
                                    record[itemKey] = value
                                }
                            }
                        }
                        if (record.name === 'FIFA2018') {
                            continue
                        }
                        if (!!record.endDate && record.endDate < currentDate) {
                            continue
                        }
                        items.push(this.adaptRecord(record))
                    }
                },
            )
            fileItems.push(items)
        }

        for (let i = fileItems.length - 2; i >= 0; i--) {
            const items = fileItems[i]
            for (const item of items) {
                item.itemsCount = fileItems[item.level]
                    .filter(({ parentCode }) => parentCode === item.code)
                    .reduce((a, b) => a + 1 + b.itemsCount, 0)
            }
        }

        for (const items of fileItems) {
            await this.insertInTransation(items)
        }

        await this.clearCache()

        await this.initFuzzySearch()

        this.logger.info('Data processed')
    }

    @method
    private adaptRecord(this: This, record: Record<string, any>): TNVEDRecord {
        switch (record.level) {
            case 1: {
                record.code = `Раздел${record.section}`
                record.order = Number(record.section) * 10_000_000
                break
            }
            case 2: {
                record.parentCode = `Раздел${record.section}`
                record.code = record.group
                record.order = Number(`${record.group}00`) * 10_000_000
                break
            }
            case 3: {
                record.parentCode = record.group
                record.code = `${record.group}${record.position}`
                record.order = Number(record.code) * 10_000_000
                record.name = `${toFirstUpperCase(record.name)}:`
                break
            }
            case 4: {
                record.parentCode = `${record.group}${record.position}`
                const codeParts = [`${record.group}${record.position}`]
                codeParts.push(record.subposition.slice(0, 2))
                codeParts.push(record.subposition.slice(2, 5))
                codeParts.push(record.subposition.slice(5, 6))
                record.code = codeParts.join(' ')
                record.order = Number(codeParts.join('')) * 10

                break
            }
        }
        record.normalizedCode = record.code.replaceAll(' ', '')

        return record as unknown as TNVEDRecord
    }

    @method
    private async insertInTransation(this: This, items: TNVEDRecord[]) {
        await this.adapter.db.transaction(async (transaction) => {
            await this.adapter.insertMany(items, {
                transaction,
                validate: false,
                individualHooks: false,
                ignoreDuplicates: false,
            })
        })
    }

    @method
    private async initFuzzySearch(this: This) {
        const data = await this.actions.find()
        if (data.length === 0) {
            return
        }

        // Initialize Fuse
        this.fuse = new Fuse(data, {
            keys: [
                { name: 'normalizedCode', weight: 0.3 },
                { name: 'name', weight: 0.3 },
                { name: 'description', weight: 0.2 },
            ],
            includeScore: true,
            threshold: 0.4, // Adjust to be more or less fuzzy
            ignoreLocation: true,
            minMatchCharLength: 3,
            findAllMatches: false,
        })
    }

    @method
    private async initS3(this: This) {
        this.s3Client = new Minio.Client(this.settings.s3)

        const bucketExists = await this.s3Client.bucketExists(this.settings.s3.defaultBucketName)
        if (!bucketExists) {
            await this.s3Client.makeBucket(this.settings.s3.defaultBucketName)
        }
    }

    /*
     *  Lifecycle methods
     */

    @lifecycle
    public async afterConnected(this: This) {
        await this.adapter.db.query('PRAGMA journal_mode=WAL;')
        await this.initFuzzySearch()
    }

    @started
    public async started(this: This) {
        await this.initS3()
    }

    @stopped
    public async stopped() {}
}
