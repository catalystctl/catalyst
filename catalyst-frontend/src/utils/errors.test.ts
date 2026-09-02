import { describe, expect, it } from 'vitest';
import { describeError, describeErrorFunction, describeMutationComponent, getErrorMessage, hasErrorCode } from './errors';

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
    const bare = new Error('x');
    bare.stack = 'Error: x'; // vitest's own stack frames would match; pin it
    expect(describeMutationComponent(undefined, bare)).toBe('Mutation:unknown');
    expect(describeMutationComponent(undefined, undefined)).toBe('Mutation:unknown');
  });

  it('ignores empty-string string keys', () => {
    expect(describeMutationComponent('', { method: 'POST', path: '/api/x' })).toBe('Mutation:POST /api/x');
  });

  it('recovers the function name from the error stack (prod minification case)', () => {
    const err = new Error('Failed to enable 2FA');
    // Simulate a minified prod stack: component frame is "k" but the method
    // property name survives (Object.enableTwoFactor).
    err.stack = [
      'Error: Failed to enable 2FA',
      '    at Object.enableTwoFactor (https://panel.example.com/assets/ProfilePage-BYHmdP_U.js:1:3410)',
      '    at async k (https://panel.example.com/assets/queryClient-0wCY7Jaz.js:2:932)',
    ].join('\n');
    expect(describeMutationComponent(['k'], err)).toBe('Mutation:enableTwoFactor');
  });

  it('prefers a readable mutationKey over the stack-derived name', () => {
    const err = new Error('x');
    err.stack = 'Error: x\n    at Object.enableTwoFactor (app.js:1:1)';
    expect(describeMutationComponent(['createBackup'], err)).toBe('Mutation:createBackup');
  });

  it('keeps a minified mutationKey only as last-resort fallback', () => {
    const err = new Error('x');
    err.stack = 'Error: x\n    at k (app.js:1:1)';
    // Stack name "k" is minified → skipped; endpoint missing → falls back to key "k".
    expect(describeMutationComponent(['k'], err)).toBe('Mutation:k');
  });

  it('rejects 2-char PascalCase-looking minified names like "Ke" (regression)', () => {
    const err = new Error('Failed to enable 2FA: HTTP 500');
    err.stack = [
      'Error: Failed to enable 2FA: HTTP 500',
      '    at Object.enableTwoFactor (https://panel.example.com/assets/ProfilePage-C61zddDt.js:1:3488)',
      '    at async Ke (https://panel.example.com/assets/queryClient-DC8ZeF5t.js:2:973)',
    ].join('\n');
    // "Ke" was previously accepted as PascalCase; the stack-derived method
    // name must win instead.
    expect(describeMutationComponent(['Ke'], err)).toBe('Mutation:enableTwoFactor');
  });
});

describe('describeErrorFunction', () => {
  it('extracts Object.method names from stacks', () => {
    const err = new Error('x');
    err.stack = 'Error: x\n    at Object.enableTwoFactor (ProfilePage.js:1:3410)';
    expect(describeErrorFunction(err)).toBe('enableTwoFactor');
  });

  it('skips minified frames and returns the first readable one', () => {
    const err = new Error('x');
    err.stack = 'Error: x\n    at k (a.js:1:1)\n    at async createServer (b.js:2:932)';
    expect(describeErrorFunction(err)).toBe('createServer');
  });

  it('returns undefined when no readable frame exists', () => {
    const err = new Error('x');
    err.stack = 'Error: x\n    at k (a.js:1:1)\n    at t3 (b.js:2:2)';
    expect(describeErrorFunction(err)).toBeUndefined();
    const noStack = new Error('no stack');
    noStack.stack = undefined;
    expect(describeErrorFunction(noStack)).toBeUndefined();
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
