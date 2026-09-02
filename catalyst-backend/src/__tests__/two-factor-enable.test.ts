/**
 * Two-Factor Enrollment — better-auth API integration test.
 *
 * Reproduces the production "Failed to enable 2FA: HTTP 500" by calling
 * auth.api.enableTwoFactor exactly as the POST /api/auth/two-factor/enable
 * route does, against a real user row in Postgres.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { auth, initAuth } from '../auth';
import { hashPassword } from 'better-auth/crypto';
import { nanoid } from 'nanoid';

// Prisma v7: pass config directly to avoid instanceof mismatch in hoisted pnpm layouts
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });

const prisma = new PrismaClient({
  adapter,
  log: ['error'],
});

// A long random string satisfies any password policy better-auth applies.
const password = `Xk9#mVq2!${nanoid(16)}Lp`;

describe('Two-Factor Enrollment (better-auth enableTwoFactor)', () => {
  let userId: string;
  let accountId: string;
  let email: string;

  beforeAll(async () => {
    initAuth();

    // Create user + credential account the way better-auth signUpEmail does,
    // using better-auth's own password hashing so verify() succeeds.
    const hashed = await hashPassword(password);
    // better-auth lowercases emails on lookup (findUserByEmail), so the
    // stored email must be all-lowercase or sign-in will not find the user.
    email = `test-2fa-${nanoid(8).toLowerCase()}@example.com`;
    const user = await prisma.user.create({
      data: {
        id: `test-2fa-user-${nanoid(8)}`,
        email,
        name: 'Two Factor Test',
        username: `twofa${nanoid(6)}`,
        emailVerified: true,
      },
    });
    userId = user.id;
    const account = await prisma.account.create({
      data: {
        id: `test-2fa-acct-${nanoid(8)}`,
        userId,
        accountId: userId,
        providerId: 'credential',
        password: hashed,
      },
    });
    accountId = account.id;
  });

  afterAll(async () => {
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
    await prisma.twoFactor.deleteMany({ where: { userId } }).catch(() => {});
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  });

  it('enableTwoFactor creates the twoFactor row without error', async () => {
    // Sign in to obtain a real session cookie, then call the endpoint the
    // same way the HTTP route does.
    const signIn = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
      returnHeaders: true,
    });

    const setCookie = signIn.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();

    try {
      // 2FA plugin endpoints are missing from the inferred API type at this
      // better-auth version; the runtime route exists (verified e2e).
      const api = auth.api as unknown as Record<string, (args: any) => Promise<any>>;
      const result = await api.enableTwoFactor({
        body: { password },
        headers: new Headers({ cookie: setCookie as string }),
      });

      expect(result).toBeDefined();
      expect(result.totpURI).toBeTruthy();

      // The enrollment row must exist for this user.
      const row = await prisma.twoFactor.findFirst({ where: { userId } });
      expect(row).toBeTruthy();
      expect(row?.secret).toBeTruthy();
      expect(row?.backupCodes).toBeTruthy();
    } catch (err) {
      // Surface the full error — the point of this test is to expose 500s.
      const e = err as { status?: number; message?: string; body?: unknown; stack?: string };
      console.error('enableTwoFactor failed:', {
        status: e.status,
        message: e.message,
        body: e.body,
        stack: e.stack?.split('\n').slice(0, 10),
      });
      throw err;
    }
  });
});
