
import { ServiceSchema } from "moleculer";
import assert from "node:assert";

interface JobSchema {
    name?: string;
    cron: string;
    manual?: boolean;
    timezone?: string;
    // hooks?: {
    //     before?: string,
    //     beforeStart?: string;
    //     after?: string
    // }
}

export function job<
    P extends JobSchema | string,
    S,
    T extends (...args: any[]) => any,
>(params: P) {
    return function (handler: T, context: ClassMethodDecoratorContext<S, T>) {
        assert(
            context.kind === 'method',
            'Action decorator can be used only as class method decorator',
        );

        const metadata = context.metadata as Partial<ServiceSchema>;
        Object.assign(metadata, {
            settings: {
                ...(metadata.settings || {}),
                cronJobs: []
            }
        });

        const name = typeof params === 'string' || !params.name ? String(context.name) : params.name;
        const cron = typeof params === 'string' ? params : params.cron;
        metadata.settings!.cronJobs.push({
            name,
            cronTime: cron,
            onTick: handler,
            // onInitialize: function () {
            //     if (params.hooks?.before) {
            //         this[params.hooks.before]?.();
            //     }
            // },
            // onComplete: function() {
            //     if (params.hooks?.after) {
            //         this[params.hooks.after]?.();
            //     }
            // }
        })
    };
}