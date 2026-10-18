import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import { createPluginContext } from '../context';
import {
  classifyFileTunnelOp,
  canReadFiles,
  canWriteFiles,
  canDriveAgentConsole,
} from '../capabilities';

/**
 * B3-2 contract: the raw WebSocket gateway and file tunnel are never handed
 * to plugins. Scoped facades gate every operation against the plugin's LIVE
 * effective grants, expose no host internals, and fail closed on unknown ops.
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
    server: { findMany: vi.fn(async () => []), findUnique: vi.fn(), count: vi.fn(async () => 0), update: vi.fn() },
    plugin: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    pluginStorage: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    pluginActionAudit: { create: vi.fn() },
  } as any;
}

/** Mocked real gateway — records calls so the facade's delegation is verifiable. */
function makeGateway() {
  return {
    sendToAgent: vi.fn(async (_nodeId: string, _message: unknown) => true),
    broadcastToAuthenticated: vi.fn((_message: unknown) => {}),
    sendToClient: vi.fn((_clientId: string, _message: unknown) => true),
    registerPluginWsHandler: vi.fn((_type: string, _handler: unknown, _name: string) => {}),
    unregisterPluginWsHandlers: vi.fn((_name: string) => {}),
  } as any;
}

function makeFileTunnel() {
  return {
    queueRequest: vi.fn(
      async (
        _nodeId: string,
        _operation: string,
        _serverUuid: string,
        _filePath: string,
        _data?: Record<string, unknown>,
        _uploadData?: Buffer,
      ) => ({ requestId: 'r_1', success: true }),
    ),
  } as any;
}

function setup(grants: string[]) {
  let current = grants;
  const gateway = makeGateway();
  const fileTunnel = makeFileTunnel();
  const ctx = createPluginContext(
    {
      name: 'gate-test-plugin',
      version: '1.0.0',
      displayName: 'Gate',
      description: '',
      author: '',
      catalystVersion: '>=1.0.0',
      permissions: [...current],
    },
    undefined,
    makePrisma(),
    makeLogger(),
    gateway,
    [],
    [],
    new Map(),
    new Map(),
    new Map(),
    { emit: vi.fn(), on: vi.fn() } as any,
    undefined,
    undefined,
    () => current,
    fileTunnel,
  );
  return {
    ctx,
    gateway,
    fileTunnel,
    setGrants(next: string[]) {
      current = next;
    },
  };
}

describe('classifyFileTunnelOp', () => {
  it('classifies read ops', () => {
    for (const op of ['list', 'download', 'archive-contents']) {
      expect(classifyFileTunnelOp(op)).toBe('read');
    }
  });
  it('classifies write ops', () => {
    for (const op of ['upload', 'write', 'create', 'delete', 'rename', 'permissions', 'compress', 'decompress', 'install-url']) {
      expect(classifyFileTunnelOp(op)).toBe('write');
    }
  });
  it('fails closed on unknown ops', () => {
    expect(classifyFileTunnelOp('nonsense')).toBe('unknown');
    expect(classifyFileTunnelOp('')).toBe('unknown');
    expect(classifyFileTunnelOp('LIST')).toBe('unknown');
  });
});

describe('capability gate predicates', () => {
  it('canReadFiles is satisfied by any read/write/server grant', () => {
    expect(canReadFiles([])).toBe(false);
    expect(canReadFiles(['files.read'])).toBe(true);
    expect(canReadFiles(['files.write'])).toBe(true);
    expect(canReadFiles(['server.read'])).toBe(true);
    expect(canReadFiles(['server.write'])).toBe(true);
    expect(canReadFiles(['*'])).toBe(true);
    expect(canReadFiles(['admin.write'])).toBe(true);
    expect(canReadFiles(['user.read'])).toBe(false);
  });

  it('canWriteFiles is satisfied by files.write or server.write', () => {
    expect(canWriteFiles([])).toBe(false);
    expect(canWriteFiles(['files.read'])).toBe(false);
    expect(canWriteFiles(['files.write'])).toBe(true);
    expect(canWriteFiles(['server.write'])).toBe(true);
    expect(canWriteFiles(['*'])).toBe(true);
    expect(canWriteFiles(['admin.write'])).toBe(true);
    expect(canWriteFiles(['server.read'])).toBe(false);
  });

  it('canDriveAgentConsole is satisfied by console.write or server.write', () => {
    expect(canDriveAgentConsole([])).toBe(false);
    expect(canDriveAgentConsole(['console.read'])).toBe(false);
    expect(canDriveAgentConsole(['console.write'])).toBe(true);
    expect(canDriveAgentConsole(['server.write'])).toBe(true);
    expect(canDriveAgentConsole(['*'])).toBe(true);
    expect(canDriveAgentConsole(['admin.write'])).toBe(true);
  });
});

describe('file tunnel facade gating', () => {
  it('denies read AND write AND unknown ops with zero grants', async () => {
    const { ctx } = setup([]);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'list', 's1', '/')).rejects.toThrow(/Permission denied/);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'write', 's1', '/', { content: 'x' })).rejects.toThrow(/Permission denied/);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'decompress', 's1', '/')).rejects.toThrow(/Permission denied/);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'not-a-real-op', 's1', '/')).rejects.toThrow(/not permitted \(unknown op\)/);
  });

  it('allows ai-assistant grants (server.read, files.read, files.write) for list/download/write', async () => {
    const { ctx, fileTunnel } = setup(['server.read', 'files.read', 'files.write']);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'list', 's1', '/')).resolves.toMatchObject({ success: true });
    await expect(ctx.fileTunnel!.queueRequest('n1', 'download', 's1', '/f.txt')).resolves.toMatchObject({ success: true });
    await expect(ctx.fileTunnel!.queueRequest('n1', 'write', 's1', '/f.txt', { content: 'x' })).resolves.toMatchObject({ success: true });
    expect(fileTunnel.queueRequest).toHaveBeenCalledTimes(3);
  });

  it('allows fastdl-sync grants (server.read, server.write, files.read, files.write) for list/download/upload/delete', async () => {
    const { ctx, fileTunnel } = setup(['server.read', 'server.write', 'files.read', 'files.write']);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'list', 's1', '/')).resolves.toMatchObject({ success: true });
    await expect(ctx.fileTunnel!.queueRequest('n1', 'download', 's1', '/f.bsp')).resolves.toMatchObject({ success: true });
    await expect(ctx.fileTunnel!.queueRequest('n1', 'upload', 's1', '/f.bsp', {}, Buffer.from('x'))).resolves.toMatchObject({ success: true });
    await expect(ctx.fileTunnel!.queueRequest('n1', 'delete', 's1', '/f.bsp')).resolves.toMatchObject({ success: true });
    expect(fileTunnel.queueRequest).toHaveBeenCalledTimes(4);
  });

  it('allows cs16-admin grants (server.read, server.write, user.read) for download/upload via server.* grants', async () => {
    const { ctx, fileTunnel } = setup(['server.read', 'server.write', 'user.read']);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'download', 's1', '/cstrike/server.cfg')).resolves.toMatchObject({ success: true });
    await expect(ctx.fileTunnel!.queueRequest('n1', 'upload', 's1', '/cstrike/banned.cfg', {}, Buffer.from('x'))).resolves.toMatchObject({ success: true });
    expect(fileTunnel.queueRequest).toHaveBeenCalledTimes(2);
  });

  it('denies an unknown op even when grants would otherwise allow files', async () => {
    const { ctx } = setup(['files.read', 'files.write']);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'not-a-real-op', 's1', '/')).rejects.toThrow(/unknown op/);
  });

  it('revokes immediately — read denied after a grant is removed mid-flight', async () => {
    const { ctx, setGrants } = setup(['files.read']);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'list', 's1', '/')).resolves.toMatchObject({ success: true });
    setGrants([]);
    await expect(ctx.fileTunnel!.queueRequest('n1', 'list', 's1', '/')).rejects.toThrow(/Permission denied/);
  });
});

describe('wsGateway facade gating', () => {
  it('denies sendToAgent with zero grants', async () => {
    const { ctx, gateway } = setup([]);
    await expect(ctx.wsGateway.sendToAgent('n1', { type: 'run' })).rejects.toThrow(/Permission denied/);
    expect(gateway.sendToAgent).not.toHaveBeenCalled();
  });

  it('allows sendToAgent with cs16-admin grants (server.write)', async () => {
    const { ctx, gateway } = setup(['server.read', 'server.write', 'user.read']);
    await expect(ctx.wsGateway.sendToAgent('n1', { type: 'exec' })).resolves.toBe(true);
    expect(gateway.sendToAgent).toHaveBeenCalledWith('n1', { type: 'exec' });
  });

  it('exposes no clients or agents internals', () => {
    const { ctx } = setup(['server.write']);
    expect('clients' in ctx.wsGateway).toBe(false);
    expect('agents' in ctx.wsGateway).toBe(false);
    // Spot-check the exact surface exposed.
    expect(typeof ctx.wsGateway.sendToAgent).toBe('function');
    expect(typeof ctx.wsGateway.broadcastToAuthenticated).toBe('function');
    expect(typeof ctx.wsGateway.sendToClient).toBe('function');
    expect(typeof ctx.wsGateway.registerPluginWsHandler).toBe('function');
    expect(typeof ctx.wsGateway.unregisterPluginWsHandlers).toBe('function');
  });

  it('sendWebSocketMessage("*") broadcasts and a targeted send uses sendToClient', () => {
    const { ctx, gateway } = setup(['server.write']);
    ctx.sendWebSocketMessage('*', { type: 'ping' });
    expect(gateway.broadcastToAuthenticated).toHaveBeenCalledWith({ type: 'ping' });
    expect(gateway.sendToClient).not.toHaveBeenCalled();

    gateway.sendToClient.mockClear();
    ctx.sendWebSocketMessage('client_42', { type: 'hello' });
    expect(gateway.sendToClient).toHaveBeenCalledWith('client_42', { type: 'hello' });
  });

  it('sendToClient delegates and returns whether delivery succeeded', () => {
    const { ctx, gateway } = setup(['server.write']);
    gateway.sendToClient.mockReturnValueOnce(false);
    expect(ctx.wsGateway.sendToClient('missing', { x: 1 })).toBe(false);
    expect(ctx.wsGateway.sendToClient('here', { x: 1 })).toBe(true);
  });

  /**
   * Drift guard: the capability gate must classify every operation the Rust
   * agent actually implements. If someone adds an agent op without teaching
   * this gate, plugins using it would be denied (fail-closed) with no signal
   * at review time. Parsing the agent source keeps the two in lockstep.
   */
  it('classifies every file-tunnel operation the agent implements', async () => {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    const agentSource = await readFile(
      path.resolve(import.meta.dirname, '../../../../catalyst-agent/src/file_tunnel.rs'),
      'utf8',
    );
    const ops = [...agentSource.matchAll(/^\s+"([a-z-]+)"\s+=>\s+handle_/gm)].map((m) => m[1]);

    // Sanity: the parse must actually find the dispatch arms, otherwise this
    // test would vacuously pass after an agent refactor.
    expect(ops.length).toBeGreaterThanOrEqual(10);
    expect(ops).toContain('list');
    expect(ops).toContain('install-url');

    const unclassified = ops.filter((op) => classifyFileTunnelOp(op) === 'unknown');
    expect(unclassified).toEqual([]);
  });
});
