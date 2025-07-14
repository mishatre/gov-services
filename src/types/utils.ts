

export type ServiceSettingsSchema<T extends object = {}> = {
    $noVersionPrefix?: boolean;
    $noServiceNamePrefix?: boolean;
    $dependencyTimeout?: number;
    $shutdownTimeout?: number;
    $secureSettings?: string[];
} & T;