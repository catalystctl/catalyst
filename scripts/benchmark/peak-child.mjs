#!/usr/bin/env node
/**
 * Single-client runner for peak.mjs — one autocannon instance per process.
 * Invoked as: node peak-child.mjs '<json opts>' <out-file>
 * (Internal; use peak.mjs from the command line.)
 */

import { writeFileSync } from "node:fs";
import autocannon from "autocannon";

const opts = JSON.parse(process.argv[2]);
const outFile = process.argv[3];

const result = await autocannon({
  url: opts.target,
  connections: opts.connections,
  pipelining: opts.pipelining,
  duration: opts.duration,
  headers: opts.headers,
  timeout: 10,
});

const summary = {
  rps: result.requests.average,
  completed: result.requests.total,
  errors: result.errors || 0,
  non2xx: result.non2xx || 0,
  bytesPerSec: result.throughput.average,
  latency: result.latency,
};

writeFileSync(outFile, JSON.stringify(summary, null, 2));
