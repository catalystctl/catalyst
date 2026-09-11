/**
 * Regression: the IP login lockout used to count every login attempt (including
 * successful ones), so 20 sign-ins within 15 minutes locked the 21st for every
 * account behind that IP. Only recorded failures may consume the bucket now.
 */
import 'dotenv/config';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../db.js';
import { checkIpRateLimit, recordIpAttempt } from '../middleware/brute-force.js';

const IP = '203.0.113.250';
const syntheticEmail = `__ip__:${IP}`;

const fakeRequest = (ip: string) =>
  ({
    ip,
    socket: { remoteAddress: ip },
    headers: { 'user-agent': 'ip-lockout-test' },
  }) as any;

describe('IP login lockout', () => {
  beforeEach(async () => {
    await prisma.authLockout.deleteMany({ where: { email: syntheticEmail } });
  });

  afterAll(async () => {
    await prisma.authLockout.deleteMany({ where: { email: syntheticEmail } });
  });

  it('never locks on checks alone, however many logins succeed', async () => {
    const request = fakeRequest(IP);
    for (let i = 0; i < 30; i += 1) {
      await checkIpRateLimit(prisma, request);
    }
  });

  it('locks only after 20 recorded failures', async () => {
    const request = fakeRequest(IP);
    for (let i = 0; i < 19; i += 1) {
      await recordIpAttempt(prisma, request);
    }
    await expect(checkIpRateLimit(prisma, request)).resolves.toBeUndefined();

    await recordIpAttempt(prisma, request);
    await expect(checkIpRateLimit(prisma, request)).rejects.toThrow(/Too many login attempts/);
  });
});
