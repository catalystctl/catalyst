import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { prisma } from '../db.js';
import { adminRoutes } from '../routes/admin.js';
import { settingsRoutes } from '../routes/settings.js';
import { clearConfigCacheMemory } from '../lib/config-cache.js';
import {
  LOCALIZATION_SETTING_ID,
  getDefaultLocale,
  getLocalizationSettings,
  updateLocalizationSettings,
} from '../services/localization.js';
import { localeForEmail, localeForUser } from '../i18n/user-locale.js';

let testUserId: string;
let userIdWithoutPreference: string;
let previousRow: { defaultLocale: string | null } | null = null;

function buildTestApp(perms: string[] = ['*']) {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = { userId: testUserId, email: 't@t.com', username: 't', permissions: perms };
  });
  app.decorate('wsGateway', { pushToAdminSubscribers: () => {} } as any);
  return app;
}

beforeAll(async () => {
  previousRow = await prisma.systemSetting.findUnique({
    where: { id: LOCALIZATION_SETTING_ID },
    select: { defaultLocale: true },
  });
  const admin = await prisma.user.create({
    data: {
      email: `loc-${nanoid(6)}@t.com`,
      name: 'locale test',
      username: `loc_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  const plain = await prisma.user.create({
    data: {
      email: `loc-plain-${nanoid(6)}@t.com`,
      name: 'locale plain',
      username: `locp_${nanoid(6)}`,
      emailVerified: true,
    },
  });
  testUserId = admin.id;
  userIdWithoutPreference = plain.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { userId: testUserId } });
  await prisma.user.deleteMany({ where: { id: { in: [testUserId, userIdWithoutPreference] } } });
  if (previousRow === null) {
    await prisma.systemSetting.deleteMany({ where: { id: LOCALIZATION_SETTING_ID } });
  } else {
    await prisma.systemSetting.upsert({
      where: { id: LOCALIZATION_SETTING_ID },
      create: { id: LOCALIZATION_SETTING_ID, defaultLocale: previousRow.defaultLocale },
      update: { defaultLocale: previousRow.defaultLocale },
    });
  }
  clearConfigCacheMemory();
});

describe('instance language storage', () => {
  it('reports no choice and falls back to English when unconfigured', async () => {
    await prisma.systemSetting.deleteMany({ where: { id: LOCALIZATION_SETTING_ID } });
    clearConfigCacheMemory();

    expect(await getLocalizationSettings()).toEqual({ defaultLocale: null });
    expect(await getDefaultLocale()).toBe('en');
  });

  it('stores, serves and clears the admin choice', async () => {
    await updateLocalizationSettings({ defaultLocale: 'zh-CN' });
    expect(await getDefaultLocale()).toBe('zh-CN');

    await updateLocalizationSettings({ defaultLocale: null });
    expect(await getDefaultLocale()).toBe('en');
  });

  it('ignores a language the panel no longer supports', async () => {
    await prisma.systemSetting.upsert({
      where: { id: LOCALIZATION_SETTING_ID },
      create: { id: LOCALIZATION_SETTING_ID, defaultLocale: 'de' },
      update: { defaultLocale: 'de' },
    });
    clearConfigCacheMemory();

    expect(await getLocalizationSettings()).toEqual({ defaultLocale: null });
    expect(await getDefaultLocale()).toBe('en');
  });
});

describe('recipient locale resolution', () => {
  it('prefers the recipient preference over the instance language', async () => {
    await prisma.user.update({
      where: { id: testUserId },
      data: { preferences: { locale: 'en' } },
    });
    await updateLocalizationSettings({ defaultLocale: 'zh-CN' });

    expect(await localeForUser(testUserId)).toBe('en');
  });

  it('uses the instance language for users without a preference', async () => {
    await updateLocalizationSettings({ defaultLocale: 'zh-CN' });

    expect(await localeForUser(userIdWithoutPreference)).toBe('zh-CN');
  });

  it('uses the instance language for unknown addresses', async () => {
    await updateLocalizationSettings({ defaultLocale: 'zh-CN' });

    expect(await localeForEmail('nobody@example.com')).toBe('zh-CN');
  });
});

describe('language settings endpoints', () => {
  it('serves the public endpoint without authentication', async () => {
    await updateLocalizationSettings({ defaultLocale: 'zh-CN' });
    const app = Fastify({ logger: false });
    await app.register(settingsRoutes, { prefix: '/api/settings' });

    const res = await app.inject({ method: 'GET', url: '/api/settings/locale' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, data: { defaultLocale: 'zh-CN' } });
    await app.close();
  });

  it('requires admin.read to read and admin.write to change', async () => {
    const reader = buildTestApp(['admin.read']);
    await reader.register(adminRoutes, { prefix: '/api/admin' });
    const readRes = await reader.inject({ method: 'GET', url: '/api/admin/localization-settings' });
    expect(readRes.statusCode).toBe(200);
    expect(readRes.json().data.defaultLocale).toBe('zh-CN');
    const denied = await reader.inject({
      method: 'PUT',
      url: '/api/admin/localization-settings',
      payload: { defaultLocale: 'en' },
    });
    expect(denied.statusCode).toBe(403);
    await reader.close();

    const noAccess = buildTestApp([]);
    await noAccess.register(adminRoutes, { prefix: '/api/admin' });
    const res = await noAccess.inject({ method: 'GET', url: '/api/admin/localization-settings' });
    expect(res.statusCode).toBe(403);
    await noAccess.close();
  });

  it('rejects a language the panel cannot render', async () => {
    await updateLocalizationSettings({ defaultLocale: 'zh-CN' });
    const app = buildTestApp(['admin.write']);
    await app.register(adminRoutes, { prefix: '/api/admin' });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/localization-settings',
      payload: { defaultLocale: 'de' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
    expect(await getDefaultLocale()).toBe('zh-CN');
    await app.close();
  });

  it('persists an accepted language and audits the change', async () => {
    const app = buildTestApp(['admin.write']);
    await app.register(adminRoutes, { prefix: '/api/admin' });

    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/localization-settings',
      payload: { defaultLocale: 'en' },
    });
    expect(res.statusCode).toBe(200);
    expect(await getDefaultLocale()).toBe('en');

    const audit = await prisma.auditLog.findFirst({
      where: { userId: testUserId, action: 'localization.settings.update' },
      orderBy: { timestamp: 'desc' },
    });
    expect(audit?.details).toMatchObject({ defaultLocale: 'en' });
    await app.close();
  });
});
