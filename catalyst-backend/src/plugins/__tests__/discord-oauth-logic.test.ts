/**
 * Tests for the discord-oauth plugin's pure logic
 * (catalyst-plugins/discord-oauth/backend/sync.js + state helpers in index.js).
 */
import { describe, it, expect, vi } from 'vitest';
import { syncUserRoles } from '../../../../catalyst-plugins/discord-oauth/backend/sync.js';

function makeCtx(currentRoles: string[] = []) {
  return {
    emit: vi.fn(),
    auth: {
      listUserRoles: vi.fn(async () => currentRoles.map((id) => ({ id, name: `role-${id}` }))),
      assignRoles: vi.fn(async () => {}),
      removeRoles: vi.fn(async () => {}),
    },
  };
}

type SyncSettings = Parameters<typeof syncUserRoles>[0]['settings'];

const settings = (overrides: Partial<SyncSettings> = {}): SyncSettings => ({
  syncMode: 'replaceManaged',
  roleMappings: [
    { discordRoleId: 'd_admin', panelRoleId: 'p_admin' },
    { discordRoleId: 'd_mod', panelRoleId: 'p_mod' },
    { discordRoleId: 'd_other', panelRoleId: 'p_mod' }, // two discord roles → one panel role
  ],
  ...overrides,
});

describe('syncUserRoles', () => {
  it('assigns mapped panel roles for held discord roles', async () => {
    const ctx = makeCtx([]);
    const result = await syncUserRoles(ctx, { userId: 'u1', discordRoleIds: ['d_admin'], settings: settings(), trigger: 'login' });
    expect(result.assigned).toEqual(['p_admin']);
    expect(result.removed).toEqual([]);
    expect(ctx.auth.assignRoles).toHaveBeenCalledWith('u1', ['p_admin'], expect.anything());
    expect(ctx.auth.removeRoles).not.toHaveBeenCalled();
  });

  it('unions multiple discord roles mapping to the same panel role', async () => {
    const ctx = makeCtx([]);
    const result = await syncUserRoles(ctx, { userId: 'u1', discordRoleIds: ['d_mod', 'd_other'], settings: settings(), trigger: 'login' });
    expect(result.assigned).toEqual(['p_mod']); // deduped
  });

  it('replaceManaged removes managed roles that lost their discord source, keeps unmanaged ones', async () => {
    const ctx = makeCtx(['p_admin', 'p_manual']);
    const result = await syncUserRoles(ctx, { userId: 'u1', discordRoleIds: [], settings: settings(), trigger: 'scheduled' });
    expect(result.removed).toEqual(['p_admin']); // p_manual is not covered by any mapping
    expect(ctx.auth.removeRoles).toHaveBeenCalledWith('u1', ['p_admin'], expect.anything());
  });

  it('addOnly never removes roles', async () => {
    const ctx = makeCtx(['p_admin', 'p_mod']);
    const result = await syncUserRoles(ctx, {
      userId: 'u1',
      discordRoleIds: [],
      settings: settings({ syncMode: 'addOnly' }),
      trigger: 'scheduled',
    });
    expect(result.removed).toEqual([]);
    expect(ctx.auth.removeRoles).not.toHaveBeenCalled();
  });

  it('no-ops when the mapping outcome already matches current roles', async () => {
    const ctx = makeCtx(['p_mod']);
    const result = await syncUserRoles(ctx, { userId: 'u1', discordRoleIds: ['d_mod'], settings: settings(), trigger: 'login' });
    expect(result).toEqual({ assigned: [], removed: [] });
    expect(ctx.emit).not.toHaveBeenCalled();
  });
});
