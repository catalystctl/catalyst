import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import { createPluginContext } from '../context';
import { collectAuthProviders } from '../auth-providers';

/**
 * Contract under test: the plugin auth bridge methods are live-gated on the
 * auth.sessions / auth.users / roles.assign grants, so a revoked grant fails
 * closed even for a plugin that previously held it. Session creation is
 * exercised with a stubbed host auth module (better-auth internals).
 */

vi.mock('../../auth', () => ({
  getAuth: () => ({
    $context: {
      secret: 'unit-test-secret',
      internalAdapter: {
        createSession: vi.fn(async (userId: string, dontRememberMe: boolean, override: any) => ({
          token: `tok_${userId}`,
          expiresAt: new Date(Date.now() + (dontRememberMe ? 3600_000 : 7 * 86400_000)),
          override,
        })),
      },
      authCookies: {
        sessionToken: { name: 'better-auth.session_token', attributes: { secure: false } },
      },
    },
  }),
}));

function makeLogger(): Logger {
  return {
    child: () => makeLogger(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function makePrisma() {
  return {
    user: {
      findFirst: vi.fn(async ({ where }: any) => {
        if (where?.email) return { id: 'u_email', email: where.email, username: 'found', name: 'Found', image: null, emailVerified: true, banned: false, lockedUntil: null };
        if (where?.id || where?.username) return { id: where.id ?? 'u_1', email: 'a@b.c', username: 'found', name: 'Found', image: null, emailVerified: true, banned: false, lockedUntil: null };
        return null;
      }),
      create: vi.fn(async ({ data }: any) => ({
        id: 'u_new', email: data.email, username: data.username, name: data.name,
        image: data.image ?? null, emailVerified: data.emailVerified ?? false, banned: false, lockedUntil: null,
      })),
      update: vi.fn(async () => ({})),
      findUnique: vi.fn(async () => ({ roles: [{ id: 'r_1', name: 'Member', description: null }] })),
    },
    role: {
      findMany: vi.fn(async () => [{ id: 'r_1', name: 'Member', description: null }]),
    },
    plugin: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    pluginStorage: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    pluginActionAudit: { create: vi.fn() },
  } as any;
}

function createContext(grants: string[]) {
  let current = grants;
  const ctx = createPluginContext(
    {
      name: 'oauth-plugin',
      version: '1.0.0',
      displayName: 'OAuth',
      description: '',
      author: '',
      catalystVersion: '>=1.0.0',
      permissions: [...current],
    },
    undefined,
    makePrisma(),
    makeLogger(),
    {} as any,
    [],
    [],
    new Map(),
    new Map(),
    new Map(),
    { emit: vi.fn(), on: vi.fn() } as any,
    undefined,
    { registerExposedApi: vi.fn(), getExposedApi: vi.fn(() => undefined), recordRpcSuccess: vi.fn(), recordRpcFailure: vi.fn() } as any,
    () => current,
  );
  return {
    ctx,
    setGrants(next: string[]) {
      current = next;
    },
  };
}

describe('ctx.auth live permission gates', () => {
  it('findUser works with auth.users and fails closed when revoked', async () => {
    const { ctx, setGrants } = createContext(['auth.users']);
    await expect(ctx.auth!.findUser({ email: 'someone@example.com' })).resolves.toMatchObject({ id: 'u_email' });
    setGrants([]);
    await expect(ctx.auth!.findUser({ email: 'someone@example.com' })).rejects.toThrow(/auth\.users/);
  });

  it('createUser validates input and rejects without the grant', async () => {
    // Permission gate fires before validation — fail closed on grants first.
    const { ctx } = createContext([]);
    await expect(ctx.auth!.createUser({ email: 'new@example.com', username: 'new', name: 'New' })).rejects.toThrow(/auth\.users/);

    const { ctx: grantedCtx } = createContext(['auth.users']);
    await expect(grantedCtx.auth!.createUser({ email: 'bad', username: 'x', name: 'X' })).rejects.toThrow(/Invalid email/);
  });

  it('createSession requires auth.sessions and sets the session cookie on the reply', async () => {
    const { ctx, setGrants } = createContext(['auth.sessions']);
    const reply = { header: vi.fn() };
    const session = await ctx.auth!.createSession('u_1', { reply, rememberMe: true });
    expect(session.token).toBe('tok_u_1');
    expect(reply.header).toHaveBeenCalledWith(
      'set-cookie',
      expect.stringContaining('better-auth.session_token=tok_u_1'),
    );
    expect(reply.header).toHaveBeenCalledWith('set-cookie', expect.stringContaining('HttpOnly'));

    setGrants([]);
    await expect(ctx.auth!.createSession('u_1')).rejects.toThrow(/auth\.sessions/);
  });

  it('role operations require roles.assign and audit changes', async () => {
    const { ctx, setGrants } = createContext(['roles.assign']);
    await expect(ctx.auth!.listRoles()).resolves.toEqual([{ id: 'r_1', name: 'Member', description: null }]);
    await expect(ctx.auth!.listUserRoles('u_1')).resolves.toEqual([{ id: 'r_1', name: 'Member', description: null }]);
    await expect(ctx.auth!.assignRoles('u_1', ['r_1'], { reason: 'test' })).resolves.toBeUndefined();
    await expect(ctx.auth!.removeRoles('u_1', ['r_1'])).resolves.toBeUndefined();

    setGrants([]);
    await expect(ctx.auth!.assignRoles('u_1', ['r_1'])).rejects.toThrow(/roles\.assign/);
  });

  it('assignRoles with empty/unknown role list is a no-op', async () => {
    const { ctx } = createContext(['roles.assign']);
    await expect(ctx.auth!.assignRoles('u_1', [])).resolves.toBeUndefined();
    await expect(ctx.auth!.assignRoles('u_1', ['unknown'])).resolves.toBeUndefined();
  });
});

describe('collectAuthProviders', () => {
  const plugin = (name: string, status: string, authProviders: any) => ({
    manifest: {
      name,
      version: '1.0.0',
      displayName: name,
      description: '',
      author: '',
      catalystVersion: '>=1.0.0',
      permissions: [],
      ...(authProviders ? { authProviders } : {}),
    },
    status,
  });

  it('lists providers of enabled plugins only, with default authorize path', () => {
    const providers = collectAuthProviders([
      plugin('discord-oauth', 'enabled', [{ id: 'discord', label: 'Discord' }]),
      plugin('disabled-oauth', 'disabled', [{ id: 'discord', label: 'Discord' }]),
      plugin('plain-plugin', 'enabled', undefined),
    ] as any);
    expect(providers).toEqual([
      {
        plugin: 'discord-oauth',
        id: 'discord',
        label: 'Discord',
        authorizeUrl: '/api/plugins/discord-oauth/authorize',
      },
    ]);
  });

  it('honours custom authorize paths and skips malformed entries', () => {
    const providers = collectAuthProviders([
      plugin('p', 'enabled', [
        { id: 'custom', label: 'Custom', authorizePath: '/start-here' },
        { label: 'NoId' },
        null,
      ]),
    ] as any);
    expect(providers).toEqual([
      { plugin: 'p', id: 'custom', label: 'Custom', authorizeUrl: '/api/plugins/p/start-here' },
    ]);
  });
});
