import { describe, it, expect } from 'vitest';
import {
  DISCLAIMER_VERSION,
  computeConsentState,
  diffGrants,
  getPermissionInfo,
  isSubsetOf,
  normalizePermissionList,
} from '../safety';

const okInputs = (overrides: Record<string, unknown> = {}) => ({
  hasAcceptance: true,
  acceptedDisclaimerVersion: DISCLAIMER_VERSION,
  acceptedPluginVersion: '1.0.0',
  acceptedPermissions: ['server.read'],
  manifestPermissions: ['server.read'],
  manifestVersion: '1.0.0',
  ...overrides,
});

describe('normalizePermissionList', () => {
  it('trims, dedupes and preserves order', () => {
    expect(normalizePermissionList([' server.read ', 'server.read', 'user.read'])).toEqual([
      'server.read',
      'user.read',
    ]);
  });

  it('drops non-strings, empties and malformed tokens', () => {
    expect(
      normalizePermissionList([42, null, '', '   ', 'bad token with spaces', 'bad/slash'] as any),
    ).toEqual([]);
  });

  it('accepts wildcard, dotted-star and wordy forms', () => {
    expect(normalizePermissionList(['*', 'server.*', 'custom_scope-1'])).toEqual([
      '*',
      'server.*',
      'custom_scope-1',
    ]);
  });

  it('returns empty for non-array input', () => {
    expect(normalizePermissionList(undefined)).toEqual([]);
    expect(normalizePermissionList('server.read' as any)).toEqual([]);
  });
});

describe('isSubsetOf', () => {
  it('is true when requested fully covered by accepted', () => {
    expect(isSubsetOf(['server.read'], ['server.read', 'user.read'])).toBe(true);
    expect(isSubsetOf([], ['server.read'])).toBe(true);
  });

  it('is false when anything requested is missing from accepted', () => {
    expect(isSubsetOf(['server.read', 'user.write'], ['server.read'])).toBe(false);
    expect(isSubsetOf(['server.read'], [])).toBe(false);
  });

  it('wildcard in accepted covers everything', () => {
    expect(isSubsetOf(['server.write', 'admin.read'], ['*'])).toBe(true);
  });

  it('requesting * requires * accepted', () => {
    expect(isSubsetOf(['*'], ['server.read'])).toBe(false);
    expect(isSubsetOf(['*'], ['*'])).toBe(true);
  });
});

describe('computeConsentState', () => {
  it('requires consent when never accepted', () => {
    const state = computeConsentState(okInputs({ hasAcceptance: false }));
    expect(state).toEqual({ consentRequired: true, reason: 'never_accepted' });
  });

  it('requires re-consent when the plugin version changed (new code)', () => {
    const state = computeConsentState(okInputs({ manifestVersion: '2.0.0' }));
    expect(state).toEqual({ consentRequired: true, reason: 'plugin_updated' });
  });

  it('requires re-consent when declared permissions grew beyond accepted set', () => {
    const state = computeConsentState(
      okInputs({ manifestPermissions: ['server.read', 'user.read'] }),
    );
    expect(state).toEqual({ consentRequired: true, reason: 'permissions_grew' });
  });

  it('does NOT require re-consent when permissions only shrank', () => {
    const state = computeConsentState(
      okInputs({
        acceptedPermissions: ['server.read', 'user.read'],
        manifestPermissions: ['server.read'],
      }),
    );
    expect(state.consentRequired).toBe(false);
  });

  it('requires re-consent when the disclaimer wording was bumped', () => {
    const state = computeConsentState(
      okInputs({ acceptedDisclaimerVersion: `${DISCLAIMER_VERSION}-old` }),
    );
    expect(state).toEqual({ consentRequired: true, reason: 'disclaimer_updated' });
  });

  it('treats a null permission snapshot on an otherwise-valid acceptance as growth', () => {
    const state = computeConsentState(okInputs({ acceptedPermissions: null }));
    expect(state).toEqual({ consentRequired: true, reason: 'permissions_grew' });
  });

  it('is satisfied when everything matches', () => {
    const state = computeConsentState(okInputs());
    expect(state).toEqual({ consentRequired: false });
  });
});

describe('diffGrants', () => {
  it('null grants mean everything declared granted', () => {
    expect(diffGrants(['a', 'b'], null)).toEqual({ granted: ['a', 'b'], revoked: [] });
  });

  it('splits declared into granted vs revoked', () => {
    expect(diffGrants(['a', 'b', 'c'], ['a', 'c'])).toEqual({
      granted: ['a', 'c'],
      revoked: ['b'],
    });
  });

  it('ignores grants outside the declared set (defense in depth)', () => {
    expect(diffGrants(['a'], ['a', 'ghost.permission'])).toEqual({
      granted: ['a'],
      revoked: [],
    });
  });
});

describe('getPermissionInfo', () => {
  it('has rich metadata for known scopes', () => {
    expect(getPermissionInfo('*').riskLevel).toBe('critical');
    expect(getPermissionInfo('server.read').label).toBe('Read servers');
  });

  it('falls back gracefully for unknown scopes', () => {
    const info = getPermissionInfo('totally.custom');
    expect(info.label).toBe('totally.custom');
    expect(info.riskLevel).toBe('medium');
  });
});
