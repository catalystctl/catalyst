/**
 * Server invite flow regressions.
 *
 * The invite page routes the invitee by comparing the invited email with the
 * session account, so the backend must give it the facts to route on:
 * - GET /invites/:token reports hasAccount so a signed-out invitee lands on
 *   "sign in" (account exists) instead of a register form that 409s.
 * - POST /invites/register returns INVITE_EMAIL_HAS_ACCOUNT (not generic
 *   CONFLICT) when the invited email already has an account.
 * - POST /invites/accept keeps failing 403 INVITE_NOT_VALID_FOR_ACCOUNT for
 *   a wrong-email session, now with the invited email as error params.
 * - Invite-based self-registration must still work while open registration is
 *   disabled (withRegistrationBypass) — the invite is the override.
 */
import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { prisma } from '../db.js';
import { initAuth } from '../auth.js';
import { serverInvitesRoutes } from '../routes/servers/invites.js';
import { withRegistrationBypass } from '../lib/registration-gate.js';
import { nanoid } from 'nanoid';

const suffix = nanoid(8).toLowerCase();
let ownerUserId: string;
let wrongEmailUserId: string;
let existingAccountUserId: string;
let serverId: string;
let freshInviteToken: string;
let existingAccountInviteToken: string;
/** Separate token for the accept tests — accepting consumes an invite. */
let acceptInviteToken: string;
let serverName: string;
let currentUserId = '';
let currentUserEmail = '';

function buildApp() {
  const app = Fastify({ logger: false });
  app.decorate('authenticate', async (request: any) => {
    request.user = {
      userId: currentUserId,
      email: currentUserEmail,
      username: 'invite-test',
      permissions: [],
    };
  });
  app.decorate('wsGateway', {
    pushToAdminSubscribers: () => {},
    pushToGlobalSubscribers: () => {},
    routeToClients: async () => {},
    invalidateServerAccess: () => {},
  } as any);
  app.register(serverInvitesRoutes, { prefix: '/api/servers' });
  return app;
}

async function createInvite(email: string): Promise<string> {
  const invite = await prisma.serverAccessInvite.create({
    data: {
      serverId,
      email: email.toLowerCase(),
      token: `inv-${nanoid(24)}`,
      permissions: ['server.read', 'console.read'],
      invitedByUserId: ownerUserId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  return invite.token;
}

beforeAll(async () => {
  initAuth();

  const ownerRole = await prisma.role.create({
    data: { name: `test-invite-owner-${suffix}`, permissions: ['*'] },
  });
  const readerRole = await prisma.role.create({
    data: { name: `test-invite-reader-${suffix}`, permissions: ['server.read'] },
  });

  const owner = await prisma.user.create({
    data: {
      email: `test-invite-owner-${suffix}@example.com`,
      username: `inviteowner${suffix}`,
      name: 'Invite Owner',
      emailVerified: true,
      roles: { connect: { id: ownerRole.id } },
    },
  });
  ownerUserId = owner.id;

  const wrongEmailUser = await prisma.user.create({
    data: {
      email: `test-invite-wrong-${suffix}@example.com`,
      username: `invitewrong${suffix}`,
      name: 'Wrong Email',
      emailVerified: true,
      roles: { connect: { id: readerRole.id } },
    },
  });
  wrongEmailUserId = wrongEmailUser.id;

  // An account for the "invited email already registered" branches.
  const invitedEmail = `test-invite-existing-${suffix}@example.com`;
  const existingAccount = await prisma.user.create({
    data: {
      email: invitedEmail,
      username: `inviteexist${suffix}`,
      name: 'Existing Invitee',
      emailVerified: true,
      roles: { connect: { id: readerRole.id } },
    },
  });
  existingAccountUserId = existingAccount.id;

  const location = await prisma.location.create({
    data: { name: `test-invite-loc-${suffix}` },
  });
  const node = await prisma.node.create({
    data: {
      name: `test-invite-node-${suffix}`,
      locationId: location.id,
      hostname: 'invite.example.com',
      publicAddress: '10.0.0.9',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 4096,
      maxCpuCores: 2,
      isOnline: true,
    },
  });
  const template = await prisma.serverTemplate.create({
    data: {
      name: `test-invite-template-${suffix}`,
      author: 'Test',
      version: '1.0.0',
      image: 'alpine:latest',
      startup: 'echo hello',
      stopCommand: 'stop',
      supportedPorts: [],
      variables: [],
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
    },
  });
  const server = await prisma.server.create({
    data: {
      uuid: `test-invite-${suffix}`,
      name: `test-invite-server-${suffix}`,
      templateId: template.id,
      nodeId: node.id,
      locationId: location.id,
      ownerId: ownerUserId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25580,
    },
  });
  serverId = server.id;
  serverName = server.name;

  freshInviteToken = await createInvite(`test-invite-fresh-${suffix}@example.com`);
  existingAccountInviteToken = await createInvite(invitedEmail);
  acceptInviteToken = await createInvite(invitedEmail);

  currentUserId = ownerUserId;
  currentUserEmail = owner.email;
});

afterAll(async () => {
  // Every fixture email ends with -<suffix>@example.com; the registered
  // invitee (created by better-auth) follows the same pattern.
  await prisma.serverAccessInvite.deleteMany({ where: { serverId } });
  await prisma.serverAccess.deleteMany({ where: { serverId } });
  await prisma.server.deleteMany({ where: { id: serverId } });
  await prisma.serverTemplate.deleteMany({ where: { name: `test-invite-template-${suffix}` } });
  await prisma.node.deleteMany({ where: { name: `test-invite-node-${suffix}` } });
  await prisma.location.deleteMany({ where: { name: `test-invite-loc-${suffix}` } });
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${suffix}@example.com` } } });
  await prisma.role.deleteMany({ where: { name: { in: [`test-invite-owner-${suffix}`, `test-invite-reader-${suffix}`] } } });
  await prisma.auditLog.deleteMany({ where: { resourceId: serverId } });
});

describe('invite flow routing facts', () => {
  it('preview reports hasAccount=false when the invited email is unregistered', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/servers/invites/${freshInviteToken}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.email).toBe(`test-invite-fresh-${suffix}@example.com`);
    expect(body.data.hasAccount).toBe(false);
    expect(body.data.serverName).toBe(serverName);
    await app.close();
  });

  it('preview reports hasAccount=true when the invited email already has an account', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/api/servers/invites/${existingAccountInviteToken}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.hasAccount).toBe(true);
    await app.close();
  });

  it('accept with a wrong-email session fails 403 and names the invited email', async () => {
    const app = await buildApp();
    currentUserId = wrongEmailUserId;
    currentUserEmail = `test-invite-wrong-${suffix}@example.com`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/invites/accept',
      payload: { token: acceptInviteToken },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe('INVITE_NOT_VALID_FOR_ACCOUNT');
    expect(body.params?.email).toBe(`test-invite-existing-${suffix}@example.com`);
    await app.close();
  });

  it('accept with the matching account grants access and consumes the invite', async () => {
    const app = await buildApp();
    currentUserId = existingAccountUserId;
    currentUserEmail = `test-invite-existing-${suffix}@example.com`;
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/invites/accept',
      payload: { token: acceptInviteToken },
    });
    expect(res.statusCode).toBe(200);

    const access = await prisma.serverAccess.findUnique({
      where: { userId_serverId: { userId: existingAccountUserId, serverId } },
    });
    expect(access?.permissions).toEqual(['server.read', 'console.read']);
    const invite = await prisma.serverAccessInvite.findUnique({ where: { token: acceptInviteToken } });
    expect(invite?.acceptedAt).not.toBeNull();
    await app.close();
  });
});

describe('invite-based registration', () => {
  it('returns INVITE_EMAIL_HAS_ACCOUNT (not generic CONFLICT) when the invited email is registered', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/invites/register',
      payload: { token: existingAccountInviteToken, username: `someone${suffix}`, password: 'password123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('INVITE_EMAIL_HAS_ACCOUNT');
    await app.close();
  });

  it('reports a taken username as a plain conflict', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/invites/register',
      payload: { token: freshInviteToken, username: `inviteowner${suffix}`, password: 'password123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('CONFLICT');
    await app.close();
  });

  it('registers the invited email and accepts the invite even with open registration disabled', async () => {
    // The dev database ships security.registrationEnabled=false (also the
    // fallback default) — exactly the panel configuration where invite-based
    // self-registration must keep working. Assert the gate really is closed
    // for the plain path, then prove the invite is the override.
    const { getSecuritySettings } = await import('../services/mailer.js');
    const security = await getSecuritySettings();
    expect(security.registrationEnabled).toBe(false);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/servers/invites/register',
      payload: {
        token: freshInviteToken,
        username: `invitereg${suffix}`,
        password: 'password123',
      },
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.email).toBe(`test-invite-fresh-${suffix}@example.com`);
    expect(data.userId).toBeTruthy();
    // Email verification is enforced on this database, so better-auth
    // withholds the session: the response must say so instead of implying
    // the invitee is signed in.
    if (security.requireEmailVerification) {
      expect(data.token).toBeNull();
      expect(data.emailVerificationRequired).toBe(true);
      expect(typeof data.mailConfigured).toBe('boolean');
    } else {
      expect(data.emailVerificationRequired).toBe(false);
    }

    const created = await prisma.user.findUnique({ where: { email: `test-invite-fresh-${suffix}@example.com` } });
    expect(created?.username).toBe(`invitereg${suffix}`);
    const access = await prisma.serverAccess.findUnique({
      where: { userId_serverId: { userId: data.userId, serverId } },
    });
    expect(access?.permissions).toEqual(['server.read', 'console.read']);
    const invite = await prisma.serverAccessInvite.findUnique({ where: { token: freshInviteToken } });
    expect(invite?.acceptedAt).not.toBeNull();
    await app.close();
  });
});

// The gate helper itself: closed settings must not leak inside a bypass.
describe('registration gate bypass scope', () => {
  it('is active only inside the callback', async () => {
    const { isRegistrationBypassed } = await import('../lib/registration-gate.js');
    expect(isRegistrationBypassed()).toBe(false);
    const inner = await withRegistrationBypass(async () => isRegistrationBypassed());
    expect(inner).toBe(true);
    expect(isRegistrationBypassed()).toBe(false);
  });
});
