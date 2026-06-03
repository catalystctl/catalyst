/**
 * Catalyst - One-time admin recovery script
 *
 * Re-creates the default admin user (admin@example.com / admin123) and the
 * default Administrator / User roles, after they were deleted by a test
 * suite running against the live database.
 *
 * Idempotent: safe to re-run. Skips steps that are already in place.
 *
 * Usage:
 *   pnpm run recover:admin
 * or:
 *   tsx scripts/recover-admin.ts
 *
 * To use a different email/password, set CATALYST_RECOVER_EMAIL and
 * CATALYST_RECOVER_PASSWORD env vars.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { auth, initAuth } from '../src/auth';

const email = (process.env.CATALYST_RECOVER_EMAIL ?? 'admin@example.com').toLowerCase().trim();
const username = process.env.CATALYST_RECOVER_USERNAME ?? 'admin';
const password = process.env.CATALYST_RECOVER_PASSWORD ?? 'admin123';
const name = process.env.CATALYST_RECOVER_NAME ?? 'admin';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

initAuth();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function ensureAdministratorRole() {
  return prisma.role.upsert({
    where: { name: 'Administrator' },
    update: { description: 'Full system access', permissions: ['*'] },
    create: { name: 'Administrator', description: 'Full system access', permissions: ['*'] },
  });
}

async function ensureUserRole() {
  return prisma.role.upsert({
    where: { name: 'User' },
    update: {
      description: 'Standard user access',
      permissions: [
        'server.read', 'server.start', 'server.stop',
        'file.read', 'file.write',
        'console.read', 'console.write',
      ],
    },
    create: {
      name: 'User',
      description: 'Standard user access',
      permissions: [
        'server.read', 'server.start', 'server.stop',
        'file.read', 'file.write',
        'console.read', 'console.write',
      ],
    },
  });
}

async function findUser() {
  return prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    include: { accounts: true, roles: true },
  });
}

async function createUserViaAuth() {
  const origin = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || process.env.BETTER_AUTH_URL || 'http://localhost:3000';
  const response = await auth.api.signUpEmail({
    headers: new Headers({ origin }),
    body: { email, password, name, username } as any,
    returnHeaders: true,
  });
  const data = 'headers' in response && (response as any).response ? (response as any).response : (response as any);
  return data?.user ?? null;
}

async function main() {
  console.log(`Recovering admin: ${email}`);

  const adminRole = await ensureAdministratorRole();
  await ensureUserRole();
  console.log('✓ Roles ready');

  let user = await findUser();

  if (!user) {
    console.log('  User missing — creating via better-auth…');
    const created = await createUserViaAuth();
    if (!created?.id) {
      throw new Error('Failed to create user via better-auth');
    }
    user = await prisma.user.findUnique({
      where: { id: created.id },
      include: { accounts: true, roles: true },
    });
    if (!user) throw new Error('User vanished after create');
    console.log('✓ User created');
  } else {
    console.log('  User exists — updating role + verification');
  }

  if (!user) throw new Error('Unreachable');

  // Ensure role assignment + emailVerified + role string
  const hasAdminRole = user.roles.some((r) => r.id === adminRole.id);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      role: 'administrator',
      emailVerified: true,
      banned: false,
      banReason: null,
      banExpires: null,
      ...(hasAdminRole ? {} : { roles: { connect: { id: adminRole.id } } }),
    },
  });

  // Ensure a credential account row exists with a password hash.
  // If the user was restored from a User-only record (no account row),
  // create a credential account using better-auth's signUp path
  // (which writes the password hash). signUpEmail is idempotent on
  // existing emails and would fail, so we use a different strategy:
  // generate a fresh password hash with the same scrypt format better-auth uses.
  const hasCredential = user.accounts.some((a) => a.providerId === 'credential');
  if (!hasCredential) {
    console.log('  No credential account — setting password via auth.api…');
    // Use better-auth's setPassword if available
    const authApi: any = auth.api as any;
    if (typeof authApi.setPassword === 'function') {
      await authApi.setPassword({ body: { userId: user.id, newPassword: password }, headers: new Headers() });
    } else if (typeof authApi.changePassword === 'function') {
      // fallback not applicable for users without current password
      throw new Error('No password set and auth.api has no setPassword method. Set one manually.');
    } else {
      throw new Error('No credential account and better-auth has no setPassword API. Manual DB intervention needed.');
    }
    console.log('✓ Password set');
  } else {
    console.log('  Credential account present — password unchanged');
  }

  console.log('');
  console.log('=== Recovery complete ===');
  console.log(`  email:    ${email}`);
  console.log(`  username: ${username}`);
  console.log(`  password: ${password}`);
  console.log(`  role:     Administrator (*)`);
  console.log('  CHANGE THE PASSWORD IMMEDIATELY AFTER LOGIN.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
