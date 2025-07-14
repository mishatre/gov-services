import * as z from "zod";

function getEnv(name: string, prefix: string, additionalPrefix?: string) {
    const keys = [[prefix, name].join('_')];
    if (additionalPrefix) {
        keys.push([additionalPrefix, prefix, name].join('_'));
    }
    for (const key of keys) {
        if (key in process.env && process.env[key] !== '') {
            return process.env[key];
        }
    }
    return undefined;
}

function toSnakeCase(str: string) {
    if (typeof str !== 'string') {
        return str;
    }

    return str
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')      // handle camelCase → snake_case
        .replace(/[\s\-]+/g, '_')                    // spaces and hyphens → underscore
        .replace(/[^a-zA-Z0-9_]/g, '')               // remove non-word characters
        .toLowerCase();

}

export function getEnvConfig<
    S extends z.ZodObject,
    D extends Partial<z.infer<S>>,
>(
    schema: S, 
    prefix: string, 
    additionalPrefix?: string, 
    defaultConfig?: D
): Omit<z.infer<S>, keyof D> & { [K in keyof D]-?: NonNullable<D[K]> } { // WithDefaults<z.infer<S>, D> {
    const data: Partial<Record<keyof z.infer<S>, any>> = {};
    const keys = [...(new Set([...Object.keys(schema.shape), ...Object.keys(defaultConfig || {})]))];
    for (const key of keys as Array<keyof z.infer<S>>) {
        data[key] = getEnv(toSnakeCase(String(key)).toUpperCase(), prefix, additionalPrefix) ?? defaultConfig?.[key]
    }
    return schema.parse(data) as any;
}