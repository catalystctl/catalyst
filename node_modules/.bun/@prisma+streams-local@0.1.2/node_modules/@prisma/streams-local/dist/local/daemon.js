import {
  parseLocalProcessOptions,
  startLocalDurableStreamsServer
} from "./index-vsvg9063.js";

// src/local/process.ts
async function runLocalServerProcess(opts, cfg) {
  const server = await startLocalDurableStreamsServer(opts);
  cfg.onReady(server.exports);
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown)
      return;
    shuttingDown = true;
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => {
    shutdown();
  });
  process.on("SIGINT", () => {
    shutdown();
  });
  if (cfg.closeOnDisconnect) {
    process.on("disconnect", () => {
      shutdown();
    });
  }
}

// src/local/daemon.ts
var opts = parseLocalProcessOptions(process.argv.slice(2), {
  allowPositionalName: true,
  defaultNameWhenMissing: "default",
  defaultHostnameWhenMissing: "127.0.0.1",
  defaultPortWhenMissing: 0
});
await runLocalServerProcess({
  name: opts.name,
  hostname: opts.hostname,
  port: opts.port
}, {
  onReady: (exportsPayload) => {
    if (typeof process.send === "function") {
      process.send({ type: "ready", exports: exportsPayload });
    } else {
      console.log(JSON.stringify(exportsPayload));
    }
  },
  closeOnDisconnect: true
});
