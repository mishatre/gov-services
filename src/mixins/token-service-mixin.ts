import { event, method, service, started } from 'moldecor';
import { Context, Service } from 'moleculer';

import { TokenNotFoundError, TokenNotProvidedError } from '../errors.js';
import { GetTokenParams, GetTokenResponse } from '../services/elact-eruz.service.js';
import { defineSettings } from '../utils/index.js';

const settings = defineSettings({
    tokenService: '',
});

@service({
    name: 'token-service-mixin',
    version: 2,

    metadata: {
        $description: ``,
        $author: 'Mikhail Tregub',
        $official: false,
    },

    settings,
})
export default class TokenServiceMixin extends Service<typeof settings> {
    private useTokenService = false;

    @method
    protected async resolveUserToken(ctx: Context<{ regNum: string }, { token?: string }>) {
        if (ctx.meta.token) {
            ctx.locals.usertoken = ctx.meta.token;
            delete ctx.meta.token;
        } else if (this.useTokenService) {
            const usertoken = await ctx.call<GetTokenResponse, GetTokenParams>(
                `${this.settings.tokenService}.getToken`,
                {
                    regNum: ctx.params.regNum,
                },
            );
            if (!usertoken) {
                throw new TokenNotFoundError();
            }
            ctx.locals.usertoken = usertoken;
        } else {
            throw new TokenNotProvidedError();
        }
    }

    @method
    private setIsTokenServiceAvailable() {
        const currentValue = this.useTokenService;

        const tokenService = this.settings.tokenService.toLowerCase();
        if (!tokenService) {
            this.useTokenService = false;
        } else {
            const list = this.broker.registry.getServiceList({
                skipInternal: true,
                onlyAvailable: true,
            });
            this.useTokenService =
                list.find((v) => v.name.toLowerCase() === tokenService) !== undefined;
        }
        if (currentValue !== this.useTokenService) {
            this.logger.debug(`useTokenService: ${currentValue} -> ${this.useTokenService}`);
        }
    }

    /*
     *  Events
     */

    @event({
        name: '$services.changed',
        context: true,
    })
    protected onServiceChanged(_: Context<any>) {
        this.setIsTokenServiceAvailable();
    }

    @event({
        name: '$node.disconnected',
        context: true,
    })
    protected onNodeDisconnected(ctx: Context<{ unexpected: boolean }>) {
        if (ctx.params.unexpected) {
            this.setIsTokenServiceAvailable();
        }
    }

    /*
     *  Lifecycle methods
     */

    @started
    public async started() {
        this.setIsTokenServiceAvailable();
    }
}
