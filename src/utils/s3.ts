import * as z from "zod";
import { getEnvConfig } from "./env.js";

export type S3Config = {
    endPoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;

    defaultBucketName?: string;
}

export const schema = z.object({
    endPoint: z.string().min(1),
    port: z.coerce.number().min(1).max(65535),
    useSSL: z.coerce.boolean(),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
    region: z.string(),
    defaultBucketName: z.optional(z.string())
})

export const getS3EnvConfig = <D extends Partial<S3Config>>(
    prefix: string, 
    additionalPrefix?: string, 
    defaultConfig?: D
) => getEnvConfig(schema, prefix, additionalPrefix, defaultConfig);
