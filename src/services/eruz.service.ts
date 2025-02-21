import { Low } from 'lowdb';
import { JSONFilePreset } from 'lowdb/node';
import { action, created, event, service, started } from 'moldecor';
import { Context, Service as MoleculerService, ServiceSettingSchema } from 'moleculer';
import assert from 'node:assert';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { LkpGetParticipantInfoResponse } from '../types.js';

interface Settings extends ServiceSettingSchema {
    database: {
        filename: string;
    };
}

export type EruzClientInfo = LkpGetParticipantInfoResponse['participantInfo'];

type RegNum = Database['regNums'][0];
interface Database {
    regNums: string[];
    tokens: Record<RegNum, { token: string }>;
    info: Record<RegNum, EruzClientInfo>;
    inns: Record<RegNum, string>;
}

export type GetRecordsResponse = Array<{
    regNum: string;
    token: string;
}>;

@service({
    name: 'eruz',
    settings: {
        database: {
            filename: 'eruz.json',
        },
    },
})
export default class EruzService extends MoleculerService<Settings> {
    private db!: Low<Database>;

    @action({
        name: 'createRecord',
        params: {
            regNum: 'string|numeric|length:8',
            token: 'uuid',
        },
    })
    public async createRecord(ctx: Context<{ regNum: string; token: string }>) {
        assert(this.db !== undefined, 'Database was not initialized');

        if (this.db.data.regNums.indexOf(ctx.params.regNum) !== -1) {
            throw new Error(`Record with regNum '${ctx.params.regNum}' already exists`);
        }

        await this.db.update((data) => {
            data.regNums.push(ctx.params.regNum);
            data.tokens[ctx.params.regNum] = { token: ctx.params.token };
        });

        ctx.emit(
            'eruz.newRecord',
            { regNum: ctx.params.regNum, token: ctx.params.token },
            { group: 'eruz' },
        );
    }

    @action({
        name: 'deleteRecord',
        params: {
            regNum: 'string|numeric|length:8',
        },
    })
    public async deleteRecord(ctx: Context<{ regNum: string }>) {
        assert(this.db !== undefined, 'Database was not initialized');
        await this.db.update((data) => {
            data.regNums = data.regNums.filter((regNum) => regNum !== ctx.params.regNum);
            delete data.tokens[ctx.params.regNum];
        });
    }

    @action({
        name: 'getToken',
        params: {
            regNum: 'string|numeric|length:8',
        },
    })
    public async getToken(ctx: Context<{ regNum: string }>) {
        assert(this.db !== undefined, 'Database was not initialized');
        const { token } = this.db.data.tokens[ctx.params.regNum];
        if (token) {
            return token;
        }
        return undefined;
    }

    @action({
        name: 'getINN',
        params: {
            regNum: 'string|numeric|length:8',
        },
    })
    public async getINN(ctx: Context<{ regNum: string }>) {
        assert(this.db !== undefined, 'Database was not initialized');
        const inn = this.db.data.inns[ctx.params.regNum];
        if (inn) {
            return inn;
        }
        return undefined;
    }

    @action({
        name: 'getRecordInfo',
        params: {
            regNum: 'string|numeric|length:8',
        },
    })
    public async getRecordInfo(ctx: Context<{ regNum: string }>) {
        assert(this.db !== undefined, 'Database was not initialized');

        const info = this.db.data.info[ctx.params.regNum];
        if (info) {
            return info;
        }
        return null;
    }

    @action({
        name: 'getRecords',
    })
    public getRecords(ctx: Context): GetRecordsResponse {
        assert(this.db !== undefined, 'Database was not initialized');
        const records = [];
        for (const [key, value] of Object.entries(this.db.data.tokens)) {
            records.push({ regNum: key, token: value.token });
        }
        return records;
    }

    @event({
        name: 'eruz#participantInfo',
        group: 'eruz',
        params: {
            info: 'object',
        },
        context: true,
    })
    protected async handleParticipantInfo(
        ctx: Context<{ info: LkpGetParticipantInfoResponse['participantInfo'] }>,
    ) {
        await this.db.update((data) => {
            data.info[ctx.params.info.regNum] = ctx.params.info;
        });
    }

    @started
    protected async started() {
        this.db = await JSONFilePreset<Database>(this.metadata['database-catalog'], {
            regNums: [],
            tokens: {},
            info: {},
            inns: {},
        });
    }

    @created
    protected created() {
        const catalog = process.env.DATABASE_CATALOG ?? path.join(process.cwd(), 'database');
        mkdirSync(catalog, { recursive: true });
        this.metadata['database-catalog'] = path.join(catalog, this.settings.database.filename);
    }
}
