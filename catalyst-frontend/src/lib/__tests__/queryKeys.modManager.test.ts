import { describe, expect, it } from 'vitest';
import { qk } from '../queryKeys';

/**
 * The search cache key must vary with every input that changes the response.
 * Omitting the target made switching Mods → Modpacks serve the cached Mods
 * results, so the filter looked broken (no request was made).
 */
describe('modManagerSearch query key', () => {
  const base = ['srv-1', 'modrinth', 'cobblemon', '', 1] as const;

  it('changes when the target changes', () => {
    const mods = qk.modManagerSearch(...base, { target: 'mods' });
    const modpacks = qk.modManagerSearch(...base, { target: 'modpacks' });
    expect(modpacks).not.toEqual(mods);
  });

  it('changes when the loader changes', () => {
    const forge = qk.modManagerSearch(...base, { target: 'modpacks', loader: 'forge' });
    const fabric = qk.modManagerSearch(...base, { target: 'modpacks', loader: 'fabric' });
    expect(fabric).not.toEqual(forge);
  });

  it('changes when the sort changes', () => {
    const a = qk.modManagerSearch(...base, { target: 'modpacks', sort: 'newest' });
    const b = qk.modManagerSearch(...base, { target: 'modpacks', sort: 'downloads' });
    expect(a).not.toEqual(b);
  });

  it('changes when categories change, including order-sensitively for different sets', () => {
    const none = qk.modManagerSearch(...base, { target: 'modpacks' });
    const one = qk.modManagerSearch(...base, { target: 'modpacks', categories: ['magic'] });
    const two = qk.modManagerSearch(...base, { target: 'modpacks', categories: ['magic', 'quests'] });
    expect(new Set([JSON.stringify(none), JSON.stringify(one), JSON.stringify(two)]).size).toBe(3);
  });

  it('still varies with the existing inputs (query, game version, page)', () => {
    const a = qk.modManagerSearch('srv-1', 'modrinth', 'sodium', '', 1, { target: 'mods' });
    const b = qk.modManagerSearch('srv-1', 'modrinth', 'lithium', '', 1, { target: 'mods' });
    const c = qk.modManagerSearch('srv-1', 'modrinth', 'sodium', '1.20.1', 1, { target: 'mods' });
    const d = qk.modManagerSearch('srv-1', 'modrinth', 'sodium', '', 2, { target: 'mods' });
    expect(new Set([a, b, c, d].map((k) => JSON.stringify(k))).size).toBe(4);
  });

  it('treats omitted filters and defaults as the same key', () => {
    expect(qk.modManagerSearch(...base)).toEqual(
      qk.modManagerSearch(...base, { target: 'mods', loader: '', sort: '', categories: [] }),
    );
  });
});

describe('modManagerCategories query key', () => {
  it('is scoped by provider, game and target', () => {
    const base = qk.modManagerCategories('srv-1', 'modrinth', '', 'modpacks');
    expect(base).not.toEqual(qk.modManagerCategories('srv-1', 'modrinth', '', 'mods'));
    expect(base).not.toEqual(qk.modManagerCategories('srv-1', 'curseforge', '', 'modpacks'));
  });
});
