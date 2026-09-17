import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../../db.js';
import { clearConfigCacheMemory } from '../../lib/config-cache.js';
import { createApiKey, deleteApiKey } from '../../services/api-key-service.js';
import {
  DEFAULT_MCP_SETTINGS,
  MCP_SETTING_ID,
  getMcpSettings,
  upsertMcpSettings,
} from '../../services/mcp-settings.js';
import { MCP_TOOLS, getMcpTool, planUpstreamRequest } from '../tools.js';
import { clearMcpToolRateLimits, handleMcpMessage, type McpContext } from '../protocol.js';
import { mcpRoutes } from '../../routes/mcp.js';

let testUserId: string;
let testKeyId: string;
let testApiKey: string;
let previousRow: { mcpEnabled: boolean; mcpToolRateLimitMax: number | null } | null = null;

const stubCtx: McpContext = {
  toolRateLimitMax: 1000,
  keyHash: 'test-key-hash',
  callUpstream: async () => ({ status: 200, payload: { ok: true } }),
};

function rpc(method: string, params: unknown, id: unknown = 1) {
  return { jsonrpc: '2.0', id, method, params };
}

function buildHttpApp() {
  const app = Fastify({ logger: false });
  // Downstream stub: the MCP route re-enters this instance via inject with
  // the caller's Bearer key, exactly like production re-enters real routes.
  app.get('/api/auth/me', async () => ({ id: testUserId, email: 'mcp@test.local' }));
  app.delete('/api/servers/:id', async (request) => ({ deleted: (request.params as { id: string }).id }));
  void app.register(mcpRoutes, { prefix: '/api' });
  return app;
}

async function postMcp(app: ReturnType<typeof buildHttpApp>, body: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: { 'content-type': 'application/json', ...headers },
    payload: JSON.stringify(body),
  });
}

beforeAll(async () => {
  previousRow = await prisma.systemSetting.findUnique({
    where: { id: MCP_SETTING_ID },
    select: { mcpEnabled: true, mcpToolRateLimitMax: true },
  });
  const user = await prisma.user.create({
    data: {
      email: `mcp-${nanoid(6)}@t.com`,
      name: 'mcp test',
      username: `mcp_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  testUserId = user.id;
  const record = await createApiKey({ userId: testUserId, name: 'mcp-test-key', allPermissions: true });
  testKeyId = record.id;
  testApiKey = record.key;
  clearMcpToolRateLimits();
  clearConfigCacheMemory();
});

afterAll(async () => {
  if (testKeyId) await deleteApiKey(testKeyId).catch(() => {});
  if (testUserId) {
    await prisma.auditLog.deleteMany({ where: { userId: testUserId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: testUserId } }).catch(() => {});
  }
  if (previousRow === null) {
    await prisma.systemSetting.deleteMany({ where: { id: MCP_SETTING_ID } }).catch(() => {});
  } else {
    await prisma.systemSetting.upsert({
      where: { id: MCP_SETTING_ID },
      create: {
        id: MCP_SETTING_ID,
        mcpEnabled: previousRow.mcpEnabled,
        mcpToolRateLimitMax: previousRow.mcpToolRateLimitMax,
      },
      update: { mcpEnabled: previousRow.mcpEnabled, mcpToolRateLimitMax: previousRow.mcpToolRateLimitMax },
    }).catch(() => {});
  }
  clearMcpToolRateLimits();
  clearConfigCacheMemory();
});

describe('mcp settings service', () => {
  it('defaults to disabled with the built-in tool budget', async () => {
    await prisma.systemSetting.deleteMany({ where: { id: MCP_SETTING_ID } });
    clearConfigCacheMemory();
    expect(await getMcpSettings()).toEqual({ ...DEFAULT_MCP_SETTINGS });
    expect(DEFAULT_MCP_SETTINGS.enabled).toBe(false);
  });

  it('round-trips the toggle with immediate effect (no restart)', async () => {
    await upsertMcpSettings({ enabled: true, toolRateLimitMax: 120 });
    expect(await getMcpSettings()).toEqual({ enabled: true, toolRateLimitMax: 120 });
    await upsertMcpSettings({ enabled: false });
    expect(await getMcpSettings()).toEqual({ enabled: false, toolRateLimitMax: DEFAULT_MCP_SETTINGS.toolRateLimitMax });
  });
});

describe('mcp tool registry', () => {
  it('covers the full panel surface with unique, well-formed tools', () => {
    expect(MCP_TOOLS.length).toBe(174);
    const names = MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of MCP_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema).toMatchObject({ type: 'object' });
      expect(tool.path({})).toMatch(/^\/(api|health)/);
    }
  });

  it('marks every DELETE plus the irreversible POSTs as destructive', () => {
    const destructive = new Set(MCP_TOOLS.filter((t) => t.destructive).map((t) => t.name));
    for (const tool of MCP_TOOLS) {
      if (tool.method === 'DELETE') expect(destructive.has(tool.name)).toBe(true);
    }
    for (const name of ['reinstall_server', 'restore_backup', 'ban_user', 'delete_user', 'trigger_panel_update', 'transfer_server_ownership', 'cancel_migration_job']) {
      expect(destructive.has(name)).toBe(true);
    }
    expect(destructive.has('list_servers')).toBe(false);
  });

  it('plans upstream requests without leaking the confirm flag', () => {
    const tool = getMcpTool('delete_server')!;
    const plan = planUpstreamRequest(tool, { serverId: 'abc', confirm: true });
    expect(plan).toMatchObject({ method: 'DELETE', path: '/api/servers/abc', body: undefined });
    const update = getMcpTool('update_server')!;
    const planned = planUpstreamRequest(update, { serverId: 'abc', name: 'n', confirm: true });
    expect(planned.body).toEqual({ name: 'n' });
  });
});

describe('mcp protocol', () => {
  it('negotiates initialize and answers ping', async () => {
    const init = (await handleMcpMessage(rpc('initialize', { protocolVersion: '2025-06-18' }), stubCtx))!;
    expect(init.result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
    });
    expect((init.result as { serverInfo: { name: string } }).serverInfo.name).toBe('catalyst-panel');
    expect(await handleMcpMessage(rpc('ping', {}), stubCtx)).toMatchObject({ result: {} });
  });

  it('lists all tools with destructive annotations', async () => {
    const res = (await handleMcpMessage(rpc('tools/list', {}), stubCtx))!;
    const tools = (res.result as { tools: Array<{ name: string; annotations?: Record<string, boolean> }> }).tools;
    expect(tools.length).toBe(174);
    expect(tools.find((t) => t.name === 'list_servers')).toMatchObject({ inputSchema: { type: 'object' } });
    expect(tools.find((t) => t.name === 'delete_server')?.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === 'list_servers')?.annotations).toBeUndefined();
  });

  it('rejects batches, unknown methods, and malformed envelopes', async () => {
    expect(await handleMcpMessage([rpc('ping', {})], stubCtx)).toMatchObject({
      error: { code: -32600 },
    });
    expect(await handleMcpMessage(rpc('nope/method', {}, 7), stubCtx)).toMatchObject({
      id: 7,
      error: { code: -32601 },
    });
    expect(await handleMcpMessage({ jsonrpc: '1.0', method: 'ping', id: 1 }, stubCtx)).toMatchObject({
      error: { code: -32600 },
    });
  });

  it('swallows notifications (202 path)', async () => {
    expect(await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, stubCtx)).toBeNull();
  });

  it('gates destructive tools behind confirm:true', async () => {
    let calls = 0;
    const ctx: McpContext = {
      ...stubCtx,
      callUpstream: async () => {
        calls += 1;
        return { status: 200, payload: {} };
      },
    };
    const denied = (await handleMcpMessage(
      rpc('tools/call', { name: 'delete_server', arguments: { serverId: 'x' } }),
      ctx,
    ))!;
    expect((denied.result as { isError: boolean }).isError).toBe(true);
    expect(JSON.stringify(denied.result)).toContain('confirm');
    expect(calls).toBe(0);

    const allowed = (await handleMcpMessage(
      rpc('tools/call', { name: 'delete_server', arguments: { serverId: 'x', confirm: true } }),
      ctx,
    ))!;
    expect((allowed.result as { isError?: boolean }).isError).toBeUndefined();
    expect(calls).toBe(1);
  });

  it('maps upstream failures to isError results, never throws', async () => {
    const ctx: McpContext = {
      ...stubCtx,
      callUpstream: async () => ({ status: 403, payload: { error: 'Access denied', code: 'PERMISSION_DENIED' } }),
    };
    const res = (await handleMcpMessage(rpc('tools/call', { name: 'whoami', arguments: {} }), ctx))!;
    const result = res.result as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('HTTP 403');
    expect(result.content[0].text).toContain('PERMISSION_DENIED');
  });

  it('enforces the per-key tool budget', async () => {
    clearMcpToolRateLimits();
    const ctx: McpContext = { ...stubCtx, toolRateLimitMax: 2, keyHash: `budget-${nanoid(6)}` };
    await handleMcpMessage(rpc('tools/call', { name: 'whoami', arguments: {} }), ctx);
    await handleMcpMessage(rpc('tools/call', { name: 'whoami', arguments: {} }), ctx);
    const limited = (await handleMcpMessage(rpc('tools/call', { name: 'whoami', arguments: {} }), ctx))!;
    expect(JSON.stringify(limited.result)).toContain('budget exceeded');
    clearMcpToolRateLimits();
  });
});

describe('mcp http routes', () => {
  it('404s while disabled, even with a valid key', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: false });
    const res = await postMcp(app, rpc('initialize', { protocolVersion: '2025-06-18' }), {
      authorization: `Bearer ${testApiKey}`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('rejects missing, malformed, and cookie-only auth', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    expect((await postMcp(app, rpc('ping', {}))).statusCode).toBe(401);
    expect(
      (await postMcp(app, rpc('ping', {}), { authorization: 'Bearer bogus' })).statusCode,
    ).toBe(401);
    // Session cookies are never accepted on this endpoint.
    expect(
      (await postMcp(app, rpc('ping', {}), { cookie: 'better-auth.session_token=abc' })).statusCode,
    ).toBe(401);
    await app.close();
  });

  it('serves initialize/tools-list and forwards tool calls upstream', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const auth = { authorization: `Bearer ${testApiKey}` };

    const init = await postMcp(app, rpc('initialize', { protocolVersion: '2025-06-18' }), auth);
    expect(init.statusCode).toBe(200);
    expect(init.json().result.capabilities).toMatchObject({ tools: { listChanged: false } });

    const list = await postMcp(app, rpc('tools/list', {}), auth);
    expect(list.json().result.tools.length).toBe(174);

    const who = await postMcp(app, rpc('tools/call', { name: 'whoami', arguments: {} }), auth);
    const whoResult = who.json().result as { content: Array<{ text: string }> };
    expect(whoResult.content[0].text).toContain('mcp@test.local');

    // Destructive without confirm never reaches upstream.
    const denied = await postMcp(
      app,
      rpc('tools/call', { name: 'delete_server', arguments: { serverId: 'srv1' } }),
      auth,
    );
    expect(denied.json().result.isError).toBe(true);

    const allowed = await postMcp(
      app,
      rpc('tools/call', { name: 'delete_server', arguments: { serverId: 'srv1', confirm: true } }),
      auth,
    );
    const allowedResult = allowed.json().result as { content: Array<{ text: string }> };
    expect(allowedResult.content[0].text).toContain('srv1');
    await app.close();
  });

  it('answers notifications with 202 and DELETE with 404', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const auth = { authorization: `Bearer ${testApiKey}` };
    const noted = await postMcp(app, { jsonrpc: '2.0', method: 'notifications/initialized' }, auth);
    expect(noted.statusCode).toBe(202);
    const deleted = await app.inject({ method: 'DELETE', url: '/api/mcp', headers: auth });
    expect(deleted.statusCode).toBe(404);
    await app.close();
  });

  it('restores the previous toggle state', async () => {
    await upsertMcpSettings({
      enabled: previousRow?.mcpEnabled ?? false,
      toolRateLimitMax: previousRow?.mcpToolRateLimitMax ?? DEFAULT_MCP_SETTINGS.toolRateLimitMax,
    });
  });
});
