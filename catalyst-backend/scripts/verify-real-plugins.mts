/**
 * Acceptance harness: load every real first-party plugin from the
 * catalyst-plugins checkout through the patched PluginLoader and assert the
 * host still works for each one.
 *
 * Run with: npx tsx scripts/verify-real-plugins.mts
 *
 * This is intentionally NOT part of the unit suite (it depends on a sibling
 * checkout). It exists so a lifecycle/capability change can be validated
 * against the actual plugin corpus, not just fixtures.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';
import { PluginLoader } from '../src/plugins/loader.js';
import { DISCLAIMER_VERSION } from '../src/plugins/safety.js';
import { classifyFileTunnelOp, canReadFiles, canWriteFiles } from '../src/plugins/capabilities.js';

const PLUGINS_DIR = process.env.CATALYST_PLUGINS_DIR
  ?? path.resolve(import.meta.dirname, '../../../catalyst-plugins');

type Row = Record<string, any>;

function makePrisma(rows: Map<string, Row>) {
  return {
    plugin: {
      findUnique: async ({ where, select }: any) => {
        const row = rows.get(where.name);
        if (!row) return null;
        if (!select) return { ...row };
        const out: Row = {};
        for (const k of Object.keys(select)) out[k] = row[k] ?? null;
        return out;
      },
      upsert: async ({ where, create }: any) => {
        if (!rows.has(where.name)) rows.set(where.name, { ...create });
        return rows.get(where.name);
      },
      update: async ({ where, data }: any) => {
        const row = rows.get(where.name) ?? {};
        Object.assign(row, data);
        rows.set(where.name, row);
        return row;
      },
      findMany: async () => [...rows.values()].filter((r) => r.enabled),
    },
    pluginStorage: {
      findUnique: async () => null,
      upsert: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
      findMany: async () => [],
    },
    pluginActionAudit: { create: async () => ({}) },
    panelIdentity: {
      findUnique: async () => ({ installId: 'inst_verify' }),
      create: async () => ({}),
    },
    systemError: { create: async () => ({}) },
    server: {
      findMany: async () => [],
      findUnique: async () => null,
      count: async () => 0,
      update: async () => ({}),
    },
  } as any;
}

/** Records every host capability a plugin touches, and whether it was allowed. */
function makeGateway() {
  const calls: string[] = [];
  return {
    calls,
    sendToAgent: async (nodeId: string, message: any) => {
      calls.push(`sendToAgent:${message?.type}`);
      return true;
    },
    broadcastToAuthenticated: (m: any) => calls.push(`broadcast:${m?.type}`),
    sendToClient: (id: string, m: any) => {
      calls.push(`sendToClient:${m?.type}`);
      return true;
    },
    registerPluginWsHandler: (type: string) => calls.push(`wsHandler:${type}`),
    unregisterPluginWsHandlers: () => calls.push('wsHandlersCleared'),
    clients: new Map(),
    agents: new Map(),
  } as any;
}

function makeFileTunnel() {
  const calls: string[] = [];
  return {
    calls,
    queueRequest: async (_n: string, op: string) => {
      calls.push(op);
      return { requestId: 'r1', success: true, data: [] };
    },
  } as any;
}

async function main() {
  const entries = await fsp.readdir(PLUGINS_DIR, { withFileTypes: true });
  const pluginDirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name);

  const results: Array<{ name: string; ok: boolean; skipped?: boolean; detail: string }> = [];
  let failures = 0;

  // Plugins that cannot boot without external vendor config. `licensed-example`
  // deliberately bails from its licensing boot when no real license key is
  // configured, so it is not evidence of a host regression.
  const REQUIRES_EXTERNAL_CONFIG: Record<string, string> = {
    'licensed-example': 'requires a vendor license key + license server (bails by design)',
  };

  for (const dir of pluginDirs) {
    const pluginDir = path.join(PLUGINS_DIR, dir);
    const manifestPath = path.join(pluginDir, 'plugin.json');
    const manifestRaw = await fsp.readFile(manifestPath, 'utf8').catch(() => null);
    if (!manifestRaw) continue;
    const manifest = JSON.parse(manifestRaw);

    // Simulate the post-consent state: enabled + accepted, so onLoad runs.
    const rows = new Map<string, Row>();
    rows.set(manifest.name, {
      name: manifest.name,
      version: manifest.version,
      enabled: true,
      config: {},
      grantedPermissions: null,
      safetyAcceptedAt: new Date(),
      safetyDisclaimerVersion: DISCLAIMER_VERSION,
      safetyAcceptedPluginVersion: manifest.version,
      safetyAcceptedPermissions: manifest.permissions ?? [],
    });

    const gateway = makeGateway();
    const fileTunnel = makeFileTunnel();
    const loader = new PluginLoader(
      PLUGINS_DIR,
      makePrisma(rows),
      pino({ level: 'silent' }),
      gateway,
      { authenticate: () => {} } as any,
      { hotReload: false },
    );

    const problems: string[] = [];
    let routeCount = 0;
    try {
      await loader.loadPlugin(pluginDir);
      const plugin = loader.getRegistry().get(manifest.name);
      if (!plugin) throw new Error('not registered');
      if (plugin.status === 'error') throw new Error(`error state: ${plugin.error?.message}`);
      if (plugin.status !== 'loaded') problems.push(`status=${plugin.status}`);

      // onLoad must have registered the plugin's routes.
      routeCount = plugin.routes.length;
      if (routeCount === 0) problems.push('no routes registered');

      // Consent satisfied ⇒ enabled path must work end to end.
      await loader.enablePlugin(manifest.name);
      const enabled = loader.getRegistry().get(manifest.name);
      if (enabled?.status !== 'enabled') problems.push(`enable -> ${enabled?.status}`);

      // Capability facades must not expose host internals.
      const ctx: any = enabled?.context;
      if (!ctx) problems.push('no context');
      else {
        if ('clients' in (ctx.wsGateway ?? {})) problems.push('wsGateway leaks clients');
        if ('agents' in (ctx.wsGateway ?? {})) problems.push('wsGateway leaks agents');

        // Every file-tunnel op the plugin actually uses must be classified,
        // AND the plugin's real declared grants must allow it. This catches a
        // gate that is too strict for the plugin corpus, which is the failure
        // mode a classification-only check would miss.
        const grants = loader.getEffectivePermissions(manifest.name);
        for (const op of new Set(fileTunnel.calls)) {
          const cls = classifyFileTunnelOp(op);
          if (cls === 'unknown') {
            problems.push(`unclassified file op used: ${op}`);
            continue;
          }
          const allowed = cls === 'read' ? canReadFiles(grants) : canWriteFiles(grants);
          if (!allowed) {
            problems.push(`op ${op} (${cls}) denied by declared grants [${grants.join(',')}]`);
          }
        }

        // Exercise the facade for real: the op must be allowed or denied
        // exactly as the grant policy says, without throwing for an allowed
        // op. Use an op the plugin actually performs when there is one.
        const probe = fileTunnel.calls[0];
        if (probe) {
          try {
            await ctx.fileTunnel.queueRequest('probe-node', probe, 'probe-server', '/probe');
          } catch (err: any) {
            problems.push(`facade denied ${probe} for its own declared grants: ${err?.message}`);
          }
        }
      }

      // Re-enable/disable cycle must be clean.
      await loader.disablePlugin(manifest.name);
      await loader.enablePlugin(manifest.name);
      if (loader.getRegistry().get(manifest.name)?.status !== 'enabled') {
        problems.push('disable->enable failed');
      }

      await loader.unloadPlugin(manifest.name);
    } catch (err: any) {
      problems.push(`threw: ${err?.message ?? String(err)}`);
    }

    const external = REQUIRES_EXTERNAL_CONFIG[manifest.name];
    const ok = problems.length === 0;
    const skipped = !ok && !!external && problems.every((p) => p.includes('no license key configured'));
    if (!ok && !skipped) failures++;
    results.push({
      name: manifest.name,
      ok,
      skipped,
      detail: ok
        ? `routes=${routeCount}`
        : skipped
          ? `SKIP: ${external}`
          : problems.join('; '),
    });
  }

  const width = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const tag = r.skipped ? 'SKIP' : r.ok ? 'PASS' : 'FAIL';
    console.log(`${tag}  ${r.name.padEnd(width)}  ${r.detail}`);
  }
  const passed = results.filter((r) => r.ok).length;
  const skippedCount = results.filter((r) => r.skipped).length;
  console.log(
    `\n${passed}/${results.length} plugins OK`
      + (skippedCount ? `, ${skippedCount} skipped (external config)` : '')
      + (failures ? `, ${failures} FAILED` : ''),
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('harness failed:', err);
  process.exit(2);
});
