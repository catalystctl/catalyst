import { describe, it, expect, vi } from 'vitest';
import type { Logger } from 'pino';
import { createPluginContext } from '../context';
import { initAuth, getAuth } from '../../auth';
import { prisma } from '../../db';

/**
 * Integration test (real dev DB + real better-auth instance): the plugin auth
 * bridge must create actual sessions. Regression guard for the better-auth
 * 1.6.x shape where `auth.$context` is an unawaited Promise — reading
 * `.internalAdapter` off it synchronously threw "Host auth instance does not
 * expose session creation" and broke every OAuth sign-in.
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

describe('ctx.auth.createSession (real better-auth)', () => {
  it('creates a real session row and sets the session cookie on the reply', async () => {
    initAuth();

    // Resolve the real context the way the bridge must: $context may be a Promise.
    const raw = (getAuth() as unknown as { $context: unknown }).$context;
    const ctx = (typeof (raw as Promise<unknown>)?.then === 'function' ? await raw : raw) as {
      internalAdapter?: { createSession: unknown };
      secret?: string;
    };
    expect(typeof ctx.internalAdapter?.createSession).toBe('function');

    const user = await prisma.user.create({
      data: {
        email: `bridge-test-${Date.now()}@example.com`,
        username: `bridge_test_${Date.now()}`,
        name: 'Bridge Test',
      },
    });

    const reply = { header: vi.fn() };
    try {
      const context = createPluginContext(
        {
          name: 'bridge-test-plugin',
          version: '1.0.0',
          displayName: 'Bridge Test',
          description: '',
          author: '',
          catalystVersion: '>=1.0.0',
          permissions: ['auth.sessions'],
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
        { registerExposedApi: vi.fn(), getExposedApi: vi.fn(() => undefined) } as any,
        () => ['auth.sessions'],
      );

      const session = await context.auth!.createSession(user.id, {
        reply,
        rememberMe: true,
        ipAddress: '203.0.113.9',
        userAgent: 'vitest',
      });

      expect(session.token).toBeTruthy();
      expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Real row in the session table with our metadata.
      const row = await prisma.session.findUnique({ where: { token: session.token } });
      expect(row?.userId).toBe(user.id);
      expect(row?.ipAddress).toBe('203.0.113.9');
      expect(row?.userAgent).toBe('vitest');

      // Cookie serialized exactly like a password login would set it.
      expect(reply.header).toHaveBeenCalledWith('set-cookie', expect.stringContaining(`${session.token}`));
      const cookie = reply.header.mock.calls[0][1] as string;
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');

      // better-auth signs session cookie values (`token.signature`) and
      // getSignedCookie rejects unsigned values with a silent null session —
      // the exact bug that made every OAuth sign-in land on a 401. Pin the
      // signed format using the SAME secret the real auth instance verifies
      // with (ctx.secret from the resolved $context).
      const cookieValue = cookie.split(';')[0].split('=').slice(1).join('=');
      const { createHmac } = await import('node:crypto');
      const expectedSignature = createHmac('sha256', Buffer.from(String(ctx.secret), 'utf8'))
        .update(session.token, 'utf8')
        .digest('base64');
      expect(cookieValue).toBe(`${session.token}.${expectedSignature}`);
    } finally {
      // Clean up the rows this test created (suite convention: hit the real
      // dev database but leave nothing behind).
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it('fails closed without the auth.sessions grant', async () => {
    initAuth();
    const context = createPluginContext(
      {
        name: 'bridge-test-plugin',
        version: '1.0.0',
        displayName: 'Bridge Test',
        description: '',
        author: '',
        catalystVersion: '>=1.0.0',
        permissions: [],
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
      { registerExposedApi: vi.fn(), getExposedApi: vi.fn(() => undefined) } as any,
      () => [],
    );
    await expect(context.auth!.createSession('any-user')).rejects.toThrow(/auth\.sessions/);
  });
});
