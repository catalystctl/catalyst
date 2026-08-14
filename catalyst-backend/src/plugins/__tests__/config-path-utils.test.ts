import { describe, it, expect } from 'vitest';
import {
  isConfigSchemaField,
  resolveConfigValue,
  buildRuntimeConfig,
} from '../config-utils';
import {
  getByPath,
  setByPath,
  matchFilter,
  applyUpdateOperators,
} from '../path-utils';

describe('config-utils', () => {
  it('detects schema fields only for known type keywords', () => {
    expect(isConfigSchemaField({ type: 'string', default: 'x' })).toBe(true);
    expect(isConfigSchemaField({ type: 'boolean', description: 'y' })).toBe(true);
    expect(isConfigSchemaField({ type: 'boolean' })).toBe(true);
    expect(isConfigSchemaField({ type: 'object', default: {} })).toBe(true);
    expect(isConfigSchemaField('hello')).toBe(false);
    expect(isConfigSchemaField({ foo: 1 })).toBe(false);
    // Free-form domain objects are NOT schemas even with type+description
    expect(
      isConfigSchemaField({ type: 'incident', description: 'Sev1' }),
    ).toBe(false);
    // Mixed payload keys → not a pure schema field
    expect(
      isConfigSchemaField({ type: 'string', default: 'x', id: 'abc' }),
    ).toBe(false);
  });

  it('resolves schema defaults and plain values', () => {
    expect(resolveConfigValue({ type: 'string', default: 'Hi' })).toBe('Hi');
    expect(resolveConfigValue(true)).toBe(true);
    expect(resolveConfigValue(undefined)).toBeUndefined();
    expect(
      resolveConfigValue({ type: 'incident', description: 'Sev1' }),
    ).toEqual({ type: 'incident', description: 'Sev1' });
  });

  it('builds runtime config from schema + stored values', () => {
    const schema = {
      greeting: { type: 'string', default: 'Hello' },
      cronEnabled: { type: 'boolean', default: true },
    };
    const stored = { greeting: 'Custom', extra: 42 };
    expect(buildRuntimeConfig(schema, stored)).toEqual({
      greeting: 'Custom',
      cronEnabled: true,
      extra: 42,
    });
  });

  it('does not treat stored schema objects as values for scalar fields', () => {
    const schema = { greeting: { type: 'string', default: 'Hello' } };
    const stored = { greeting: { type: 'string', default: 'Hello' } };
    expect(buildRuntimeConfig(schema, stored)).toEqual({ greeting: 'Hello' });
  });

  it('keeps legitimate object-shaped stored values for object fields', () => {
    const schema = {
      severity: {
        type: 'object',
        default: { type: 'info', description: 'default' },
        description: 'Severity descriptor',
      },
    };
    const stored = {
      severity: { type: 'incident', description: 'Sev1' },
    };
    expect(buildRuntimeConfig(schema, stored)).toEqual({
      severity: { type: 'incident', description: 'Sev1' },
    });
  });

  it('unwraps leftover object-schema pollution under object fields', () => {
    const schema = {
      severity: { type: 'object', default: { level: 1 } },
    };
    // First-install row still has the schema blob itself
    const stored = {
      severity: { type: 'object', default: { level: 1 }, description: 'x' },
    };
    expect(buildRuntimeConfig(schema, stored)).toEqual({
      severity: { level: 1 },
    });
  });

  it('keeps object-shaped extras not declared in schema', () => {
    const schema = { greeting: { type: 'string', default: 'Hi' } };
    const stored = {
      greeting: 'Hi',
      ticketKind: { type: 'incident', description: 'Sev1' },
    };
    expect(buildRuntimeConfig(schema, stored)).toEqual({
      greeting: 'Hi',
      ticketKind: { type: 'incident', description: 'Sev1' },
    });
  });
});

describe('path-utils', () => {
  it('reads and writes dotted paths', () => {
    const doc: any = { sla: { resolutionBreached: true } };
    expect(getByPath(doc, 'sla.resolutionBreached')).toBe(true);
    setByPath(doc, 'sla.responseBreached', true);
    expect(doc.sla.responseBreached).toBe(true);
    setByPath(doc, 'nested.deep.value', 1);
    expect(doc.nested.deep.value).toBe(1);
  });

  it('matches nested filters', () => {
    const doc = { sla: { resolutionBreached: true }, status: 'open' };
    expect(matchFilter(doc, { 'sla.resolutionBreached': true })).toBe(true);
    expect(matchFilter(doc, { 'sla.resolutionBreached': false })).toBe(false);
    expect(
      matchFilter(doc, {
        $and: [{ status: 'open' }, { 'sla.resolutionBreached': true }],
      }),
    ).toBe(true);
  });

  it('applies $set with dotted paths without polluting top-level', () => {
    const doc: any = { sla: { a: 1 } };
    applyUpdateOperators(doc, { $set: { 'sla.b': 2, status: 'closed' } });
    expect(doc.sla).toEqual({ a: 1, b: 2 });
    expect(doc.status).toBe('closed');
    expect(doc['sla.b']).toBeUndefined();
  });

  it('rejects prototype-polluting path segments', () => {
    const doc: any = { sla: { a: 1 } };
    setByPath(doc, '__proto__.polluted', true);
    setByPath(doc, 'constructor.prototype.polluted', true);
    setByPath(doc, 'sla.__proto__.x', true);
    applyUpdateOperators(doc, { $set: { '__proto__.admin': true } });
    expect(getByPath(doc, '__proto__.polluted')).toBeUndefined();
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).admin).toBeUndefined();
    expect(doc.sla).toEqual({ a: 1 });
  });
});
