import cluster from 'cluster';
import os from 'os';

export function bootstrapCluster(mainFn: () => Promise<void>) {
  if (cluster.isPrimary) {
    const workers = Number(process.env.WORKERS) || os.cpus().length;
    for (let i = 0; i < workers; i++) cluster.fork();
    cluster.on('exit', (worker) => {
      console.error(`Worker ${worker.process.pid} died. Restarting...`);
      cluster.fork();
    });
  } else {
    mainFn().catch((err) => {
      console.error(err);
      process.exit(1);
    });
  }
}
