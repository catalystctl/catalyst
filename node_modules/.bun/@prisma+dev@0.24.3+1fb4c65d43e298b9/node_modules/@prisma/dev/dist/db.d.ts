import { PGlite } from '@electric-sql/pglite';
import { c as ServerState } from './state-DTMxyzXf.js';
import 'valibot';

interface WalEvent {
    oldRecord: Record<string, unknown> | null;
    record: Record<string, unknown> | null;
    schema: string;
    table: string;
    txid: string;
    type: "delete" | "insert" | "update";
}
interface WalEventBridge {
    close(): Promise<void>;
    poll(): Promise<void>;
    subscribe(callback: WalEventSubscriber): () => void;
}
interface WalEventBridgeOptions {
    database?: string;
    host?: string;
    password?: string;
    port?: number;
    username?: string;
}
type WalEventSubscriber = (events: WalEvent[]) => void;
type PolledMessage = {
    name: string;
    text?: string;
};
declare function attachWalEventBridge(db: PGlite, _options?: WalEventBridgeOptions): Promise<WalEventBridge>;
declare function shouldPollWalAfterMessages(messages: PolledMessage[]): boolean;
declare function shouldPollWalAfterResponse(response: Uint8Array): boolean;

interface DBServer {
    attachWalEventBridge(): Promise<WalEventBridge>;
    close(): Promise<void>;
    readonly connectionLimit: number;
    readonly connectionString: string;
    readonly connectTimeout: number;
    readonly database: string;
    dump(destinationPath: string): Promise<void>;
    readonly maxIdleConnectionLifetime: number;
    readonly password: string;
    readonly poolTimeout: number;
    readonly port: number;
    readonly prismaORMConnectionString: string;
    getPrimaryKeyColumns(schema: string, table: string): Promise<readonly string[]>;
    readonly socketTimeout: number;
    readonly sslMode: string;
    readonly terminalCommand: string;
    readonly username: string;
}
interface DBDump {
    dumpPath: string;
}
type DBServerPurpose = "database" | "shadow_database";
declare function startDBServer(purpose: DBServerPurpose, serverState: ServerState): Promise<DBServer>;
type DumpDBOptions<D extends string> = {
    dataDir: string;
    db?: never;
    debug?: boolean;
    destinationPath?: D;
} | {
    dataDir?: never;
    db: PGlite;
    debug?: boolean;
    destinationPath?: D;
};
declare function dumpDB<D extends string = never>(options: DumpDBOptions<D>): Promise<[D] extends [never] ? string : void>;

export { type DBDump, type DBServer, type DBServerPurpose, type DumpDBOptions, type WalEvent, type WalEventBridge, attachWalEventBridge, dumpDB, shouldPollWalAfterMessages, shouldPollWalAfterResponse, startDBServer };
