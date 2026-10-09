import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { clearConfigCacheMemory } from '../lib/config-cache.js';
import { createApiKey, deleteApiKey } from '../services/api-key-service.js';
import { upsertMcpSettings, MCP_SETTING_ID } from '../services/mcp-settings.js';
import { mcpRoutes } from '../routes/mcp.js';

let testUserId: string;
let testKeyId: string;
let testApiKey: string;
let previousRow: { mcpEnabled: boolean; mcpToolRateLimitMax: number | null } | null = null;

function buildHttpApp() {
  const app = Fastify({ logger: false });
  app.get('/api/auth/me', async () => ({ id: testUserId, email: 'mcp@test.local' }));
  void app.register(mcpRoutes, { prefix: '/api' });
  return app;
}

beforeAll(async () => {
  previousRow = await prisma.systemSetting.findUnique({
    where: { id: MCP_SETTING_ID },
    select: { mcpEnabled: true, mcpToolRateLimitMax: true },
  });
  const user = await prisma.user.create({
    data: {
      email: `mcp-routes-${nanoid(6)}@t.com`,
      name: 'mcp routes test',
      username: `mcp_rt_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  testUserId = user.id;
  const record = await createApiKey({ userId: testUserId, name: 'mcp-routes-test-key', allPermissions: true });
  testKeyId = record.id;
  testApiKey = record.key;
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
  clearConfigCacheMemory();
});

describe('POST /api/mcp - happy path', () => {
  it('accepts a valid initialize request with Bearer auth', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${testApiKey}`,
      },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.protocolVersion).toBe('2025-06-18');
    expect(body.result.serverInfo.name).toBe('catalyst-panel');
    await app.close();
  });

  it('responds to ping requests', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${testApiKey}` },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toEqual({});
    await app.close();
  });
});

describe('POST /api/mcp - error cases', () => {
  it('returns 404 when MCP is disabled', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: false });
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${testApiKey}` },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('returns 401 without Bearer authorization', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns 401 with invalid API key', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { 'content-type': 'application/json', authorization: 'Bearer catalyst_fake_key' },
      payload: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns JSON-RPC parse error for malformed JSON', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${testApiKey}` },
      payload: '{"invalid": "json"',
    });
    expect([200, 400]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.error.code).toBe(-32700);
      expect(body.error.message).toContain('Parse error');
    }
    await app.close();
  });

  it('returns 202 for notifications without response body', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const res = await app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${testApiKey}` },
      payload: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
    await app.close();
  });
});

describe('GET /api/mcp - SSE stream', () => {
  it('verifies SSE endpoint accepts valid auth', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    
    // SSE streams are long-lived; we verify the endpoint exists and accepts auth
    // The actual stream behavior is tested in the existing mcp.test.ts
    const res = await app.inject({
      method: 'GET',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${testApiKey}` },
    });
    
    // May return 200 with stream headers or connection may close immediately in test
    expect([200, 503]).toContain(res.statusCode);
    await app.close();
  });

  it('returns 401 without Bearer auth', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const res = await app.inject({ method: 'GET', url: '/api/mcp' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('DELETE /api/mcp - stateless mode', () => {
  it('returns 404 because there are no sessions to terminate', async () => {
    const app = buildHttpApp();
    await upsertMcpSettings({ enabled: true });
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${testApiKey}` },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
