import cron from 'node-cron';
import cronParser from 'cron-parser';
import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';

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

      // Update next run time
      await this.updateNextRunTime(task.id, task.schedule, startedAt);

      this.logger.info(`Task executed successfully: ${task.name} (${task.id})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown task error';
      this.logger.error(error, `Failed to execute task: ${task.name} (${task.id})`);
      await this.prisma.scheduledTask.update({
        where: { id: task.id },
        data: {
          lastRunAt: startedAt,
          runCount: { increment: 1 },
          lastStatus: 'failed',
          lastError: message,
        },
      });
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
    }
  }

  /**
   * Simple next run calculation (approximation)
   */
  calculateNextRun(schedule: string, baseDate = new Date()): Date {
    const interval = (cronParser as any).parseExpression(schedule, {
      currentDate: baseDate,
      tz: process.env.TZ || 'UTC',
    });
    return interval.next().toDate();
  }

  /**
   * Check for tasks that need to be reloaded or updated
   */
  async checkAndUpdateTasks() {
    try {
      // Reload all enabled tasks (in case they were added/modified)
      const tasks = await this.prisma.scheduledTask.findMany({
        where: { enabled: true },
      });

      // Find tasks that are in DB but not scheduled
      for (const task of tasks) {
        if (!this.scheduledJobs.has(task.id)) {
          this.scheduleTask(task);
        }
      }

      // Find tasks that are scheduled but disabled in DB
      const enabledTaskIds = new Set(tasks.map((t) => t.id));
      for (const [taskId] of this.scheduledJobs.entries()) {
        if (!enabledTaskIds.has(taskId)) {
          this.unscheduleTask(taskId);
        }
      }

      const now = new Date();
      for (const task of tasks) {
        if (task.nextRunAt && task.nextRunAt <= now) {
          await this.executeTask(task);
        } else if (!task.nextRunAt) {
          await this.updateNextRunTime(task.id, task.schedule, now);
        }
      }
    } catch (error) {
      this.logger.error(error, 'Failed to check and update tasks');
    }
  }

  /**
   * Get current scheduled tasks count
   */
  getScheduledTasksCount(): number {
    return this.scheduledJobs.size;
  }
}
