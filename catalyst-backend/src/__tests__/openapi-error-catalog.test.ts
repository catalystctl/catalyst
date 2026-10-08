import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ErrorCodes } from '../lib/error-codes/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('OpenAPI error catalog', () => {
  it('publishes every stable ErrorCodes value in ErrorCode', () => {
    const specPath = path.resolve(HERE, '../../../api/openapi.json');
    const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
      components?: { schemas?: { ErrorCode?: { enum?: unknown[] } } };
    };
    const published = new Set(spec.components?.schemas?.ErrorCode?.enum ?? []);
    const missing = Object.values(ErrorCodes).filter((code) => !published.has(code));
    expect(missing, `stable error codes missing from OpenAPI: ${missing.join(', ')}`).toEqual([]);
  });
});
