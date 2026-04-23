/**
 * Migration Service — Orchestrates Pterodactyl → Catalyst migration
 */

import { EventEmitter } from "node:events";
import type { PrismaClient } from "@prisma/client";
import { PterodactylClient, PterodactylClientError } from "./pterodactyl-client";
import { EntityMapper } from "./entity-mapper";
import { MigrationStateManager } from "./migration-state";
import type { MigrationPhase } from "./types";
import { MIGRATION_PHASES } from "./types";
import crypto from "node:crypto";
import { captureSystemError } from "../../services/error-logger";

interface MigrationEvents {
  progress: [data: {
    jobId: string;
    phase: MigrationPhase;
    current: number;
    total: number;
    message: string;
  }];
  phaseStart: [data: { jobId: string; phase: MigrationPhase }];
  phaseComplete: [data: { jobId: string; phase: MigrationPhase }];
  error: [data: { jobId: string; phase: MigrationPhase; error: string }];
  complete: [data: { jobId: string }];
  log: [data: { jobId: string; level: string; message: string; phase?: string }];
}

export class MigrationService extends EventEmitter<MigrationEvents> {
  private activeJobs = new Map<string, { cancelled: boolean }>();
  private app: any;

  constructor(
    private prisma: PrismaClient,
    private logger: any,
    app?: any
  ) {
    super();
    this.app = app;
  }

  setApp(app: any) {
    this.app = app;
  }

  // ========================================================================
  // PUBLIC API
  // ========================================================================

  /**
   * Test connection to a Pterodactyl panel
   */
  async testConnection(url: string, key: string, clientApiKey?: string): Promise<{
    success: boolean;
    version?: string;
    stats?: {
      locations: number;
      nodes: number;
      nests: number;
      users: number;
      servers: number;
    };
    nodesList?: Array<{ id: number; name: string; fqdn: string; memory: number; serverCount: number }>;
    serversList?: Array<{ id: number; uuid: string; name: string; nodeId: number; nodeName: string; state: string; eggName: string; nestName: string }>;
    error?: string;
  }> {
    const client = new PterodactylClient(url, key, this.logger, clientApiKey);

    try {
      const connResult = await client.testConnection();
      if (!connResult.success) {
        return connResult;
      }

      // Get preview with lists
      const preview = await client.getPreview();
      return {
        success: true,
        version: connResult.version,
        stats: {
          locations: preview.locations,
          nodes: preview.nodes,
          nests: preview.nests,
          users: preview.users,
          servers: preview.servers,
        },
        nodesList: preview.nodesList,
        serversList: preview.serversList,
      };
    } finally {
      client.close();
    }
  }

  /**
   * Start a new migration
   */
  async startMigration(jobId: string): Promise<void> {
    const state = new MigrationStateManager(this.prisma);
    const job = await state.getJob(jobId);
    if (!job) throw new Error(`Migration job ${jobId} not found`);
    if (job.status === "running") throw new Error("Migration already running");

    const config = job.config as any;
    const activeFlag = { cancelled: false };
    this.activeJobs.set(jobId, activeFlag);

    try {
      await state.startJob(jobId);
      this.logger.info({ jobId, url: job.sourceUrl }, "Starting migration");

      // Create client
      const client = new PterodactylClient(job.sourceUrl, job.sourceKey, this.logger, config.clientApiKey);

      try {
        await this.runMigration(jobId, client, config, state, activeFlag, job.bypassToken);
      } finally {
        client.close();
      }
    } catch (err: any) {
      captureSystemError({ level: 'error', component: 'MigrationService', message: `Migration failed: ${err.message}`, stack: err?.stack, metadata: { jobId } }).catch(() => {});
      this.logger.error({ jobId, error: err.message }, "Migration failed");
      await state.updateJobStatus(jobId, "failed", err.message);
      this.emit("error", { jobId, phase: "validate" as MigrationPhase, error: err.message });
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  async pauseMigration(jobId: string): Promise<void> {
    const active = this.activeJobs.get(jobId);
    if (active) active.cancelled = true;
    const state = new MigrationStateManager(this.prisma);
    await state.updateJobStatus(jobId, "paused");
  }

  async resumeMigration(jobId: string): Promise<void> {
    const state = new MigrationStateManager(this.prisma);
    const job = await state.getJob(jobId);
    if (!job) throw new Error(`Migration job ${jobId} not found`);
    if (job.status !== "paused" && job.status !== "failed") {
      throw new Error(`Cannot resume job in status: ${job.status}`);
    }

    const config = job.config as any;
    const activeFlag = { cancelled: false };
    this.activeJobs.set(jobId, activeFlag);

    try {
      await state.updateJobStatus(jobId, "running");
      const client = new PterodactylClient(job.sourceUrl, job.sourceKey, this.logger, config.clientApiKey);
      try {
        await this.runMigration(jobId, client, config, state, activeFlag, job.bypassToken);
      } finally {
        client.close();
      }
    } catch (err: any) {
      captureSystemError({ level: 'error', component: 'MigrationService', message: `Migration resume failed: ${err.message}`, stack: err?.stack, metadata: { jobId } }).catch(() => {});
      this.logger.error({ jobId, error: err.message }, "Migration resume failed");
      await state.updateJobStatus(jobId, "failed", err.message);
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  async cancelMigration(jobId: string): Promise<void> {
    const active = this.activeJobs.get(jobId);
    if (active) active.cancelled = true;
    const state = new MigrationStateManager(this.prisma);
    await state.updateJobStatus(jobId, "cancelled");
  }

  async getMigrationStatus(jobId: string) {
    const state = new MigrationStateManager(this.prisma);
    return state.getJob(jobId);
  }

  async listMigrations() {
    const state = new MigrationStateManager(this.prisma);
    return state.listJobs();
  }

  async retryStep(jobId: string, stepId: string): Promise<void> {
    const state = new MigrationStateManager(this.prisma);
    const job = await state.getJob(jobId);
    if (!job) throw new Error(`Migration job ${jobId} not found`);
    if (job.status !== "paused" && job.status !== "failed") {
      throw new Error("Job must be paused or failed to retry steps");
    }

    await state.resetStepForRetry(stepId);

    // Auto-resume the job
    await this.resumeMigration(jobId);
  }

  // ========================================================================
  // MIGRATION ORCHESTRATOR
  // ========================================================================

  private async runMigration(
    jobId: string,
    client: PterodactylClient,
    config: any,
    state: MigrationStateManager,
    activeFlag: { cancelled: boolean },
    bypassToken?: string | null
  ) {
    const mapper = new EntityMapper(this.prisma);

    // Pre-populate node map from explicit config mappings
    // nodeMappings: { pteroNodeId (string) -> catalystNodeId (string) }
    // serverMappings: { pteroServerId (string) -> catalystNodeId (string) }
    const nodeMappings = config.nodeMappings as Record<string, string> | undefined;
    const serverMappings = config.serverMappings as Record<string, string> | undefined;
    const scope = config.scope || 'full';

    if (nodeMappings) {
      for (const [pteroId, catalystId] of Object.entries(nodeMappings)) {
        mapper.nodeMap.set(Number(pteroId), catalystId);
      }
    }
    if (serverMappings) {
      // For per-server scope, we build a per-server node lookup.
      // Store in a separate map on the mapper instance.
      mapper.serverNodeMap = new Map(
        Object.entries(serverMappings).map(([pteroId, catalystId]) => [Number(pteroId), catalystId])
      );
    }

    // Build set of allowed Ptero server IDs based on scope
    const allowedPteroServerIds = new Set<number>();
    if (scope === 'full' && nodeMappings) {
      // Full scope: include all servers from mapped nodes
      for (const pteroNodeId of Object.keys(nodeMappings)) {
        allowedPteroServerIds.add(Number(pteroNodeId)); // will match by node below
      }
    } else if (scope === 'node' && nodeMappings) {
      for (const pteroNodeId of Object.keys(nodeMappings)) {
        allowedPteroServerIds.add(Number(pteroNodeId));
      }
    } else if (scope === 'server' && serverMappings) {
      for (const pteroServerId of Object.keys(serverMappings)) {
        allowedPteroServerIds.add(Number(pteroServerId));
      }
    }
    config._allowedPteroServerIds = allowedPteroServerIds;

    // Determine which phases to run
    const phasesToRun: MigrationPhase[] = config.phases?.length
      ? (config.phases as MigrationPhase[])
      : [...MIGRATION_PHASES];

    // Check if resuming — find last completed phase
    const lastPhase = await state.getLastCompletedPhase(jobId) as MigrationPhase | null;
    let resumeFrom = 0;
    if (lastPhase) {
      const idx = phasesToRun.indexOf(lastPhase);
      this.logger.info({ jobId, lastPhase, idx, resumeFrom: idx + 1 }, "Resuming migration from phase");
      if (idx >= 0) resumeFrom = idx + 1;
    }
    this.logger.info({ jobId, resumeFrom, phasesToRun }, "Migration phases");

    let totalSteps = 0;
    let completedSteps = 0;
    let failedSteps = 0;

    for (let i = resumeFrom; i < phasesToRun.length; i++) {
      if (activeFlag.cancelled) {
        this.logger.info({ jobId, phase: phasesToRun[i] }, "Migration cancelled");
        return;
      }

      const phase = phasesToRun[i];
      this.logger.info({ jobId, phase }, `Starting phase: ${phase}`);
      this.emit("phaseStart", { jobId, phase });
      this.emit("log", { jobId, level: "info", message: `Starting phase: ${phase}`, phase });

      await state.updateJobProgress(jobId, phase, {
        total: totalSteps,
        completed: completedSteps,
        failed: failedSteps,
        skipped: 0,
      });

      try {
        const result = await this.runPhase(
          phase,
          jobId,
          client,
          mapper,
          state,
          config,
          activeFlag,
          bypassToken
        );

        totalSteps += result.total;
        completedSteps += result.completed;
        failedSteps += result.failed;

        this.logger.info({ jobId, phase, result }, `Phase ${phase} complete`);
        this.emit("phaseComplete", { jobId, phase });
        this.emit("log", {
          jobId,
          level: "info",
          message: `Phase ${phase} complete: ${result.completed}/${result.total} succeeded, ${result.failed} failed`,
          phase,
        });
      } catch (err: any) {
        captureSystemError({ level: 'error', component: 'MigrationService', message: `Phase ${phase} failed: ${err.message}`, stack: err?.stack, metadata: { jobId, phase } }).catch(() => {});
        this.logger.error({ jobId, phase, error: err.message }, `Phase ${phase} failed`);
        this.emit("error", { jobId, phase, error: err.message });

        if (err instanceof PterodactylClientError && err.code === "AUTH_FAILED") {
          // Fatal error — don't continue
          throw err;
        }
        // Non-fatal — continue to next phase
        failedSteps++;
      }

      await state.updateJobProgress(jobId, phase, {
        total: totalSteps,
        completed: completedSteps,
        failed: failedSteps,
        skipped: 0,
      });
    }

    // Mark as completed
    await state.updateJobStatus(jobId, "completed");
    this.emit("complete", { jobId });
    this.emit("log", {
      jobId,
      level: "info",
      message: `Migration complete: ${completedSteps}/${totalSteps} steps succeeded`,
    });
  }

  private async runPhase(
    phase: MigrationPhase,
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    config: any,
    activeFlag: { cancelled: boolean },
    bypassToken?: string | null
  ): Promise<{ total: number; completed: number; failed: number }> {
    switch (phase) {
      case "validate":
        return this.phaseValidate(jobId, client, state);
      case "locations":
        return this.phaseLocations(jobId, client, mapper, state, activeFlag);
      case "templates":
        return this.phaseTemplates(jobId, client, mapper, state, activeFlag);
      case "users":
        return this.phaseUsers(jobId, client, mapper, state, activeFlag);
      case "servers":
        return this.phaseServers(jobId, client, mapper, state, config, activeFlag);
      case "subusers":
        return this.phaseSubusers(jobId, client, mapper, state, config, activeFlag);
      case "databases":
        return this.phaseDatabases(jobId, client, mapper, state, config, activeFlag);
      case "schedules":
        return this.phaseSchedules(jobId, client, mapper, state, config, activeFlag);
      case "backups":
        return this.phaseBackups(jobId, client, mapper, state, config, activeFlag);
      case "files":
        return this.phaseFiles(jobId, client, mapper, state, config, activeFlag, bypassToken);
      default:
        this.logger.warn({ phase }, "Unknown migration phase");
        return { total: 0, completed: 0, failed: 0 };
    }
  }

  // ========================================================================
  // PHASE: VALIDATE
  // ========================================================================

  private async phaseValidate(
    jobId: string,
    client: PterodactylClient,
    state: MigrationStateManager
  ) {
    const step = await state.createStep(jobId, "validate", "validate_connection");
    const start = Date.now();

    try {
      await state.updateStepStatus(step.id, "running");

      // Test connection
      const connResult = await client.testConnection();
      if (!connResult.success) {
        throw new Error(`Connection test failed: ${connResult.error}`);
      }

      // Store version info
      await state.updateStepStatus(step.id, "completed", {
        durationMs: Date.now() - start,
        metadata: { version: connResult.version },
      });

      return { total: 1, completed: 1, failed: 0 };
    } catch (err: any) {
      await state.updateStepStatus(step.id, "failed", {
        error: err.message,
        durationMs: Date.now() - start,
      });
      throw err;
    }
  }

  // ========================================================================
  // PHASE: LOCATIONS
  // ========================================================================

  private async phaseLocations(
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    activeFlag: { cancelled: boolean }
  ) {
    const locations = await client.listLocations();
    let completed = 0;
    let failed = 0;

    for (const loc of locations) {
      if (activeFlag.cancelled) break;

      const ptero = loc.attributes;
      const step = await state.createStep(jobId, "locations", "import_location", String(ptero.id));
      const start = Date.now();

      // Skip if already completed (resume)
      const existing = await state.getStepsByPhase(jobId, "locations");
      const alreadyDone = existing.find(
        (s) => s.sourceId === String(ptero.id) && s.status === "completed"
      );
      if (alreadyDone) {
        // Restore location mapping from step targetId
        if (alreadyDone.targetId) {
          mapper.locationMap.set(ptero.id, alreadyDone.targetId);
        }
        await state.updateStepStatus(step.id, "skipped", { durationMs: 0 });
        completed++;
        continue;
      }

      try {
        await state.updateStepStatus(step.id, "running");

        const mapped = mapper.mapLocation(ptero);

        // Check for existing location with same name
        const existingLoc = await this.prisma.location.findUnique({
          where: { name: mapped.data.name },
        });

        let targetId: string;
        if (existingLoc) {
          targetId = existingLoc.id;
          this.logger.info(
            { pteroId: ptero.id, catalystId: targetId, name: mapped.data.name },
            "Location already exists, mapping"
          );
        } else {
          const created = await this.prisma.location.create({
            data: mapped.data,
          });
          targetId = created.id;
        }

        mapper.locationMap.set(ptero.id, targetId);
        await state.updateStepStatus(step.id, "completed", {
          targetId,
          durationMs: Date.now() - start,
          metadata: { name: ptero.long || ptero.short },
        });
        completed++;
      } catch (err: any) {
        await state.updateStepStatus(step.id, "failed", {
          error: err.message,
          durationMs: Date.now() - start,
        });
        failed++;
        captureSystemError({ level: 'error', component: 'MigrationService', message: `Failed to import location: ${err.message}`, stack: err?.stack, metadata: { jobId, pteroId: ptero.id } }).catch(() => {});
        this.logger.error({ pteroId: ptero.id, error: err.message }, "Failed to import location");
      }
    }

    this.emit("progress", { jobId, phase: "locations", current: completed, total: locations.length, message: `Locations: ${completed}/${locations.length}` });
    return { total: locations.length, completed, failed };
  }

  // ========================================================================
  // PHASE: NODES
  // ========================================================================

  // ========================================================================
  // PHASE: TEMPLATES (Nests + Eggs)
  // ========================================================================

  private async phaseTemplates(
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    activeFlag: { cancelled: boolean }
  ) {
    const nests = await client.listNests();
    let completed = 0;
    let failed = 0;
    let totalExpected = 0;

    // First count total eggs
    for (const nest of nests) {
      try {
        const eggs = await client.listEggs(nest.attributes.id);
        totalExpected += eggs.length + 1; // +1 for nest itself
      } catch {
        totalExpected += 1;
      }
    }

    for (const nest of nests) {
      if (activeFlag.cancelled) break;

      const pteroNest = nest.attributes;

      // Create Nest
      const nestStep = await state.createStep(jobId, "templates", "import_nest", String(pteroNest.id));
      const nestStart = Date.now();
      let catalystNestId: string | undefined;

      try {
        await state.updateStepStatus(nestStep.id, "running");

        // Check existing nest
        const existingNest = await this.prisma.nest.findUnique({
          where: { name: pteroNest.name },
        });

        if (existingNest) {
          catalystNestId = existingNest.id;
        } else {
          const created = await this.prisma.nest.create({
            data: {
              name: pteroNest.name,
              description: pteroNest.description || "",
              author: pteroNest.author || "",
            },
          });
          catalystNestId = created.id;
        }

        mapper.nestMap.set(pteroNest.id, catalystNestId);
        await state.updateStepStatus(nestStep.id, "completed", {
          targetId: catalystNestId,
          durationMs: Date.now() - nestStart,
        });
        completed++;
      } catch (err: any) {
        await state.updateStepStatus(nestStep.id, "failed", {
          error: err.message,
          durationMs: Date.now() - nestStart,
        });
        failed++;
        continue;
      }

      if (!catalystNestId) {
        this.logger.warn({ nestId: pteroNest.id }, "No catalyst nest ID, skipping eggs");
        continue;
      }

      // Create Eggs as ServerTemplates
      let eggs: any[];
      try {
        eggs = await client.listEggs(pteroNest.id);
      } catch {
        this.logger.warn({ nestId: pteroNest.id }, "Failed to list eggs for nest");
        continue;
      }

      for (const egg of eggs) {
        if (activeFlag.cancelled) break;

        let pteroEgg = egg.attributes;
        const step = await state.createStep(jobId, "templates", "import_template", String(pteroEgg.id));
        const start = Date.now();

        // Skip already completed, but restore the mapping from step metadata
        const existingSteps = await state.getStepsByPhase(jobId, "templates");
        const alreadyDone = existingSteps.find(
          (s) => s.sourceId === String(pteroEgg.id) && s.action === "import_template" && s.status === "completed"
        );
        if (alreadyDone) {
          // Restore egg mapping from step targetId so downstream phases can resolve it
          if (alreadyDone.targetId) {
            mapper.eggMap.set(pteroEgg.id, alreadyDone.targetId);
          }
          completed++;
          continue;
        }

        try {
          await state.updateStepStatus(step.id, "running");

          // If variables weren't included in the list response, fetch the full egg
          if (!pteroEgg.relationships?.variables) {
            try {
              const fullEgg = await client.getEgg(pteroNest.id, pteroEgg.id);
              pteroEgg = fullEgg;
            } catch {
              // Continue without variables
            }
          }

          const mapped = mapper.mapTemplate(pteroEgg, catalystNestId);

          // Check existing template
          const existingTemplate = await this.prisma.serverTemplate.findUnique({
            where: { name: mapped.data.name },
          });

          let targetId: string;
          if (existingTemplate) {
            // Update the existing template
            await this.prisma.serverTemplate.update({
              where: { id: existingTemplate.id },
              data: mapped.data as any,
            });
            targetId = existingTemplate.id;
          } else {
            const created = await this.prisma.serverTemplate.create({
              data: mapped.data as any,
            });
            targetId = created.id;
          }

          mapper.eggMap.set(pteroEgg.id, targetId);
          await state.updateStepStatus(step.id, "completed", {
            targetId,
            durationMs: Date.now() - start,
            metadata: { name: pteroEgg.name, nest: pteroNest.name },
          });
          completed++;
        } catch (err: any) {
          captureSystemError({ level: 'error', component: 'MigrationService', message: `Failed to import egg template: ${err.message}`, stack: err?.stack, metadata: { jobId, pteroEggId: pteroEgg.id, nestId: pteroNest.id } }).catch(() => {});
          this.logger.error({ pteroEggId: pteroEgg.id, nestId: pteroNest.id, err: err.message, stack: err.stack }, "Failed to import egg template");
          await state.updateStepStatus(step.id, "failed", {
            error: err.message,
            durationMs: Date.now() - start,
          });
          failed++;
        }
      }
    }

    this.emit("progress", { jobId, phase: "templates", current: completed, total: totalExpected, message: `Templates: ${completed}/${totalExpected}` });
    return { total: totalExpected, completed, failed };
  }

  // ========================================================================
  // PHASE: USERS
  // ========================================================================

  private async phaseUsers(
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    activeFlag: { cancelled: boolean }
  ) {
    const users = await client.listUsers();
    let completed = 0;
    let failed = 0;

    // Find or create a default role for migrated users
    let defaultRole = await this.prisma.role.findFirst({
      where: { name: "User" },
    });
    if (!defaultRole) {
      defaultRole = await this.prisma.role.create({
        data: {
          name: "User",
          description: "Default role for migrated users",
          permissions: ["server.read", "server.start", "server.stop", "console.read", "console.write", "file.read", "file.write", "backup.read"],
        },
      });
    }

    for (const userRes of users) {
      if (activeFlag.cancelled) break;

      const ptero = userRes.attributes;
      const step = await state.createStep(jobId, "users", "import_user", String(ptero.id));
      const start = Date.now();

      try {
        await state.updateStepStatus(step.id, "running");

        const mapped = mapper.mapUser(ptero);

        // Check if user already exists (by email)
        const existingUser = await this.prisma.user.findUnique({
          where: { email: mapped.data.email },
        });

        let targetId: string;
        if (existingUser) {
          targetId = existingUser.id;
          this.logger.info(
            { pteroId: ptero.id, email: mapped.data.email },
            "User already exists, mapping"
          );
        } else {
          // Create user with a random password (they'll need to reset)
          const randomPassword = crypto.randomBytes(32).toString("hex");
          const created = await this.prisma.user.create({
            data: {
              ...mapped.data,
              role: mapped.isRootAdmin ? "admin" : "user",
              roles: mapped.isRootAdmin
                ? { connect: { id: defaultRole.id } }
                : { connect: { id: defaultRole.id } },
              // Note: Password will be set via better-auth on first login
              // We create an account record with a placeholder
            },
          });

          // Create an account record so better-auth recognizes this user
          await this.prisma.account.create({
            data: {
              userId: created.id,
              accountId: `pterodactyl_${ptero.id}`,
              providerId: "pterodactyl-migration",
              password: randomPassword,
            },
          });

          targetId = created.id;
        }

        mapper.userMap.set(ptero.id, targetId);
        await state.updateStepStatus(step.id, "completed", {
          targetId,
          durationMs: Date.now() - start,
          metadata: { isRootAdmin: mapped.isRootAdmin, passwordResetRequired: !existingUser },
        });
        completed++;
      } catch (err: any) {
        await state.updateStepStatus(step.id, "failed", {
          error: err.message,
          durationMs: Date.now() - start,
        });
        failed++;
      }
    }

    this.emit("progress", { jobId, phase: "users", current: completed, total: users.length, message: `Users: ${completed}/${users.length}` });
    return { total: users.length, completed, failed };
  }

  // ========================================================================
  // PHASE: SERVERS
  // ========================================================================

  private async phaseServers(
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    config: any,
    activeFlag: { cancelled: boolean }
  ) {
    const servers = await client.listServers();
    const scope = config.scope || 'full';
    const allowedIds = config._allowedPteroServerIds as Set<number> | undefined;
    let completed = 0;
    let failed = 0;

    // Filter servers based on scope
    let filteredServers = servers;
    if (allowedIds && allowedIds.size > 0) {
      if (scope === 'server') {
        // Per-server: filter by server ID
        filteredServers = servers.filter((s) => allowedIds.has(s.attributes.id));
      } else {
        // Full/node: allowedIds contains node IDs — filter servers by their node
        filteredServers = servers.filter((s) => allowedIds.has(s.attributes.node));
      }
    }

    // Build ptero node→location map (v1.x servers don't have location directly,
    // must resolve through node.location_id)
    if (mapper.pteroNodeLocationMap.size === 0) {
      try {
        const pteroNodes = await client.listNodes();
        for (const nodeRes of pteroNodes) {
          mapper.pteroNodeLocationMap.set(nodeRes.attributes.id, nodeRes.attributes.location_id);
        }
      } catch (err: any) {
        this.logger.warn({ error: err.message }, "Failed to fetch Pterodactyl nodes for location mapping");
      }
    }

    // Fetch Pterodactyl node allocations to build the allocation ID → {ip, port} map.
    // In v1.12.x, servers only return allocation as a numeric ID — we need
    // the actual IP:port from the node allocations endpoint.
    if (mapper.pteroAllocationMap.size === 0) {
      try {
        const pteroNodes = await client.listNodes();
        for (const nodeRes of pteroNodes) {
          try {
            const allocs = await client.getNodeAllocations(nodeRes.attributes.id);
            for (const allocRes of allocs) {
              const a = allocRes.attributes;
              mapper.pteroAllocationMap.set(a.id, { ip: a.ip, port: a.port });
            }
          } catch {
            // Some nodes may not have allocation endpoint
          }
        }
        this.logger.info(
          { count: mapper.pteroAllocationMap.size },
          "Fetched Pterodactyl allocations for port/IP mapping"
        );
      } catch (err: any) {
        this.logger.warn({ error: err.message }, "Failed to fetch Pterodactyl allocations");
      }
    }

    for (const serverRes of filteredServers) {
      if (activeFlag.cancelled) break;

      const ptero = serverRes.attributes;
      const step = await state.createStep(jobId, "servers", "import_server", String(ptero.id));
      const start = Date.now();

      try {
        await state.updateStepStatus(step.id, "running");

        // Resolve references
        const catalystTemplateId = mapper.eggMap.get(ptero.egg);
        if (!catalystTemplateId) {
          throw new Error(`Egg/template ${ptero.egg} not found in Catalyst`);
        }

        // Get the template for docker_image fallback
        const catalystTemplate = await this.prisma.serverTemplate.findUnique({
          where: { id: catalystTemplateId },
        });

        // Resolve target Catalyst node
        // Per-server scope uses serverNodeMap; full/node scope uses nodeMap
        const catalystNodeId = mapper.serverNodeMap.get(ptero.id)
          || mapper.nodeMap.get(ptero.node);
        if (!catalystNodeId) {
          throw new Error(`No Catalyst node mapped for server ${ptero.id} (node ${ptero.node})`);
        }

        // Resolve location through node (v1.x servers don't have location directly)
        const pteroLocationId = mapper.pteroNodeLocationMap.get(ptero.node) || 0;
        const catalystLocationId = mapper.locationMap.get(pteroLocationId);
        if (!catalystLocationId) {
          throw new Error(`Location not found for server ${ptero.id} (node ${ptero.node}, location ${pteroLocationId})`);
        }

        // Resolve the primary port from the Pterodactyl allocation map
        const pteroAllocationId = typeof ptero.allocation === 'number'
          ? ptero.allocation
          : (ptero.allocation as any)?.id;
        const pteroAlloc = pteroAllocationId
          ? mapper.pteroAllocationMap.get(pteroAllocationId)
          : undefined;
        const primaryPort = pteroAlloc?.port || 25565;

        // Look up the Catalyst NodeAllocation for this port on the target node.
        // This gives us the correct IP that the server should bind to on Catalyst.
        const catalystAllocation = await this.prisma.nodeAllocation.findFirst({
          where: { nodeId: catalystNodeId, port: primaryPort },
          select: { id: true, ip: true, port: true, serverId: true },
        });
        const catalystAllocIp = catalystAllocation?.ip || null;

        // Find server owner — use first admin user as fallback
        const firstAdmin = await this.prisma.user.findFirst({
          where: { role: "admin" },
        });
        const firstUser = firstAdmin || await this.prisma.user.findFirst();
        const ownerId = firstUser?.id;
        if (!ownerId) {
          throw new Error("No user available to assign as server owner");
        }

        const mapped = mapper.mapServer(
          ptero,
          catalystTemplateId,
          catalystNodeId,
          ownerId,
          catalystLocationId,
          catalystTemplate || {},
          catalystAllocIp
        );

        // Check existing server
        const existingServer = await this.prisma.server.findUnique({
          where: { uuid: mapped.data.uuid },
        });

        let targetId: string;
        if (existingServer) {
          targetId = existingServer.id;
          // Update primaryIp/portBindings if they're wrong (from a prior buggy migration)
          if (!existingServer.primaryIp && catalystAllocIp) {
            await this.prisma.server.update({
              where: { id: targetId },
              data: { primaryIp: catalystAllocIp },
            });
            this.logger.info({ uuid: mapped.data.uuid, primaryIp: catalystAllocIp }, "Updated server primaryIp");
          }
          this.logger.info({ uuid: mapped.data.uuid }, "Server already exists, skipping");
        } else {
          const created = await this.prisma.server.create({
            data: mapped.data as any,
          });
          targetId = created.id;

          // Link NodeAllocation records so ports show as "assigned"
          // We already looked up the primary port's allocation above;
          // now handle all ports (primary + additional) from portBindings.
          const portBindings = mapped.data.portBindings as Record<number, number> || {};
          const portsToLink = new Set(Object.values(portBindings).map(Number));

          for (const port of portsToLink) {
            const existingAlloc = await this.prisma.nodeAllocation.findFirst({
              where: {
                nodeId: catalystNodeId,
                port,
                serverId: null,
              },
            });
            if (existingAlloc) {
              await this.prisma.nodeAllocation.update({
                where: { id: existingAlloc.id },
                data: { serverId: targetId },
              });
            } else {
              // No pre-existing allocation — create one with the allocation IP
              // from the primary port's allocation (same subnet)
              await this.prisma.nodeAllocation.create({
                data: {
                  nodeId: catalystNodeId,
                  serverId: targetId,
                  ip: catalystAllocIp || "0.0.0.0",
                  port,
                },
              }).catch(() => {
                // Unique constraint violation — allocation already linked
              });
            }
          }

          // Grant owner full permissions (same as normal server creation)
          await this.prisma.serverAccess.create({
            data: {
              userId: ownerId,
              serverId: targetId,
              permissions: [
                "server.start",
                "server.stop",
                "server.read",
                "server.install",
                "alert.read",
                "alert.create",
                "alert.update",
                "alert.delete",
                "file.read",
                "file.write",
                "console.read",
                "console.write",
                "server.delete",
              ],
            },
          }).catch(() => {
            // Ignore duplicate access entries
          });

          // Create the server directory on the target node via file tunnel
          try {
            const node = await this.prisma.node.findUnique({ where: { id: catalystNodeId } });
            if (node?.isOnline) {
              const fileTunnel = (this.app as any)?.fileTunnel;
              if (fileTunnel) {
                await fileTunnel.queueRequest(
                  catalystNodeId,
                  "create",
                  mapped.data.uuid,
                  "/",
                  { isDirectory: true }
                );
                this.logger.info(
                  { serverUuid: mapped.data.uuid, nodeId: catalystNodeId },
                  "Server directory created on node"
                );
              } else {
                this.logger.warn(
                  { nodeId: catalystNodeId },
                  "File tunnel not available, server directory not created"
                );
              }
            } else {
              this.logger.warn(
                { nodeId: catalystNodeId },
                "Node offline, server directory not created"
              );
            }
          } catch (dirErr: any) {
            this.logger.warn(
              { serverUuid: mapped.data.uuid, error: dirErr.message },
              "Failed to create server directory (non-fatal)"
            );
          }
        }

        mapper.serverMap.set(ptero.id, targetId);
        mapper.pteroServerUuidMap.set(ptero.id, ptero.uuid);
        await state.updateStepStatus(step.id, "completed", {
          targetId,
          durationMs: Date.now() - start,
          metadata: { name: ptero.name, uuid: mapped.data.uuid },
        });
        completed++;
      } catch (err: any) {
        await state.updateStepStatus(step.id, "failed", {
          error: err.message,
          durationMs: Date.now() - start,
        });
        failed++;
        captureSystemError({ level: 'error', component: 'MigrationService', message: `Failed to import server: ${err.message}`, stack: err?.stack, metadata: { jobId, pteroId: ptero.id } }).catch(() => {});
        this.logger.error({ pteroId: ptero.id, error: err.message }, "Failed to import server");
      }
    }

    this.emit("progress", { jobId, phase: "servers", current: completed, total: filteredServers.length, message: `Servers: ${completed}/${filteredServers.length}` });
    return { total: filteredServers.length, completed, failed };
  }

  // ========================================================================
  // PHASE: DATABASES
  // ========================================================================

  private async phaseDatabases(
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    config: any,
    activeFlag: { cancelled: boolean }
  ) {
    const allowedIds = config._allowedPteroServerIds as Set<number> | undefined;
    let completed = 0;
    let failed = 0;
    let totalExpected = 0;

    // First, import database hosts (optional — may not exist on all panels)
    let dbHosts: any[] = [];
    try {
      dbHosts = await client.getDatabaseHosts();
    } catch (err: any) {
      if (err.code === 'NOT_FOUND' || err.statusCode === 404) {
        this.logger.info("Database hosts endpoint not available, skipping");
      } else {
        throw err;
      }
    }
    totalExpected += dbHosts.length;

    for (const hostRes of dbHosts) {
      if (activeFlag.cancelled) break;

      const ptero = hostRes.attributes;
      const step = await state.createStep(jobId, "databases", "import_database_host", String(ptero.id));
      const start = Date.now();

      try {
        await state.updateStepStatus(step.id, "running");

        const mapped = mapper.mapDatabaseHost(ptero);

        const existingHost = await this.prisma.databaseHost.findFirst({
          where: {
            host: mapped.data.host,
            port: mapped.data.port,
          },
        });

        let targetId: string;
        if (existingHost) {
          targetId = existingHost.id;
        } else {
          const created = await this.prisma.databaseHost.create({
            data: mapped.data,
          });
          targetId = created.id;
        }

        mapper.dbHostMap.set(ptero.id, targetId);
        await state.updateStepStatus(step.id, "completed", {
          targetId,
          durationMs: Date.now() - start,
        });
        completed++;
      } catch (err: any) {
        await state.updateStepStatus(step.id, "failed", {
          error: err.message,
          durationMs: Date.now() - start,
        });
        failed++;
      }
    }

    // Then, import per-server databases
    for (const [pteroServerId, catalystServerId] of mapper.serverMap) {
      if (activeFlag.cancelled) break;

      // Skip servers not in scope
      if (allowedIds && allowedIds.size > 0 && !allowedIds.has(pteroServerId)) continue;
      if (activeFlag.cancelled) break;

      try {
        let serverDbs: any[] = [];
        try {
          serverDbs = await client.getServerDatabases(pteroServerId);
        } catch (err: any) {
          if (err.code === 'NOT_FOUND' || err.statusCode === 404) continue;
          throw err;
        }
        totalExpected += serverDbs.length;

        for (const dbRes of serverDbs) {
          if (activeFlag.cancelled) break;

          const ptero = dbRes.attributes;
          const step = await state.createStep(jobId, "databases", "import_database", String(ptero.id));
          const start = Date.now();

          try {
            await state.updateStepStatus(step.id, "running");

            // Resolve host
            const hostId = ptero.relationships?.host?.attributes?.id || ptero.host;
            const catalystHostId = mapper.dbHostMap.get(hostId) || await this.prisma.databaseHost.findFirst().then(h => h?.id);
            if (!catalystHostId) {
              throw new Error("No database host available");
            }

            const mapped = mapper.mapDatabase(ptero, catalystServerId, catalystHostId);
            const created = await this.prisma.serverDatabase.create({
              data: mapped.data,
            });

            await state.updateStepStatus(step.id, "completed", {
              targetId: created.id,
              durationMs: Date.now() - start,
            });
            completed++;
          } catch (err: any) {
            await state.updateStepStatus(step.id, "failed", {
              error: err.message,
              durationMs: Date.now() - start,
            });
            failed++;
          }
        }
      } catch (err: any) {
        this.logger.warn(
          { serverId: pteroServerId, error: err.message },
          "Failed to fetch databases for server"
        );
      }
    }

    this.logger.info({ jobId, completed, failed, totalExpected }, "phaseDatabases: done");
    this.emit("progress", { jobId, phase: "databases", current: completed, total: totalExpected, message: `Databases: ${completed}/${totalExpected}` });
    return { total: totalExpected, completed, failed };
  }

  // ========================================================================
  // PHASE: SCHEDULES
  // ========================================================================

  private async phaseSubusers(
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    config: any,
    activeFlag: { cancelled: boolean }
  ) {
    const allowedIds = config._allowedPteroServerIds as Set<number> | undefined;
    let completed = 0;
    let failed = 0;
    let totalExpected = 0;

    for (const [pteroServerId, catalystServerId] of mapper.serverMap) {
      if (activeFlag.cancelled) break;

      // Skip servers not in scope
      if (allowedIds && allowedIds.size > 0 && !allowedIds.has(pteroServerId)) continue;

      // Resolve Pterodactyl server UUID for client API
      const pteroUuid = mapper.pteroServerUuidMap?.get(pteroServerId);
      if (!pteroUuid) {
        this.logger.warn(
          { pteroServerId },
          "phaseSubusers: no UUID for server, skipping subusers"
        );
        continue;
      }

      let subusers: any[];
      try {
        subusers = await client.getServerSubusers(pteroUuid);
      } catch (err: any) {
        this.logger.warn(
          { pteroServerId, error: err.message },
          "phaseSubusers: failed to fetch subusers, skipping server"
        );
        continue;
      }

      totalExpected += subusers.length;

      for (const subuserRes of subusers) {
        if (activeFlag.cancelled) break;

        const ptero = subuserRes.attributes;
        const step = await state.createStep(
          jobId,
          "subusers",
          "import_subuser",
          String(ptero.id)
        );
        const start = Date.now();

        try {
          await state.updateStepStatus(step.id, "running");

          // Resolve the Catalyst user — must have been migrated in phaseUsers
          const catalystUserId = mapper.userMap.get(ptero.user_id);
          if (!catalystUserId) {
            // User not migrated (was filtered out or failed) — skip silently
            await state.updateStepStatus(step.id, "completed", {
              targetId: catalystUserId,
              durationMs: Date.now() - start,
              metadata: { skipped: true, reason: "User not migrated" },
            });
            completed++;
            continue;
          }

          // Don't create access for the server owner (they already have full access)
          const server = await this.prisma.server.findUnique({
            where: { id: catalystServerId },
            select: { ownerId: true },
          });
          if (server?.ownerId === catalystUserId) {
            await state.updateStepStatus(step.id, "completed", {
              targetId: catalystUserId,
              durationMs: Date.now() - start,
              metadata: { skipped: true, reason: "User is server owner" },
            });
            completed++;
            continue;
          }

          const mapped = mapper.mapSubuser(ptero, catalystServerId, catalystUserId);

          // Upsert: update permissions if access already exists
          await this.prisma.serverAccess.upsert({
            where: {
              userId_serverId: {
                userId: catalystUserId,
                serverId: catalystServerId,
              },
            },
            create: mapped.data,
            update: { permissions: mapped.data.permissions },
          });

          await state.updateStepStatus(step.id, "completed", {
            targetId: catalystUserId,
            durationMs: Date.now() - start,
          });
          completed++;
        } catch (err: any) {
          await state.updateStepStatus(step.id, "failed", {
            error: err.message,
            durationMs: Date.now() - start,
          });
          failed++;
        }
      }
    }

    this.logger.info({ jobId, completed, failed, totalExpected }, "phaseSubusers: done");
    this.emit("progress", { jobId, phase: "subusers", current: completed, total: totalExpected, message: `Subusers: ${completed}/${totalExpected}` });
    return { total: totalExpected, completed, failed };
  }

  private async phaseSchedules(
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    config: any,
    activeFlag: { cancelled: boolean }
  ) {
    this.logger.info({ jobId }, "phaseSchedules: start");
    const allowedIds = config._allowedPteroServerIds as Set<number> | undefined;
    let completed = 0;
    let failed = 0;
    let totalExpected = 0;

    for (const [pteroServerId, catalystServerId] of mapper.serverMap) {
      if (activeFlag.cancelled) break;

      // Skip servers not in scope
      if (allowedIds && allowedIds.size > 0 && !allowedIds.has(pteroServerId)) continue;
      if (activeFlag.cancelled) break;

      // Schedules require client API with server UUID
      const pteroUuid = mapper.pteroServerUuidMap.get(pteroServerId);
      if (!pteroUuid) {
        this.logger.warn({ pteroServerId }, "No Pterodactyl UUID found for server, skipping schedules");
        continue;
      }

      try {
        let schedules: any[] = [];
        try {
          schedules = await client.getServerSchedules(pteroUuid);
        } catch (err: any) {
          if (err.code === 'NOT_FOUND' || err.statusCode === 404) continue;
          throw err;
        }
        totalExpected += schedules.length;

        for (const schedRes of schedules) {
          if (activeFlag.cancelled) break;

          const ptero = schedRes.attributes;
          const step = await state.createStep(jobId, "schedules", "import_schedule", String(ptero.id));
          const start = Date.now();

          try {
            await state.updateStepStatus(step.id, "running");

            const mapped = mapper.mapSchedule(ptero, catalystServerId);
            const created = await this.prisma.scheduledTask.create({
              data: mapped.data,
            });

            await state.updateStepStatus(step.id, "completed", {
              targetId: created.id,
              durationMs: Date.now() - start,
            });
            completed++;
          } catch (err: any) {
            await state.updateStepStatus(step.id, "failed", {
              error: err.message,
              durationMs: Date.now() - start,
            });
            failed++;
          }
        }
      } catch {
        // Schedules might not be accessible
      }
    }

    this.emit("progress", { jobId, phase: "schedules", current: completed, total: totalExpected, message: `Schedules: ${completed}/${totalExpected}` });
    return { total: totalExpected, completed, failed };
  }

  // ========================================================================
  // PHASE: BACKUPS
  // ========================================================================

  private async phaseBackups(
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    config: any,
    activeFlag: { cancelled: boolean }
  ) {
    this.logger.info({ jobId }, "phaseBackups: start");
    const allowedIds = config._allowedPteroServerIds as Set<number> | undefined;
    let completed = 0;
    let failed = 0;
    let totalExpected = 0;

    for (const [pteroServerId, catalystServerId] of mapper.serverMap) {
      if (activeFlag.cancelled) break;

      // Skip servers not in scope
      if (allowedIds && allowedIds.size > 0 && !allowedIds.has(pteroServerId)) continue;
      if (activeFlag.cancelled) break;

      // Backups require client API with server UUID
      const pteroUuid = mapper.pteroServerUuidMap.get(pteroServerId);
      if (!pteroUuid) {
        this.logger.warn({ pteroServerId }, "No Pterodactyl UUID found for server, skipping backups");
        continue;
      }
      if (!client.hasClientApi()) {
        this.logger.info({ pteroServerId }, "No client API key, skipping backup metadata import");
        continue;
      }

      try {
        let backups: any[] = [];
        try {
          backups = await client.getServerBackups(pteroUuid);
        } catch (err: any) {
          if (err.code === 'NOT_FOUND' || err.statusCode === 404) continue;
          throw err;
        }
        totalExpected += backups.length;

        // Only import the most recent successful backup per server
        const completedBackups = backups
          .filter((b) => b.attributes.is_successful || b.attributes.completed_at)
          .sort((a, b) => {
            const dateA = new Date(a.attributes.completed_at || a.attributes.created_at || 0).getTime();
            const dateB = new Date(b.attributes.completed_at || b.attributes.created_at || 0).getTime();
            return dateB - dateA;
          });

        if (completedBackups.length === 0) continue;

        // Import only the latest backup
        const latest = completedBackups[0];
        const ptero = latest.attributes;
        const step = await state.createStep(jobId, "backups", "import_backup", String(ptero.id || ptero.uuid));
        const start = Date.now();

        try {
          await state.updateStepStatus(step.id, "running");

          const mapped = mapper.mapBackup(ptero, catalystServerId);
          const created = await this.prisma.backup.create({
            data: mapped.data,
          });

          await state.updateStepStatus(step.id, "completed", {
            targetId: created.id,
            durationMs: Date.now() - start,
          });
          completed++;
        } catch (err: any) {
          await state.updateStepStatus(step.id, "failed", {
            error: err.message,
            durationMs: Date.now() - start,
          });
          failed++;
        }
      } catch {
        // Backups might not be accessible
      }
    }

    this.emit("progress", { jobId, phase: "backups", current: completed, total: totalExpected, message: `Backups: ${completed}/${totalExpected}` });
    return { total: totalExpected, completed, failed };
  }

  // ========================================================================
  // PHASE: FILES (Download backups and extract)
  // ========================================================================

  private async phaseFiles(
    jobId: string,
    client: PterodactylClient,
    mapper: EntityMapper,
    state: MigrationStateManager,
    config: any,
    activeFlag: { cancelled: boolean },
    bypassToken?: string | null
  ) {
    this.logger.info({ jobId }, "phaseFiles: start");
    let completed = 0;
    let failed = 0;
    let totalExpected = 0;

    const allowedIds = config._allowedPteroServerIds as Set<number> | undefined;
    const fileTunnel = (this.app as any)?.fileTunnel as import("../file-tunnel").FileTunnelService | undefined;

    if (!fileTunnel) {
      this.logger.warn("File tunnel not available, skipping file migration");
      return { total: 0, completed: 0, failed: 0 };
    }

    // Build list of servers to migrate files for, with their target node
    const serversToMigrate: {
      pteroServerId: number;
      catalystServerId: string;
      catalystUuid: string;
      catalystNodeId: string;
    }[] = [];

    for (const [pteroServerId, catalystServerId] of mapper.serverMap) {
      if (activeFlag.cancelled) break;
      if (allowedIds && allowedIds.size > 0 && !allowedIds.has(pteroServerId)) continue;

      const catalystServer = await this.prisma.server.findUnique({
        where: { id: catalystServerId },
        select: { uuid: true, nodeId: true },
      });
      if (!catalystServer || !catalystServer.nodeId) {
        this.logger.warn(
          { pteroServerId, catalystServerId },
          "Server has no node assigned, skipping file migration"
        );
        continue;
      }

      serversToMigrate.push({
        pteroServerId,
        catalystServerId,
        catalystUuid: catalystServer.uuid,
        catalystNodeId: catalystServer.nodeId,
      });
    }

    totalExpected = serversToMigrate.length;

    for (const server of serversToMigrate) {
      if (activeFlag.cancelled) break;

      const step = await state.createStep(
        jobId,
        "files",
        "migrate_server_files",
        String(server.pteroServerId)
      );
      const start = Date.now();

      try {
        await state.updateStepStatus(step.id, "running");

        const pteroUuid = mapper.pteroServerUuidMap.get(server.pteroServerId);
        if (!pteroUuid) {
          throw new Error("No Pterodactyl UUID found for server");
        }

        // 1. Check existing backups (requires client API)
        if (!client.hasClientApi()) {
          this.logger.info({ serverId: server.pteroServerId }, "No client API key, skipping file migration");
          await state.updateStepStatus(step.id, "skipped", {
            durationMs: Date.now() - start,
            metadata: { reason: "No client API key provided. Provide a ptlc_* key to enable file migration." },
          });
          completed++;
          continue;
        }

        let backups: any[];
        try {
          backups = await client.getServerBackups(pteroUuid);
          this.logger.info({ serverId: server.pteroServerId, count: backups.length }, "Found backups");
        } catch (err: any) {
          this.logger.warn({ serverId: server.pteroServerId, error: err.message }, "Could not list backups");
          await state.updateStepStatus(step.id, "skipped", {
            durationMs: Date.now() - start,
            metadata: { reason: "Could not list backups" },
          });
          completed++;
          continue;
        }

        // 2. Find a completed backup with checksum (needed for file transfer)
        let completedBackups = backups
          .filter((b) => (b.attributes.is_successful || b.attributes.completed_at) && b.attributes.checksum);

        // 3. If no usable backup, try to create one
        if (completedBackups.length === 0) {
          // Check if the server has backup slots available
          let backupSlots = 0;
          let currentBackups = backups.length;
          try {
            const pteroServer = await client.getServer(server.pteroServerId);
            backupSlots = pteroServer.feature_limits?.backups ?? 0;
            currentBackups = pteroServer.backups ?? backups.length;
          } catch {
            // If we can't fetch server details, assume we can try
          }

          if (backupSlots === 0) {
            this.logger.info(
              { serverId: server.pteroServerId },
              "Server has 0 backup slots, automatically setting to 1"
            );
            try {
              await client.updateServerFeatureLimits(server.pteroServerId, { backups: 1 });
              backupSlots = 1;
            } catch (err: any) {
              await state.updateStepStatus(step.id, "skipped", {
                durationMs: Date.now() - start,
                metadata: { reason: `Could not set backup limit: ${err.message}. Set at least 1 backup slot manually.` },
              });
              completed++;
              continue;
            }
          }

          if (currentBackups >= backupSlots) {
            this.logger.info(
              { serverId: server.pteroServerId, current: currentBackups, max: backupSlots },
              "All backup slots used, increasing limit by 1"
            );
            try {
              await client.updateServerFeatureLimits(server.pteroServerId, { backups: backupSlots + 1 });
            } catch (err: any) {
              await state.updateStepStatus(step.id, "skipped", {
                durationMs: Date.now() - start,
                metadata: { reason: `Could not increase backup limit: ${err.message}.` },
              });
              completed++;
              continue;
            }
          }

          // Create a backup via client API
          this.logger.info(
            { serverId: server.pteroServerId },
            "Creating backup on Pterodactyl server for file migration"
          );
          try {
            const newBackup = await client.createBackup(pteroUuid);
            const backupUuid = newBackup.attributes.uuid;

            this.logger.info(
              { serverId: server.pteroServerId, backupUuid },
              "Waiting for backup to complete..."
            );
            const completedBackup = await client.pollBackupCompleted(pteroUuid, backupUuid);

            completedBackups = [{ attributes: completedBackup }];
            this.logger.info(
              { serverId: server.pteroServerId, backupUuid, bytes: completedBackup.bytes },
              "Backup created and completed"
            );
          } catch (err: any) {
            captureSystemError({ level: 'error', component: 'MigrationService', message: `Failed to create backup: ${err.message}`, stack: err?.stack, metadata: { jobId, serverId: server.pteroServerId } }).catch(() => {});
            this.logger.error(
              { serverId: server.pteroServerId, error: err.message },
              "Failed to create backup"
            );
            await state.updateStepStatus(step.id, "failed", {
              error: `Failed to create backup: ${err.message}`,
              durationMs: Date.now() - start,
            });
            failed++;
            continue;
          }
        }

        // 4. Use the latest completed backup
        const backup = completedBackups.sort((a, b) => {
          const dateA = new Date(a.attributes.completed_at || a.attributes.created_at || 0).getTime();
          const dateB = new Date(b.attributes.completed_at || b.attributes.created_at || 0).getTime();
          return dateB - dateA;
        })[0].attributes;
        const archiveName = `migration_backup_${backup.uuid}.tar.gz`;

        this.logger.info(
          { serverId: server.pteroServerId, backupUuid: backup.uuid },
          "Downloading server backup"
        );

        // 5. Download the backup (two-step: signed URL → Wings daemon)
        const stream = await client.downloadBackup(pteroUuid, backup.uuid);
        const chunks: Buffer[] = [];
        const hash = crypto.createHash("sha1");

        await new Promise<void>((resolve, reject) => {
          const readable = stream as any;
          readable.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
            hash.update(chunk);
          });
          readable.on("end", resolve);
          readable.on("error", reject);
        });

        const backupBuffer = Buffer.concat(chunks);
        const computedChecksum = hash.digest("hex");

        // Validate checksum (Pterodactyl v1.x returns "sha1:<hash>")
        const expectedHash = backup.checksum?.startsWith("sha1:")
          ? backup.checksum.slice(5)
          : backup.checksum;
        if (expectedHash && computedChecksum !== expectedHash) {
          throw new Error(
            `SHA1 checksum mismatch: expected ${expectedHash}, got ${computedChecksum}`
          );
        }

        this.logger.info(
          { serverUuid: server.catalystUuid, sizeBytes: backupBuffer.length, nodeId: server.catalystNodeId },
          "Uploading backup to node via file tunnel"
        );

        // 2. Upload the tar.gz to the agent via file tunnel (bypass size limit for migration)
        await fileTunnel.queueRequest(
          server.catalystNodeId,
          "upload",
          server.catalystUuid,
          `/${archiveName}`,
          {},
          backupBuffer,
          { bypassToken: bypassToken || undefined }
        );

        // 3. Decompress the archive on the agent
        this.logger.info(
          { serverUuid: server.catalystUuid, archiveName },
          "Extracting backup on node"
        );

        const decompressResult = await fileTunnel.queueRequest(
          server.catalystNodeId,
          "decompress",
          server.catalystUuid,
          `/${archiveName}`,
          { targetPath: "/" }
        );

        if (!decompressResult.success) {
          throw new Error(`Decompress failed: ${decompressResult.error || "unknown error"}`);
        }

        // 4. Clean up the archive file
        await fileTunnel.queueRequest(
          server.catalystNodeId,
          "delete",
          server.catalystUuid,
          `/${archiveName}`,
          {}
        ).catch(() => {
          // Non-fatal — archive cleanup failure is OK
        });

        await state.updateStepStatus(step.id, "completed", {
          durationMs: Date.now() - start,
          metadata: {
            backupUuid: backup.uuid,
            checksum: computedChecksum,
            checksumValid: !backup.checksum || computedChecksum === backup.checksum,
            sizeBytes: backupBuffer.length,
          },
        });
        completed++;
      } catch (err: any) {
        await state.updateStepStatus(step.id, "failed", {
          error: err.message,
          durationMs: Date.now() - start,
        });
        failed++;
        captureSystemError({ level: 'error', component: 'MigrationService', message: `Failed to migrate server files: ${err.message}`, stack: err?.stack, metadata: { jobId, serverId: server.pteroServerId } }).catch(() => {});
        this.logger.error(
          { serverId: server.pteroServerId, error: err.message },
          "Failed to migrate server files"
        );
      }
    }

    this.emit("progress", { jobId, phase: "files", current: completed, total: totalExpected, message: `Files: ${completed}/${totalExpected}` });
    return { total: totalExpected, completed, failed };
  }
}
