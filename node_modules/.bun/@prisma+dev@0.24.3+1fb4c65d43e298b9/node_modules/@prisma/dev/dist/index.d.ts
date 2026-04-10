import { a as Exports, E as ExperimentalStreams, S as ServerOptions } from './state-DTMxyzXf.js';
export { b as ServerAlreadyRunningError } from './state-DTMxyzXf.js';
import { WalEvent, DBServerPurpose } from './db.js';
export { CopiedPrismaDevRuntimeAsset, PrismaDevRuntimeAsset, copyPrismaDevRuntimeAssets, getPrismaDevRuntimeAssetManifest } from './runtime-assets.js';
import 'valibot';
import '@electric-sql/pglite';

/**
 * A readonly batch of WAL events emitted together.
 *
 * @experimental This API may change without notice.
 */
type ExperimentalWalEventBatch = readonly WalEvent[];
/**
 * Callback invoked when a batch of WAL events is available.
 *
 * @experimental This API may change without notice.
 */
type ExperimentalWalEventCallback = (events: ExperimentalWalEventBatch) => void;
/**
 * The experimental public WAL event API returned from `startPrismaDevServer()`.
 *
 * @experimental This API may change without notice.
 */
interface ExperimentalWalEvents {
    /**
     * Subscribe to WAL event batches. The returned function unsubscribes the callback.
     */
    subscribe(callback: ExperimentalWalEventCallback): () => void;
    /**
     * Create an async iterator that yields WAL event batches as they arrive.
     */
    stream(): AsyncIterableIterator<ExperimentalWalEventBatch>;
}
/**
 * Experimental capabilities exposed on the public programmatic server.
 *
 * @experimental This API may change without notice.
 */
interface ExperimentalServerFeatures {
    readonly streams: ExperimentalStreams;
    readonly wal: ExperimentalWalEvents;
}
interface ProgrammaticServer extends Exports {
    close(): Promise<void>;
    /**
     * Experimental capabilities that may change without notice.
     *
     * @experimental
     */
    experimental: ExperimentalServerFeatures;
    name: string;
}

declare const DEFAULT_DATABASE_PORT = 51214;
declare const DEFAULT_SERVER_PORT = 51213;
declare const DEFAULT_SHADOW_DATABASE_PORT = 51215;
type PortAssignableService = DBServerPurpose | "server";
declare class PortNotAvailableError extends Error {
    readonly port: number;
    name: string;
    constructor(port: number);
}

type ReadonlyServer = Omit<ProgrammaticServer, "close">;
/**
 * Starts a `prisma dev` server instance programmatically.
 *
 * DO NOT USE IN PRODUCTION. This is only intended for development and testing purposes.
 *
 * The returned server also includes experimental capabilities under `server.experimental`,
 * including WAL event subscriptions at `server.experimental.wal` and the
 * colocated Prisma Streams endpoint metadata at `server.experimental.streams`.
 */
declare function startPrismaDevServer(options?: ServerOptions): Promise<ProgrammaticServer>;
/**
 * @deprecated use {@link startPrismaDevServer} instead.
 */
declare function unstable_startServer(options?: ServerOptions): Promise<ProgrammaticServer>;

export { DEFAULT_DATABASE_PORT, DEFAULT_SERVER_PORT, DEFAULT_SHADOW_DATABASE_PORT, type ExperimentalServerFeatures, ExperimentalStreams, WalEvent as ExperimentalWalEvent, type ExperimentalWalEventBatch, type ExperimentalWalEvents, type PortAssignableService, PortNotAvailableError, type ReadonlyServer, type ProgrammaticServer as Server, ServerOptions, startPrismaDevServer, unstable_startServer };
