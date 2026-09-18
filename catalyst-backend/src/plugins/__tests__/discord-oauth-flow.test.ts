/**
 * End-to-end flow test for the discord-oauth plugin's OAuth handlers
 * (catalyst-plugins/discord-oauth/backend/index.js).
 *
 * Registers the plugin's routes through a stub context, then drives the
 * authorize + callback handlers with a stubbed Discord REST API (global
 * fetch). Verifies the login flow: link creation, auto-registration,
 * role sync, session creation and the final redirect.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const DISCORD_USER = {
  id: '999000111222333444',
  username: 'gamer',
  global_name: 'Gamer One',
  avatar: 'a_abc123',
  email: 'gamer@example.com',
};

const GUILD_ID = '111222333444555666';
const DISCORD_ADMIN_ROLE = '777888999000111222';

function makeReply() {
  const headers: Record<string, string> = {};
  return {
    headers,
    statusCode: 0,
    sent: false,
    header(k: string, v: string) {
      headers[k.toLowerCase()] = v;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send() {
      this.sent = true;
      return this;
    },
  };
}

function stubDiscordApi() {
  const calls: string[] = [];
  const tokenBodies: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    calls.push(url);
    const body = init?.body ? String(init.body) : '';
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

    if (url === 'https://discord.com/api/v10/oauth2/token') {
      tokenBodies.push(body);
      if (!body.includes('code=good_code')) return json({ error: 'invalid_grant' }, 400);
      return json({ access_token: 'at_discord', token_type: 'Bearer', expires_in: 604800 });
    }
    if (url === 'https://discord.com/api/v10/users/@me') {
      return json(DISCORD_USER);
    }
    if (url === `https://discord.com/api/v10/users/@me/guilds/${GUILD_ID}/member`) {
      return json({ roles: [DISCORD_ADMIN_ROLE], nick: 'gamernick', joined_at: '2024-01-01T00:00:00Z' });
    }
    return json({ error: 'Unknown' }, 404);
  }));
  return { calls, tokenBodies };
}

async function loadPlugin() {
  const mod = await import('../../../../catalyst-plugins/discord-oauth/backend/index.js');
  return mod.default;
}

interface CapturedLink {
  filter: any;
  doc: any;
}

function makeCtx() {
  const routes: Record<string, any> = {};
  const linksStore: any[] = [];
  const storage = new Map<string, unknown>();
  const created: any[] = [];
  const sessions: any[] = [];
  const events: string[] = [];
  const panelRoles = [{ id: 'p_admin', name: 'Admins', description: null }, { id: 'p_manual', name: 'Manual', description: null }];
  const userRoles = new Set<string>(['p_manual']);

  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerRoute: (o: any) => {
      routes[`${Array.isArray(o.method) ? o.method[0] : o.method} ${o.url}`] = o;
    },
    requirePermission: () => async () => {},
    emit: (e: string) => events.push(e),
    scheduleTask: vi.fn(),
    exposeApi: vi.fn(),
    getStorage: async (k: string) => (storage.has(k) ? storage.get(k) : null),
    setStorage: async (k: string, v: unknown) => {
      storage.set(k, v);
    },
    deleteStorage: async (k: string) => storage.delete(k),
    collection: () => ({
      findOne: async (filter: any) =>
        linksStore.find((l) => (filter.discordId ? l.discordId === filter.discordId : filter.userId ? l.userId === filter.userId : false)) ?? null,
      insert: async (doc: any) => {
        linksStore.push({ ...doc });
        return doc;
      },
      find: async () => [...linksStore],
      count: async () => linksStore.length,
      update: async (filter: any, update: any) => {
        for (const l of linksStore) {
          if (filter.discordId ? l.discordId === filter.discordId : filter.userId === filter.userId) {
            Object.assign(l, update.$set ?? update);
          }
        }
        return 1;
      },
      delete: async (filter: any) => {
        const i = linksStore.findIndex((l) => (filter.discordId ? l.discordId === filter.discordId : l.userId === filter.userId));
        if (i >= 0) linksStore.splice(i, 1);
        return 1;
      },
    }),
    auth: {
      findUser: vi.fn(async ({ userId, email }: any) => {
        if (email === DISCORD_USER.email) return { id: 'u_pre', email, username: 'pre', name: 'Pre', image: null, emailVerified: true, banned: false, lockedUntil: null };
        if (userId === 'u_created') return { id: 'u_created', email: DISCORD_USER.email, username: 'gamer', name: 'Gamer One', image: null, emailVerified: true, banned: false, lockedUntil: null };
        return null;
      }),
      createUser: vi.fn(async (input: any) => {
        created.push(input);
        return { id: 'u_created', ...input };
      }),
      createSession: vi.fn(async (userId: string, opts: any) => {
        sessions.push({ userId, opts });
        opts?.reply?.header('set-cookie', `better-auth.session_token=tok_${userId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
        return { token: `tok_${userId}`, expiresAt: new Date(Date.now() + 7 * 86400_000) };
      }),
      listRoles: async () => panelRoles,
      listUserRoles: async () => [...userRoles].map((id) => panelRoles.find((r) => r.id === id)!),
      assignRoles: vi.fn(async (userId: string, roleIds: string[]) => {
        roleIds.forEach((r) => userRoles.add(r));
      }),
      removeRoles: vi.fn(async (_userId: string, roleIds: string[]) => {
        roleIds.forEach((r) => userRoles.delete(r));
      }),
    },
    db: { users: { count: async () => 3 } },
    getUserId: (req: any) => req?.user?.userId ?? null,
    __routes: routes,
    __test: { linksStore, created, sessions, events, storage, getUserRoles: () => [...userRoles] },
  };
  return ctx;
}

async function configureSettings(ctx: any, overrides: Record<string, unknown> = {}) {
  await ctx.setStorage('settings', {
    clientId: 'cid',
    clientSecret: 'csecret',
    guildId: GUILD_ID,
    requireGuildMembership: true,
    requiredDiscordRoleIds: [],
    autoRegister: true,
    linkExistingByEmail: false,
    markEmailVerified: true,
    defaultRoleIds: [],
    roleMappings: [{ discordRoleId: DISCORD_ADMIN_ROLE, panelRoleId: 'p_admin' }],
    syncMode: 'replaceManaged',
    syncSchedule: '0 * * * *',
    syncEnabled: false,
    loginDisabled: false,
    removeLinkOnLeave: false,
    ...overrides,
  });
}

describe('discord-oauth OAuth flow (handlers driven directly)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  // The backend suite runs with isolate:false — a stubbed global would leak
  // into every test file that runs after this one.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('completes the sign-in flow: register, link, sync roles, create session, redirect', async () => {
    stubDiscordApi();
    const plugin = await loadPlugin();
    const ctx = makeCtx();
    await plugin.onLoad(ctx);
    await configureSettings(ctx);

    // 1. authorize → Discord redirect with signed state + PKCE
    const authReply = makeReply();
    await routes(ctx)['GET /authorize'].handler(
      { headers: { host: 'panel.example' }, protocol: 'https', query: { redirect: '/servers' }, ip: '203.0.113.9' },
      authReply,
    );
    expect(authReply.headers.location).toContain('https://discord.com/oauth2/authorize?');
    const authorizeUrl = new URL(authReply.headers.location!);
    expect(authorizeUrl.searchParams.get('client_id')).toBe('cid');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('scope')).toContain('guilds.members.read');
    const state = authorizeUrl.searchParams.get('state')!;

    // 2. callback with the echoed state
    const cbReply = makeReply();
    await routes(ctx)['GET /callback'].handler(
      {
        headers: { host: 'panel.example', 'user-agent': 'TestAgent' },
        protocol: 'https',
        query: { code: 'good_code', state },
        ip: '203.0.113.9',
      },
      cbReply,
    );

    // Registered a new user, linked, synced the mapped role, opened a session.
    expect(ctx.__test.created).toHaveLength(1);
    expect(ctx.__test.created[0]).toMatchObject({ email: 'gamer@example.com', username: 'gamer', emailVerified: true });
    expect(ctx.__test.linksStore).toHaveLength(1);
    expect(ctx.__test.linksStore[0]).toMatchObject({ userId: 'u_created', discordId: DISCORD_USER.id, roles: [DISCORD_ADMIN_ROLE] });
    expect(ctx.__test.getUserRoles().sort()).toEqual(['p_admin', 'p_manual']);
    expect(ctx.__test.sessions).toHaveLength(1);
    expect(ctx.__test.sessions[0]).toMatchObject({ userId: 'u_created' });
    expect(cbReply.headers['set-cookie']).toContain('better-auth.session_token=tok_u_created');
    expect(cbReply.headers.location).toBe('/servers');
    expect(ctx.__test.events).toContain('discord:user_signed_in');
  });

  it('rejects a tampered state and an expired state', async () => {
    stubDiscordApi();
    const plugin = await loadPlugin();
    const ctx = makeCtx();
    await plugin.onLoad(ctx);
    await configureSettings(ctx);

    const reply = makeReply();
    await routes(ctx)['GET /callback'].handler(
      { headers: { host: 'panel.example' }, protocol: 'https', query: { code: 'good_code', state: 'AAA.BBB' } },
      reply,
    );
    expect(reply.headers.location).toContain('oauthError=bad_state');

    // Valid signature but expired payload: mint one from the plugin's own
    // state secret, with exp in the past.
    const secret = (await ctx.getStorage('stateSecret')) as string;
    const { createHmac } = await import('node:crypto');
    const payload = Buffer.from(JSON.stringify({ mode: 'login', exp: Date.now() - 1000, verifier: 'v' })).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('base64url');
    const reply2 = makeReply();
    await routes(ctx)['GET /callback'].handler(
      { headers: { host: 'panel.example' }, protocol: 'https', query: { code: 'good_code', state: `${payload}.${sig}` } },
      reply2,
    );
    expect(reply2.headers.location).toContain('oauthError=bad_state');
  });

  it('denies sign-in when guild membership is required but missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://discord.com/api/v10/oauth2/token') {
        return new Response(JSON.stringify({ access_token: 'at', token_type: 'Bearer' }), { status: 200 });
      }
      if (url === 'https://discord.com/api/v10/users/@me') {
        return new Response(JSON.stringify(DISCORD_USER), { status: 200 });
      }
      if (url.startsWith('https://discord.com/api/v10/users/@me/guilds/')) {
        return new Response(JSON.stringify({ message: 'Unknown Guild' }), { status: 404 });
      }
      return new Response(JSON.stringify({ message: 'Unknown' }), { status: 404 });
    }));
    const plugin = await loadPlugin();
    const ctx = makeCtx();
    await plugin.onLoad(ctx);
    await configureSettings(ctx, { autoRegister: false });

    const authReply = makeReply();
    await routes(ctx)['GET /authorize'].handler({ headers: { host: 'panel.example' }, protocol: 'https', query: {} }, authReply);
    const state = new URL(authReply.headers.location!).searchParams.get('state')!;

    const cbReply = makeReply();
    await routes(ctx)['GET /callback'].handler(
      { headers: { host: 'panel.example' }, protocol: 'https', query: { code: 'good_code', state } },
      cbReply,
    );
    expect(cbReply.headers.location).toContain('oauthError=guild_required');
    expect(ctx.__test.sessions).toHaveLength(0);
  });

  it('link mode attaches the Discord identity to the signed-in user', async () => {
    stubDiscordApi();
    const plugin = await loadPlugin();
    const ctx = makeCtx();
    await plugin.onLoad(ctx);
    await configureSettings(ctx);

    // Signed-in user starts a link: authorize in optional-auth mode sees request.user.
    const authReply = makeReply();
    await routes(ctx)['GET /authorize'].handler(
      {
        headers: { host: 'panel.example' },
        protocol: 'https',
        query: { mode: 'link' },
        user: { userId: 'u_pre', permissions: [] },
      },
      authReply,
    );
    expect(authReply.headers.location).toContain('/authorize?');
    const state = new URL(authReply.headers.location!).searchParams.get('state')!;

    const cbReply = makeReply();
    await routes(ctx)['GET /callback'].handler(
      { headers: { host: 'panel.example' }, protocol: 'https', query: { code: 'good_code', state } },
      cbReply,
    );
    expect(cbReply.headers.location).toContain('/profile?discord=linked');
    expect(ctx.__test.linksStore).toHaveLength(1);
    expect(ctx.__test.linksStore[0]).toMatchObject({ userId: 'u_pre', discordId: DISCORD_USER.id });
    expect(ctx.__test.created).toHaveLength(0); // linked, not registered
    expect(ctx.__test.sessions).toHaveLength(0); // no new session for link mode
  });

  it('uses the configured public URL for redirect_uri when proxies rewrite Host (tunnel/dev setups)', async () => {
    const { tokenBodies } = stubDiscordApi();
    const plugin = await loadPlugin();
    const ctx = makeCtx();
    await plugin.onLoad(ctx);
    await configureSettings(ctx, { frontendUrl: 'https://panel.catalystctl.com' });

    // The backend only sees the last proxy hop: Host 127.0.0.1:3000, http.
    const authReply = makeReply();
    await routes(ctx)['GET /authorize'].handler(
      { headers: { host: '127.0.0.1:3000' }, protocol: 'http', query: { redirect: '/servers' }, ip: '203.0.113.9' },
      authReply,
    );
    const authorizeUrl = new URL(authReply.headers.location!);
    expect(authorizeUrl.searchParams.get('redirect_uri')).toBe(
      'https://panel.catalystctl.com/api/plugins/discord-oauth/callback',
    );
    const state = authorizeUrl.searchParams.get('state')!;

    // Token exchange must send the SAME redirect_uri Discord saw.
    const cbReply = makeReply();
    await routes(ctx)['GET /callback'].handler(
      { headers: { host: '127.0.0.1:3000' }, protocol: 'http', query: { code: 'good_code', state }, ip: '203.0.113.9' },
      cbReply,
    );
    expect(tokenBodies[0]).toContain(
      `redirect_uri=${encodeURIComponent('https://panel.catalystctl.com/api/plugins/discord-oauth/callback')}`,
    );
    // Post-login redirect also targets the public origin.
    expect(cbReply.headers.location).toBe('https://panel.catalystctl.com/servers');
  });
});

function routes(ctx: any): Record<string, any> {
  return ctx.__routes;
}
