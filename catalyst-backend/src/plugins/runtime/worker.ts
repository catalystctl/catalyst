import { parentPort, workerData, isMainThread } from 'worker_threads';
import type { PluginManifest } from '../types';

if (isMainThread) {
  throw new Error('worker.ts should only be run inside a worker thread');
}

interface WorkerCallMessage {
  type: 'call';
  method: string;
  args: any[];
  requestId: string;
}

interface WorkerResultMessage {
  type: 'result';
  requestId: string;
  data?: any;
  error?: string;
}

interface WorkerLogMessage {
  type: 'log';
  level: string;
  args: any[];
}

const { manifest, entryPath } = workerData as {
  manifest: PluginManifest;
  entryPath: string;
};

if (!parentPort) {
  throw new Error('worker.ts requires a parentPort for IPC');
}

let pluginModule: any = null;
let pluginContext: any = null;

function createIsolatedContext(manifest: PluginManifest) {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'manifest') return manifest;
        if (prop === 'logger') {
          return new Proxy(
            {},
            {
              get(_, level) {
                return (...args: any[]) => {
                  parentPort!.postMessage({
                    type: 'log',
                    level,
                    args,
                  } as WorkerLogMessage);
                };
              },
            },
          );
        }
        return (...args: any[]) => {
          const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          return new Promise((resolve, reject) => {
            const handler = (msg: WorkerCallMessage | WorkerResultMessage) => {
              if (msg.type === 'result' && msg.requestId === requestId) {
                parentPort!.removeListener('message', handler);
                if (msg.error) reject(new Error(msg.error));
                else resolve(msg.data);
              }
            };
            parentPort!.on('message', handler);
            parentPort!.postMessage({
              type: 'call',
              method: String(prop),
              args,
              requestId,
            });
            setTimeout(() => {
              parentPort!.removeListener('message', handler);
              reject(new Error(`Plugin method "${String(prop)}" timed out`));
            }, 30000);
          });
        };
      },
    },
  ) as any;
}

async function init() {
  try {
    pluginModule = await import(/* @vite-ignore */ entryPath);
    const plugin = pluginModule.default || pluginModule;
    pluginContext = createIsolatedContext(manifest);

    if (plugin.onLoad) {
      await plugin.onLoad(pluginContext);
    }

    parentPort!.postMessage({ type: 'initialized' });
  } catch (err: any) {
    parentPort!.postMessage({
      type: 'error',
      error: err.message || String(err),
      stack: err.stack,
    });
  }
}

init();
