#!/usr/bin/env node
/**
 * ops.mjs — operational benchmarks (file, lifecycle, SSE, backups, migration, scale)
 * Uses fetch + raw timing. Designed to run after bench.mjs HTTP suites.
 *
 * Usage:
 *   STATE_FILE=~/.local/share/catalyst-lxc-lab/state.env node ops.mjs --target catalyst --out ops-catalyst.json
 *   STATE_FILE=... node ops.mjs --target pterodactyl --out ops-ptero.json
 *   # or with explicit env:
 *   node ops.mjs --url http://10.0.3.20:3000 --token $JWT --paper-id $ID --out ops.json
 */

import { performance } from "node:perf_hooks";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  if (i === -1) return d;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) return d;
  return v;
};
const hasFlag = (n) => args.includes(`--${n}`);

function percentile(a, p) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const idx = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.max(0, Math.min(idx, s.length - 1))];
}
function stats(latencies) {
  if (!latencies.length) return { count: 0, mean: 0, min: 0, max: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, stddev: 0 };
  const s = [...latencies].sort((a, b) => a - b);
  const mean = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const variance = latencies.reduce((a, b) => a + (b - mean) ** 2, 0) / latencies.length;
  return {
    count: latencies.length,
    mean: +mean.toFixed(2),
    min: +s[0].toFixed(2),
    max: +s[s.length - 1].toFixed(2),
    p50: +percentile(latencies, 50).toFixed(2),
    p75: +percentile(latencies, 75).toFixed(2),
    p90: +percentile(latencies, 90).toFixed(2),
    p95: +percentile(latencies, 95).toFixed(2),
    p99: +percentile(latencies, 99).toFixed(2),
    stddev: +Math.sqrt(variance).toFixed(2),
  };
}

function loadState(stateFile) {
  const out = {};
  if (!stateFile || !existsSync(stateFile)) return out;
  const raw = readFileSync(stateFile, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    // strip quoting from %q
    if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) {
      try { v = JSON.parse(v); } catch { v = v.slice(1, -1); }
    }
    // also handle $'...' from %q
    if (v.startsWith("$'") && v.endsWith("'")) {
      try { v = JSON.parse(`"${v.slice(2, -1).replace(/'/g, "'")}"`); } catch {}
    }
    // fallback: unescape bash $'' via eval-like
    v = v.replace(/^'/, "").replace(/'$/, "").replace(/\\'/g, "'");
    out[m[1]] = v;
  }
  // second pass: source-style eval for %q values (best effort)
  try {
    const txt = readFileSync(stateFile, "utf8");
    // simple: parse AUTH_TOKEN, PAPER_SERVER_ID etc via regex
    for (const k of ["AUTH_TOKEN","PAPER_SERVER_ID","NODE_ID","PTERO_APP_KEY","PTERO_CLIENT_KEY","PTERO_SERVER_ID","PTERO_SERVER_UUID","PTERO_URL","PTERO_NEST_ID","BACKEND_IP","PANEL_IP"]) {
      const mm = txt.match(new RegExp(`^${k}=(.*)$`, "m"));
      if (mm) {
        let vv = mm[1].trim();
        if (!out[k] || out[k] === vv) out[k] = vv.replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {}
  return out;
}

// More robust state loader via bash source
async function loadStateViaBash(stateFile) {
  if (!stateFile || !existsSync(stateFile)) return {};
  const { execSync } = await import("node:child_process");
  try {
    const keys = ["AUTH_TOKEN","PAPER_SERVER_ID","SOTF_SERVER_ID","NODE_ID","LOCATION_ID","PAPER_TEMPLATE_ID","PTERO_APP_KEY","PTERO_CLIENT_KEY","PTERO_SERVER_ID","PTERO_SERVER_UUID","PTERO_NEST_ID","PTERO_EGG_ID","PTERO_URL","BACKEND_IP","PANEL_IP","PTERO_NODE_ID"];
    const out = {};
    for (const k of keys) {
      try {
        const v = execSync(`bash -c 'source "${stateFile}" 2>/dev/null; printf "%s" "\${${k}:-}"'`, { encoding: "utf8" }).trim();
        if (v) out[k] = v;
      } catch {}
    }
    // also try PUBLIC_URL / API_BASE from last run
    try {
      const api = execSync(`bash -c 'source "${stateFile}" 2>/dev/null; printf "%s" "\${API_BASE:-}\${PUBLIC_URL:-}"'`, { encoding: "utf8" }).trim();
      if (api) out["API_BASE"] = api;
    } catch {}
    return out;
  } catch { return {}; }
}

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { res, json, text, ok: res.ok, status: res.status };
}

async function timed(name, fn, iterations = 1) {
  const latencies = [];
  let errors = 0;
  let lastError = null;
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now();
    try {
      await fn(i);
      latencies.push(performance.now() - t0);
    } catch (e) {
      lastError = e;
      errors++;
      latencies.push(performance.now() - t0);
    }
  }
  return {
    name,
    iterations,
    errors,
    errorRate: iterations ? +(errors / iterations * 100).toFixed(2) : 0,
    lastError: lastError ? String(lastError).slice(0, 300) : null,
    latency: stats(latencies),
    totalMs: +latencies.reduce((a, b) => a + b, 0).toFixed(2),
  };
}

// Ops
async function opFileWriteReadback({ base, token, serverId }) {
  if (!serverId) throw new Error("missing serverId");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const path = `/bench-file-${Date.now()}.txt`;
  const content = "bench-write-" + "x".repeat(900);
  return timed("op-file-write-readback", async () => {
    // write
    const w = await fetchJson(`${base}/api/servers/${serverId}/files/write`, {
      method: "POST",
      headers,
      body: JSON.stringify({ path, content }),
    });
    if (!w.ok) throw new Error(`write ${w.status} ${w.text.slice(0,200)}`);
    // list to confirm
    const l = await fetchJson(`${base}/api/servers/${serverId}/files?path=%2F`, { headers });
    if (!l.ok) throw new Error(`list ${l.status}`);
    // download
    const dRes = await fetch(`${base}/api/servers/${serverId}/files/download?path=${encodeURIComponent(path)}`, { headers });
    if (!dRes.ok) throw new Error(`download ${dRes.status}`);
    await dRes.arrayBuffer();
    // cleanup
    await fetch(`${base}/api/servers/${serverId}/files/delete?path=${encodeURIComponent(path)}`, { method: "DELETE", headers }).catch(()=>{});
  }, 12);
}

async function opFileUpload({ base, token, serverId }) {
  if (!serverId) throw new Error("missing serverId");
  const headers = { Authorization: `Bearer ${token}` };
  return timed("op-file-upload-256k", async () => {
    const buf = Buffer.alloc(256 * 1024, "a");
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const form = new FormData();
    form.set("path", "/");
    form.set("file", blob, `bench-upload-${Date.now()}.bin`);
    const r = await fetch(`${base}/api/servers/${serverId}/files/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const t = await r.text();
    if (!r.ok) throw new Error(`upload ${r.status} ${t.slice(0,200)}`);
    // best-effort delete
    const name = `bench-upload`;
    // list and delete matching?
  }, 6);
}

async function opServerCreateBurst({ base, token, templateId, nodeId, locationId }) {
  if (!templateId || !nodeId || !locationId) throw new Error("missing template/node/location");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const created = [];
  const result = await timed("op-server-create-burst-10", async (i) => {
    const name = `BENCH_CREATE_${Date.now()}_${i}`;
    const body = {
      name,
      templateId,
      nodeId,
      locationId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      allocatedDiskMb: 1024,
      primaryPort: 30000 + (i % 5000),
      environment: {},
    };
    const r = await fetchJson(`${base}/api/servers`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`create ${r.status} ${r.text.slice(0,300)}`);
    const id = r.json?.data?.id || r.json?.id;
    if (id) created.push(id);
  }, 10);
  // cleanup
  for (const id of created) {
    await fetch(`${base}/api/servers/${id}`, { method: "DELETE", headers }).catch(()=>{});
  }
  return result;
}

async function opSseTtfb({ base, token, serverId, concurrency = 12 }) {
  if (!serverId) throw new Error("missing serverId");
  const headers = { Authorization: `Bearer ${token}`, Accept: "text/event-stream" };
  const latencies = [];
  let errors = 0;
  const url = `${base}/api/servers/${serverId}/events`;
  // concurrency parallel connects; each measures TTFB to first byte
  const tasks = Array.from({ length: concurrency }, async () => {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`sse ${res.status}`);
      const reader = res.body.getReader();
      const { value } = await reader.read();
      clearTimeout(to);
      latencies.push(performance.now() - t0);
      try { await reader.cancel(); } catch {}
    } catch (e) {
      clearTimeout(to);
      errors++;
      latencies.push(performance.now() - t0);
    }
  });
  await Promise.all(tasks);
  return {
    name: "op-sse-ttfb",
    iterations: concurrency,
    errors,
    errorRate: +(errors / concurrency * 100).toFixed(2),
    latency: stats(latencies),
    totalMs: +latencies.reduce((a,b)=>a+b,0).toFixed(2),
  };
}

async function opBackupCreate({ base, token, serverId }) {
  if (!serverId) throw new Error("missing serverId");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return timed("op-backup-create", async () => {
    const r = await fetchJson(`${base}/api/servers/${serverId}/backups`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: `bench-${Date.now()}` }),
    });
    if (!r.ok) throw new Error(`backup ${r.status} ${r.text.slice(0,300)}`);
    // Do not wait for completion; creation time is the metric
  }, 3);
}

async function opMigration50({ base, token, pteroUrl, pteroAppKey, nodeId }) {
  if (!pteroUrl || !pteroAppKey) throw new Error("missing pteroUrl/pteroAppKey");
  if (!nodeId) throw new Error("missing nodeId for migration target");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  // migration is destructive (creates servers); run once and time end-to-end
  const t0 = performance.now();
  let op = null;
  try {
    // test connection
    const test = await fetchJson(`${base}/api/admin/migration/test`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: pteroUrl, key: pteroAppKey }),
    });
    if (!test.ok) throw new Error(`migration test ${test.status} ${test.text.slice(0,300)}`);
    // start full migration
    const start = await fetchJson(`${base}/api/admin/migration/start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ url: pteroUrl, key: pteroAppKey, scope: "full", nodeMapping: { default: nodeId } }),
    });
    if (!start.ok) throw new Error(`migration start ${start.status} ${start.text.slice(0,400)}`);
    const jobId = start.json?.data?.jobId || start.json?.jobId || start.json?.data?.id;
    if (!jobId) throw new Error(`no jobId ${start.text.slice(0,400)}`);
    // poll
    const deadline = Date.now() + 5 * 60 * 1000;
    let status = "";
    let last = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3000));
      const pol = await fetchJson(`${base}/api/admin/migration/${jobId}`, { headers });
      if (!pol.ok) throw new Error(`poll ${pol.status}`);
      last = pol.json;
      status = last?.data?.status || last?.status || "";
      if (status === "completed" || status === "failed") break;
    }
    const elapsed = performance.now() - t0;
    op = {
      name: "op-migration-50",
      iterations: 1,
      errors: status === "completed" ? 0 : 1,
      errorRate: status === "completed" ? 0 : 100,
      latency: stats([elapsed]),
      totalMs: +elapsed.toFixed(2),
      status,
      details: last,
    };
    return op;
  } catch (e) {
    const elapsed = performance.now() - t0;
    return {
      name: "op-migration-50",
      iterations: 1,
      errors: 1,
      errorRate: 100,
      latency: stats([elapsed]),
      totalMs: +elapsed.toFixed(2),
      status: "error",
      lastError: String(e).slice(0, 500),
    };
  }
}

async function opScaleList({ base, token, count = 500 }) {
  // List with pagination sweep — measures DB + auth for large server sets
  const headers = { Authorization: `Bearer ${token}` };
  return timed("op-scale-list", async () => {
    const r = await fetchJson(`${base}/api/servers?limit=${count}`, { headers });
    if (!r.ok) throw new Error(`scale list ${r.status}`);
  }, 8);
}

async function main() {
  const target = getArg("target", "catalyst"); // catalyst|pterodactyl (currently catalyst only; ptero ops are app-key + different endpoints)
  const out = getArg("out", "");
  const urlArg = getArg("url", "");
  const tokenArg = getArg("token", "");
  const stateFile = getArg("state-file", process.env.STATE_FILE || `${process.env.HOME || "/root"}/.local/share/catalyst-lxc-lab/state.env`);

  const st = await loadStateViaBash(stateFile);
  let base = urlArg || st.API_BASE || "";
  if (!base && st.BACKEND_IP) base = `http://${st.BACKEND_IP}:3000`;
  if (!base || base === "http://:3000" || base === "http://127.0.0.1:3000") {
    try {
      const { execSync } = await import("node:child_process");
      const cfgIp = execSync(`bash -c 'source "${process.cwd()}/scripts/lxc-lab/config.env" 2>/dev/null; printf "%s" "\${BACKEND_IP:-}"'`, { encoding: "utf8" }).trim();
      if (cfgIp) base = `http://${cfgIp}:3000`;
    } catch {}
  }
  if (!base || base === "http://:3000") base = "http://10.0.3.20:3000";
  const token = tokenArg || st.AUTH_TOKEN || "";
  const serverId = getArg("paper-id", st.PAPER_SERVER_ID || "");
  const nodeId = getArg("node-id", st.NODE_ID || "");
  const locationId = getArg("location-id", st.LOCATION_ID || "");
  const templateId = getArg("template-id", st.PAPER_TEMPLATE_ID || "");
  const pteroUrl = getArg("ptero-url", st.PTERO_URL || "http://10.0.3.30");
  const pteroAppKey = getArg("ptero-app-key", st.PTERO_APP_KEY || "");

  if (!token) {
    console.error(`No AUTH_TOKEN (state-file ${stateFile} missing or --token not provided). Run lab.sh bootstrap/login first or pass --token.`);
    process.exit(1);
  }

  console.log(`ops target=${target} base=${base} server=${serverId.slice(0,8)}… node=${nodeId.slice(0,8)}…`);

  const include = (getArg("only", "") || "").split(",").filter(Boolean);
  const skip = (getArg("skip", "") || "").split(",").filter(Boolean);
  const should = (id) => {
    if (include.length && !include.includes(id)) return false;
    if (skip.includes(id)) return false;
    return true;
  };

  const results = [];
  const run = async (id, fn) => {
    if (!should(id)) { console.log(`→ ${id} SKIP (--only/--skip)`); return; }
    console.log(`→ ${id}`);
    try {
      const r = await fn();
      console.log(`  ${r.name}: p50=${r.latency.p50}ms p95=${r.latency.p95}ms err=${r.errorRate}% total=${r.totalMs}ms ${r.lastError ? `ERR ${r.lastError.slice(0,120)}` : ""}`);
      results.push(r);
    } catch (e) {
      console.error(`  ${id} failed: ${e.message}`);
      results.push({ name: id, iterations: 0, errors: 1, errorRate: 100, lastError: String(e).slice(0,300), latency: stats([]), totalMs: 0 });
    }
  };

  if (target === "catalyst") {
    await run("op-file-write-readback", () => opFileWriteReadback({ base, token, serverId }));
    await run("op-file-upload-256k", () => opFileUpload({ base, token, serverId }));
    await run("op-scale-list", () => opScaleList({ base, token }));
    await run("op-sse-ttfb", () => opSseTtfb({ base, token, serverId }));
    if (templateId && nodeId && locationId) {
      await run("op-server-create-burst-10", () => opServerCreateBurst({ base, token, templateId, nodeId, locationId }));
    } else {
      console.log("→ op-server-create-burst-10 SKIP (missing template/node/location)");
    }
    await run("op-backup-create", () => opBackupCreate({ base, token, serverId }));
    // migration is heavy and destructive; opt-in unless --only or BENCH_INCLUDE_MIGRATION=1
    if ((include.includes("op-migration-50") || process.env.BENCH_INCLUDE_MIGRATION === "1") && should("op-migration-50")) {
      await run("op-migration-50", () => opMigration50({ base, token, pteroUrl, pteroAppKey, nodeId }));
    } else {
      console.log("→ op-migration-50 SKIP (opt-in: --only op-migration-50 or BENCH_INCLUDE_MIGRATION=1)");
    }
  } else {
    console.log("Pterodactyl ops not yet implemented (HTTP suites cover ptero Application/Client APIs via bench.mjs).");
    // Still emit scale-ish ptero list via bench.mjs; no separate ptero ops for now.
  }

  const outObj = {
    meta: { target, base, timestamp: new Date().toISOString(), serverId, nodeId, templateId },
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
