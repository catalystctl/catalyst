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

// ── Legacy split-value count report (alias window tracker) ────────────────
// Duplicate of LEGACY_ALIASES keys (src/lib/permission-vocabulary.ts — the
// single source; .mjs cannot import TS). When every count below is zero,
// it is safe to drop the alias window.
const LEGACY_KEYS = [
  'apikey.manage', 'server.update', 'node.update', 'server.suspend',
  'server.transfer', 'server.create', 'server.stop',
];
const STORES = [
  ['Role', prisma.role],
  ['ApiKey', prisma.apikey],
  ['ServerAccess', prisma.serverAccess],
  ['ServerAccessInvite', prisma.serverAccessInvite],
  ['RoleServerGrant', prisma.roleServerGrant],
  ['RoleNodeGrant', prisma.roleNodeGrant],
];
console.log('\nLegacy split values still stored (run db:migrate-permissions to append the new values; these stay until the alias window closes):');
let totalLegacy = 0;
for (const [name, model] of STORES) {
  const rows = await model.findMany({ select: { permissions: true } });
  const counts = {};
  for (const row of rows) {
    for (const stored of row.permissions) {
      const base = stored.split(':')[0];
      if (LEGACY_KEYS.includes(base)) counts[base] = (counts[base] ?? 0) + 1;
    }
  }
  const detail = Object.entries(counts).map(([k, n]) => `${k}×${n}`).join(', ');
  totalLegacy += Object.values(counts).reduce((s, n) => s + n, 0);
  console.log(`  ${name}: ${detail || 'none'}`);
}
console.log(
  totalLegacy === 0
    ? '=> zero legacy values stored: LEGACY_ALIASES can be removed (post wave-2 + UI retraining).'
    : `=> ${totalLegacy} legacy values stored across all grant stores.`,
);

await prisma.$disconnect();
