export type DurableStreamsLocalExports = {
    http: {
        url: string;
        port: number;
    };
    sqlite: {
        path: string;
    };
    name: string;
    pid: number;
};
export type DurableStreamsLocalServer = {
    exports: DurableStreamsLocalExports;
    close(): Promise<void>;
};
export declare function startLocalDurableStreamsServer(opts?: {
    name?: string;
    port?: number;
    hostname?: string;
}): Promise<DurableStreamsLocalServer>;
