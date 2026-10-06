#!/usr/bin/env node
/**
 * Peak-throughput benchmark (capacity measurement).
 *
 * bench.mjs (zero-dep fetch loops) is the functional harness: correct
 * percentiles per scenario, but a single client process saturates around
 * ~8-9k rps and even N processes contend with the server for CPU. Measuring
 * server capacity needs a load generator that spends far less CPU per request
 * and can pipeline requests on one connection.
 *
 * This wrapper drives autocannon (devDependency, benchmark-only — never
 * shipped in the panel image). Each client runs as its own process (clients
 * sharing one event loop halve each other's capacity), and their throughput
 * is summed. Latency figures from pipelined runs include pipeline queueing,
 * so treat them as throughput-mode numbers; use bench.mjs (or sequential
 * curl) for latency-focused measurement.
 *
 * Usage:
 *   node scripts/benchmark/peak.mjs --url http://127.0.0.1:3123 \
 *     --path /api/settings/locale [--clients 2] [--connections 50] \
 *     [--pipelining 50] [--duration 20] [--cookie <session cookie>] \
 *     [--header 'X: y'] [--out results.json]
 *
 * Benchmark-server recipe (fair mode disables rate limiting; never in prod):
 *   PORT=3123 NODE_ENV=development BENCHMARK_FAIR=1 LOG_LEVEL=warn \
 *     REQUEST_LOGGING=false WORKERS=12 DB_POOL_MAX=8 node dist/start.js
 * Multi-worker pool sizing: workers × DB_POOL_MAX < Postgres max_connections.
 */

import { writeFileSync, readFileSync, mkdirSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
function getArg(name, def = undefined) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return def;
  const val = args[idx + 1];
  if (val === undefined || val.startsWith("--")) return def;
  return val;
}

const url = getArg("url", "http://127.0.0.1:3123");
const path = getArg("path", "/api/settings/locale");
const clients = Math.max(1, parseInt(getArg("clients", "2"), 10) || 2);
const connections = Math.max(1, parseInt(getArg("connections", "50"), 10) || 50);
const pipelining = Math.max(1, parseInt(getArg("pipelining", "50"), 10) || 50);
const duration = Math.max(1, parseInt(getArg("duration", "20"), 10) || 20);
const out = getArg("out");

const headers = {};
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === "--header" && args[i + 1].includes(":")) {
    const sep = args[i + 1].indexOf(":");
    headers[args[i + 1].slice(0, sep).trim()] = args[i + 1].slice(sep + 1).trim();
  }
}
const cookie = getArg("cookie");
if (cookie) headers["Cookie"] = cookie;

const target = url.replace(/\/$/, "") + path;
console.log(
  `[peak] ${clients} client process(es) × ${connections} connections × pipelining ${pipelining} → ${target} (${duration}s)`,
);

const childScript = resolve(dirname(fileURLToPath(import.meta.url)), "peak-child.mjs");
const tmpFiles = [];
const children = [];
for (let i = 0; i < clients; i++) {
  const tmpOut = resolve(dirname(fileURLToPath(import.meta.url)), `../../.peak-child-${process.pid}-${i}.json`);
  tmpFiles.push(tmpOut);
  children.push(
    new Promise((res, rej) => {
      const child = spawn(
        process.execPath,
        [
          childScript,
          JSON.stringify({ target, connections, pipelining, duration, headers }),
          tmpOut,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) =>
        code === 0 ? res(tmpOut) : rej(new Error(`peak client ${i} exited ${code}: ${stderr.slice(0, 1000)}`)),
      );
    }),
  );
}

const files = await Promise.all(children);
const rows = files.map((f) => JSON.parse(readFileSync(f, "utf8")));

const totals = rows.reduce(
  (acc, r) => {
    acc.rps += r.rps;
    acc.non2xx += r.non2xx;
    acc.errors += r.errors;
    acc.completed += r.completed;
    acc.bytesPerSec += r.bytesPerSec;
    return acc;
  },
  { rps: 0, non2xx: 0, errors: 0, completed: 0, bytesPerSec: 0 },
);

// Latency per client is reported as-is (pipelined latency includes queueing);
// the summary shows the max across clients, which is the conservative read.
const maxLatency = rows.reduce((acc, r) => {
  for (const [k, v] of Object.entries(r.latency ?? {})) {
    if (typeof v === "number") acc[k] = Math.max(acc[k] ?? 0, v);
  }
  return acc;
}, {});

const summary = {
  meta: {
    target,
    timestamp: new Date().toISOString(),
    node: process.version,
    clients,
    connections,
    pipelining,
    duration,
  },
  rps: Math.round(totals.rps),
  completed: totals.completed,
  errors: totals.errors,
  non2xx: totals.non2xx,
  bytesPerSec: Math.round(totals.bytesPerSec),
  latencyMs: maxLatency,
  perClient: rows,
};

console.log(
  `[peak] rps=${summary.rps} errors=${summary.errors} non2xx=${summary.non2xx} latency(p50/max across clients)=${summary.latencyMs.p50}ms`,
);

if (out) {
  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(resolve(out), JSON.stringify(summary, null, 2));
  console.log(`[peak] wrote ${out}`);
}
for (const f of tmpFiles) {
  try {
    unlinkSync(f);
  } catch {}
}
