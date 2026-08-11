import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { auth } from '../src/auth';
import { withRegistrationBypass } from '../src/lib/registration-gate.js';

const adminEmailEnv = process.env.CATALYST_ADMIN_EMAIL?.trim().toLowerCase();
const adminUsernameEnv = process.env.CATALYST_ADMIN_USERNAME?.trim();
const adminPasswordEnv = process.env.CATALYST_ADMIN_PASSWORD;
const adminNameEnv = process.env.CATALYST_ADMIN_NAME?.trim() || adminUsernameEnv || 'Administrator';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

if (!adminEmailEnv || !adminUsernameEnv || !adminPasswordEnv) {
  throw new Error(
    'CATALYST_ADMIN_EMAIL, CATALYST_ADMIN_USERNAME, and CATALYST_ADMIN_PASSWORD are required'
  );
}

if (adminPasswordEnv.length < 12) {
  throw new Error('CATALYST_ADMIN_PASSWORD must be at least 12 characters');
}

const adminEmail = adminEmailEnv;
const adminUsername = adminUsernameEnv;
const adminPassword = adminPasswordEnv;
const adminName = adminNameEnv;

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const adminPermissions = [
  '*',
  'server.start',
  'server.stop',
  'server.read',
  'file.read',
  'file.write',
  'console.read',
  'console.write',
  'server.create',
  'server.delete',
  'server.suspend',
  'admin.read',
  'admin.write',
];

async function ensureAdministratorRole() {
  return prisma.role.upsert({
    where: { name: 'Administrator' },
    update: {
      description: 'Full system access',
      permissions: adminPermissions,
    },
    create: {
      name: 'Administrator',
      description: 'Full system access',
      permissions: adminPermissions,
    },
  });
}

async function createAdminUser() {
  const origin = process.env.FRONTEND_URL || process.env.CORS_ORIGIN || process.env.BETTER_AUTH_URL;
  const response = await withRegistrationBypass(() => auth.api.signUpEmail({
    headers: new Headers({
      origin: origin || 'http://localhost:3000',
    }),
    body: {
      email: adminEmail,
      password: adminPassword,
      name: adminName,
      username: adminUsername,
    } as any,
    returnHeaders: true,
  }));

  const data =
    'headers' in response && response.response ? response.response : (response as any);

  return data?.user ?? null;
}

async function main() {
  console.log('Bootstrapping production admin user...');
  const adminRole = await ensureAdministratorRole();

  let user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: adminEmail, mode: 'insensitive' } },
        { username: adminUsername },
      ],
    },
    include: {
      roles: { select: { id: true, name: true } },
    },
  });

  if (!user) {
    const created = await createAdminUser();
    if (!created?.id) {
      throw new Error('Failed to create admin user');
    }
    user = await prisma.user.findUnique({
      where: { id: created.id },
      include: { roles: { select: { id: true, name: true } } },
    });
  }

  if (!user) {
    throw new Error('Admin user could not be loaded');
  }

  const hasAdminRole = user.roles.some((role) => role.id === adminRole.id);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      role: 'administrator',
      roles: hasAdminRole ? undefined : { connect: { id: adminRole.id } },
    },
  });

  console.log(`Admin account ready: ${adminEmail}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
