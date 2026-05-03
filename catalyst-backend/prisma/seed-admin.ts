// ═════════════════════════════════════════════════════════════════════════════
//  DEVELOPMENT ONLY — DO NOT RUN IN PRODUCTION
//  Minimal seed that creates only the default admin user + role.
//  Fast. Use for e2e / screenshot tests. For production use the /setup route.
// ═════════════════════════════════════════════════════════════════════════════

import 'dotenv/config';
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { auth, initAuth } from "../src/auth";
initAuth();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ALLOW_DEFAULT_ADMIN) {
    console.error('ERROR: Seed scripts must not be run in production.');
    console.error('For new production installs, open the /setup page in your browser.');
    console.error('If you really need to seed, set NODE_ENV=development or');
    console.error('SEED_ALLOW_DEFAULT_ADMIN=true to override this guard.');
    process.exit(1);
  }

  console.log('Seeding admin user + role...');

  let user = await prisma.user.findUnique({ where: { email: 'admin@example.com' } });

  if (!user) {
    const signUpResponse = await auth.api.signUpEmail({
      headers: new Headers({
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      }),
      body: {
        email: 'admin@example.com',
        password: 'admin123',
        name: 'admin',
        username: 'admin',
      } as any,
      returnHeaders: true,
    });

    const data =
      'headers' in signUpResponse && signUpResponse.response
        ? signUpResponse.response
        : (signUpResponse as any);
    user = data?.user;
  }

  if (!user) {
    throw new Error('Failed to create admin user via better-auth');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'Administrator' },
    update: { permissions: ['*'] },
    create: {
      name: 'Administrator',
      description: 'Full system access',
      permissions: ['*'],
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: {
      role: 'administrator',
      roles: { connect: { id: adminRole.id } },
    },
  });

  console.log('✓ Admin user ready: admin@example.com / admin123');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
