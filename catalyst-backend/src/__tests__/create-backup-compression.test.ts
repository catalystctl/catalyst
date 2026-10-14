/**
 * Scheduled "Create backup" tasks must honour the compression choice stored in
 * the task payload: an explicit `compressed: false` stores a plain `.tar` and
 * tells the agent not to gzip; an absent flag keeps the historical gzip
 * default. Guards the payload → agent/DB plumbing the tasks route relies on.
 */
import { describe, it, expect, vi } from 'vitest';
import { createServerBackup } from '../services/create-backup.js';

type Stub = {
  created: any[];
  sent: any[];
  prisma: any;
};

function makeStub(): Stub {
  const created: any[] = [];
  const sent: any[] = [];
  const prisma: any = {
    server: {
      updateMany: async () => ({ count: 1 }),
      update: async () => ({}),
      findUnique: async () => ({ status: 'creating_backup' }),
    },
    backup: {
      findMany: async () => [],
      create: async (args: any) => {
        created.push(args);
        return { id: 'backup-1' };
      },
    },
  };
  return { created, sent, prisma };
}

function makeServer() {
  return {
    id: 'server-1',
    uuid: 'uuid-1',
    name: 'Test server',
    nodeId: 'node-1',
    status: 'stopped',
    suspendedAt: null,
    backupStorageMode: 'local',
    backupAllocationMb: 1024,
    node: { isOnline: true },
  } as any;
}

describe('createServerBackup compression pass-through', () => {
  it('gzips by default when no flag is supplied', async () => {
    const stub = makeStub();
    const sendToAgent = vi.fn(async (_nodeId: string, message: any) => {
      stub.sent.push(message);
      return true;
    });

    const result = await createServerBackup({
      prisma: stub.prisma,
      server: makeServer(),
      name: 'nightly',
      sendToAgent,
    });

    expect(result.ok).toBe(true);
    expect(stub.sent[0].compressed).toBe(true);
    expect(stub.created[0].data.compressed).toBe(true);
    if (result.ok) expect(result.agentPath.endsWith('.tar.gz')).toBe(true);
  });

  it('stores a plain .tar when the task asked for an uncompressed backup', async () => {
    const stub = makeStub();
    const sendToAgent = vi.fn(async (_nodeId: string, message: any) => {
      stub.sent.push(message);
      return true;
    });

    const result = await createServerBackup({
      prisma: stub.prisma,
      server: makeServer(),
      name: 'nightly',
      compressed: false,
      sendToAgent,
    });

    expect(result.ok).toBe(true);
    expect(stub.sent[0].compressed).toBe(false);
    expect(stub.created[0].data.compressed).toBe(false);
    if (result.ok) {
      expect(result.agentPath.endsWith('.tar')).toBe(true);
      expect(result.agentPath.endsWith('.tar.gz')).toBe(false);
    }
  });
});
