/** Check only the methods used by this plugin; extra host APIs are welcome. */
export declare function assertHostMethods(plugin: string, host: unknown, methods: readonly string[]): void;
/** Optional contributions must not take down the host or the plugin's other features. */
export declare function hostMethodsAvailable(plugin: string, host: unknown, methods: readonly string[]): boolean;
