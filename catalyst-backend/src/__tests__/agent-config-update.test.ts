/**
 * Regression: the panel's config editor round-trips the whole agent config,
 * which always contains security-sensitive keys (release_repo, sftp, cni_*,
 * systemd, config_path). The route must forward the admin's allowUnsafe
 * opt-in and surface the agent's rejection reason instead of a bare 503.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { nodeRoutes } from '../routes/nodes.js';
import { nanoid } from 'nanoid';

let testUserId: string;
let testRoleId: string;
let testLocationId: string;
let testNodeId: string;
let lastAgentMessage: Record<string, unknown> | null = null;
let lastSentMessage: Record<string, unknown> | null = null;
let agentResponse: Record<string, unknown> = { saved: true };

function buildApp() {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: testUserId,
      email: 'agent-config-test@example.com',
      username: 'agent-config-test',
      permissions: ['*'],
    };
  });

  app.decorate('wsGateway', {
    requestFromAgent: async (_nodeId: string, message: Record<string, unknown>) => {
      lastAgentMessage = message;
      return agentResponse;
    },
    sendToAgent: async (_nodeId: string, message: Record<string, unknown>) => {
      lastSentMessage = message;
      return true;
    },
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
  } as any);

  app.register(nodeRoutes, { prefix: '/api/nodes' });
  return app;
}

beforeAll(async () => {
  const role = await prisma.role.create({
    data: { name: `test-agent-config-${nanoid(8)}`, permissions: ['*'] },
  });
  testRoleId = role.id;

  const user = await prisma.user.create({
    data: {
      email: `agent-config-${nanoid(8)}@example.com`,
      username: `agentcfg${nanoid(4)}`,
      name: 'Agent Config Test',
      emailVerified: true,
      roles: { connect: { id: testRoleId } },
    },
  });
  testUserId = user.id;

  const location = await prisma.location.create({
    data: { name: `test-agent-config-loc-${nanoid(8)}` },
  });
  testLocationId = location.id;

  const node = await prisma.node.create({
    data: {
      name: `test-agent-config-node-${nanoid(8)}`,
      locationId: testLocationId,
      hostname: 'agent-config.example.com',
      publicAddress: '10.0.0.2',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  testNodeId = node.id;
});

afterAll(async () => {
  if (testNodeId) await prisma.node.delete({ where: { id: testNodeId } }).catch(() => {});
  if (testUserId) await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  if (testRoleId) await prisma.role.delete({ where: { id: testRoleId } }).catch(() => {});
  if (testLocationId) await prisma.location.delete({ where: { id: testLocationId } }).catch(() => {});
});

describe('PUT /api/nodes/:nodeId/agent/config', () => {
  it('forwards allowUnsafe to the agent only when the admin opts in', async () => {
    const app = buildApp();
    agentResponse = { saved: true };

    lastAgentMessage = null;
    const withFlag = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${testNodeId}/agent/config`,
      payload: { content: 'server = {}', allowUnsafe: true },
    });
    expect(withFlag.statusCode).toBe(200);
    expect(lastAgentMessage).toMatchObject({
      type: 'agent_config_update',
      content: 'server = {}',
      allowUnsafe: true,
    });

    lastAgentMessage = null;
    const withoutFlag = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${testNodeId}/agent/config`,
      payload: { content: 'server = {}' },
    });
    expect(withoutFlag.statusCode).toBe(200);
    expect(lastAgentMessage).toMatchObject({ allowUnsafe: false });

    await app.close();
  });

  it('returns the agent rejection reason with a stable error code', async () => {
    const app = buildApp();
    agentResponse = {
      saved: false,
      error: "agent_config_update denies 'sftp' without allowUnsafe (backup + audit required)",
    };

    const res = await app.inject({
      method: 'PUT',
      url: `/api/nodes/${testNodeId}/agent/config`,
      payload: { content: 'server = {}' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('AGENT_CONFIG_REJECTED');
    expect(body.params?.reason).toContain("denies 'sftp'");

    await app.close();
  });
});

describe('POST /api/nodes/:nodeId/agent/update', () => {
  it('normalizes the v-prefixed GitHub tag the panel sends', async () => {
    const app = buildApp();

    lastSentMessage = null;
    const ok = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/agent/update`,
      payload: { targetVersion: 'v1.50.3' },
    });
    expect(ok.statusCode).toBe(200);
    expect(lastSentMessage).toMatchObject({ type: 'update_agent', targetVersion: '1.50.3' });

    lastSentMessage = null;
    const bad = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/agent/update`,
      payload: { targetVersion: 'not-a-version' },
    });
    expect(bad.statusCode).toBe(400);
    expect(lastSentMessage).toBeNull();

    await app.close();
  });
});
