import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErrorCodes } from '../shared-types.js';

type Json = Record<string, any>;
const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(HERE, '../..');
const SPEC = JSON.parse(readFileSync(resolve(ROOT, '../api/openapi.json'), 'utf8')) as Json;
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace']);

function resolveRef(value: any): any {
  if (!value?.$ref) return value;
  expect(value.$ref).toMatch(/^#\//);
  return value.$ref.slice(2).split('/').reduce((node: any, key: string) => node?.[key], SPEC);
}

function hasSchema(value: any): boolean {
  const resolved = resolveRef(value);
  return !!resolved && typeof resolved === 'object' && ('$ref' in (value ?? {}) || Object.keys(resolved).length === 0 || 'type' in resolved || 'properties' in resolved || 'oneOf' in resolved || 'anyOf' in resolved || 'allOf' in resolved);
}

/**
 * Checks a value against the subset of JSON Schema this document uses.
 * Returns violations instead of throwing so one run reports every bad example.
 * `format` is not enforced: it is documentation, not a pattern.
 */
function check(value: unknown, schema: any, where: string): string[] {
  const resolved = resolveRef(schema);
  if (!resolved || typeof resolved !== 'object') return [`${where}: schema does not resolve`];
  if (resolved.const !== undefined && value !== resolved.const) return [`${where}: expected const ${JSON.stringify(resolved.const)}`];
  if (Array.isArray(resolved.enum) && !resolved.enum.includes(value)) return [`${where}: ${JSON.stringify(value)} is not one of ${resolved.enum.join(', ')}`];

  const types: string[] = Array.isArray(resolved.type) ? resolved.type : resolved.type ? [resolved.type] : [];
  if (types.length > 0) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const matches = types.some((type) => type === actual || (type === 'number' && actual === 'integer'));
    if (!matches) return [`${where}: expected ${types.join('|')}, got ${actual}`];
  }

  const out: string[] = [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = (resolved.properties ?? {}) as Record<string, unknown>;
    for (const key of resolved.required ?? []) if (!(key in (value as object))) out.push(`${where}: missing required key "${key}"`);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const child = properties[key];
      if (!child) {
        if (resolved.additionalProperties === false) out.push(`${where}: key "${key}" is not declared`);
        else if (resolved.additionalProperties && typeof resolved.additionalProperties === 'object') out.push(...check(entry, resolved.additionalProperties, `${where}.${key}`));
        continue;
      }
      out.push(...check(entry, child, `${where}.${key}`));
    }
  }
  if (Array.isArray(value) && resolved.items) value.forEach((entry, index) => out.push(...check(entry, resolved.items, `${where}[${index}]`)));
  if (typeof value === 'string') {
    if (typeof resolved.minLength === 'number' && value.length < resolved.minLength) out.push(`${where}: shorter than minLength ${resolved.minLength}`);
    if (typeof resolved.maxLength === 'number' && value.length > resolved.maxLength) out.push(`${where}: longer than maxLength ${resolved.maxLength}`);
    if (typeof resolved.pattern === 'string' && !new RegExp(resolved.pattern).test(value)) out.push(`${where}: does not match ${resolved.pattern}`);
  }
  if (typeof value === 'number') {
    if (typeof resolved.minimum === 'number' && value < resolved.minimum) out.push(`${where}: below minimum ${resolved.minimum}`);
    if (typeof resolved.maximum === 'number' && value > resolved.maximum) out.push(`${where}: above maximum ${resolved.maximum}`);
  }
  if (resolved.anyOf && !resolved.anyOf.some((option: any) => check(value, option, where).length === 0)) out.push(`${where}: matches no anyOf branch`);
  if (resolved.oneOf && resolved.oneOf.filter((option: any) => check(value, option, where).length === 0).length !== 1) out.push(`${where}: matches no single oneOf branch`);
  if (resolved.allOf) for (const part of resolved.allOf) out.push(...check(value, part, where));
  return out;
}

describe('OpenAPI 3.1 executable contract', () => {
  it('has complete operations, valid parameters/responses, and resolving references', () => {
    expect(SPEC.openapi).toBe('3.1.0');
    const operationIds = new Set<string>();
    for (const [path, item] of Object.entries<Json>(SPEC.paths)) {
      const pathParams = new Set((item.parameters ?? []).filter((p: any) => p.in === 'path').map((p: any) => p.name));
      for (const [method, operation] of Object.entries<Json>(item)) {
        if (!METHODS.has(method)) continue;
        expect(operation.operationId, `${method.toUpperCase()} ${path} operationId`).toBeTypeOf('string');
        expect(operationIds.has(operation.operationId), `${operation.operationId} is unique`).toBe(false);
        operationIds.add(operation.operationId);
        expect(operation.summary || operation.description, `${method.toUpperCase()} ${path} summary/description`).toBeTruthy();
        expect(operation.responses, `${method.toUpperCase()} ${path} responses`).toBeTypeOf('object');
        const declared = new Set([...pathParams, ...(operation.parameters ?? []).filter((p: any) => p.in === 'path').map((p: any) => p.name)]);
        for (const match of path.matchAll(/\{([^}]+)\}/g)) expect(declared.has(match[1]), `${method.toUpperCase()} ${path} declares {${match[1]}}`).toBe(true);
        for (const parameter of operation.parameters ?? []) {
          expect(['path', 'query', 'header', 'cookie']).toContain(parameter.in);
          expect(parameter.name).toBeTypeOf('string');
          expect(hasSchema(parameter.schema), `${method.toUpperCase()} ${path} parameter ${parameter.name} schema`).toBe(true);
          if (parameter.in === 'path') expect(parameter.required).toBe(true);
        }
        if (operation.requestBody) {
          const body = resolveRef(operation.requestBody);
          expect(body?.content).toBeTypeOf('object');
          for (const media of Object.values<Json>(body.content)) expect(hasSchema(media.schema), `${method.toUpperCase()} ${path} request schema`).toBe(true);
        }
        for (const [status, raw] of Object.entries<Json>(operation.responses)) {
          const response = resolveRef(raw);
          expect(response, `${method.toUpperCase()} ${path} response ${status} resolves`).toBeTruthy();
          expect(response.description).toBeTypeOf('string');
          if (response.content) for (const media of Object.values<Json>(response.content)) expect(hasSchema(media.schema), `${method.toUpperCase()} ${path} response ${status} schema`).toBe(true);
        }
      }
    }
  });

  it('covers stable error codes referenced by route source', () => {
    const catalog = new Set(Object.values(ErrorCodes));
    const documented = new Set<string>();
    for (const item of Object.values<Json>(SPEC.paths)) for (const operation of Object.values<Json>(item)) {
      for (const code of operation?.['x-catalyst']?.errorCodes ?? []) {
        expect(catalog.has(code), `unknown stable error code ${code}`).toBe(true);
        documented.add(code);
      }
    }
    expect(documented.size).toBeGreaterThan(0);
  });

  it('publishes only examples that satisfy their own schema', () => {
    const violations: string[] = [];
    for (const [path, item] of Object.entries<Json>(SPEC.paths)) {
      for (const [method, operation] of Object.entries<Json>(item)) {
        if (!METHODS.has(method)) continue;
        const where = `${method.toUpperCase()} ${path}`;
        const body = operation.requestBody?.content?.['application/json'];
        if (body?.example !== undefined) violations.push(...check(body.example, body.schema, `${where} request example`));
        for (const [status, raw] of Object.entries<Json>(operation.responses ?? {})) {
          const media = resolveRef(raw)?.content?.['application/json'];
          if (media?.example !== undefined) violations.push(...check(media.example, media.schema, `${where} ${status} response example`));
        }
        for (const parameter of operation.parameters ?? []) {
          if (parameter.example !== undefined) violations.push(...check(parameter.example, parameter.schema, `${where} parameter ${parameter.name} example`));
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('flags every write operation that has no request-body contract', () => {
    // A POST/PUT/PATCH with no documented body is a gap in the route source,
    // not an endpoint that takes nothing. The count is a ratchet: add a body
    // contract (route `schema.body` or a CONTRACT_RULES entry) and lower it.
    const UNDOCUMENTED_WRITE_BODIES = 125;
    const gaps: string[] = [];
    for (const [path, item] of Object.entries<Json>(SPEC.paths)) {
      for (const [method, operation] of Object.entries<Json>(item)) {
        if (!['post', 'put', 'patch'].includes(method)) continue;
        const where = `${method.toUpperCase()} ${path}`;
        if (operation.requestBody) {
          expect(operation['x-catalyst']?.bodyUndocumented, `${where} documents a body but is flagged`).toBeUndefined();
        } else {
          expect(operation['x-catalyst']?.bodyUndocumented, `${where} has no body contract and is not flagged`).toBe(true);
          // Wildcards (Better Auth, the plugin dispatcher) cannot declare a body:
          // the handler is owned elsewhere. Flagged, but not counted against the
          // budget for routes this repo owns.
          if (!operation['x-catalyst']?.wildcard) gaps.push(where);
        }
      }
    }
    expect(gaps.length, `undocumented write bodies: ${gaps.length} (budget ${UNDOCUMENTED_WRITE_BODIES})`).toBeLessThanOrEqual(UNDOCUMENTED_WRITE_BODIES);
  });
});
