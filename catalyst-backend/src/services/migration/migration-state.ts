/**
 * Migration State Manager — Checkpoint/resume state persistence
 */

import type { PrismaClient } from "@prisma/client";

export class MigrationStateManager {
  constructor(private prisma: PrismaClient) {}

  // ========================================================================
  // JOB MANAGEMENT
  // ========================================================================

  async createJob(config: {
    sourceUrl: string;
    sourceKey: string;
    nodeMapping: "hybrid" | "create" | "map";
    selectedNodes?: string[];
    phases?: string[];
  }) {
    return this.prisma.migrationJob.create({
      data: {
        sourceUrl: config.sourceUrl,
        sourceKey: config.sourceKey,
        config: {
          nodeMapping: config.nodeMapping,
          selectedNodes: config.selectedNodes || [],
          phases: config.phases || [],
          dryRun: false,
        },
        status: "pending",
        progress: {
          total: 0,
          completed: 0,
          failed: 0,
          skipped: 0,
        },
      },
    });
  }

  async getJob(jobId: string) {
    return this.prisma.migrationJob.findUnique({
      where: { id: jobId },
      include: {
        steps: {
          orderBy: [{ phase: "asc" }, { startedAt: "asc" }],
        },
      },
    });
  }

  async listJobs() {
    return this.prisma.migrationJob.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { steps: true },
        },
      },
    });
  }

  async updateJobStatus(jobId: string, status: string, error?: string) {
    const data: any = { status };
    if (status === "completed" || status === "failed" || status === "cancelled") {
      data.completedAt = new Date();
      // Invalidate the file-tunnel bypass token — migration is no longer active
      data.bypassToken = null;
    }
    if (error) {
      data.error = error;
    }
    return this.prisma.migrationJob.update({
      where: { id: jobId },
      data,
    });
  }

  async updateJobProgress(
    jobId: string,
    currentPhase: string,
    progress: {
      total: number;
      completed: number;
      failed: number;
      skipped: number;
    }
  ) {
    return this.prisma.migrationJob.update({
      where: { id: jobId },
      data: {
        currentPhase,
        progress,
      },
    });
  }

  async startJob(jobId: string) {
    return this.prisma.migrationJob.update({
      where: { id: jobId },
      data: {
        status: "running",
        startedAt: new Date(),
      },
    });
  }

  // ========================================================================
  // STEP MANAGEMENT
  // ========================================================================

  async createStep(
    jobId: string,
    phase: string,
    action: string,
    sourceId?: string
  ) {
    return this.prisma.migrationStep.create({
      data: {
        jobId,
        phase,
        action,
        sourceId: sourceId ? String(sourceId) : null,
        status: "pending",
      },
    });
  }

  async updateStepStatus(
    stepId: string,
    status: string,
    opts?: {
      targetId?: string;
      error?: string;
      durationMs?: number;
      metadata?: Record<string, unknown>;
    }
  ) {
    const data: any = { status };

    if (status === "running") {
      data.startedAt = new Date();
    }
    if (status === "completed" || status === "failed" || status === "skipped") {
      data.completedAt = new Date();
    }
    if (opts?.targetId) data.targetId = opts.targetId;
    if (opts?.error) data.error = opts.error;
    if (opts?.durationMs !== undefined) data.durationMs = opts.durationMs;
    if (opts?.metadata) data.metadata = opts.metadata;

    return this.prisma.migrationStep.update({
      where: { id: stepId },
      data,
    });
  }

  async getPendingSteps(jobId: string) {
    return this.prisma.migrationStep.findMany({
      where: {
        jobId,
        status: { in: ["pending", "failed"] },
      },
      orderBy: [{ phase: "asc" }, { startedAt: "asc" }],
    });
  }

  async getLastCompletedPhase(jobId: string) {
    const lastCompleted = await this.prisma.migrationStep.findFirst({
      where: {
        jobId,
        status: "completed",
      },
      orderBy: { completedAt: "desc" },
      select: { phase: true },
    });
    return lastCompleted?.phase || null;
  }

  async getStepsByPhase(jobId: string, phase: string) {
    return this.prisma.migrationStep.findMany({
      where: { jobId, phase },
      orderBy: [{ id: "asc" }],
    });
  }

  async getStepsSummary(jobId: string) {
    const steps = await this.prisma.migrationStep.groupBy({
      by: ["status"],
      where: { jobId },
      _count: true,
    });
    const summary: Record<string, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
    };
    for (const step of steps) {
      summary[step.status] = step._count;
    }
    return summary;
  }

  async resetStepForRetry(stepId: string) {
    return this.prisma.migrationStep.update({
      where: { id: stepId },
      data: {
        status: "pending",
        error: null,
        startedAt: null,
        completedAt: null,
        targetId: null,
        durationMs: null,
      },
    });
  }
}
