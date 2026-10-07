// Wave 3 permission data migration — TARGET-VOCABULARY.md §3.
//
// For each grant store row: append the new split values for any legacy value
// present (scope suffix preserved), KEEP the legacy values in place during the
// alias window (runtime hasGrant honors them either way), dedupe, and log
// per-store counts. Idempotent — a second run appends nothing: targets that
// are already present are skipped.
//
// Run: pnpm run db:migrate-permissions [-- --dry-run]

import 'dotenv/config';
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from '@prisma/adapter-pg';
import { LEGACY_ALIASES } from '../src/lib/permission-vocabulary.js';

const DRY_RUN = process.argv.includes('--dry-run');

// Prisma v7: pass config directly to avoid instanceof mismatch in hoisted
// pnpm layouts (same pattern as seed.ts).
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type GrantRow = { id: string; permissions: string[] };

interface StoreReport {
  model: string;
  rowsScanned: number;
  rowsChanged: number;
  valuesAppended: number;
  byLegacy: Record<string, number>;
}

/**
 * New values a stored permission should also grant.
 * 'server.update' → ['server.network', 'server.storage'];
 * 'node.update:node_1' → ['node.server_manage:node_1', 'node.agent_control:node_1'].
 */
function expansionFor(stored: string): string[] {
  const colonIndex = stored.indexOf(':');
  const base = colonIndex === -1 ? stored : stored.slice(0, colonIndex);
  const suffix = colonIndex === -1 ? '' : stored.slice(colonIndex);
  const targets = (LEGACY_ALIASES as Record<string, readonly string[] | undefined>)[base];
  return targets ? targets.map((t) => `${t}${suffix}`) : [];
}

/** Merged array for a row, or null when nothing changes (idempotent skip). */
function migrateRow(permissions: string[]): { next: string[]; appended: string[] } | null {
  const additions: string[] = [];
  for (const stored of permissions) {
    for (const target of expansionFor(stored)) {
      if (!permissions.includes(target) && !additions.includes(target)) {
        additions.push(target);
      }
    }
  }
  if (additions.length === 0) return null;
  return { next: [...permissions, ...additions], appended: additions };
}

async function migrateStore(
  model: string,
  scan: () => Promise<GrantRow[]>,
  update: (id: string, permissions: string[]) => Promise<unknown>,
): Promise<StoreReport> {
  const rows = await scan();
  const report: StoreReport = {
    model,
    rowsScanned: rows.length,
    rowsChanged: 0,
    valuesAppended: 0,
    byLegacy: {},
  };
  for (const row of rows) {
    for (const stored of row.permissions) {
      const colonIndex = stored.indexOf(':');
      const base = colonIndex === -1 ? stored : stored.slice(0, colonIndex);
      if (base in LEGACY_ALIASES) {
        report.byLegacy[base] = (report.byLegacy[base] ?? 0) + 1;
      }
    }
    const change = migrateRow(row.permissions);
    if (!change) continue;
    if (!DRY_RUN) await update(row.id, change.next);
    report.rowsChanged += 1;
    report.valuesAppended += change.appended.length;
    console.log(`  [${model}] ${row.id}: +${change.appended.join(', ')}`);
  }
  return report;
}

async function main() {
  console.log(`Permission split migration (${DRY_RUN ? 'DRY RUN' : 'APPLY'}) — TARGET-VOCABULARY §3`);
  console.log(
    `Mapping: ${Object.entries(LEGACY_ALIASES)
      .map(([k, v]) => `${k} → ${v.join(' + ')}`)
      .join('; ')}`,
  );
  console.log('Legacy values stay in place during the alias window.\n');

  // All six grant stores (schema.prisma): Role, apikey, ServerAccess,
  // ServerAccessInvite, RoleServerGrant, RoleNodeGrant. Tables are fetched
  // fully into memory — grant tables are small relative to log/metric tables
  // and full scan is the only way to catch scoped legacy forms
  // (e.g. 'node.update:node_1'), which array `hasSome` filters miss.
  const reports: StoreReport[] = [];
  reports.push(
    await migrateStore(
      'Role',
      () => prisma.role.findMany({ select: { id: true, permissions: true } }),
      (id, permissions) => prisma.role.update({ where: { id }, data: { permissions } }),
    ),
  );
  reports.push(
    await migrateStore(
      'apikey',
      () => prisma.apikey.findMany({ select: { id: true, permissions: true } }),
      (id, permissions) => prisma.apikey.update({ where: { id }, data: { permissions } }),
    ),
  );
  reports.push(
    await migrateStore(
      'ServerAccess',
      () => prisma.serverAccess.findMany({ select: { id: true, permissions: true } }),
      (id, permissions) => prisma.serverAccess.update({ where: { id }, data: { permissions } }),
    ),
  );
  reports.push(
    await migrateStore(
      'ServerAccessInvite',
      () => prisma.serverAccessInvite.findMany({ select: { id: true, permissions: true } }),
      (id, permissions) => prisma.serverAccessInvite.update({ where: { id }, data: { permissions } }),
    ),
  );
  reports.push(
    await migrateStore(
      'RoleServerGrant',
      () => prisma.roleServerGrant.findMany({ select: { id: true, permissions: true } }),
      (id, permissions) => prisma.roleServerGrant.update({ where: { id }, data: { permissions } }),
    ),
  );
  reports.push(
    await migrateStore(
      'RoleNodeGrant',
      () => prisma.roleNodeGrant.findMany({ select: { id: true, permissions: true } }),
      (id, permissions) => prisma.roleNodeGrant.update({ where: { id }, data: { permissions } }),
    ),
  );

  console.log('\nSummary:');
  for (const r of reports) {
    const legacyDetail = Object.entries(r.byLegacy)
      .map(([k, n]) => `${k}×${n}`)
      .join(', ');
    console.log(
      `  ${r.model}: scanned=${r.rowsScanned} changed=${r.rowsChanged} appended=${r.valuesAppended}` +
        (legacyDetail ? ` (legacy present: ${legacyDetail})` : ''),
    );
  }
  const totalChanged = reports.reduce((s, r) => s + r.rowsChanged, 0);
  const totalAppended = reports.reduce((s, r) => s + r.valuesAppended, 0);
  console.log(
    `\nTOTAL rows changed: ${totalChanged}, values appended: ${totalAppended}` +
      (DRY_RUN ? ' (dry run — nothing written)' : ''),
  );
  console.log('Idempotent: re-running appends nothing (present targets are skipped).');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
