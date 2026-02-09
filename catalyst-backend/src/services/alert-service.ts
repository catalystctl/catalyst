import type { PrismaClient } from '@prisma/client';
import type pino from 'pino';
import fetch from 'node-fetch';
import { renderAlertEmail, sendEmail } from './mailer';

interface AlertConditions {
  cpuThreshold?: number;
  memoryThreshold?: number;
  diskThreshold?: number;
  offlineThreshold?: number; // minutes
}

interface AlertActions {
  webhooks?: string[];
  emails?: string[];
  notifyOwner?: boolean;
  createAlert?: boolean;
  cooldownMinutes?: number;
}

export class AlertService {
  private prisma: PrismaClient;
  private logger: pino.Logger;
  private checkInterval?: ReturnType<typeof setInterval>;

  constructor(prisma: PrismaClient, logger: pino.Logger) {
    this.prisma = prisma;
    this.logger = logger.child({ component: 'AlertService' });
  }

  /**
   * Start the alert monitoring service
   */
  async start() {
    this.logger.info('Starting alert service...');

    // Check for alert conditions every 30 seconds
    this.checkInterval = setInterval(() => {
      this.evaluateAlerts().catch((err) => {
        this.logger.error({ err }, 'Failed to evaluate alerts');
      });

      this.retryFailedDeliveries().catch((err) => {
        this.logger.error({ err }, 'Failed to retry failed alert deliveries');
      });
    }, 30000);

    this.logger.info('Alert service started');
  }

  /**
   * Stop the alert service
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    this.logger.info('Alert service stopped');
  }

  /**
   * Evaluate all enabled alert rules
   */
  async evaluateAlerts() {
    try {
      const rules = await this.prisma.alertRule.findMany({
        where: { enabled: true },
      });

      for (const rule of rules) {
        await this.evaluateRule(rule);
      }
    } catch (error) {
      this.logger.error(error, 'Failed to evaluate alerts');
    }
  }

  /**
   * Evaluate a single alert rule
   */
  async evaluateRule(rule: any) {
    try {
      const conditions = rule.conditions as AlertConditions;
      const actions = rule.actions as AlertActions;

      switch (rule.type) {
        case 'resource_threshold':
          await this.checkResourceThresholds(rule, conditions, actions);
          break;

        case 'node_offline':
          await this.checkNodeOffline(rule, conditions, actions);
          break;

        case 'server_crashed':
          await this.checkServerCrashes(rule, conditions, actions);
          break;

        default:
          this.logger.warn(`Unknown alert rule type: ${rule.type}`);
      }
    } catch (error) {
      this.logger.error(error, `Failed to evaluate rule ${rule.id}`);
    }
  }

  /**
   * Check resource threshold alerts
   */
  async checkResourceThresholds(rule: any, conditions: AlertConditions, actions: AlertActions) {
    if (rule.target === 'server' && rule.targetId) {
      // Check specific server
      const metrics = await this.prisma.serverMetrics.findFirst({
        where: { serverId: rule.targetId },
        orderBy: { timestamp: 'desc' },
        include: { server: true },
      });

      if (!metrics) return;

      // Check CPU threshold
      if (conditions.cpuThreshold && metrics.cpuPercent > conditions.cpuThreshold) {
        const alert = await this.createAlert({
          ruleId: rule.id,
          userId: rule.userId ?? undefined,
          serverId: rule.targetId,
          type: 'resource_threshold',
          severity: 'warning',
          title: `High CPU Usage on ${metrics.server.name}`,
          message: `CPU usage is ${metrics.cpuPercent.toFixed(2)}%, exceeding threshold of ${conditions.cpuThreshold}%`,
          metadata: { cpu: metrics.cpuPercent, threshold: conditions.cpuThreshold },
        });
        if (alert) {
          await this.executeActions(actions, {
            alertType: 'resource_threshold',
            resourceType: 'cpu',
            value: metrics.cpuPercent,
            threshold: conditions.cpuThreshold,
            serverName: metrics.server.name,
          }, alert);
        }
      }

      // Check memory threshold
      if (conditions.memoryThreshold) {
        const memoryPercent =
          metrics.server.allocatedMemoryMb > 0
            ? (metrics.memoryUsageMb / metrics.server.allocatedMemoryMb) * 100
            : 0;
        if (memoryPercent > conditions.memoryThreshold) {
          const alert = await this.createAlert({
            ruleId: rule.id,
            userId: rule.userId ?? undefined,
            serverId: rule.targetId,
            type: 'resource_threshold',
            severity: 'warning',
            title: `High Memory Usage on ${metrics.server.name}`,
            message: `Memory usage is ${memoryPercent.toFixed(2)}%, exceeding threshold of ${conditions.memoryThreshold}%`,
            metadata: { memory: memoryPercent, threshold: conditions.memoryThreshold },
          });
          if (alert) {
            await this.executeActions(actions, {
              alertType: 'resource_threshold',
              resourceType: 'memory',
              value: memoryPercent,
              threshold: conditions.memoryThreshold,
              serverName: metrics.server.name,
            }, alert);
          }
        }
      }

      if (conditions.diskThreshold) {
        const diskPercent =
          metrics.server.allocatedDiskMb > 0 ? (metrics.diskUsageMb / metrics.server.allocatedDiskMb) * 100 : 0;
        if (diskPercent > conditions.diskThreshold) {
          const alert = await this.createAlert({
            ruleId: rule.id,
            userId: rule.userId ?? undefined,
            serverId: rule.targetId,
            type: 'resource_threshold',
            severity: 'warning',
            title: `High Disk Usage on ${metrics.server.name}`,
            message: `Disk usage is ${diskPercent.toFixed(2)}%, exceeding threshold of ${conditions.diskThreshold}%`,
            metadata: { disk: diskPercent, threshold: conditions.diskThreshold },
          });
          if (alert) {
            await this.executeActions(
              actions,
              {
                alertType: 'resource_threshold',
                resourceType: 'disk',
                value: diskPercent,
                threshold: conditions.diskThreshold,
                serverName: metrics.server.name,
              },
              alert,
            );
          }
        }
      }
    } else if (rule.target === 'node' && rule.targetId) {
      // Check specific node
      const metrics = await this.prisma.nodeMetrics.findFirst({
        where: { nodeId: rule.targetId },
        orderBy: { timestamp: 'desc' },
        include: { node: true },
      });

      if (!metrics) return;

      // Check CPU threshold
      if (conditions.cpuThreshold && metrics.cpuPercent > conditions.cpuThreshold) {
        const alert = await this.createAlert({
          ruleId: rule.id,
          userId: rule.userId ?? undefined,
          nodeId: rule.targetId,
          type: 'resource_threshold',
          severity: 'critical',
          title: `High CPU Usage on Node ${metrics.node.name}`,
          message: `Node CPU usage is ${metrics.cpuPercent.toFixed(2)}%, exceeding threshold of ${conditions.cpuThreshold}%`,
          metadata: { cpu: metrics.cpuPercent, threshold: conditions.cpuThreshold },
        });
        if (alert) {
          await this.executeActions(actions, {
            alertType: 'resource_threshold',
            resourceType: 'cpu',
            value: metrics.cpuPercent,
            threshold: conditions.cpuThreshold,
            nodeName: metrics.node.name,
          }, alert);
        }
      }

      // Check memory threshold
      if (conditions.memoryThreshold) {
        const memoryPercent = metrics.memoryTotalMb > 0 ? (metrics.memoryUsageMb / metrics.memoryTotalMb) * 100 : 0;
        if (memoryPercent > conditions.memoryThreshold) {
          const alert = await this.createAlert({
            ruleId: rule.id,
            userId: rule.userId ?? undefined,
            nodeId: rule.targetId,
            type: 'resource_threshold',
            severity: 'critical',
            title: `High Memory Usage on Node ${metrics.node.name}`,
            message: `Node memory usage is ${memoryPercent.toFixed(2)}%, exceeding threshold of ${conditions.memoryThreshold}%`,
            metadata: { memory: memoryPercent, threshold: conditions.memoryThreshold },
          });
          if (alert) {
            await this.executeActions(actions, {
              alertType: 'resource_threshold',
              resourceType: 'memory',
              value: memoryPercent,
              threshold: conditions.memoryThreshold,
              nodeName: metrics.node.name,
            }, alert);
          }
        }
      }

      if (conditions.diskThreshold) {
        const diskPercent = metrics.diskTotalMb > 0 ? (metrics.diskUsageMb / metrics.diskTotalMb) * 100 : 0;
        if (diskPercent > conditions.diskThreshold) {
          const alert = await this.createAlert({
            ruleId: rule.id,
            userId: rule.userId ?? undefined,
            nodeId: rule.targetId,
            type: 'resource_threshold',
            severity: 'critical',
            title: `High Disk Usage on Node ${metrics.node.name}`,
            message: `Node disk usage is ${diskPercent.toFixed(2)}%, exceeding threshold of ${conditions.diskThreshold}%`,
            metadata: { disk: diskPercent, threshold: conditions.diskThreshold },
          });
          if (alert) {
            await this.executeActions(
              actions,
              {
                alertType: 'resource_threshold',
                resourceType: 'disk',
                value: diskPercent,
                threshold: conditions.diskThreshold,
                nodeName: metrics.node.name,
              },
              alert,
            );
          }
        }
      }
    }
  }

  /**
   * Check for offline nodes
   */
  async checkNodeOffline(rule: any, conditions: AlertConditions, actions: AlertActions) {
    const offlineThreshold = conditions.offlineThreshold || 5; // Default 5 minutes
    const thresholdDate = new Date(Date.now() - offlineThreshold * 60 * 1000);

    const offlineNodes = await this.prisma.node.findMany({
      where: {
        OR: [
          { lastSeenAt: { lt: thresholdDate } },
          { AND: [{ lastSeenAt: null }, { createdAt: { lt: thresholdDate } }] },
        ],
        ...(rule.targetId ? { id: rule.targetId } : {}),
      },
    });

    for (const node of offlineNodes) {
      // Check if we already have an unresolved alert for this node
      const existingAlert = await this.prisma.alert.findFirst({
        where: {
          nodeId: node.id,
          type: 'node_offline',
          resolved: false,
        },
      });

      if (!existingAlert) {
      const alert = await this.createAlert({
        ruleId: rule.id,
        userId: rule.userId ?? undefined,
        nodeId: node.id,
        type: 'node_offline',
        severity: 'critical',
          title: `Node ${node.name} is Offline`,
          message: `Node has been offline for more than ${offlineThreshold} minutes`,
          metadata: { lastSeenAt: node.lastSeenAt, offlineThreshold },
        });

        if (alert) {
          await this.executeActions(actions, {
            alertType: 'node_offline',
            nodeName: node.name,
            offlineMinutes: offlineThreshold,
          }, alert);
        }
      }
    }
  }

  /**
   * Check for crashed servers
   */
  async checkServerCrashes(rule: any, conditions: AlertConditions, actions: AlertActions) {
    const crashedServers = await this.prisma.server.findMany({
      where: {
        status: 'crashed',
        ...(rule.targetId ? { id: rule.targetId } : {}),
      },
    });

    for (const server of crashedServers) {
      // Check if we already have an unresolved alert for this crash
      const existingAlert = await this.prisma.alert.findFirst({
        where: {
          serverId: server.id,
          type: 'server_crashed',
          resolved: false,
          createdAt: { gt: server.lastCrashAt || new Date(0) },
        },
      });

      if (!existingAlert) {
        const alert = await this.createAlert({
          ruleId: rule.id,
          userId: rule.userId ?? undefined,
          serverId: server.id,
          type: 'server_crashed',
          severity: 'critical',
          title: `Server ${server.name} Crashed`,
          message: `Server has crashed. Crash count: ${server.crashCount}/${server.maxCrashCount}`,
          metadata: { crashCount: server.crashCount, maxCrashCount: server.maxCrashCount },
        });

        if (alert) {
          await this.executeActions(actions, {
            alertType: 'server_crashed',
            serverName: server.name,
            crashCount: server.crashCount,
            maxCrashCount: server.maxCrashCount,
          }, alert);
        }
      }
    }
  }

  /**
   * Create an alert if it doesn't already exist
   */
  async createAlert(data: {
    ruleId?: string;
    userId?: string;
    serverId?: string;
    nodeId?: string;
    type: string;
    severity: string;
    title: string;
    message: string;
    metadata?: any;
  }) {
    const cooldownMinutes = await this.resolveCooldownMinutes(data.ruleId);
    const windowStart = new Date(Date.now() - cooldownMinutes * 60 * 1000);
    const existingAlert = await this.prisma.alert.findFirst({
      where: {
        ...(data.serverId ? { serverId: data.serverId } : {}),
        ...(data.nodeId ? { nodeId: data.nodeId } : {}),
        ...(data.ruleId ? { ruleId: data.ruleId } : {}),
        type: data.type,
        title: data.title,
        resolved: false,
        createdAt: { gt: windowStart },
      },
    });

    if (existingAlert) {
      this.logger.debug(`Duplicate alert suppressed: ${data.title}`);
      return;
    }

      const alert = await this.prisma.alert.create({
        data: {
          ruleId: data.ruleId,
          userId: data.userId,
          serverId: data.serverId,
          nodeId: data.nodeId,
        type: data.type,
        severity: data.severity,
        title: data.title,
        message: data.message,
        metadata: data.metadata || {},
      },
    });

    this.logger.info(`Alert created: ${alert.title} (${alert.id})`);
    return alert;
  }

  /**
   * Execute alert actions (webhooks, etc.)
   */
  async executeActions(actions: AlertActions, context: any, alert: { id: string }) {
    if (actions.webhooks && actions.webhooks.length > 0) {
      for (const webhookUrl of actions.webhooks) {
        await this.dispatchWebhook(alert.id, webhookUrl, context);
      }
    }
    if (actions.emails && actions.emails.length > 0) {
      for (const email of actions.emails) {
        await this.dispatchEmail(alert.id, email, context);
      }
    }
    if (actions.notifyOwner) {
      await this.dispatchOwnerEmail(alert.id, context);
    }
  }

  private async resolveCooldownMinutes(ruleId?: string) {
    if (!ruleId) {
      return 5;
    }
    const rule = await this.prisma.alertRule.findUnique({
      where: { id: ruleId },
      select: { actions: true },
    });
    const actions = rule?.actions as AlertActions | undefined;
    return actions?.cooldownMinutes && actions.cooldownMinutes > 0 ? actions.cooldownMinutes : 5;
  }

  private isDiscordWebhook(webhookUrl: string) {
    return /discord\.com\/api\/webhooks/.test(webhookUrl);
  }

  private buildWebhookPayload(
    webhookUrl: string,
    context: any,
    alert: { id: string; title: string; message: string; severity: string; type: string; createdAt: Date },
  ) {
    if (this.isDiscordWebhook(webhookUrl)) {
      const severity = alert.severity.toUpperCase();
      return {
        content: `**${severity}** - ${alert.title}\n${alert.message}`,
        embeds: [
          {
            title: alert.title,
            description: alert.message,
            color: alert.severity === 'critical' ? 0xef4444 : alert.severity === 'warning' ? 0xf59e0b : 0x22c55e,
            fields: [
              { name: 'Type', value: alert.type, inline: true },
              { name: 'Severity', value: severity, inline: true },
              { name: 'Created', value: alert.createdAt.toISOString(), inline: false },
            ],
            timestamp: alert.createdAt.toISOString(),
          },
        ],
      };
    }
    return {
      alertId: alert.id,
      timestamp: new Date().toISOString(),
      ...context,
    };
  }

  private async dispatchWebhook(alertId: string, webhookUrl: string, context: any) {
    const delivery = await this.prisma.alertDelivery.create({
      data: { alertId, channel: 'webhook', target: webhookUrl, status: 'pending' },
    });
    try {
      const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
      if (!alert) {
        throw new Error('Alert not found for webhook dispatch');
      }
      const payload = this.buildWebhookPayload(webhookUrl, context, alert);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Webhook response ${response.status}: ${body}`);
      }
      await this.prisma.alertDelivery.update({
        where: { id: delivery.id },
        data: { status: 'sent', attempts: delivery.attempts + 1, lastAttemptAt: new Date() },
      });
      this.logger.info(`Webhook sent to ${webhookUrl}`);
    } catch (error) {
      await this.prisma.alertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed',
          attempts: delivery.attempts + 1,
          lastAttemptAt: new Date(),
          lastError: error instanceof Error ? error.message : 'Webhook delivery failed',
        },
      });
      this.logger.error(error, `Failed to send webhook to ${webhookUrl}`);
    }
  }

  private async dispatchEmail(alertId: string, email: string, context: any) {
    const delivery = await this.prisma.alertDelivery.create({
      data: { alertId, channel: 'email', target: email, status: 'pending' },
    });
    try {
      const alert = await this.prisma.alert.findUnique({ where: { id: alertId } });
      if (!alert) {
        throw new Error('Alert not found for email dispatch');
      }
      const alertUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/alerts`;
      const emailContent = renderAlertEmail({
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        type: alert.type,
        createdAt: alert.createdAt,
        alertUrl,
      });
      await sendEmail({
        to: email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
      await this.prisma.alertDelivery.update({
        where: { id: delivery.id },
        data: { status: 'sent', attempts: delivery.attempts + 1, lastAttemptAt: new Date() },
      });
      this.logger.info(`Alert email sent to ${email}`);
    } catch (error) {
      await this.prisma.alertDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'failed',
          attempts: delivery.attempts + 1,
          lastAttemptAt: new Date(),
          lastError: error instanceof Error ? error.message : 'Email delivery failed',
        },
      });
      this.logger.error(error, `Failed to send alert email to ${email}`);
    }
  }

  private async dispatchOwnerEmail(alertId: string, context: any) {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      include: { server: { select: { ownerId: true } } },
    });
    if (!alert?.server?.ownerId) {
      return;
    }
    const owner = await this.prisma.user.findUnique({ where: { id: alert.server.ownerId } });
    if (!owner?.email) {
      return;
    }
    await this.dispatchEmail(alertId, owner.email, context);
  }

  private async retryFailedDeliveries() {
    const maxAttempts = 3;
    const retryDelayMs = 5 * 60 * 1000;
    const cutoff = new Date(Date.now() - retryDelayMs);
    const deliveries = await this.prisma.alertDelivery.findMany({
      where: {
        status: 'failed',
        attempts: { lt: maxAttempts },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: cutoff } }],
      },
      take: 50,
    });
    if (!deliveries.length) {
      return;
    }
    for (const delivery of deliveries) {
      const alert = await this.prisma.alert.findUnique({ where: { id: delivery.alertId } });
      if (!alert) {
        continue;
      }
      const retryContext = {
        alertId: alert.id,
        alertType: alert.type,
        severity: alert.severity,
        title: alert.title,
        message: alert.message,
        metadata: alert.metadata,
        createdAt: alert.createdAt.toISOString(),
      };
      if (delivery.channel === 'webhook') {
        await this.retryWebhookDelivery(delivery.id, delivery.target, retryContext);
      } else if (delivery.channel === 'email') {
        await this.retryEmailDelivery(delivery.id, delivery.target, alert);
      }
    }
  }

  private async retryWebhookDelivery(deliveryId: string, webhookUrl: string, context: any) {
    try {
      const alert = await this.prisma.alert.findUnique({ where: { id: context.alertId } });
      if (!alert) {
        throw new Error('Alert not found for webhook retry');
      }
      const payload = this.buildWebhookPayload(webhookUrl, context, alert);
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Webhook response ${response.status}: ${body}`);
      }
      await this.prisma.alertDelivery.update({
        where: { id: deliveryId },
        data: { status: 'sent', attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: null },
      });
      this.logger.info(`Retried webhook delivery to ${webhookUrl}`);
    } catch (error) {
      await this.prisma.alertDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'failed',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          lastError: error instanceof Error ? error.message : 'Webhook delivery failed',
        },
      });
      this.logger.error(error, `Retry webhook failed for ${webhookUrl}`);
    }
  }

  private async retryEmailDelivery(
    deliveryId: string,
    email: string,
    alert: { title: string; message: string; severity: string; type: string; createdAt: Date },
  ) {
    try {
      const alertUrl = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/alerts`;
      const emailContent = renderAlertEmail({
        title: alert.title,
        message: alert.message,
        severity: alert.severity,
        type: alert.type,
        createdAt: alert.createdAt,
        alertUrl,
      });
      await sendEmail({
        to: email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
      await this.prisma.alertDelivery.update({
        where: { id: deliveryId },
        data: { status: 'sent', attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: null },
      });
      this.logger.info(`Retried alert email to ${email}`);
    } catch (error) {
      await this.prisma.alertDelivery.update({
        where: { id: deliveryId },
        data: {
          status: 'failed',
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          lastError: error instanceof Error ? error.message : 'Email delivery failed',
        },
      });
      this.logger.error(error, `Retry email failed for ${email}`);
    }
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(alertId: string, resolvedBy?: string) {
    await this.prisma.alert.update({
      where: { id: alertId },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy,
      },
    });

    this.logger.info(`Alert resolved: ${alertId}`);
  }
}
