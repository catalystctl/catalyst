/**
 * Validation-contract guard.
 *
 * The bug this guards against: a schema stricter than the data the panel
 * legitimately sends. `PUT /api/servers/:id` required `min(1)` per environment
 * value, stored environments contain `""`, so changing the container image
 * always failed with an opaque "Invalid request body".
 *
 * Two things keep that class from returning:
 *  1. `validateRequestBody` always answers with a stable code and field-level
 *     details, so any future mismatch names the field instead of being opaque.
 *  2. The bounds the panel's forms offer are the bounds the schemas accept.
 *     This file pins both sides of that contract, so a form limit and a schema
 *     limit can no longer drift apart unnoticed.
 */
import { describe, expect, it } from 'vitest';
import {
  serverCreateSchema,
  serverUpdateSchema,
  serverCloneSchema,
  serverClonePreflightSchema,
  validateRequestBody,
} from '../lib/validation.js';

const createInput = {
  name: 'contract-server',
  templateId: 'template-1',
  nodeId: 'node-1',
  locationId: 'location-1',
  primaryPort: 25565,
  allocatedMemoryMb: 2048,
  allocatedCpuCores: 2,
  allocatedDiskMb: 10240,
};

/** Minimal Fastify stand-ins: the middleware only uses body and reply. */
const runValidation = (schema: Parameters<typeof validateRequestBody>[0], body: unknown) => {
  const request: any = { body };
  let sent: any;
  let status = 0;
  const reply: any = {
    status(code: number) {
      status = code;
      return this;
    },
    send(payload: unknown) {
      sent = payload;
      return this;
    },
  };
  return { request, reply, run: async () => { await validateRequestBody(schema)(request, reply); return { status, sent, body: request.body }; } };
};

describe('validateRequestBody reports rejections actionably', () => {
  it('carries the stable code and field details, so the panel can name the field', async () => {
    const { run } = runValidation(serverUpdateSchema, { environment: { SEED: 'x'.repeat(5000) } });
    const { status, sent } = await run();
    expect(status).toBe(400);
    expect(sent.error).toBe('Invalid request body');
    expect(sent.code).toBe('VALIDATION_ERROR');
    expect(sent.details).toEqual([
      expect.objectContaining({ field: 'environment.SEED', code: 'VALIDATION_TOO_LONG' }),
    ]);
  });

  it('leaves an accepted body parsed', async () => {
    const { run } = runValidation(serverUpdateSchema, { environment: { SEED: '' } });
    const { status, body } = await run();
    expect(status).toBe(0);
    expect(body).toEqual({ environment: { SEED: '' } });
  });
});

describe('environment maps are round-trippable', () => {
  const stored = { GAME_VERSION: 'stable', SEED: '', IMAGE_VARIANT: 'java21', TEMPLATE_IMAGE: 'eclipse-temurin:21-jre' };

  for (const [label, schema] of [
    ['update', serverUpdateSchema],
    ['create', serverCreateSchema],
    ['clone', serverCloneSchema],
    ['clone preflight', serverClonePreflightSchema],
  ] as const) {
    it(`${label} accepts an environment with an empty value`, () => {
      const payload: Record<string, unknown> = { environment: stored };
      if (label === 'create') Object.assign(payload, createInput);
      if (label === 'clone preflight') Object.assign(payload, { mode: 'configuration', targetNodeId: 'node-2' });
      expect(schema.safeParse(payload).success).toBe(true);
    });
  }

  it('still rejects a nested object as a value', () => {
    expect(serverUpdateSchema.safeParse({ environment: { A: { nested: true } } }).success).toBe(false);
  });
});

describe('panel form bounds match the schema bounds', () => {
  // Mirrors catalyst-frontend/src/lib/serverLimits.ts. Both sides must agree or
  // the form offers a value the API refuses.
  const MIN_MEMORY_MB = 512;
  const MIN_CPU_CORES = 1;
  const MAX_CPU_CORES = 128;
  const MIN_DISK_MB = 1024;
  const MAX_DATABASE_ALLOCATION = 1024;
  const SERVER_NETWORK_MODES = ['bridge', 'macvlan', 'host', 'mc-lan-static', 'mc-lan-dynamic'];

  it('accepts the form floors and rejects one below them', () => {
    const atFloor = { ...createInput, allocatedMemoryMb: MIN_MEMORY_MB, allocatedCpuCores: MIN_CPU_CORES, allocatedDiskMb: MIN_DISK_MB };
    expect(serverCreateSchema.safeParse(atFloor).success).toBe(true);
    expect(serverCreateSchema.safeParse({ ...atFloor, allocatedMemoryMb: MIN_MEMORY_MB - 1 }).success).toBe(false);
    expect(serverCreateSchema.safeParse({ ...atFloor, allocatedCpuCores: 0 }).success).toBe(false);
    expect(serverCreateSchema.safeParse({ ...atFloor, allocatedDiskMb: MIN_DISK_MB - 1 }).success).toBe(false);

    // Update takes the same floors; the panel's update form now offers them.
    expect(serverUpdateSchema.safeParse({ allocatedMemoryMb: MIN_MEMORY_MB }).success).toBe(true);
    expect(serverUpdateSchema.safeParse({ allocatedMemoryMb: MIN_MEMORY_MB - 1 }).success).toBe(false);
    expect(serverUpdateSchema.safeParse({ allocatedCpuCores: MAX_CPU_CORES }).success).toBe(true);
    expect(serverUpdateSchema.safeParse({ allocatedCpuCores: MAX_CPU_CORES + 1 }).success).toBe(false);
  });

  it('agrees on the database-allocation ceiling across create, clone and update', () => {
    const atMax = MAX_DATABASE_ALLOCATION;
    expect(serverCreateSchema.safeParse({ ...createInput, databaseAllocation: atMax }).success).toBe(true);
    expect(serverClonePreflightSchema.safeParse({ mode: 'configuration', targetNodeId: 'node-2', databaseAllocation: atMax }).success).toBe(true);
    expect(serverUpdateSchema.safeParse({ databaseAllocation: atMax }).success).toBe(true);

    const overMax = MAX_DATABASE_ALLOCATION + 1;
    expect(serverCreateSchema.safeParse({ ...createInput, databaseAllocation: overMax }).success).toBe(false);
    expect(serverClonePreflightSchema.safeParse({ mode: 'configuration', targetNodeId: 'node-2', databaseAllocation: overMax }).success).toBe(false);
    expect(serverUpdateSchema.safeParse({ databaseAllocation: overMax }).success).toBe(false);
  });

  it('accepts every network mode the panel offers, on every server write path', () => {
    for (const mode of SERVER_NETWORK_MODES) {
      expect(serverUpdateSchema.safeParse({ networkMode: mode }).success, `update ${mode}`).toBe(true);
      expect(serverCreateSchema.safeParse({ ...createInput, networkMode: mode }).success, `create ${mode}`).toBe(true);
      expect(
        serverClonePreflightSchema.safeParse({ mode: 'configuration', targetNodeId: 'node-2', networkMode: mode }).success,
        `clone ${mode}`,
      ).toBe(true);
    }
    expect(serverUpdateSchema.safeParse({ networkMode: 'not-a-mode' }).success).toBe(false);
  });

  it('accepts a stored (round-tripped) server row as an update payload', () => {
    // The admin tab PUTs whole families of fields it read from the API. A row
    // migrated from Pterodactyl is the worst case: numeric-looking env values,
    // empty optional variables and an mc-lan network mode.
    const storedRow = {
      name: 'Migrated Server',
      description: 'imported from Pterodactyl',
      environment: { SEED: '', MEMORY: '1024', EULA: 'true' } as Record<string, string>,
      startupCommand: null,
      portBindings: { 25565: 25565 },
      allocatedMemoryMb: 1024,
      allocatedCpuCores: 2,
      allocatedDiskMb: 10240,
      backupAllocationMb: 0,
      databaseAllocation: 0,
      primaryPort: 25565,
      primaryIp: '10.0.0.5',
      allocationId: 'alloc-1',
      networkMode: 'mc-lan-static',
    };
    const parsed = serverUpdateSchema.safeParse(storedRow);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
  });
});
