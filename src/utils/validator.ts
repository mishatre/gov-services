import { type Context, type GenericObject, Validator } from 'moleculer'
import type * as z from 'zod'

export class ZodValidator extends Validator {
    private fallback = new Validator()

    compile(schema: z.ZodObject) {
        if ('parse' in schema) {
            return (params: GenericObject, { meta }: { meta: Context }) =>
                this.validate(params, schema, meta)
        }
        return this.fallback.compile(schema)
    }

    validate(params: GenericObject, schema: z.ZodObject, ctx?: Context) {
        if ('parse' in schema) {
            if (!ctx) {
                throw new Error('Context is not provided')
            }
            ctx.params = schema.parse(params)
            return true
        }
        return this.fallback.validate(params, schema)
    }
}
