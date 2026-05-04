/**
 * Catalyst - IPv6 Support Tests
 *
 * Tests for dual-stack IPv4/IPv6 support in IPAM, node allocations,
 * and IP pool management.
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { nodeRoutes } from '../routes/nodes.js';
import { adminRoutes } from '../routes/admin.js';
import { nanoid } from 'nanoid';
import {
  parseIp,
  formatIp,
  parseCidr,
  normalizeHostIp,
  summarizePool,
  listAvailableIps,
  allocateIpForServer,
} from '../utils/ipam.js';

// ============================================================================
// Test State
// ============================================================================

let testLocationId: string;
let testUserId: string;
let adminRoleId: string;
let testNodeId: string;
const createdPoolIds: string[] = [];
const createdAllocationIds: string[] = [];
let nextPort = 30000;

function getNextPort() {
  return nextPort++;
}

// ============================================================================
// Test App Builder
// ============================================================================

function buildTestApp(userOverrides: Record<string, any> = {}) {
  const app = Fastify({ logger: false });

  app.decorate('authenticate', async (request: any, _reply: any) => {
    request.user = {
      userId: testUserId,
      email: 'test@example.com',
      username: 'testuser',
      permissions: ['*'],
      ...userOverrides,
    };
  });

  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    sendToAgent: async () => true,
    requestFromAgent: async () => ({ success: true }),
    relayBackupStream: async () => {},
  } as any);

  return app;
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeAll(async () => {
  const location = await prisma.location.create({
    data: { name: `test-ipv6-location-${nanoid(8)}` },
  });
  testLocationId = location.id;

  const adminRole = await prisma.role.create({
    data: {
      name: `test-ipv6-admin-${nanoid(8)}`,
      description: 'Test admin role',
      permissions: ['*'],
    },
  });
  adminRoleId = adminRole.id;

  const user = await prisma.user.create({
    data: {
      email: `test-ipv6-${nanoid(8)}@example.com`,
      name: 'Test IPv6 User',
      username: `testipv6${nanoid(8)}`,
      emailVerified: true,
      roles: { connect: { id: adminRoleId } },
    },
  });
  testUserId = user.id;

  const node = await prisma.node.create({
    data: {
      name: `test-ipv6-node-${nanoid(8)}`,
      locationId: testLocationId,
      hostname: 'test-ipv6-host',
      publicAddress: '2001:db8::1',
      secret: nanoid(32),
      maxMemoryMb: 16384,
      maxCpuCores: 8,
    },
  });
  testNodeId = node.id;
});

afterAll(async () => {
  for (const id of createdAllocationIds) {
    await prisma.nodeAllocation.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdPoolIds) {
    await prisma.ipAllocation.deleteMany({ where: { poolId: id } }).catch(() => {});
    await prisma.ipPool.delete({ where: { id } }).catch(() => {});
  }
  await prisma.node.delete({ where: { id: testNodeId } }).catch(() => {});
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
  await prisma.role.delete({ where: { id: adminRoleId } }).catch(() => {});
  await prisma.location.delete({ where: { id: testLocationId } }).catch(() => {});
});

// ============================================================================
// IPAM Unit Tests
// ============================================================================

describe('IPAM - parseIp', () => {
  it('parses IPv4 address', () => {
    const result = parseIp('192.168.1.1');
    expect(result.family).toBe('v4');
    expect(result.value).toBe(0xc0a80101);
  });

  it('parses IPv6 address', () => {
    const result = parseIp('2001:db8::1');
    expect(result.family).toBe('v6');
    expect(result.value).toBe(BigInt('0x20010db8000000000000000000000001'));
  });

  it('parses IPv6 loopback', () => {
    const result = parseIp('::1');
    expect(result.family).toBe('v6');
    expect(result.value).toBe(BigInt(1));
  });

  it('parses IPv6 full form', () => {
    const result = parseIp('2001:0db8:0000:0000:0000:0000:0000:0001');
    expect(result.family).toBe('v6');
    expect(result.value).toBe(BigInt('0x20010db8000000000000000000000001'));
  });
});

describe('IPAM - formatIp', () => {
  it('formats IPv4 address', () => {
    expect(formatIp(0xc0a80101, 'v4')).toBe('192.168.1.1');
  });

  it('formats IPv6 address', () => {
    const value = BigInt('0x20010db8000000000000000000000001');
    expect(formatIp(value, 'v6')).toBe('2001:db8::1');
  });

  it('round-trips IPv6 address', () => {
    const addrs = [
      '2001:db8::1',
      '2001:db8:85a3::8a2e:370:7334',
      'fe80::1',
      '::1',
      '::',
      'ff02::1',
    ];
    for (const addr of addrs) {
      const parsed = parseIp(addr);
      expect(parsed.family).toBe('v6');
      const formatted = formatIp(parsed.value, 'v6');
      expect(formatted).toBe(addr);
    }
  });
});

describe('IPAM - parseCidr', () => {
  it('parses IPv4 CIDR', () => {
    const result = parseCidr('192.168.1.0/24');
    expect(result.family).toBe('v4');
    expect(formatIp(result.start, 'v4')).toBe('192.168.1.1'); // usable range excludes network
    expect(formatIp(result.end, 'v4')).toBe('192.168.1.254'); // usable range excludes broadcast
  });

  it('parses IPv6 CIDR /64', () => {
    const result = parseCidr('2001:db8::/64');
    expect(result.family).toBe('v6');
    expect(formatIp(result.start, 'v6')).toBe('2001:db8::1'); // usable range excludes network
    expect(formatIp(result.end, 'v6')).toBe('2001:db8::ffff:ffff:ffff:fffe'); // excludes all-ones (canonical compressed form)
  });

  it('parses IPv6 CIDR /126', () => {
    const result = parseCidr('2001:db8::/126');
    expect(result.family).toBe('v6');
    expect(formatIp(result.start, 'v6')).toBe('2001:db8::1'); // usable range excludes network
    expect(formatIp(result.end, 'v6')).toBe('2001:db8::2'); // excludes broadcast
  });

  it('parses IPv6 CIDR /128', () => {
    const result = parseCidr('2001:db8::1/128');
    expect(result.family).toBe('v6');
    expect(formatIp(result.start, 'v6')).toBe('2001:db8::1');
    expect(formatIp(result.end, 'v6')).toBe('2001:db8::1');
  });
});

describe('IPAM - normalizeHostIp', () => {
  it('accepts IPv4 non-loopback', () => {
    expect(normalizeHostIp('192.168.1.1')).toBe('192.168.1.1');
  });

  it('rejects IPv4 loopback', () => {
    expect(() => normalizeHostIp('127.0.0.1')).toThrow('loopback');
  });

  it('accepts IPv6 global unicast', () => {
    expect(normalizeHostIp('2001:db8::1')).toBe('2001:db8::1');
  });

  it('accepts IPv6 loopback ::1', () => {
    expect(normalizeHostIp('::1')).toBe('::1');
  });

  it('rejects IPv6 link-local', () => {
    expect(() => normalizeHostIp('fe80::1')).toThrow('link-local');
  });

  it('rejects IPv6 unique-local', () => {
    expect(() => normalizeHostIp('fc00::1')).toThrow('unique-local');
  });

  it('rejects IPv6 unspecified', () => {
    expect(() => normalizeHostIp('::')).toThrow('unspecified');
  });
});

describe('IPAM - summarizePool', () => {
  it('summarizes IPv4 pool', () => {
    const summary = summarizePool({
      cidr: '192.168.1.0/24',
      gateway: '192.168.1.1',
      reserved: [],
    });
    expect(summary.rangeStart).toBe('192.168.1.1'); // network address excluded
    expect(summary.rangeEnd).toBe('192.168.1.254'); // broadcast excluded
    expect(summary.total).toBe(254);
  });



  it('summarizes IPv6 pool', () => {
    const summary = summarizePool({
      cidr: '2001:db8::/64',
      gateway: '2001:db8::1',
      reserved: [],
    });
    expect(summary.rangeStart).toBe('2001:db8::1'); // network address excluded
    expect(summary.total).toBeGreaterThan(0);
  });
});

describe('IPAM - listAvailableIps', () => {
  it('lists IPv6 available IPs with limit', async () => {
    const pool = await prisma.ipPool.create({
      data: {
        nodeId: testNodeId,
        networkName: `test-ipv6-net-${nanoid(4)}`,
        cidr: '2001:db8::/126',
        gateway: '2001:db8::1',
      },
    });
    createdPoolIds.push(pool.id);

    const available = await listAvailableIps(prisma, {
      nodeId: testNodeId,
      networkName: pool.networkName,
      limit: 10,
    });

    expect(available).not.toBeNull();
    expect(available!.length).toBe(1); // /126 usable: ::1,::2; gateway ::1 reserved => only ::2
    expect(available![0]).toMatch(/2001:db8::/);
  });
});

describe('IPAM - allocateIpForServer', () => {
  it('allocates IPv6 IP for server', async () => {
    const pool = await prisma.ipPool.create({
      data: {
        nodeId: testNodeId,
        networkName: `test-ipv6-alloc-${nanoid(4)}`,
        cidr: '2001:db8:1::/126',
        gateway: '2001:db8:1::1',
      },
    });
    createdPoolIds.push(pool.id);

    const server = await prisma.server.create({
      data: {
        uuid: nanoid(32),
        name: `test-ipv6-server-${nanoid(4)}`,
        templateId: (await prisma.serverTemplate.findFirst())?.id || 'dummy',
        nodeId: testNodeId,
        locationId: testLocationId,
        ownerId: testUserId,
        allocatedMemoryMb: 1024,
        allocatedCpuCores: 1,
        primaryPort: getNextPort(),
      },
    });

    const ip = await allocateIpForServer(prisma, {
      nodeId: testNodeId,
      networkName: pool.networkName,
      serverId: server.id,
    });

    expect(ip).not.toBeNull();
    expect(ip).toMatch(/^2001:db8:1::/);

    await prisma.ipAllocation.deleteMany({ where: { serverId: server.id } });
    await prisma.server.delete({ where: { id: server.id } });
  });
});

// ============================================================================
// Node Allocation API Tests
// ============================================================================

describe('Node Allocations - IPv6', () => {
  it('creates IPv6 port allocations', async () => {
    const app = buildTestApp();
    await app.register(nodeRoutes, { prefix: '/api/nodes' });

    const port = getNextPort();
    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/allocations`,
      payload: {
        ip: '2001:db8::10',
        ports: String(port),
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(1);

    const allocation = await prisma.nodeAllocation.findFirst({
      where: { nodeId: testNodeId, port },
    });
    expect(allocation).not.toBeNull();
    expect(allocation!.ip).toBe('2001:db8::10');
    if (allocation) createdAllocationIds.push(allocation.id);
  });

  it('creates multiple IPv6 allocations', async () => {
    const app = buildTestApp();
    await app.register(nodeRoutes, { prefix: '/api/nodes' });

    const port1 = getNextPort();
    const port2 = getNextPort();
    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/allocations`,
      payload: {
        ip: '2001:db8::20, 2001:db8::21',
        ports: `${port1},${port2}`,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(4); // 2 IPs × 2 ports

    const allocs = await prisma.nodeAllocation.findMany({
      where: { nodeId: testNodeId, port: { in: [port1, port2] } },
    });
    const ips = allocs.map((a) => a.ip).sort();
    expect(ips).toContain('2001:db8::20');
    expect(ips).toContain('2001:db8::21');
    for (const a of allocs) createdAllocationIds.push(a.id);
  });

  it('creates allocations from IPv6 CIDR', async () => {
    const app = buildTestApp();
    await app.register(nodeRoutes, { prefix: '/api/nodes' });

    const port = getNextPort();
    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/allocations`,
      payload: {
        ip: '2001:db8:2::/126',
        ports: String(port),
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.data.created).toBe(2); // /126 yields 2 usable IPs

    const allocs = await prisma.nodeAllocation.findMany({
      where: { nodeId: testNodeId, port },
    });
    for (const a of allocs) createdAllocationIds.push(a.id);
  });

  it('rejects IPv6 CIDR that is too large', async () => {
    const app = buildTestApp();
    await app.register(nodeRoutes, { prefix: '/api/nodes' });

    const port = getNextPort();
    const response = await app.inject({
      method: 'POST',
      url: `/api/nodes/${testNodeId}/allocations`,
      payload: {
        ip: '2001:db8::/64',
        ports: String(port),
      },
    });

    // /64 is too large to expand into individual allocations (exceeds 5000 cap)
    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.error).toContain('CIDR expansion too large');

    const allocs = await prisma.nodeAllocation.findMany({
      where: { nodeId: testNodeId, port },
    });
    for (const a of allocs) createdAllocationIds.push(a.id);
  });
});

// ============================================================================
// Admin IP Pool API Tests
// ============================================================================

describe('Admin IP Pools - IPv6', () => {
  it('creates IPv6 IP pool via admin API', async () => {
    const app = buildTestApp();
    await app.register(adminRoutes, { prefix: '/api/admin' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/ip-pools',
      payload: {
        nodeId: testNodeId,
        networkName: `test-ipv6-pool-${nanoid(4)}`,
        cidr: '2001:db8:aa::/64',
        gateway: '2001:db8:aa::1',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);
    expect(body.data.cidr).toBe('2001:db8:aa::/64');
    expect(body.data.gateway).toBe('2001:db8:aa::1');
    createdPoolIds.push(body.data.id);
  });

  it('lists IPv6 pools with correct summary', async () => {
    const pool = await prisma.ipPool.create({
      data: {
        nodeId: testNodeId,
        networkName: `test-ipv6-list-${nanoid(4)}`,
        cidr: '2001:db8:bb::/64',
        gateway: '2001:db8:bb::1',
      },
    });
    createdPoolIds.push(pool.id);

    const app = buildTestApp();
    await app.register(nodeRoutes, { prefix: '/api/nodes' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/nodes/${testNodeId}/ip-pools`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.success).toBe(true);

    const found = body.data.find((p: any) => p.id === pool.id);
    expect(found).toBeDefined();
  });
});
