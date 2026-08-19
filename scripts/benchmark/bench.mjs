#!/usr/bin/env node
/**
 * Catalyst vs Pterodactyl benchmark runner
 * Zero-dep, Node 20+ (uses global fetch + perf_hooks).
 * Runs concurrent fetch loops for duration, collects latency histogram + status codes.
 *
 * Usage:
 *   node bench.mjs --url http://10.0.3.20:3000 --token <jwt> --scenario api-list --duration 30 --connections 50
 *   node bench.mjs --url http://10.0.3.30 --token <ptla> --accept "application/vnd.pterodactyl.v1+json" --path /api/application/servers
 *   node bench.mjs --config scenarios.json --url <base> --token <jwt> --out results.json
 */

import { performance } from "node:perf_hooks";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const args = process.argv.slice(2);
function getArg(name, def = undefined) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return def;
  const val = args[idx + 1];
  if (val === undefined || val.startsWith("--")) return def;
  return val;
}
function getAllArgs(name) {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === `--${name}` && args[i + 1] && !args[i + 1].startsWith("--")) out.push(args[i + 1]);
  return out;
}
function hasFlag(name) {
  return args.includes(`--${name}`);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function stats(latencies) {
  if (latencies.length === 0) return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, p999: 0, stddev: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = latencies.reduce((a, b) => a + b, 0);
  const mean = sum / latencies.length;
  const variance = latencies.reduce((a, b) => a + (b - mean) ** 2, 0) / latencies.length;
  return {
    count: latencies.length,
    mean: +mean.toFixed(2),
    min: +sorted[0].toFixed(2),
    max: +sorted[sorted.length - 1].toFixed(2),
    p50: +percentile(sorted, 50).toFixed(2),
    p75: +percentile(sorted, 75).toFixed(2),
    p90: +percentile(sorted, 90).toFixed(2),
    p95: +percentile(sorted, 95).toFixed(2),
    p99: +percentile(sorted, 99).toFixed(2),
    p999: +percentile(sorted, 99.9).toFixed(2),
    stddev: +Math.sqrt(variance).toFixed(2),
  };
}

export function substitutePath(path, vars) {
  let out = path;
  for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`:${k}`, v).replaceAll(`{${k}}`, v);
  return out;
}

/**
 * Run a single HTTP benchmark scenario.
 * opts: { url, method, path, headers, body, connections, duration, warmup, name }
 */
export async function runHttpBenchmark(opts) {
  const { url, method = "GET", path = "/", headers = {}, body = undefined, connections = 10, duration = 10, warmup = 2, name = path } = opts;
  const target = url.replace(/\/$/, "") + path;
  const latencies = [];
  const statusCodes = {};
  let completed = 0;
  let errors = 0;
  let bytes = 0;

  if (warmup > 0) {
    const warmEnd = performance.now() + warmup * 1000;
    const warmPromises = Array.from({ length: Math.min(connections, 5) }, async () => {
      while (performance.now() < warmEnd) {
        try {
          const r = await fetch(target, { method, headers, body });
          await r.arrayBuffer().catch(() => {});
        } catch {}
      }
    });
    await Promise.all(warmPromises);
  }

  const start = performance.now();
  const end = start + duration * 1000;

  async function worker() {
    while (performance.now() < end) {
      const t0 = performance.now();
      try {
        const res = await fetch(target, { method, headers, body });
        const buf = await res.arrayBuffer().catch(() => new ArrayBuffer(0));
        const t1 = performance.now();
        latencies.push(t1 - t0);
        completed++;
        bytes += buf.byteLength;
        const code = String(res.status);
        statusCodes[code] = (statusCodes[code] || 0) + 1;
        if (res.status >= 400) errors++;
      } catch (e) {
        const t1 = performance.now();
        latencies.push(t1 - t0);
        completed++;
        errors++;
        statusCodes["ERR"] = (statusCodes["ERR"] || 0) + 1;
      }
    }
  }

  const workers = Array.from({ length: connections }, () => worker());
  await Promise.all(workers);

  const elapsed = (performance.now() - start) / 1000;
  const s = stats(latencies);
  return {
    name,
    target,
    method,
    connections,
    duration: +elapsed.toFixed(2),
    completed,
    errors,
    errorRate: completed ? +(errors / completed * 100).toFixed(2) : 0,
    rps: +(completed / elapsed).toFixed(2),
    bytesPerSec: elapsed ? Math.round(bytes / elapsed) : 0,
    statusCodes,
    latency: s,
  };
}

export async function timedOp(name, fn, iterations = 1) {
  const latencies = [];
  let errors = 0;
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    try {
      await fn(i);
      latencies.push(performance.now() - t0);
    } catch {
      errors++;
      latencies.push(performance.now() - t0);
    }
  }
  const s = stats(latencies);
  return {
    name,
    iterations,
    errors,
    errorRate: iterations ? +(errors / iterations * 100).toFixed(2) : 0,
    latency: s,
    totalMs: +latencies.reduce((a, b) => a + b, 0).toFixed(2),
  };
}

// CLI
const isMain = process.argv[1] && (process.argv[1].endsWith("bench.mjs") || import.meta.url === `file://${process.argv[1]}`);
if (isMain) {
  const url = getArg("url");
  const token = getArg("token");
  const scenario = getArg("scenario");
  const out = getArg("out");
  const conn = parseInt(getArg("connections", "10"), 10);
  const dur = parseInt(getArg("duration", "10"), 10);
  const warm = parseInt(getArg("warmup", "2"), 10);
  const accept = getArg("accept", "application/json");
  const paperId = getArg("paper-id", "");
  const pteroId = getArg("ptero-id", "");
  const pteroUuid = getArg("ptero-uuid", "");
  const nestId = getArg("nest-id", "");
  const help = hasFlag("help") || hasFlag("h");

  if (help || (!url && !hasFlag("compare"))) {
    console.log(`
bench.mjs — Catalyst benchmark runner

  node bench.mjs --url <base> --token <jwt> [opts]
  node bench.mjs --config scenarios.json --url <base> --token <jwt> --out results.json
  node bench.mjs --compare a.json b.json --out comparison.md

Options:
  --url <base>          Base URL (e.g. http://10.0.3.20:3000)
  --token <jwt>         Bearer token (or Pterodactyl app key)
  --scenario <id>       Scenario id from scenarios.json (or raw path if no config)
  --path <path>         Raw path when not using scenarios.json
  --method <verb>       HTTP method (default GET)
  --connections <n>     Concurrency (default 10)
  --duration <s>        Duration seconds (default 10)
  --warmup <s>          Warmup seconds (default 2)
  --accept <mime>       Accept header (default application/json, ptero: application/vnd.pterodactyl.v1+json)
  --paper-id <id>       Substitute :paperId / :paper-id
  --ptero-id <id>       Substitute :pteroId
  --ptero-uuid <uuid>   Substitute :pteroUuid
  --nest-id <id>        Substitute :nestId
  --config <file>       Scenarios config (default scripts/benchmark/scenarios.json)
  --out <file>          Write JSON results
  --compare <a> <b>     Compare two result JSON files (stub, use compare.mjs for full report)
  --help
`);
    process.exit(help ? 0 : 1);
  }

  if (hasFlag("compare")) {
    const aPath = getArg("compare");
    const bPath = args[args.indexOf("--compare") + 2] && !args[args.indexOf("--compare") + 2].startsWith("--") ? args[args.indexOf("--compare") + 2] : null;
    const a = aPath && existsSync(aPath) ? JSON.parse(readFileSync(aPath, "utf8")) : null;
    const maybeB = bPath && existsSync(bPath) ? JSON.parse(readFileSync(bPath, "utf8")) : null;
    if (!a || !maybeB) {
      console.error("compare requires two existing JSON files: --compare a.json b.json");
      process.exit(1);
    }
    console.log(`# Benchmark comparison\n\n| Scenario | A rps | B rps | Δ | A p95 | B p95 | Δ |`);
    console.log(`|---|---|---|---|---|---|---|`);
    process.exit(0);
  }

  const configPath = resolve(getArg("config", resolve(__dirname, "scenarios.json")));
  let scenarios = [];
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf8"));
      scenarios = cfg.suites || cfg.scenarios || [];
    } catch {}
  }

  let toRun = [];
  if (scenario && scenarios.length) {
    const s = scenarios.find((x) => x.id === scenario);
    if (!s) {
      console.error(`Scenario '${scenario}' not found in ${configPath}`);
      console.error(`Available: ${scenarios.map((x) => x.id).join(", ")}`);
      process.exit(1);
    }
    toRun = [s];
  } else if (scenario && !scenarios.length) {
    toRun = [{ id: scenario, catalyst: { path: scenario, method: getArg("method", "GET") } }];
  } else if (scenarios.length) {
    toRun = scenarios;
  } else {
    const p = getArg("path", "/api/servers");
    toRun = [{ id: "custom", catalyst: { path: p, method: getArg("method", "GET") } }];
  }

  const vars = { paperId, "paper-id": paperId, pteroId, pteroUuid, nestId, paperId: paperId, pteroId: pteroId };
  // also allow :paperId style without dash alias already handled

  const headers = { Accept: accept };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (accept.includes("json")) headers["Content-Type"] = "application/json";

  const results = [];
  for (const suite of toRun) {
    const spec = suite.catalyst || suite;
    if (!spec || !spec.path) {
      console.log(`→ ${suite.id} SKIP (no catalyst spec)`);
      continue;
    }
    let path = substitutePath(spec.path, vars);
    // skip if still contains unresolved template (missing id)
    if (path.includes(":")) {
      console.log(`→ ${suite.id} SKIP (unresolved template ${path} — missing --paper-id etc.)`);
      continue;
    }
    const method = spec.method || "GET";
    const body = spec.body ? JSON.stringify(spec.body) : undefined;
    const c = spec.connections || conn;
    const d = spec.duration || dur;
    console.log(`→ ${suite.id} ${method} ${path} c=${c} d=${d}s`);
    const r = await runHttpBenchmark({
      name: suite.id,
      url,
      method,
      path,
      headers: { ...headers, ...(spec.headers || {}) },
      body,
      connections: c,
      duration: d,
      warmup: warm,
    });
    console.log(`  rps=${r.rps} p50=${r.latency.p50}ms p95=${r.latency.p95}ms p99=${r.latency.p99}ms err=${r.errorRate}% ${JSON.stringify(r.statusCodes)}`);
    results.push({ suite: suite.id, ...r });
  }

  const outObj = {
    meta: { url, timestamp: new Date().toISOString(), node: process.version, vars },
    results,
  };
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), JSON.stringify(outObj, null, 2));
    console.log(`\nWrote ${out}`);
  } else {
    console.log(JSON.stringify(outObj, null, 2));
  }
}
