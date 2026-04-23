import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import { getWsGateway } from '../websocket/gateway';
import { captureSystemError } from './error-logger';

interface TaskExecutor {
  executeTask(task: any): Promise<void>;
}

export class TaskScheduler {
  private prisma: PrismaClient;
  private logger: pino.Logger;
  private scheduledJobs: Map<string, any>;
  private taskExecutor?: TaskExecutor;
  private checkInterval?: ReturnType<typeof setInterval>;
  private runningTasks: Set<string>;

  constructor(prisma: PrismaClient, logger: pino.Logger) {
    this.prisma = prisma;
    this.logger = logger;
    this.scheduledJobs = new Map();
    this.runningTasks = new Set();
  }

  /**
   * Set the task executor (e.g., WebSocketGateway for sending commands to agents)
   */
  setTaskExecutor(executor: TaskExecutor) {
    this.taskExecutor = executor;
  }

  /**
   * Start the task scheduler
   */
  async start() {
    this.logger.info('Starting task scheduler...');

    // Load all enabled tasks
    await this.loadTasks();

    // Recovery: restart tasks that should have run while the scheduler was down
    await this.recoverMissedTasks();

    // Check for tasks every minute to handle nextRunAt updates
    this.checkInterval = setInterval(() => {
      this.checkAndUpdateTasks();
    }, 60000); // 1 minute

    this.logger.info('Task scheduler started');
  }

  /**
   * Stop the task scheduler
   */
  stop() {
    this.logger.info('Stopping task scheduler...');

    // Stop all scheduled jobs
    for (const [taskId, job] of this.scheduledJobs.entries()) {
      job.stop();
      this.scheduledJobs.delete(taskId);
    }

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.logger.info('Task scheduler stopped');
  }

  /**
   * Load all enabled tasks from database and schedule them
   */
  async loadTasks() {
    const tasks = await this.prisma.scheduledTask.findMany({
      where: { enabled: true },
      include: { server: true },
    });

    this.logger.info(`Loading ${tasks.length} scheduled tasks`);

    for (const task of tasks) {
      this.scheduleTask(task);
    }
  }

  /**
   * Schedule a single task
   */
  scheduleTask(task: any) {
    // Validate cron expression
    if (!cron.validate(task.schedule)) {
      captureSystemError({ level: 'warn', component: 'TaskScheduler', message: `Invalid cron expression for task ${task.id}: ${task.schedule}`, metadata: { taskId: task.id, schedule: task.schedule } }).catch(() => {});
      this.logger.error(`Invalid cron expression for task ${task.id}: ${task.schedule}`);
      return;
    }

    // Stop existing job if it exists
    if (this.scheduledJobs.has(task.id)) {
      this.scheduledJobs.get(task.id)?.stop();
    }

    let job;
    try {
      // Create new scheduled job
      job = cron.schedule(
        task.schedule,
        async () => {
          await this.executeTask(task);
        },
        {
          timezone: process.env.TZ || 'UTC',
        }
      );
      job.start();
    } catch (error) {
      this.logger.error(error, `Failed to schedule task ${task.id}`);
      captureSystemError({
        level: 'error',
        component: 'TaskScheduler',
        message: `Failed to schedule task ${task.id}`,
        stack: error instanceof Error ? error.stack : undefined,
        metadata: { taskId: task.id, schedule: task.schedule },
      }).catch(() => {});
      return;
    }

    this.scheduledJobs.set(task.id, job);

    // Calculate next run time
    this.updateNextRunTime(task.id, task.schedule);

    this.logger.info(`Scheduled task: ${task.name} (${task.id}) with schedule: ${task.schedule}`);
  }

  /**
   * Unschedule a task
   */
  unscheduleTask(taskId: string) {
    const job = this.scheduledJobs.get(taskId);
    if (job) {
      job.stop();
      this.scheduledJobs.delete(taskId);
      this.logger.info(`Unscheduled task: ${taskId}`);
    }
  }

  /**
   * Execute a task
   */
  async executeTask(task: any) {
    if (this.runningTasks.has(task.id)) {
      this.logger.warn(`Task ${task.id} is already running, skipping`);
      return;
    }

    this.runningTasks.add(task.id);
    const startedAt = new Date();
    this.logger.info(`Executing task: ${task.name} (${task.id})`);

    // Notify clients that task is running
    const gateway = getWsGateway();
    if (gateway) {
      gateway.routeToClients(task.serverId, {
        type: 'task_progress',
        taskId: task.id,
        serverId: task.serverId,
        status: 'running',
        timestamp: Date.now(),
      });
    }

    try {
      // Check if server still exists
      const server = await this.prisma.server.findUnique({
        where: { id: task.serverId },
      });

      if (!server) {
        throw new Error(`Server not found for task ${task.id}`);
      }

      // Execute based on action type
      if (this.taskExecutor) {
        await this.taskExecutor.executeTask(task);
      } else {
        throw new Error(`Task executor not set for task ${task.id}`);
      }

      // Update task statistics
      await this.prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: startedAt,
          runCount: { increment: 1 },
          lastStatus: 'success',
          lastError: null,
        },
      });

      // Notify clients that task completed
      if (gateway) {
        gateway.routeToClients(task.serverId, {
          type: 'task_complete',
          taskId: task.id,
          serverId: task.serverId,
          status: 'success',
          lastRunAt: new Date().toISOString(),
          timestamp: Date.now(),
        });
      }

      // Update next run time
      await this.updateNextRunTime(task.id, task.schedule, startedAt);

      this.logger.info(`Task executed successfully: ${task.name} (${task.id})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown task error';
      this.logger.error(error, `Failed to execute task: ${task.name} (${task.id})`);
      captureSystemError({
        level: 'error',
        component: 'TaskScheduler',
        message: `Failed to execute task: ${task.name} (${task.id})`,
        stack: error instanceof Error ? error.stack : undefined,
        metadata: { taskId: task.id, taskName: task.name, serverId: task.serverId },
      }).catch(() => {});
      await this.prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: startedAt,
          runCount: { increment: 1 },
          lastStatus: 'failed',
          lastError: message,
        },
      });

      // Notify clients that task failed
      if (gateway) {
        gateway.routeToClients(task.serverId, {
          type: 'task_complete',
          taskId: task.id,
          serverId: task.serverId,
          status: 'failed',
          lastRunAt: new Date().toISOString(),
          timestamp: Date.now(),
        });
      }
      await this.updateNextRunTime(task.id, task.schedule, startedAt);
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  /**
   * Calculate and update next run time for a task
   */
  async updateNextRunTime(taskId: string, schedule: string, baseDate = new Date()) {
    try {
      const nextRun = this.calculateNextRun(schedule, baseDate);

      await this.prisma.scheduledTask.update({
        where: { id: taskId },
        data: { nextRunAt: nextRun },
      });
    } catch (error) {
      this.logger.error(error, `Failed to update next run time for task ${taskId}`);
      captureSystemError({
        level: 'error',
        component: 'TaskScheduler',
        message: `Failed to update next run time for task ${taskId}`,
        stack: error instanceof Error ? error.stack : undefined,
        metadata: { taskId },
      }).catch(() => {});
    }
  }

  /**
   * Simple next run calculation (approximation)
   */
  calculateNextRun(schedule: string, baseDate = new Date()): Date {
    const interval = CronExpressionParser.parse(schedule, {
      currentDate: baseDate,
      tz: process.env.TZ || 'UTC',
    });
    return interval.next().toDate();
  }

  /**
   * Recover tasks that were missed while the scheduler was offline.
   * Only runs tasks whose nextRunAt has passed and that are not already running.
   */
  async recoverMissedTasks() {
    try {
      const now = new Date();
      const missedTasks = await this.prisma.scheduledTask.findMany({
        where: {
          enabled: true,
          nextRunAt: { lte: now },
        },
      });
      for (const task of missedTasks) {
        if (this.runningTasks.has(task.id)) {
          this.logger.warn(`Skipping recovery of already running task ${task.id}`);
          continue;
        }
        this.logger.info(`Recovering missed task: ${task.name} (${task.id})`);
        await this.executeTask(task);
      }
    } catch (error) {
      this.logger.error(error, 'Failed to recover missed tasks');
      captureSystemError({
        level: 'error',
        component: 'TaskScheduler',
        message: 'Failed to recover missed tasks',
        stack: error instanceof Error ? error.stack : undefined,
      }).catch(() => {});
    }
  }

  /**
   * Check for tasks that need to be reloaded or updated.
   * Uses lightweight queries to avoid full table scans.
   */
  async checkAndUpdateTasks() {
    try {
      // Fetch only IDs of enabled tasks for scheduling comparison (lightweight)
      const enabledTaskIdRows = await this.prisma.scheduledTask.findMany({
        where: { enabled: true },
        select: { id: true },
      });
      const enabledTaskIds = new Set(enabledTaskIdRows.map((t) => t.id));

      // Find tasks that are scheduled but disabled in DB
      for (const [taskId] of this.scheduledJobs.entries()) {
        if (!enabledTaskIds.has(taskId)) {
          this.unscheduleTask(taskId);
        }
      }

      // Fetch tasks that need execution or scheduling (targeted query)
      const now = new Date();
      const tasks = await this.prisma.scheduledTask.findMany({
        where: {
          enabled: true,
          OR: [
            { nextRunAt: { lte: now } },
            { nextRunAt: null },
          ],
        },
      });

      // Find tasks that are in DB but not scheduled
      for (const task of tasks) {
        if (!this.scheduledJobs.has(task.id)) {
          this.scheduleTask(task);
        }
      }

      for (const task of tasks) {
        if (task.nextRunAt && task.nextRunAt <= now) {
          if (this.runningTasks.has(task.id)) {
            this.logger.warn(`Task ${task.id} is already running, skipping scheduled execution`);
            continue;
          }
          await this.executeTask(task);
        } else if (!task.nextRunAt) {
          await this.updateNextRunTime(task.id, task.schedule, now);
        }
      }
    } catch (error) {
      this.logger.error(error, 'Failed to check and update tasks');
      captureSystemError({
        level: 'error',
        component: 'TaskScheduler',
        message: 'Failed to check and update tasks',
        stack: error instanceof Error ? error.stack : undefined,
      }).catch(() => {});
    }
  }

  /**
   * Get current scheduled tasks count
   */
  getScheduledTasksCount(): number {
    return this.scheduledJobs.size;
  }
}
