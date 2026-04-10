import { ReadonlyServer } from './index.js';
import { E as ExperimentalStreams } from './state-DTMxyzXf.js';
import './db.js';
import '@electric-sql/pglite';
import './runtime-assets.js';
import 'valibot';

type DaemonServer = Omit<ReadonlyServer, "experimental"> & {
    experimental?: {
        streams?: ExperimentalStreams;
    };
};
interface DaemonMessageStarted {
    type: "started";
    server: DaemonServer;
}
interface DaemonMessageError {
    type: "error";
    error: string;
}
type DaemonMessage = DaemonMessageStarted | DaemonMessageError;

export type { DaemonMessage, DaemonMessageError, DaemonMessageStarted };
