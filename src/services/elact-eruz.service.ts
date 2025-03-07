import { action, created, lifecycle, method, service, started } from 'moldecor';
import { Context, Errors, Service as MoleculerService, ServiceSettingSchema } from 'moleculer';
import DbService from 'moleculer-db';
import SqlAdapter from 'moleculer-db-adapter-sequelize';
import Sequelize from 'sequelize';

import { NotFoundError, TokenNotFoundError } from '../errors.js';

interface Settings {}

export interface CreateRecordParams {
    regNum: string;
    inn: string;
    token: string;
    skipValidation: boolean;
}

export interface RemoveRecordParams {
    regNum: string;
}

export interface GetTokenParams {
    regNum: string;
}

export interface GetINNParams {
    regNum: string;
}

export interface CreateRecordParams {
    regNum: string;
    inn: string;
    token: string;
    skipValidation: boolean;
}

export interface CreateRecordParams {
    regNum: string;
    inn: string;
    token: string;
    skipValidation: boolean;
}

export interface CreateRecordResponse {
    regNum: string;
}

export interface RemoveRecordResponse {
    regNum: string;
}
export type GetTokenResponse = string;
export type GetINNResponse = string;

interface dbTable {
    regNum: string;
    inn: string;
    token: string;
    enabled: boolean;
}

@service({
    name: 'elact-eruz',

    metadata: {
        $description: `Сервис работы с токен-ключами электронного актирования в ЕИС`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings: {},

    mixins: [DbService],
    adapter: new SqlAdapter({
        dialect: 'sqlite',
        storage: './.data/elact-eruz.sqlite',
        logging: false,
    }),
    model: {
        name: 'records',
        define: {
            regNum: {
                type: Sequelize.STRING(8),
                autoIncrement: false,
                primaryKey: true,
            },
            inn: Sequelize.STRING(12),
            token: Sequelize.UUID,
            disabled: Sequelize.BOOLEAN,
        },
        options: {
            // Options from http://docs.sequelizejs.com/manual/tutorial/models-definition.html
        },
    },
    // Disable all moleculer-db actions
    actions: {
        find: false,
        count: false,
        list: false,
        create: false,
        insert: false,
        get: false,
        update: false,
        remove: false,
    },
})
export default class ElactEruzService extends MoleculerService<Settings> {
    private adapter!: SqlAdapter;

    @action({
        name: 'createRecord',
        params: {
            regNum: 'string|numeric|length:8',
            inn: 'string|numeric|min:10|max:12',
            token: 'uuid',
        },
    })
    public async createRecord(ctx: Context<CreateRecordParams>): Promise<CreateRecordResponse> {
        const { regNum, inn, token, skipValidation } = ctx.params;

        const foundRecord = await this.getRecord(ctx, regNum);
        if (!!foundRecord) {
            throw new Errors.MoleculerClientError(
                `Record with regNum '${ctx.params.regNum}' already exists`,
                409,
                'ERR_ALREADY_EXISTS',
            );
        }

        await this._create(ctx, {
            regNum,
            inn,
            token,
            disabled: false,
        });

        return {
            regNum,
        };
    }

    @action({
        name: 'removeRecord',
        params: {
            regNum: 'string|numeric|length:8',
        },
    })
    public async removeRecord(ctx: Context<RemoveRecordParams>): Promise<RemoveRecordResponse> {
        await this._remove(ctx, { id: ctx.params.regNum });
        return {
            regNum: ctx.params.regNum,
        };
    }

    @action({
        name: 'getToken',
        params: {
            regNum: 'string|numeric|length:8',
        },
        cache: {
            enabled: true,
        },
    })
    public async getToken(ctx: Context<GetTokenParams>): Promise<GetTokenResponse> {
        const foundRecord = await this.getRecord(ctx, ctx.params.regNum);
        if (!foundRecord) {
            throw new TokenNotFoundError();
        }
        return foundRecord.token;
    }

    @action({
        name: 'getINN',
        params: {
            regNum: 'string|numeric|length:8',
        },
    })
    public async getINN(ctx: Context<GetINNParams>): Promise<GetINNResponse> {
        const foundRecord = await this.getRecord(ctx, ctx.params.regNum);
        if (!foundRecord) {
            throw new NotFoundError();
        }
        return foundRecord.inn;
    }

    @method
    private async getRecord(ctx: Context, regNum: string): Promise<dbTable | undefined> {
        try {
            return await this._get(ctx, { id: regNum });
        } catch (_) {}
        return undefined;
    }

    @lifecycle
    entityCreated(json: dbTable, ctx: Context) {
        ctx.emit(
            'elact-eruz.created',
            { regNum: json.regNum, inn: json.inn },
            { group: 'elact-eruz' },
        );
    }

    @lifecycle
    entityRemoved(json: dbTable, ctx: Context) {
        ctx.emit(
            'elact-eruz.removed',
            { regNum: json.regNum, inn: json.inn },
            { group: 'elact-eruz' },
        );
    }

    @started
    protected async started() {}

    @created
    protected created() {}
}
