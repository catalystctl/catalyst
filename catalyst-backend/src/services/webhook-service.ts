/**
 * Webhook Service
 *
 * Manages outbound webhook dispatching for server lifecycle events.
 * Webhooks are configured via WEBHOOK_URLS env var or a SystemSetting row.
 * Each event payload is POSTed as JSON with HMAC-SHA256 signature verification.
 */

import type { PrismaClient } from "@prisma/client";
import type pino from "pino";
import crypto from "crypto";

export interface WebhookEvent {
  event: string;
  serverId: string;
  serverName?: string;
  userId?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export class WebhookService {
  private prisma: PrismaClient;
  private logger: pino.Logger;
  private webhookUrls: string[] = [];
  private secret: string;
  private lastRefreshAt = 0;
  private readonly REFRESH_INTERVAL_MS = 60_000; // Refresh every 60s

  constructor(prisma: PrismaClient, logger: pino.Logger) {
    this.prisma = prisma;
    this.logger = logger.child({ component: "WebhookService" });
    this.secret = process.env.WEBHOOK_SECRET || crypto.randomBytes(32).toString("hex");
  }

  /**
   * Get the configured webhook URLs, refreshing from env/DB if stale.
   */
  private async getWebhookUrls(): Promise<string[]> {
    const now = Date.now();
    if (now - this.lastRefreshAt < this.REFRESH_INTERVAL_MS && this.webhookUrls.length > 0) {
      return this.webhookUrls;
    }

    try {
      // Support both env var and DB-stored webhook URLs.
      // Env:  WEBHOOK_URLS=https://example.com/hook,https://other.com/hook
      // DB:   SystemSetting(id="webhooks") — store JSON array in smtpHost field
      const envUrls = process.env.WEBHOOK_URLS;
      if (envUrls) {
        this.webhookUrls = envUrls
          .split(",")
          .map((u) => u.trim())
          .filter((u) => u.length > 0 && u.startsWith("http"));
      } else {
        const settings = await this.prisma.systemSetting.findUnique({ where: { id: "webhooks" } });
        if (settings?.smtpHost) {
          try {
            const parsed = JSON.parse(settings.smtpHost);
            this.webhookUrls = Array.isArray(parsed)
              ? parsed.filter((u: unknown) => typeof u === "string" && u.length > 0)
              : [];
          } catch {
            this.webhookUrls = [];
          }
        } else {
          this.webhookUrls = [];
        }
      }
      this.lastRefreshAt = now;

      if (this.webhookUrls.length > 0) {
        this.logger.debug({ count: this.webhookUrls.length }, "Loaded webhook URLs");
      }
    } catch (err) {
      this.logger.warn(err, "Failed to load webhook URLs");
    }

    return this.webhookUrls;
  }

  /**
   * Sign a webhook payload with HMAC-SHA256.
   */
  private sign(payload: string): string {
    return crypto.createHmac("sha256", this.secret).update(payload).digest("hex");
  }

  /**
   * Dispatch a webhook event to all configured URLs (fire-and-forget).
   */
  async dispatch(event: WebhookEvent): Promise<void> {
    const urls = await this.getWebhookUrls();
    if (urls.length === 0) return;

    const payload = JSON.stringify(event);
    const signature = this.sign(payload);

    for (const url of urls) {
      this.dispatchSingle(url, payload, signature, event).catch((err) => {
        this.logger.warn({ url, event: event.event, err }, "Webhook delivery failed");
      });
    }
  }

  private async dispatchSingle(
    url: string,
    payload: string,
    signature: string,
    event: WebhookEvent
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Signature": signature,
          "X-Webhook-Event": event.event,
          "X-Webhook-Timestamp": event.timestamp,
          "User-Agent": "Catalyst-Webhooks/1.0",
        },
        body: payload,
        signal: controller.signal,
      });

      if (!response.ok) {
        this.logger.warn(
          { url, status: response.status, event: event.event },
          "Webhook returned non-2xx status"
        );
      } else {
        this.logger.debug({ url, event: event.event }, "Webhook delivered");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        this.logger.warn({ url, event: event.event }, "Webhook delivery timed out");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Helper: dispatch a server.created event.
   */
  async serverCreated(server: { id: string; name?: string; ownerId: string }, userId: string) {
    return this.dispatch({
      event: "server.created",
      serverId: server.id,
      serverName: server.name,
      userId,
      timestamp: new Date().toISOString(),
      data: { ownerId: server.ownerId },
    });
  }

  /**
   * Helper: dispatch a server.deleted event.
   */
  async serverDeleted(serverId: string, serverName?: string, userId?: string) {
    return this.dispatch({
      event: "server.deleted",
      serverId,
      serverName,
      userId,
      timestamp: new Date().toISOString(),
      data: {},
    });
  }

  /**
   * Helper: dispatch a server.suspended event.
   */
  async serverSuspended(
    serverId: string,
    serverName: string | null | undefined,
    reason: string | null | undefined,
    userId: string
  ) {
    return this.dispatch({
      event: "server.suspended",
      serverId,
      serverName: serverName ?? undefined,
      userId,
      timestamp: new Date().toISOString(),
      data: { reason: reason ?? undefined },
    });
  }

  /**
   * Helper: dispatch a server.unsuspended event.
   */
  async serverUnsuspended(serverId: string, serverName: string | null | undefined, userId: string) {
    return this.dispatch({
      event: "server.unsuspended",
      serverId,
      serverName: serverName ?? undefined,
      userId,
      timestamp: new Date().toISOString(),
      data: {},
    });
  }

  /**
   * Helper: dispatch a server.bulk_suspended event.
   */
  async serverBulkSuspended(serverIds: string[], reason: string | null | undefined, userId: string) {
    return this.dispatch({
      event: "server.bulk_suspended",
      serverId: "",
      userId,
      timestamp: new Date().toISOString(),
      data: { serverIds, reason: reason ?? undefined },
    });
  }

  /**
   * Helper: dispatch a server.bulk_deleted event.
   */
  async serverBulkDeleted(serverIds: string[], userId: string) {
    return this.dispatch({
      event: "server.bulk_deleted",
      serverId: "",
      userId,
      timestamp: new Date().toISOString(),
      data: { serverIds },
    });
  }

  /**
   * Helper: dispatch a user.deleted event.
   */
  async userDeleted(userId: string, email: string, username: string, deletedBy: string) {
    return this.dispatch({
      event: "user.deleted",
      serverId: "",
      userId: deletedBy,
      timestamp: new Date().toISOString(),
      data: { targetUserId: userId, email, username },
    });
  }
}
