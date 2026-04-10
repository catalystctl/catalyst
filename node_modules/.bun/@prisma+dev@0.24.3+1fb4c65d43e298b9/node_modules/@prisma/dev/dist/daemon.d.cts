import { ReadonlyServer } from './index.cjs';
import { E as ExperimentalStreams } from './state-DTMxyzXf.cjs';
import './db.cjs';
import '@electric-sql/pglite';
import './runtime-assets.cjs';
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
