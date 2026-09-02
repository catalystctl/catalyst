import { describe, expect, it } from 'vitest';
import { describeError, describeMutationComponent, getErrorMessage, hasErrorCode } from './errors';

describe('describeError', () => {
  it('returns the message of Error instances', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('returns plain strings as-is', () => {
    expect(describeError('plain')).toBe('plain');
  });

  it('unwraps message from ApiError-like objects', () => {
    expect(describeError({ status: 404, message: 'HTTP 404' })).toBe('HTTP 404');
  });

  it('JSON-stringifies plain objects instead of "[object Object]"', () => {
    expect(describeError({ code: 'X', detail: 1 })).toBe('{"code":"X","detail":1}');
  });

  it('handles arrays', () => {
    expect(describeError(['a'])).toBe('["a"]');
  });

  it('falls back to String() for primitives', () => {
    expect(describeError(42)).toBe('42');
    expect(describeError(null)).toBe('null');
    expect(describeError(undefined)).toBe('undefined');
  });

  it('does not treat empty-string message as a message', () => {
    expect(describeError({ message: '' })).toBe('{"message":""}');
  });
});

describe('describeMutationComponent', () => {
  it('uses the mutationKey array when present', () => {
    expect(describeMutationComponent(['servers', 'start'], new Error('x'))).toBe(
      'Mutation:servers:start',
    );
  });

  it('uses a string mutationKey when present', () => {
    expect(describeMutationComponent('createBackup', new Error('x'))).toBe(
      'Mutation:createBackup',
    );
  });

  it('falls back to method+path from an ApiError-like value', () => {
    expect(
      describeMutationComponent(undefined, { method: 'GET', path: '/api/servers/1/backups/2/download' }),
    ).toBe('Mutation:GET /api/servers/1/backups/2/download');
  });

  it('falls back to path only when method is missing', () => {
    expect(describeMutationComponent(undefined, { path: '/api/nodes' })).toBe('Mutation:HTTP /api/nodes');
  });

  it('returns Mutation:unknown when nothing is derivable', () => {
    expect(describeMutationComponent(undefined, new Error('x'))).toBe('Mutation:unknown');
    expect(describeMutationComponent(undefined, undefined)).toBe('Mutation:unknown');
  });

  it('ignores empty-string string keys', () => {
    expect(describeMutationComponent('', { method: 'POST', path: '/api/x' })).toBe('Mutation:POST /api/x');
  });
});

describe('getErrorMessage', () => {
  it('extracts nested error bodies', () => {
    expect(getErrorMessage({ response: { data: { error: 'Nope' } } }, 'fallback')).toBe('Nope');
  });

  it('uses fallback when nothing readable', () => {
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});

describe('hasErrorCode', () => {
  it('matches codes on plain objects', () => {
    expect(hasErrorCode({ code: 'TWO_FACTOR_REQUIRED' }, 'TWO_FACTOR_REQUIRED')).toBe(true);
    expect(hasErrorCode({ code: 'OTHER' }, 'TWO_FACTOR_REQUIRED')).toBe(false);
  });
});
