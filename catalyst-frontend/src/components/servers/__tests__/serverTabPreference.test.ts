import { afterEach, describe, expect, it } from 'vitest';
import {
  lastTabStorageKey,
  readLastServerTab,
  restoreServerTab,
  writeLastServerTab,
} from '../serverTabPreference';

const TABS = ['console', 'files', 'backups', 'tasks', 'users'] as const;

afterEach(() => {
  window.localStorage.clear();
});

describe('server tab preference (audit D7)', () => {
  it('keys the remembered tab per server', () => {
    expect(lastTabStorageKey('srv-1')).toBe('catalyst.lastTab.srv-1');
    expect(lastTabStorageKey('srv-1')).not.toBe(lastTabStorageKey('srv-2'));
  });

  it('round-trips a built-in tab', () => {
    writeLastServerTab('srv-1', 'backups', TABS);
    expect(window.localStorage.getItem('catalyst.lastTab.srv-1')).toBe('backups');
    expect(readLastServerTab('srv-1', TABS)).toBe('backups');
  });

  it('ignores and never stores an unknown or plugin tab', () => {
    writeLastServerTab('srv-1', 'plugin:example-tab', TABS);
    expect(window.localStorage.getItem('catalyst.lastTab.srv-1')).toBeNull();

    // A stored value that is no longer a valid tab (tab removed in a new
    // version) is ignored rather than navigated to.
    window.localStorage.setItem('catalyst.lastTab.srv-1', 'retired-tab');
    expect(readLastServerTab('srv-1', TABS)).toBeNull();
  });

  it('scopes the memory to one server', () => {
    writeLastServerTab('srv-1', 'files', TABS);
    expect(readLastServerTab('srv-2', TABS)).toBeNull();
  });

  it('restores only when the URL names no tab', () => {
    writeLastServerTab('srv-1', 'tasks', TABS);
    // An explicit deep link always wins over the memory.
    expect(restoreServerTab('srv-1', 'files', TABS)).toBeNull();
    expect(restoreServerTab('srv-1', undefined, TABS)).toBe('tasks');
  });

  it('does not redirect when the default console tab is already correct', () => {
    writeLastServerTab('srv-1', 'console', TABS);
    expect(restoreServerTab('srv-1', undefined, TABS)).toBeNull();
    expect(restoreServerTab('srv-2', undefined, TABS)).toBeNull();
  });

  it('treats a blocked storage as "no memory" instead of throwing', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(readLastServerTab('srv-1', TABS)).toBeNull();
      expect(() => writeLastServerTab('srv-1', 'files', TABS)).not.toThrow();
      expect(restoreServerTab('srv-1', undefined, TABS)).toBeNull();
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original);
    }
  });
});