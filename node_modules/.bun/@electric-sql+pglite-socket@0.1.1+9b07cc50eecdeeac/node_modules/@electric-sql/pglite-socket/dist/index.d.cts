import { PGlite } from '@electric-sql/pglite';
import { Socket } from 'net';

declare const CONNECTION_QUEUE_TIMEOUT = 60000;
/**
 * Global query queue manager
 * Ensures only one query executes at a time in PGlite
 */
declare class QueryQueueManager {
    private queue;
    private processing;
    private db;
    private debug;
    private lastHandlerId;
    constructor(db: PGlite, debug?: boolean);
    private log;
    enqueue(handlerId: number, message: Uint8Array, onData: (data: Uint8Array) => void): Promise<number>;
    private processQueue;
    getQueueLength(): number;
    clearQueueForHandler(handlerId: number): void;
    clearTransactionIfNeeded(handlerId: number): Promise<void>;
}
/**
 * Options for creating a PGLiteSocketHandler
 */
interface PGLiteSocketHandlerOptions {
    /** The query queue manager */
    queryQueue: QueryQueueManager;
    /** Whether to close the socket when detached (default: false) */
    closeOnDetach?: boolean;
    /** Print the incoming and outgoing data to the console in hex and ascii */
    inspect?: boolean;
    /** Enable debug logging of method calls */
    debug?: boolean;
    /** Idle timeout in ms (0 to disable, default: 0) */
    idleTimeout?: number;
}
/**
 * Handler for a single socket connection to PGlite
 * Each connection can remain open and send multiple queries
 */
declare class PGLiteSocketHandler extends EventTarget {
    private queryQueue;
    private socket;
    private active;
    private closeOnDetach;
    private inspect;
    private debug;
    private readonly id;
    private messageBuffer;
    private idleTimer?;
    private idleTimeout;
    private lastActivityTime;
    private static nextHandlerId;
    constructor(options: PGLiteSocketHandlerOptions);
    get handlerId(): number;
    private log;
    attach(socket: Socket): Promise<PGLiteSocketHandler>;
    private resetIdleTimer;
    detach(close?: boolean): Promise<PGLiteSocketHandler>;
    get isAttached(): boolean;
    private handleData;
    private handleError;
    private handleClose;
    private inspectData;
}
/**
 * Options for creating a PGLiteSocketServer
 */
interface PGLiteSocketServerOptions {
    /** The PGlite database instance */
    db: PGlite;
    /** The port to listen on (default: 5432) */
    port?: number;
    /** The host to bind to (default: 127.0.0.1) */
    host?: string;
    /** Unix socket path to bind to (default: undefined) */
    path?: string;
    /** Print the incoming and outgoing data to the console in hex and ascii */
    inspect?: boolean;
    /** Enable debug logging of method calls */
    debug?: boolean;
    /** Idle timeout in ms (0 to disable, default: 0) */
    idleTimeout?: number;
    /** Maximum concurrent connections (default: 100) */
    maxConnections?: number;
}
/**
 * PGLite Socket Server with support for multiple concurrent connections
 * Connections remain open and queries are queued at the query level
 */
declare class PGLiteSocketServer extends EventTarget {
    readonly db: PGlite;
    private server;
    private port?;
    private host?;
    private path?;
    private active;
    private inspect;
    private debug;
    private idleTimeout;
    private maxConnections;
    private handlers;
    private queryQueue;
    constructor(options: PGLiteSocketServerOptions);
    private log;
    start(): Promise<void>;
    getServerConn(): string;
    stop(): Promise<void>;
    private handleConnection;
    getStats(): {
        activeConnections: number;
        queuedQueries: number;
        maxConnections: number;
    };
}

export { CONNECTION_QUEUE_TIMEOUT, PGLiteSocketHandler, type PGLiteSocketHandlerOptions, PGLiteSocketServer, type PGLiteSocketServerOptions };
