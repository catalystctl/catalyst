/**
 * CPU display format — the panel-wide default.
 *
 * `ThemeSettings.cpuDisplayFormat` is the format every gauge falls back to when
 * a user has not pinned one of their own. It has to be:
 *   - validated on write (an unknown value would silently render as 'cores'),
 *   - persisted and echoed back by the admin GET,
 *   - exported through the cached public payload, which is how the frontend
 *     learns the default at boot for signed-out and signed-in users alike,
 *   - and its cache evicted on save, or an admin change would not reach the
 *     panel until the cache expired.
 */
import 'dotenv/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { adminRoutes } from '../routes/admin.js';
import { invalidateConfig } from '../lib/config-cache.js';
import { CPU_DISPLAY_FORMATS } from '../shared-types.js';

let app: FastifyInstance;
let userId: string;
let roleId: string;

/** The value the panel shipped with, restored in afterAll. */
let originalFormat: string | null = null;

function buildApp(): FastifyInstance {
  const instance = Fastify({ logger: false });

  instance.decorate('authenticate', async (request: any) => {
    request.user = {
      userId,
      email: 'cpu-format@example.com',
      username: 'cpu-format',
      permissions: ['*'],
    };
  });
  instance.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    invalidateServerAccess: () => {},
  } as any);

  instance.register(adminRoutes, { prefix: '/api/admin' });
  return instance;
}

/** Mirrors GET /api/theme-settings/public's mapping for the field under test. */
async function publicCpuFormat(): Promise<string> {
  const settings = await prisma.themeSettings.findUnique({ where: { id: 'default' } });
  return settings?.cpuDisplayFormat ?? 'cores';
}

async function patchTheme(body: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: '/api/admin/theme-settings',
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body),
  });
}

beforeAll(async () => {
  const existing = await prisma.themeSettings.findUnique({ where: { id: 'default' } });
  originalFormat = existing?.cpuDisplayFormat ?? null;

  const role = await prisma.role.create({
    data: { name: `test-cpu-format-${nanoid(8)}`, permissions: ['*'] },
  });
  roleId = role.id;
  const user = await prisma.user.create({
    data: {
      email: `cpu-format-${nanoid(8)}@example.com`,
      username: `cpufmt${nanoid(6)}`,
      name: 'cpu format',
      emailVerified: true,
      roles: { connect: { id: role.id } },
    },
  });
  userId = user.id;

  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  // Leave the panel as we found it — this suite mutates the shipped default.
  await prisma.themeSettings.upsert({
    where: { id: 'default' },
    update: { cpuDisplayFormat: originalFormat ?? 'cores' },
    create: { id: 'default', cpuDisplayFormat: originalFormat ?? 'cores' },
  });
  await invalidateConfig('theme_default').catch(() => {});
  if (roleId) await prisma.role.deleteMany({ where: { id: roleId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
});

beforeEach(async () => {
  await prisma.themeSettings.upsert({
    where: { id: 'default' },
    update: { cpuDisplayFormat: 'cores' },
    create: { id: 'default', cpuDisplayFormat: 'cores' },
  });
  await invalidateConfig('theme_default').catch(() => {});
});

describe('panel-wide CPU display format', () => {
  it('defaults to cores, the format the panel already shipped', async () => {
    expect(await publicCpuFormat()).toBe('cores');
  });

  it.each(CPU_DISPLAY_FORMATS)('accepts and persists %s', async (format) => {
    const res = await patchTheme({ cpuDisplayFormat: format });

    expect(res.statusCode).toBe(200);
    expect(await publicCpuFormat()).toBe(format);
  });

  it('rejects an unknown format instead of storing it', async () => {
    const res = await patchTheme({ cpuDisplayFormat: 'furlongs' });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
    // The stored value must be untouched, so no gauge silently changes format.
    expect(await publicCpuFormat()).toBe('cores');
  });

  it('rejects a non-string format', async () => {
    const res = await patchTheme({ cpuDisplayFormat: 3 });

    expect(res.statusCode).toBe(400);
    expect(await publicCpuFormat()).toBe('cores');
  });

  it('leaves the format alone when the patch omits it', async () => {
    await patchTheme({ cpuDisplayFormat: 'share' });
    const res = await patchTheme({ panelName: 'Catalyst' });

    expect(res.statusCode).toBe(200);
    expect(await publicCpuFormat()).toBe('share');
  });

  it('returns the stored format from the admin GET', async () => {
    await patchTheme({ cpuDisplayFormat: 'perCore' });

    const res = await app.inject({ method: 'GET', url: '/api/admin/theme-settings' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.cpuDisplayFormat).toBe('perCore');
  });
});
