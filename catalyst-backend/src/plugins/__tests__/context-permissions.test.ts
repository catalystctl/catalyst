import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import { createPluginContext } from '../context';

/**
 * Contract under test: permission checks consult the live grants provider on
 * every call, so an admin revoking a grant mid-flight takes effect immediately
 * without recreating the plugin context.
 */

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
    server: {
      findMany: vi.fn(async () => [{ id: 'srv_1' }]),
      update: vi.fn(async ({ where }: any) => ({ id: where.id })),
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => null),
    },
  } as any;
}

function createContext(grants: string[]) {
  let current = grants;
  const prisma = makePrisma();
  // Minimal registry stub: none of its APIs are registered, so granted calls
  // fail at the lookup stage while revoked calls must fail at the gate stage.
  const registryStub = {
    registerExposedApi: vi.fn(),
    getExposedApi: vi.fn(() => undefined),
    recordRpcSuccess: vi.fn(),
    recordRpcFailure: vi.fn(),
  };
  const ctx = createPluginContext(
    {
      name: 'test-plugin',
      version: '1.0.0',
      displayName: 'Test',
      description: '',
      author: '',
      catalystVersion: '>=1.0.0',
      permissions: [...current],
    },
    undefined,
    prisma,
    makeLogger(),
    {} as any,
    [],
    [],
    new Map(),
    new Map(),
    new Map(),
    { emit: vi.fn(), on: vi.fn() } as any,
    undefined,
    registryStub as any,
    () => current,
  );
  return {
    ctx,
    setGrants(next: string[]) {
      current = next;
    },
    prisma,
  };
}

describe('ScopedPluginDBClient live permission checks', () => {
  it('grants read + whitelisted write when declared', async () => {
    const { ctx, prisma } = createContext(['server.read', 'server.write']);
    await expect(ctx.db.servers.findMany()).resolves.toEqual([{ id: 'srv_1' }]);
    await expect(ctx.db.servers.update('srv_1', { status: 'suspended' })).resolves.toMatchObject({
      id: 'srv_1',
    });
    expect(prisma.server.update).toHaveBeenCalled();
  });

  it('applies revocation immediately — reads denied after revoke', async () => {
    const { ctx, setGrants } = createContext(['server.read', 'server.write']);
    await expect(ctx.db.servers.findMany()).resolves.toBeTruthy();

    setGrants([]); // admin revoked everything

    // Table access throws synchronously from the getter itself
    expect(() => ctx.db.servers).toThrow(/servers access not declared/);
  });

  it('applies revocation immediately — writes denied while untouched grants still read', async () => {
    const { ctx, setGrants } = createContext(['server.read', 'server.write']);
    setGrants(['server.read']); // only server.write revoked

    await expect(ctx.db.servers.update('srv_1', { status: 'running' })).rejects.toThrow(
      /server\.write permission required/,
    );
    // Read still permitted
    await expect(ctx.db.servers.findMany()).resolves.toBeTruthy();
  });

  it('re-granting restores access without recreating the context', async () => {
    const { ctx, setGrants } = createContext([]);
    expect(() => ctx.db.servers).toThrow(/servers access not declared/);
    setGrants(['server.read']);
    await expect(ctx.db.servers.count()).resolves.toBe(0);
  });

  it('wildcard grant enables everything and remains live', async () => {
    const { ctx, setGrants } = createContext(['*']);
    await expect(ctx.db.servers.update('srv_1', { status: 'suspended' })).resolves.toBeTruthy();
    setGrants([]);
    expect(() => ctx.db.servers).toThrow(/servers access not declared/);
  });

  it('plugin.rpc gate follows live grants', async () => {
    // No registry exposed API registered → call should fail at the API lookup
    // stage when granted, but at the permission stage when revoked.
    const { ctx, setGrants } = createContext([]);
    await expect(ctx.callPluginApi('other-plugin', 'apiName')).rejects.toThrow(
      /plugin\.rpc permission required/,
    );
    setGrants(['plugin.rpc']);
    await expect(ctx.callPluginApi('missing-plugin', 'apiName')).rejects.toThrow(
      /does not expose API/,
    );
  });
});
