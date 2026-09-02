/**
 * Auto FastDL plugin — backend entry.
 *
 * Pairs game servers with a FastDL (Caddy) server on the same node and keeps
 * the FastDL docroot in sync with the game servers' downloadable content
 * (maps, models, sounds, ...). Sync runs on a cron schedule and on demand.
 *
 * Storage model (plugin collections):
 *   pairings   — one doc per source->fastdl mapping
 *   sync_state — per pairing, the last-synced file snapshot
 *   sync_log   — bounded per-pairing run history
 */

import { syncPairing, summarizeReport } from './sync-engine.js';
import { buildDownloadUrl } from './logic.js';

const MAX_LOG_ENTRIES_PER_PAIRING = 50;
const DEFAULTS = {
  syncIntervalCron: '*/5 * * * *',
  syncEnabled: true,
  generateBzip2: false,
  bz2MinSizeMb: 2,
  maxFileSizeMb: 512,
  deleteRemoved: true,
};

const plugin = {
  async onLoad(ctx) {
    ctx.logger.info('Auto FastDL plugin loaded');
    this.cronJob = null;
    this.syncing = new Set(); // pairingIds with a sync in flight

    // ── Routes (auto-prefixed to /api/plugins/fastdl-sync/) ────────────────
    const requirePerm = (...perms) => ctx.requirePermission?.(...perms) ?? ((req, reply, done) => done?.());

    // List pairings with sync status + the sv_downloadurl for each fastdl server
    ctx.registerRoute({
      method: 'GET',
      url: '/pairings',
      preHandler: requirePerm('server.read'),
      handler: async () => {
        const pairings = await ctx.collection('pairings').find();
        const servers = await ctx.db.servers.findMany({
          select: { id: true, uuid: true, name: true, nodeId: true, primaryIp: true, primaryPort: true, status: true },
        });
        const byUuid = new Map(servers.map((s) => [s.uuid, s]));
        const enriched = [];
        for (const p of pairings) {
          const src = byUuid.get(p.sourceServerUuid);
          const dst = byUuid.get(p.fastdlServerUuid);
          const state = await ctx.collection('sync_state').findOne({ pairingId: p.id });
          const log = await ctx.collection('sync_log').find(
            { pairingId: p.id },
            { sort: { startedAt: -1 }, limit: 5 },
          );
          enriched.push({
            ...p,
            sourceServer: src ? { uuid: src.uuid, name: src.name, status: src.status } : null,
            fastdlServer: dst ? {
              uuid: dst.uuid, name: dst.name, status: dst.status,
              downloadUrl: buildDownloadUrl(dst.primaryIp, dst.primaryPort),
            } : null,
            lastSyncAt: state?.syncedAt ?? null,
            fileCount: state?.files ? Object.keys(state.files).length : null,
            recentRuns: log,
          });
        }
        return { success: true, pairings: enriched };
      },
    });

    // Candidates: game servers (by template/environment heuristics) and FastDL servers
    ctx.registerRoute({
      method: 'GET',
      url: '/candidates',
      preHandler: requirePerm('server.read'),
      handler: async () => {
        const servers = await ctx.db.servers.findMany({
          select: { id: true, uuid: true, name: true, nodeId: true, templateId: true, primaryIp: true, primaryPort: true },
        });
        // FastDL servers are those created from a template whose image/startup
        // marks them; detect via templateId lookup is not available to plugins,
        // so the UI lets the admin pick which server is the FastDL target.
        return { success: true, servers };
      },
    });

    // Create a pairing
    ctx.registerRoute({
      method: 'POST',
      url: '/pairings',
      preHandler: requirePerm('server.write'),
      handler: async (request, reply) => {
        const { sourceServerUuid, fastdlServerUuid, sourceServerNodeId, fastdlServerNodeId, excludeGlobs } = request.body ?? {};
        if (!sourceServerUuid || !fastdlServerUuid || !sourceServerNodeId || !fastdlServerNodeId) {
          return reply.status(400).send({ success: false, error: 'sourceServerUuid, fastdlServerUuid, sourceServerNodeId and fastdlServerNodeId are required' });
        }
        if (sourceServerUuid === fastdlServerUuid) {
          return reply.status(400).send({ success: false, error: 'a server cannot be paired with itself' });
        }
        const pairing = {
          id: `pair_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          sourceServerUuid,
          fastdlServerUuid,
          sourceServerNodeId,
          fastdlServerNodeId,
          excludeGlobs: Array.isArray(excludeGlobs) ? excludeGlobs : [],
          createdAt: new Date().toISOString(),
        };
        await ctx.collection('pairings').insert(pairing);
        ctx.logger.info({ pairingId: pairing.id }, 'FastDL pairing created');
        return { success: true, pairing };
      },
    });

    // Delete a pairing (optionally wiping synced files is left manual — deleting
    // thousands of files on a click is riskier than leaving them)
    ctx.registerRoute({
      method: 'DELETE',
      url: '/pairings/:id',
      preHandler: requirePerm('server.write'),
      handler: async (request, reply) => {
        const { id } = request.params;
        await ctx.collection('pairings').delete({ id });
        await ctx.collection('sync_state').deleteMany({ pairingId: id });
        await ctx.collection('sync_log').deleteMany({ pairingId: id });
        return { success: true };
      },
    });

    // Trigger an immediate sync
    ctx.registerRoute({
      method: 'POST',
      url: '/pairings/:id/sync',
      preHandler: requirePerm('server.write'),
      handler: async (request, reply) => {
        const { id } = request.params;
        const pairing = await ctx.collection('pairings').findOne({ id });
        if (!pairing) return reply.status(404).send({ success: false, error: 'pairing not found' });
        if (this.syncing.has(id)) {
          return reply.status(409).send({ success: false, error: 'sync already running for this pairing' });
        }
        // Run in background; UI polls the log endpoint
        this.runSync(ctx, pairing).catch(() => {});
        return { success: true, started: true };
      },
    });

    // Sync log for one pairing
    ctx.registerRoute({
      method: 'GET',
      url: '/pairings/:id/log',
      preHandler: requirePerm('server.read'),
      handler: async (request) => {
        const log = await ctx.collection('sync_log').find(
          { pairingId: request.params.id },
          { sort: { startedAt: -1 }, limit: MAX_LOG_ENTRIES_PER_PAIRING },
        );
        return { success: true, log };
      },
    });
  },

  /** Run a sync with in-flight dedupe + logging; used by route and cron. */
  async runSync(ctx, pairing) {
    if (this.syncing.has(pairing.id)) return;
    this.syncing.add(pairing.id);
    try {
      const opts = {
        generateBzip2: ctx.getConfig('generateBzip2') ?? DEFAULTS.generateBzip2,
        bz2MinSizeMb: ctx.getConfig('bz2MinSizeMb') ?? DEFAULTS.bz2MinSizeMb,
        maxFileSizeMb: ctx.getConfig('maxFileSizeMb') ?? DEFAULTS.maxFileSizeMb,
        deleteRemoved: ctx.getConfig('deleteRemoved') ?? DEFAULTS.deleteRemoved,
      };
      const report = await syncPairing(ctx, pairing, opts);
      await ctx.collection('sync_log').insert({
        pairingId: pairing.id,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        ok: report.ok,
        summary: summarizeReport(report),
        copied: report.copied,
        deleted: report.deleted,
        bz2Generated: report.bz2Generated,
        skipped: report.skipped,
        errors: report.errors.slice(0, 20),
      });
      // Bound the log
      const all = await ctx.collection('sync_log').find({ pairingId: pairing.id }, { sort: { startedAt: -1 } });
      if (all.length > MAX_LOG_ENTRIES_PER_PAIRING) {
        for (const old of all.slice(MAX_LOG_ENTRIES_PER_PAIRING)) {
          await ctx.collection('sync_log').delete({ _id: old._id ?? old.id });
        }
      }
      if (!report.ok) {
        ctx.logger.warn({ pairingId: pairing.id, errors: report.errors }, 'FastDL sync finished with errors');
      } else {
        ctx.logger.info({ pairingId: pairing.id, summary: summarizeReport(report) }, 'FastDL sync complete');
      }
    } finally {
      this.syncing.delete(pairing.id);
    }
  },

  async onEnable(ctx) {
    // (Re)schedule the cron from current config
    this.disableCron?.();
    const enabled = ctx.getConfig('syncEnabled') ?? DEFAULTS.syncEnabled;
    if (!enabled) return;

    const cron = await import('node-cron');
    const expr = ctx.getConfig('syncIntervalCron') ?? DEFAULTS.syncIntervalCron;
    if (!cron.validate(expr)) {
      ctx.logger.warn({ expr }, 'Invalid syncIntervalCron — scheduled sync disabled');
      return;
    }
    this.cronJob = cron.schedule(expr, async () => {
      try {
        const pairings = await ctx.collection('pairings').find();
        for (const p of pairings) {
          await this.runSync(ctx, p);
        }
      } catch (err) {
        ctx.logger.error({ err: err.message }, 'Scheduled FastDL sync failed');
      }
    });
    ctx.logger.info({ expr }, 'FastDL sync scheduler enabled');
  },

  disableCron() {
    this.cronJob?.stop?.();
    this.cronJob = null;
  },

  async onDisable() {
    this.disableCron();
  },
};

export default plugin;
