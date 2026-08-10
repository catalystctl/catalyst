/**
 * Pure unit tests for server-relative path normalization.
 * No React / app bootstrap required.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizePath,
  joinPath,
  splitPath,
  getParentPath,
  buildBreadcrumbs,
} from '../utils/filePaths';

describe('normalizePath', () => {
  it('defaults empty input to root', () => {
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('   ')).toBe('/');
  });

  it('collapses parent segments (critical regression)', () => {
    expect(normalizePath('/a/../b')).toBe('/b');
    expect(normalizePath('/a/b/../c')).toBe('/a/c');
    expect(normalizePath('/a/./b')).toBe('/a/b');
  });

  it('never escapes above the virtual root', () => {
    expect(normalizePath('../x')).toBe('/x');
    expect(normalizePath('/../../etc/passwd')).toBe('/etc/passwd');
    expect(normalizePath('..')).toBe('/');
    expect(normalizePath('/..')).toBe('/');
  });

  it('normalizes backslashes', () => {
    expect(normalizePath('\\plugins\\LuckPerms')).toBe('/plugins/LuckPerms');
  });

  it('collapses repeated separators', () => {
    expect(normalizePath('//a///b//')).toBe('/a/b');
  });
});

describe('joinPath / splitPath / getParentPath', () => {
  it('joins under root safely', () => {
    expect(joinPath('/', 'plugins')).toBe('/plugins');
    expect(joinPath('/plugins', 'LuckPerms/../config')).toBe('/plugins/config');
  });

  it('splits and parents correctly', () => {
    expect(splitPath('/a/b/c')).toEqual(['a', 'b', 'c']);
    expect(getParentPath('/a/b/c')).toBe('/a/b');
    expect(getParentPath('/a')).toBe('/');
    expect(getParentPath('/')).toBe('/');
  });

  it('builds breadcrumbs under collapsed paths', () => {
    expect(buildBreadcrumbs('/a/../b/c')).toEqual([
      { name: 'b', path: '/b' },
      { name: 'c', path: '/b/c' },
    ]);
    expect(buildBreadcrumbs('/')).toEqual([]);
  });

  it('joinPath never escapes above root via segment', () => {
    expect(joinPath('/plugins', '../../etc/passwd')).toBe('/etc/passwd');
    expect(joinPath('/', '..')).toBe('/');
  });
});
