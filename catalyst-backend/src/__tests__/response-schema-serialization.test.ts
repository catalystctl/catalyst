/**
 * Response-schema serialization guard (issue #293).
 *
 * Fastify serializes responses with fast-json-stringify, which only emits the
 * properties a response schema declares. A bare `{ type: "object" }` therefore
 * serializes every payload to `{}` — the panel sees "Login failed" and empty
 * marketplaces (regression from 6e192c529).
 *
 * Guard A (runtime): a real unauthenticated route with a pass-through response
 * schema keeps its body.
 * Guard B (source scan): no route may declare a bare object response schema —
 * object responses must either list their `properties` or set
 * `additionalProperties` so the payload survives serialization.
 */
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupRoutes } from '../routes/setup.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');

// Matches a bare `{ type: "object" }` / `{ type: 'object' }` literal: no
// properties and no additionalProperties, so fast-json-stringify writes `{}`.
const BARE_OBJECT = /\{\s*type:\s*(["'])object\1\s*,?\s*\}/g;

/** Every `response: { ... }` object literal span in a source file. */
function responseSpans(src: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const marker = /response\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(src))) {
    const open = src.indexOf('{', match.index + match[0].length);
    if (open < 0 || src.slice(match.index + match[0].length, open).trim() !== '') continue;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '"' || ch === "'" || ch === '`') {
        i++;
        while (i < src.length) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === ch) break;
          i++;
        }
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    }
    spans.push([open, i]);
  }
  return spans;
}

function routeSourceFiles(): string[] {
  const files = [join(SRC, 'server.ts')];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts') && !full.includes('__tests__')) files.push(full);
    }
  };
  walk(join(SRC, 'routes'));
  return files;
}

describe('response schema serialization', () => {
  it('keeps the payload of a pass-through object response schema', async () => {
    const app = Fastify({ logger: false });
    await app.register(setupRoutes, { prefix: '/api/setup' });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/setup/environment' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      // A bare `{ type: "object" }` schema would serialize this to `{}`.
      expect(body).toMatchObject({ success: true });
      expect(Array.isArray(body.data)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('declares additionalProperties on every bare object response schema', () => {
    const offenders: string[] = [];
    for (const file of routeSourceFiles()) {
      const src = readFileSync(file, 'utf8');
      for (const [start, end] of responseSpans(src)) {
        for (const hit of src.slice(start, end).matchAll(BARE_OBJECT)) {
          const line = src.slice(0, start + (hit.index ?? 0)).split('\n').length;
          offenders.push(`${relative(SRC, file)}:${line}`);
        }
      }
    }
    expect(
      offenders,
      'bare object response schemas serialize to {} under fast-json-stringify — add additionalProperties: true or the real properties',
    ).toEqual([]);
  });
});
