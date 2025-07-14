import { action, lifecycle, method, service } from 'moldecor';
import { Context, Errors, Service } from 'moleculer';
import DbService from 'moleculer-db';
import SqlAdapter from 'moleculer-db-adapter-sequelize';
import Sequelize from 'sequelize';

import { NotFoundError, TokenNotFoundError } from '../errors.js';
import { defineSettings } from '../utils/index.js';

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

type This = ElactEruzService & DbService;

const settings = defineSettings({});

@service({
    name: 'elact-eruz',

    metadata: {
        $description: `Сервис работы с токен-ключами электронного актирования в ЕИС`,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings,

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
export default class ElactEruzService extends Service<typeof settings> {
    declare private adapter: SqlAdapter & { db: Sequelize.Sequelize };

    /*
     *  Actions
     */

    @action({
        name: 'createRecord',
        params: {
            regNum: 'string|numeric|length:8',
            inn: 'string|numeric|min:10|max:12',
            token: 'uuid',
        },
    })
    public async createRecord(
        this: This,
        ctx: Context<CreateRecordParams>,
    ): Promise<CreateRecordResponse> {
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
    public async removeRecord(
        this: This,
        ctx: Context<RemoveRecordParams>,
    ): Promise<RemoveRecordResponse> {
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
    public async getToken(this: This, ctx: Context<GetTokenParams>): Promise<GetTokenResponse> {
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
    public async getINN(this: This, ctx: Context<GetINNParams>): Promise<GetINNResponse> {
        const foundRecord = await this.getRecord(ctx, ctx.params.regNum);
        if (!foundRecord) {
            throw new NotFoundError();
        }
        return foundRecord.inn;
    }

    /*
     *  Methods
     */

    @method
    private async getRecord(
        this: This,
        ctx: Context,
        regNum: string,
    ): Promise<dbTable | undefined> {
        try {
            return await this._get(ctx, { id: regNum });
        } catch (_) {}
        return undefined;
    }

    /*
     *  Lifecycle methods
     */

    @lifecycle
    entityCreated(this: This, json: dbTable, ctx: Context) {
        ctx.emit(
            'elact-eruz.created',
            { regNum: json.regNum, inn: json.inn },
            { group: 'elact-eruz' },
        );
    }

    @lifecycle
    entityRemoved(this: This, json: dbTable, ctx: Context) {
        ctx.emit(
            'elact-eruz.removed',
            { regNum: json.regNum, inn: json.inn },
            { group: 'elact-eruz' },
        );
    }
}
