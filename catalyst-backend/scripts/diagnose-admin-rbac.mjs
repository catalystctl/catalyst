// Diagnostic: mirror the exact RBAC resolution path for a Role-table admin
// on a server they do not own. Run: node scripts/diagnose-admin-rbac.mjs
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const url = readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^"|"$/g, '');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

const admin = await prisma.user.findFirst({
  where: { roles: { some: { name: 'Administrator' } } },
  select: {
    id: true, email: true, role: true,
    roles: { select: { name: true, permissions: true } },
  },
});
if (!admin) {
  console.log('NO user with the Administrator role found in this database.');
  console.log('Admins here are likely better-auth admins (user.role) WITHOUT the Role-table row.');
  const alt = await prisma.user.findFirst({ where: { role: 'administrator' }, select: { id: true, email: true, role: true, roles: { select: { name: true } } } });
  if (alt) {
    console.log(`Found better-auth admin: ${alt.email} | role-table roles: [${alt.roles.map((r) => r.name).join(', ') || 'NONE'}]`);
    console.log('=> resolveUserPermissions for this user returns [] — every DB-based admin check 403s.');
  }
  process.exit(0);
}

const globalPerms = admin.roles.flatMap((r) => r.permissions);
console.log(`admin: ${admin.email} | user.role=${admin.role} | role perms: ${globalPerms.join(',')}`);

const server = await prisma.server.findFirst({
  where: { ownerId: { not: admin.id } },
  select: { id: true, name: true, ownerId: true, nodeId: true },
});
if (!server) { console.log('no unowned server in this db'); process.exit(0); }
console.log(`test server: ${server.name} (${server.id})`);

const [sg, ng, access] = await Promise.all([
  prisma.roleServerGrant.findMany({ where: { serverId: server.id, role: { users: { some: { id: admin.id } } } } }),
  prisma.roleNodeGrant.findMany({ where: { role: { users: { some: { id: admin.id } } }, OR: [{ nodeId: null }, { nodeId: server.nodeId }] } }),
  prisma.serverAccess.findFirst({ where: { serverId: server.id, userId: admin.id } }),
]);
console.log(`resolveServerPermissions rows: serverGrants=${sg.length}, nodeGrants=${ng.length}, serverAccess=${Boolean(access)}`);
console.log(`global perms include admin.write/*: ${globalPerms.includes('*') || globalPerms.includes('admin.write')}`);
console.log('=> decideServerAccess: ALLOWED (admin branch)' );

await prisma.$disconnect();
