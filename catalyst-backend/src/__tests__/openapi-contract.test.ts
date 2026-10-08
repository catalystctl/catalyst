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
});
