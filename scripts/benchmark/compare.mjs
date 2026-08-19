#!/usr/bin/env node
/**
 * compare.mjs — render a markdown + JSON comparison of two benchmark runs.
 * Usage:
 *   node compare.mjs --catalyst results/catalyst.json --pterodactyl results/ptero.json --out report.md --json comparison.json
 *   node compare.mjs --catalyst a.json --pterodactyl b.json   # stdout md
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

const args = process.argv.slice(2);
const getArg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  if (i === -1) return d;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) return d;
  return v;
};
const hasFlag = (n) => args.includes(`--${n}`);

function loadJson(p) {
  if (!p || !existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

function fmt(n, d = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(d);
}

function deltaPct(a, b) {
  if (a === 0 || a === null || a === undefined) return "—";
  const pct = ((b - a) / a) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function winner(a, b, lowerIsBetter = true) {
  if (a === null || b === null) return "—";
  if (a === b) return "tie";
  const aWins = lowerIsBetter ? a < b : a > b;
  return aWins ? "Catalyst" : "Pterodactyl";
}

function mdEscape(s) {
  return String(s).replace(/\|/g, "\\|");
}

function main() {
  const catPath = getArg("catalyst", getArg("cat", ""));
  const pteroPath = getArg("pterodactyl", getArg("ptero", getArg("pterodactyl", "")));
  const out = getArg("out", "");
  const outJson = getArg("json", "");
  const title = getArg("title", "Catalyst vs Pterodactyl — Benchmark Report");

  if (!catPath || !pteroPath) {
    console.error("Usage: node compare.mjs --catalyst results/catalyst.json --pterodactyl results/ptero.json [--out report.md] [--json comparison.json]");
    process.exit(1);
  }

  const cat = loadJson(catPath);
  const ptero = loadJson(pteroPath);
  if (!cat) { console.error(`Missing ${catPath}`); process.exit(1); }
  if (!ptero) { console.error(`Missing ${pteroPath}`); process.exit(1); }

  // Normalize: results may be { results: [...] } or { suites: [...] } or mixed with ops
  const catResults = cat.results || cat.suites || [];
  const pteroResults = ptero.results || ptero.suites || [];
  // Also handle ops files: { results: [{ name, latency... }] }
  // For cross-target comparison we match by suite/id/name

  const catById = new Map(catResults.map((r) => [r.suite || r.name || r.id, r]));
  const pteroById = new Map(pteroResults.map((r) => [r.suite || r.name || r.id, r]));

  const allIds = [...new Set([...catById.keys(), ...pteroById.keys()])].sort();

  const rows = [];
  for (const id of allIds) {
    const c = catById.get(id);
    const p = pteroById.get(id);
    // HTTP suites have rps, latency; ops have latency only
    const cRps = c?.rps ?? null;
    const pRps = p?.rps ?? null;
    const cP95 = c?.latency?.p95 ?? c?.p95 ?? null;
    const pP95 = p?.latency?.p95 ?? p?.p95 ?? null;
    const cP50 = c?.latency?.p50 ?? null;
    const pP50 = p?.latency?.p50 ?? null;
    const cErr = c?.errorRate ?? null;
    const pErr = p?.errorRate ?? null;
    rows.push({ id, cRps, pRps, cP95, pP95, cP50, pP50, cErr, pErr, c, p });
  }

  const ts = new Date().toISOString();
  const catMeta = cat.meta || {};
  const pteroMeta = ptero.meta || {};

  let md = `# ${mdEscape(title)}\n\n`;
  md += `Generated: \`${ts}\`\n\n`;
  md += `| Target | Base URL | Timestamp | Node |\n`;
  md += `|---|---|---|---|\n`;
  md += `| Catalyst | \`${mdEscape(catMeta.url || catMeta.base || "—")}\` | \`${mdEscape(catMeta.timestamp || "—")}\` | \`${mdEscape(catMeta.node || "—")}\` |\n`;
  md += `| Pterodactyl | \`${mdEscape(pteroMeta.url || pteroMeta.base || "—")}\` | \`${mdEscape(pteroMeta.timestamp || "—")}\` | \`${mdEscape(pteroMeta.node || "—")}\` |\n`;
  md += `\n`;

  md += `## Summary (higher rps is better, lower latency is better)\n\n`;
  md += `| Suite | Catalyst rps | Pterodactyl rps | Δ rps | Catalyst p95 | Pterodactyl p95 | Δ p95 | Catalyst p50 | Pterodactyl p50 | Errors (C / P) | Winner (p95) |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of rows) {
    const rpsDelta = r.cRps !== null && r.pRps !== null ? deltaPct(r.pRps, r.cRps) : "—";
    const p95Delta = r.cP95 !== null && r.pP95 !== null ? deltaPct(r.pP95, r.cP95) : "—";
    const w = r.cP95 !== null && r.pP95 !== null ? winner(r.cP95, r.pP95, true) : (r.cRps !== null && r.pRps !== null ? winner(r.pRps, r.cRps, false) : "—");
    md += `| \`${mdEscape(r.id)}\` | ${r.cRps !== null ? fmt(r.cRps, 1) : "—"} | ${r.pRps !== null ? fmt(r.pRps, 1) : "—"} | ${rpsDelta} | ${r.cP95 !== null ? fmt(r.cP95, 1) + "ms" : "—"} | ${r.pP95 !== null ? fmt(r.pP95, 1) + "ms" : "—"} | ${p95Delta} | ${r.cP50 !== null ? fmt(r.cP50, 1) + "ms" : "—"} | ${r.pP50 !== null ? fmt(r.pP50, 1) + "ms" : "—"} | ${r.cErr !== null ? fmt(r.cErr, 1) + "%" : "—"} / ${r.pErr !== null ? fmt(r.pErr, 1) + "%" : "—"} | ${w} |\n`;
  }

  md += `\n## Details\n\n`;
  for (const r of rows) {
    md += `### \`${mdEscape(r.id)}\`\n\n`;
    if (r.c) {
      md += `- **Catalyst**: rps=${fmt(r.c.rps ?? r.cRps ?? 0, 1)} p50=${fmt(r.c.latency?.p50, 1)}ms p95=${fmt(r.c.latency?.p95, 1)}ms p99=${fmt(r.c.latency?.p99, 1)}ms err=${fmt(r.c.errorRate ?? r.cErr, 1)}% codes=${JSON.stringify(r.c.statusCodes || {})} total=${r.c.completed ?? r.c.iterations ?? "—"} dur=${r.c.duration ?? r.c.totalMs ?? "—"}s\n`;
    } else {
      md += `- **Catalyst**: — (no data)\n`;
    }
    if (r.p) {
      md += `- **Pterodactyl**: rps=${fmt(r.p.rps ?? r.pRps ?? 0, 1)} p50=${fmt(r.p.latency?.p50, 1)}ms p95=${fmt(r.p.latency?.p95, 1)}ms p99=${fmt(r.p.latency?.p99, 1)}ms err=${fmt(r.p.errorRate ?? r.pErr, 1)}% codes=${JSON.stringify(r.p.statusCodes || {})} total=${r.p.completed ?? r.p.iterations ?? "—"} dur=${r.p.duration ?? r.p.totalMs ?? "—"}s\n`;
    } else {
      md += `- **Pterodactyl**: — (no data; Catalyst-only suite or fixture not running)\n`;
    }
    md += `\n`;
  }

  md += `---\n\n`;
  md += `*Method: \`scripts/benchmark/bench.mjs\` + \`ops.mjs\` via \`scripts/benchmark/run.sh\`. Concurrency, duration, and warmup per suite are in \`scenarios.json\`. Re-run with \`bash scripts/lxc-lab/lab.sh benchmark\`. Raw JSON is in the workflow artifact \`benchmark-results\`.*\n`;

  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), md);
    console.log(`Wrote ${out}`);
  } else {
    console.log(md);
  }

  if (outJson) {
    const cmp = {
      meta: { generatedAt: ts, catalyst: catMeta, pterodactyl: pteroMeta },
      rows: rows.map((r) => ({
        id: r.id,
        catalyst: r.c ? { rps: r.c.rps ?? null, latency: r.c.latency ?? null, errorRate: r.c.errorRate ?? null, statusCodes: r.c.statusCodes ?? null, completed: r.c.completed ?? r.c.iterations ?? null, duration: r.c.duration ?? r.c.totalMs ?? null } : null,
        pterodactyl: r.p ? { rps: r.p.rps ?? null, latency: r.p.latency ?? null, errorRate: r.p.errorRate ?? null, statusCodes: r.p.statusCodes ?? null, completed: r.p.completed ?? r.p.iterations ?? null, duration: r.p.duration ?? r.p.totalMs ?? null } : null,
      })),
    };
    mkdirSync(dirname(resolve(outJson)), { recursive: true });
    writeFileSync(resolve(outJson), JSON.stringify(cmp, null, 2));
    console.log(`Wrote ${outJson}`);
  }
}

main();
