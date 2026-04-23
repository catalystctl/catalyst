/**
 * Pterodactyl Application API Client
 * Uses HTTP/2 with persistent sessions and automatic reconnection
 */

import * as http2 from "node:http2";
import * as http from "node:http";
import * as https from "node:https";
import { Readable } from "node:stream";
import type { URL as URLType } from "node:url";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type {
  PterodactylListResponse,
  PterodactylResource,
  PterodactylSingleResponse,
  PterodactylLocation,
  PterodactylNode,
  PterodactylNest,
  PterodactylEgg,
  PterodactylUser,
  PterodactylServer,
  PterodactylSubuser,
  PterodactylDatabase,
  PterodactylAllocation,
  PterodactylDatabaseHost,
  PterodactylSchedule,
  PterodactylBackup,
} from "./types";

export class PterodactylClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "PterodactylClientError";
  }
}

interface RequestOptions {
  path: string;
  method?: string;
  body?: Buffer | null;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** Override the default authorization key for this request */
  authKey?: string;
}

interface ClientEvents {
  progress: [data: { phase: string; current: number; total: number }];
  reconnect: [attempt: number];
  error: [error: Error];
  close: [];
}

export class PterodactylClient extends EventEmitter<ClientEvents> {
  private session: http2.ClientHttp2Session | null = null;
  private readonly baseUrl: URLType;
  private readonly apiKey: string;
  /** Optional client API key (ptlc_*) for v1.x backup/schedule/subuser access */
  private readonly clientApiKey: string | null;
  private readonly logger: any;
  private closed = false;
  private useHttp1 = false; // Fallback when server doesn't support HTTP/2
  private http1Agent: http.Agent | https.Agent | null = null;
  private reconnectAttempt = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelayMs = 1000;
  private readonly maxReconnectDelayMs = 30000;
  private connectPromise: Promise<void> | null = null;
  private inflightRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private requestIdCounter = 0;

  constructor(panelUrl: string, apiKey: string, logger?: any, clientApiKey?: string) {
    super();
    // Normalize URL — strip trailing slash
    const cleanUrl = panelUrl.replace(/\/+$/, "");
    this.baseUrl = new URL(cleanUrl) as any;
    this.apiKey = apiKey;
    this.clientApiKey = clientApiKey || null;
    this.logger = logger || console;
  }

  /**
   * Whether we have a client API key available.
   * In Pterodactyl v1.x, backups/schedules/subusers require client API access.
   */
  hasClientApi(): boolean {
    return !!this.clientApiKey;
  }

  // ========================================================================
  // CONNECTION MANAGEMENT
  // ========================================================================

  private async ensureConnected(): Promise<void> {
    if (this.closed) {
      throw new PterodactylClientError("CLOSED", "Client has been closed");
    }

    // If already connected and session is not closed, reuse
    if (this.useHttp1) {
      this.ensureHttp1Agent();
      return;
    }
    if (this.session && !this.closed && !this.session.closed && !this.session.destroyed) {
      return;
    }

    // If connection is in progress, wait for it
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connect();
    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new PterodactylClientError("CLOSED", "Client has been closed"));
        return;
      }

      // If already fell back to HTTP/1.1, no session needed
      if (this.useHttp1) {
        this.ensureHttp1Agent();
        resolve();
        return;
      }

      const isHttps = this.baseUrl.protocol === "https:";

      // Skip HTTP/2 for plain HTTP — h2c prior knowledge is almost never
      // supported by web servers/proxies. Go straight to HTTP/1.1.
      if (!isHttps) {
        this.logger?.info?.("Plain HTTP detected, using HTTP/1.1 (h2c prior knowledge not supported)");
        this.useHttp1 = true;
        this.ensureHttp1Agent();
        resolve();
        return;
      }

      const port = this.baseUrl.port || "443";
      const host = this.baseUrl.hostname;

      // For HTTPS, try HTTP/2 with ALPN negotiation
      let session: http2.ClientHttp2Session;
      try {
        session = http2.connect(`https://${host}:${port}`, {
          rejectUnauthorized: false,
        });
      } catch (err: any) {
        // Synchronous error from http2.connect — fall back to HTTP/1.1
        this.logger?.info?.({ err: err.message }, "HTTP/2 connect failed, falling back to HTTP/1.1");
        this.useHttp1 = true;
        this.ensureHttp1Agent();
        resolve();
        return;
      }

      session.on("connect", () => {
        this.logger?.debug?.("Pterodactyl HTTP/2 session established");
        this.reconnectAttempt = 0;
        resolve();
      });

      session.on("error", (err: Error) => {
        this.logger?.error?.({ err }, "Pterodactyl HTTP/2 session error");

        // Detect protocol error — server doesn't speak HTTP/2, fall back to HTTP/1.1
        const isProtocolError =
          err.message.includes("NGHTTP2_PROTOCOL_ERROR") ||
          err.message.includes("ERR_HTTP2_SESSION_ERROR") ||
          err.message.includes("authority") ||
          err.message.includes("ALPN");

        if (isProtocolError && !this.useHttp1) {
          this.logger?.info?.(
            "Pterodactyl server does not support HTTP/2, falling back to HTTP/1.1"
          );
          this.useHttp1 = true;
          this.session = null;
          this.ensureHttp1Agent();
          this.reconnectAttempt = 0;
          resolve(); // Connection "succeeded" via fallback
          return;
        }

        if (!this.closed) {
          this.scheduleReconnect();
        }
        reject(new PterodactylClientError("CONNECT_ERROR", `Connection failed: ${err.message}`));
      });

      session.on("goaway", (code, lastStreamId, opaqueData) => {
        this.logger?.warn?.(
          { code, lastStreamId },
          "Pterodactyl HTTP/2 GOAWAY received"
        );
        this.session = null;
        if (!this.closed) {
          this.scheduleReconnect();
        }
      });

      session.on("close", () => {
        this.logger?.debug?.("Pterodactyl HTTP/2 session closed");
        this.session = null;
        // Reject any pending requests
        for (const [id, req] of this.inflightRequests) {
          clearTimeout(req.timeout);
          req.reject(new PterodactylClientError("DISCONNECTED", "Connection closed"));
          this.inflightRequests.delete(id);
        }
        if (!this.closed) {
          this.scheduleReconnect();
        }
      });

      session.on("timeout", () => {
        this.logger?.warn?.("Pterodactyl HTTP/2 session timeout");
        session.close();
      });

      // Set timeout on the session
      session.setTimeout(30000, () => {
        if (session && !session.closed) {
          session.ping((err) => {
            if (err) {
              this.logger?.warn?.("Pterodactyl HTTP/2 ping failed");
              session.close();
            }
          });
        }
      });

      this.session = session;
    });
  }

  private scheduleReconnect() {
    if (this.closed || this.connectPromise) return;
    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.logger?.error?.(
        "Pterodactyl client: max reconnection attempts reached"
      );
      this.emit("error", new Error("Max reconnection attempts reached"));
      return;
    }

    const delay = Math.min(
      this.baseReconnectDelayMs * Math.pow(2, this.reconnectAttempt),
      this.maxReconnectDelayMs
    );
    // Add jitter (±25%)
    const jitter = delay * (0.75 + Math.random() * 0.5);

    this.reconnectAttempt++;
    this.emit("reconnect", this.reconnectAttempt);
    this.logger?.info?.(
      { attempt: this.reconnectAttempt, delayMs: Math.round(jitter) },
      "Pterodactyl client: scheduling reconnect"
    );

    setTimeout(() => {
      if (this.closed) return;
      this.connect().catch(() => {
        // Reconnect failed, scheduleReconnect will be called by error handler
      });
    }, jitter);
  }

  close(): void {
    this.closed = true;
    if (this.session && !this.session.closed && !this.session.destroyed) {
      this.session.close();
    }
    this.session = null;
    this.connectPromise = null;
    if (this.http1Agent) {
      this.http1Agent.destroy();
      this.http1Agent = null;
    }
    // Reject pending requests
    for (const [id, req] of this.inflightRequests) {
      clearTimeout(req.timeout);
      req.reject(new PterodactylClientError("CLOSED", "Client closed"));
    }
    this.inflightRequests.clear();
    this.emit("close");
  }

  private ensureHttp1Agent(): void {
    if (!this.http1Agent) {
      const isHttps = this.baseUrl.protocol === "https:";
      if (isHttps) {
        this.http1Agent = new https.Agent({
          keepAlive: true,
          maxSockets: 4,
          rejectUnauthorized: false,
        });
      } else {
        this.http1Agent = new http.Agent({
          keepAlive: true,
          maxSockets: 4,
        });
      }
    }
  }

  // ========================================================================
  // HTTP/2 REQUEST
  // ========================================================================

  private async request<T>(opts: RequestOptions): Promise<T> {
    await this.ensureConnected();

    // Use HTTP/1.1 fallback when server doesn't support HTTP/2
    if (this.useHttp1) {
      return this.requestHttp1<T>(opts);
    }

    if (!this.session) {
      throw new PterodactylClientError("NO_SESSION", "No HTTP/2 session available");
    }

    return new Promise<T>((resolve, reject) => {
      const reqId = `req_${++this.requestIdCounter}`;
      const timeoutMs = opts.timeoutMs ?? 30000;
      const path = opts.path.startsWith("/")
        ? opts.path
        : `/${opts.path}`;

      const headers: http2.OutgoingHttpHeaders = {
        ":method": opts.method || "GET",
        ":path": `${this.baseUrl.pathname.replace(/\/+$/, "")}${path}`,
        ":authority": this.baseUrl.host,
        "authorization": `Bearer ${opts.authKey || this.apiKey}`,
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": "Catalyst-Migration/1.0",
        ...(opts.headers || {}),
      };

      if (opts.body) {
        headers["content-length"] = String(opts.body.length);
      }

      if (!this.session) {
        throw new PterodactylClientError("NO_SESSION", "No HTTP/2 session available");
      }

      const req = this.session.request(headers);

      const timeout = setTimeout(() => {
        req.close(http2.constants.NGHTTP2_CANCEL);
        this.inflightRequests.delete(reqId);
        reject(new PterodactylClientError("TIMEOUT", `Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.inflightRequests.set(reqId, {
        resolve: resolve as any,
        reject,
        timeout,
      });

      req.on("response", (headers) => {
        const status = headers[":status"] as number;
        const chunks: Buffer[] = [];

        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          clearTimeout(timeout);
          this.inflightRequests.delete(reqId);

          const body = Buffer.concat(chunks);
          const bodyStr = body.toString("utf-8");

          if (status >= 200 && status < 300) {
            try {
              const parsed = JSON.parse(bodyStr);
              resolve(parsed as T);
            } catch {
              // Some endpoints return empty bodies
              resolve(undefined as unknown as T);
            }
          } else if (status === 429) {
            // Rate limited
            const retryAfter = parseInt(headers["retry-after"] as string || "5", 10);
            this.logger?.warn?.({ status, retryAfter }, "Pterodactyl rate limited");
            setTimeout(() => {
              this.request<T>(opts).then(resolve).catch(reject);
            }, Math.max(retryAfter, 1) * 1000);
          } else if (status === 401) {
            reject(new PterodactylClientError("AUTH_FAILED", "Invalid API key", 401));
          } else if (status === 404) {
            reject(new PterodactylClientError("NOT_FOUND", `Resource not found: ${path}`, 404));
          } else {
            let errorMsg = `HTTP ${status}`;
            try {
              const errBody = JSON.parse(bodyStr);
              errorMsg = errBody?.errors?.[0]?.detail || errBody?.error || errorMsg;
            } catch { /* ignore */ }
            reject(new PterodactylClientError("API_ERROR", errorMsg, status));
          }
        });

        req.on("error", (err: Error) => {
          clearTimeout(timeout);
          this.inflightRequests.delete(reqId);
          reject(new PterodactylClientError("REQUEST_ERROR", err.message));
        });
      });

      req.on("error", (err: Error) => {
        clearTimeout(timeout);
        this.inflightRequests.delete(reqId);
        reject(new PterodactylClientError("REQUEST_ERROR", err.message));
      });

      if (opts.body) {
        req.end(opts.body);
      } else {
        req.end();
      }
    });
  }

  /**
   * HTTP/1.1 fallback request using Node.js https module with connection pooling.
   */
  private requestHttp1<T>(opts: RequestOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const isHttps = this.baseUrl.protocol === "https:";
      const port = parseInt(this.baseUrl.port || (isHttps ? "443" : "80"), 10);
      const host = this.baseUrl.hostname;
      const basePath = this.baseUrl.pathname.replace(/\/+$/, "");
      const fullPath = `${basePath}${opts.path.startsWith("/") ? opts.path : `/${  opts.path}`}`;
      const timeoutMs = opts.timeoutMs ?? 30000;

      const reqHeaders: Record<string, string> = {
        "authorization": `Bearer ${opts.authKey || this.apiKey}`,
        "accept": "application/json",
        "content-type": "application/json",
        "user-agent": "Catalyst-Migration/1.0 (HTTP/1.1)",
        "host": this.baseUrl.host,
        ...(opts.headers || {}),
      };

      if (opts.body) {
        reqHeaders["content-length"] = String(opts.body.length);
      }

      const transport = isHttps ? https : http;
      const req = transport.request(
        {
          hostname: host,
          port,
          path: fullPath,
          method: opts.method || "GET",
          headers: reqHeaders,
          agent: this.http1Agent || undefined,
          rejectUnauthorized: isHttps ? false : undefined,
        },
        (res) => {
          const status = res.statusCode || 0;
          const chunks: Buffer[] = [];

          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const body = Buffer.concat(chunks);
            const bodyStr = body.toString("utf-8");

            if (status >= 200 && status < 300) {
              try {
                resolve(JSON.parse(bodyStr) as T);
              } catch {
                resolve(undefined as unknown as T);
              }
            } else if (status === 429) {
              const retryAfter = parseInt(res.headers["retry-after"] as string || "5", 10);
              this.logger?.warn?.({ status, retryAfter }, "Pterodactyl rate limited");
              setTimeout(() => {
                this.requestHttp1<T>(opts).then(resolve).catch(reject);
              }, Math.max(retryAfter, 1) * 1000);
            } else if (status === 401) {
              reject(new PterodactylClientError("AUTH_FAILED", "Invalid API key", 401));
            } else if (status === 404) {
              reject(new PterodactylClientError("NOT_FOUND", `Resource not found: ${fullPath}`, 404));
            } else {
              let errorMsg = `HTTP ${status}`;
              try {
                const errBody = JSON.parse(bodyStr);
                errorMsg = errBody?.errors?.[0]?.detail || errBody?.error || errorMsg;
              } catch { /* ignore */ }
              reject(new PterodactylClientError("API_ERROR", errorMsg, status));
            }
          });
        }
      );

      const timeout = setTimeout(() => {
        req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
        reject(new PterodactylClientError("TIMEOUT", `Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      req.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(new PterodactylClientError("REQUEST_ERROR", err.message));
      });

      if (opts.body) {
        req.end(opts.body);
      } else {
        req.end();
      }
    });
  }

  // ========================================================================
  // PAGINATION HELPER
  // ========================================================================

  /**
   * Fetch all pages of a paginated endpoint
   */
  async listAll<T>(
    path: string,
    params?: Record<string, string>,
    authKey?: string
  ): Promise<PterodactylResource<T>[]> {
    const allItems: PterodactylResource<T>[] = [];
    let page = 1;
    const perPage = 50; // Pterodactyl max is 100, 50 is safer
    let hasMore = true;

    while (hasMore) {
      const query = new URLSearchParams({
        page: String(page),
        per_page: String(perPage),
        ...(params || {}),
      }).toString();

      const response = await this.request<PterodactylListResponse<T>>(
        { path: `${path}?${query}`, authKey }
      );

      const items = response.data || [];
      allItems.push(...items);

      this.emit("progress", {
        phase: path.split("/").pop() || "list",
        current: allItems.length,
        total: response.meta?.pagination?.total || 0,
      });

      const totalPages = response.meta?.pagination?.total_pages
        || response.meta?.pagination?.last_page
        || 1;

      hasMore = page < totalPages && items.length > 0;
      page++;
    }

    return allItems;
  }

  // ========================================================================
  // API METHODS
  // ========================================================================

  /**
   * Test connection to Pterodactyl panel
   */
  async testConnection(): Promise<{
    success: boolean;
    version?: string;
    error?: string;
  }> {
    try {
      const response = await this.request<PterodactylListResponse<unknown>>(
        { path: "/api/application/locations?per_page=1" }
      );
      return {
        success: true,
        version: response.object === "list" ? "1.x" : "unknown",
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Connection failed",
      };
    }
  }

  /**
   * Get entity counts for migration preview
   */
  async getPreview(): Promise<{
    locations: number;
    nodes: number;
    nests: number;
    users: number;
    servers: number;
    nodesList: Array<{ id: number; name: string; fqdn: string; memory: number; serverCount: number }>;
    serversList: Array<{
      id: number; uuid: string; name: string; nodeId: number; nodeName: string;
      state: string; eggName: string; nestName: string;
      backupSlots: number; currentBackups: number;
      /** Per-server migration summary */
      databases: number;
      schedules: number;
      subusers: number;
      hasAllocation: boolean;
      memory: number;
      disk: number;
      cpu: number;
      suspended: boolean;
    }>;
  }> {
    const [locations, nodes, nests, users, servers] = await Promise.all([
      this.listAll<PterodactylLocation>("/api/application/locations"),
      this.listAll<PterodactylNode>("/api/application/nodes"),
      this.listAll<PterodactylNest>("/api/application/nests"),
      this.listAll<PterodactylUser>("/api/application/users"),
      this.listAll<PterodactylServer>("/api/application/servers"),
    ]);

    // Build lookup maps (Pterodactyl v1.x `include` may not populate relationships)
    const nodeServerCounts = new Map<number, number>();
    for (const s of servers) {
      const nid = s.attributes.node;
      nodeServerCounts.set(nid, (nodeServerCounts.get(nid) || 0) + 1);
    }

    const nodesList = nodes.map(n => ({
      id: n.attributes.id,
      name: n.attributes.name,
      fqdn: n.attributes.fqdn,
      memory: n.attributes.memory,
      serverCount: nodeServerCounts.get(n.attributes.id) || 0,
    }));

    const nodeNameMap = new Map<number, string>();
    for (const n of nodes) {
      nodeNameMap.set(n.attributes.id, n.attributes.name);
    }
    const nestNameMap = new Map<number, string>();
    for (const n of nests) {
      nestNameMap.set(n.attributes.id, n.attributes.name);
    }
    const eggNameMap = new Map<number, string>();
    for (const n of nests) {
      try {
        const eggs = await this.listAll<PterodactylEgg>(`/api/application/nests/${n.attributes.id}/eggs`);
        for (const e of eggs) {
          eggNameMap.set(e.attributes.id, e.attributes.name);
        }
      } catch {
        // Some nests might not have accessible eggs
      }
    }

    const serversList = servers.map(s => {
      const serverAttrs = s.attributes as PterodactylServer;
      // Try to get egg name from relationships first, then from map
      let eggName = String(serverAttrs.egg);
      if (serverAttrs.relationships?.egg?.attributes?.name) {
        eggName = serverAttrs.relationships.egg.attributes.name;
      } else {
        eggName = eggNameMap.get(serverAttrs.egg) || eggName;
      }
      return {
        id: serverAttrs.id,
        uuid: serverAttrs.uuid,
        name: serverAttrs.name,
        nodeId: serverAttrs.node,
        nodeName: nodeNameMap.get(serverAttrs.node) || "Unknown",
        state: serverAttrs.suspended ? "suspended" : "active",
        eggName,
        nestName: nestNameMap.get(serverAttrs.nest) || "Unknown",
        backupSlots: serverAttrs.feature_limits?.backups ?? 0,
        currentBackups: serverAttrs.backups ?? 0,
        // Default counts — enriched below if clientApiKey is available
        databases: 0,
        schedules: 0,
        subusers: 0,
        hasAllocation: !!serverAttrs.allocation,
        memory: serverAttrs.limits?.memory || 0,
        disk: serverAttrs.limits?.disk || 0,
        cpu: serverAttrs.limits?.cpu || 0,
        suspended: !!serverAttrs.suspended,
      };
    });

    // Enrich servers with per-server counts using Client API (if key provided)
    if (this.clientApiKey) {
      const BATCH_SIZE = 5;
      for (let i = 0; i < serversList.length; i += BATCH_SIZE) {
        const batch = serversList.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (server) => {
          try {
            const [schedRes, userRes, dbRes] = await Promise.allSettled([
              this.listAll<any>(`/api/client/servers/${server.uuid}/schedules`, undefined, this.clientApiKey ?? undefined),
              this.listAll<any>(`/api/client/servers/${server.uuid}/users`, undefined, this.clientApiKey ?? undefined),
              this.listAll<any>(`/api/application/servers/${server.id}/databases`),
            ]);
            if (schedRes.status === 'fulfilled') server.schedules = schedRes.value.length;
            if (userRes.status === 'fulfilled') server.subusers = userRes.value.length;
            if (dbRes.status === 'fulfilled') server.databases = dbRes.value.length;
          } catch {
            // Skip enrichment for this server
          }
        }));
      }
    }

    return {
      locations: locations.length,
      nodes: nodes.length,
      nests: nests.length,
      users: users.length,
      servers: servers.length,
      nodesList,
      serversList,
    };
  }

  /** List all locations */
  async listLocations(): Promise<PterodactylResource<PterodactylLocation>[]> {
    return this.listAll<PterodactylLocation>("/api/application/locations");
  }

  /** List all nodes */
  async listNodes(): Promise<PterodactylResource<PterodactylNode>[]> {
    return this.listAll<PterodactylNode>("/api/application/nodes");
  }

  /** List all nests */
  async listNests(): Promise<PterodactylResource<PterodactylNest>[]> {
    return this.listAll<PterodactylNest>("/api/application/nests");
  }

  /** List eggs for a nest */
  async listEggs(nestId: number): Promise<PterodactylResource<PterodactylEgg>[]> {
    return this.listAll<PterodactylEgg>(
      `/api/application/nests/${nestId}/eggs`,
      { include: "variables" }
    );
  }

  /** Get a single egg with variables */
  async getEgg(nestId: number, eggId: number): Promise<PterodactylEgg> {
    const response = await this.request<
      PterodactylSingleResponse<PterodactylEgg>
    >({ path: `/api/application/nests/${nestId}/eggs/${eggId}?include=variables` });
    return response.attributes;
  }

  /** List all users */
  async listUsers(): Promise<PterodactylResource<PterodactylUser>[]> {
    return this.listAll<PterodactylUser>("/api/application/users");
  }

  /** List all servers.
   *  Note: In Pterodactyl v1.x, the `include` parameter may not populate relationships.
   *  Use `getServer()` for full details with relationships.
   */
  async listServers(): Promise<PterodactylResource<PterodactylServer>[]> {
    return this.listAll<PterodactylServer>("/api/application/servers");
  }

  /** Get a single server with full details.
   *  Note: In Pterodactyl v1.x, relationships via `include` may not work.
   *  The returned attributes contain `node`, `nest`, `egg`, `user` (numeric IDs)
   *  and `allocation` (primary allocation object). Additional allocations must
   *  be fetched via `getNodeAllocations(nodeId)`.
   */
  async getServer(serverId: number): Promise<PterodactylServer> {
    const response = await this.request<
      PterodactylSingleResponse<PterodactylServer>
    >({ path: `/api/application/servers/${serverId}` });
    return response.attributes;
  }

  /**
   * Update a server's build settings including feature limits.
   * In Pterodactyl v1.x, this uses the /build endpoint which requires all fields.
   * We first fetch the current server state to avoid overwriting other fields.
   */
  async updateServerFeatureLimits(
    serverId: number,
    limits: { backups?: number; databases?: number; allocations?: number }
  ): Promise<void> {
    // Fetch current server state to get all required fields for the /build endpoint
    const server = await this.getServer(serverId);
    const body = Buffer.from(JSON.stringify({
      allocation: typeof server.allocation === 'number' ? server.allocation : (server.allocation as any)?.id || server.allocation,
      memory: server.limits?.memory || 1024,
      swap: server.limits?.swap || 0,
      disk: server.limits?.disk || 10240,
      io: server.limits?.io || 500,
      cpu: server.limits?.cpu || 0,
      feature_limits: {
        databases: server.feature_limits?.databases ?? 0,
        allocations: server.feature_limits?.allocations ?? 0,
        backups: server.feature_limits?.backups ?? 0,
        ...limits,
      },
    }));
    await this.request<PterodactylSingleResponse<PterodactylServer>>({
      path: `/api/application/servers/${serverId}/build`,
      method: "PATCH",
      body,
    });
  }

  /** Get server databases (application API) */
  async getServerDatabases(
    serverId: number
  ): Promise<PterodactylResource<PterodactylDatabase>[]> {
    return this.listAll<PterodactylDatabase>(
      `/api/application/servers/${serverId}/databases`
    );
  }

  /** Get allocations for a node (application API).
   *  Used to find additional port allocations for servers. */
  async getNodeAllocations(
    nodeId: number
  ): Promise<PterodactylResource<PterodactylAllocation>[]> {
    return this.listAll<PterodactylAllocation>(
      `/api/application/nodes/${nodeId}/allocations`
    );
  }

  // ========================================================================
  // CLIENT API METHODS (require ptlc_* token)
  // In Pterodactyl v1.x, backups, schedules, and subusers are only
  // accessible via the client API, which uses server UUIDs (not numeric IDs).
  // ========================================================================

  /**
   * Make a client API request using the client API key.
   * The client API uses the same panel host but different auth and UUID-based paths.
   */
  private async clientApiRequest<T>(pathOrOpts: string | RequestOptions): Promise<T> {
    if (!this.clientApiKey) {
      throw new PterodactylClientError(
        "NO_CLIENT_KEY",
        "Client API key is required for this operation. Provide a ptlc_* key in the migration config."
      );
    }
    const opts = typeof pathOrOpts === 'string' ? { path: pathOrOpts } : pathOrOpts;
    return this.request<T>({
      ...opts,
      authKey: this.clientApiKey,
    });
  }

  /** Get server schedules via client API (uses server UUID). */
  async getServerSchedules(
    serverUuid: string
  ): Promise<PterodactylResource<PterodactylSchedule>[]> {
    return this.listAll<PterodactylSchedule>(
      `/api/client/servers/${serverUuid}/schedules`,
      { include: "tasks" },
      this.clientApiKey ?? undefined
    );
  }

  /** Get server backups via client API (uses server UUID). */
  async getServerBackups(
    serverUuid: string
  ): Promise<PterodactylResource<PterodactylBackup>[]> {
    return this.listAll<PterodactylBackup>(
      `/api/client/servers/${serverUuid}/backups`,
      undefined,
      this.clientApiKey ?? undefined
    );
  }

  /** Trigger a backup creation on a Pterodactyl server via client API.
   *  Returns the backup resource once the API request is accepted.
   *  The backup is created asynchronously — use pollBackupCompleted to wait.
   */
  async createBackup(
    serverUuid: string,
    opts?: { name?: string; ignoredFiles?: string }
  ): Promise<PterodactylResource<PterodactylBackup>> {
    const body = Buffer.from(JSON.stringify({
      name: opts?.name || `catalyst_migration_${Date.now()}`,
      ignored_files: opts?.ignoredFiles || "",
    }));
    return this.clientApiRequest<PterodactylSingleResponse<PterodactylBackup>>({
      path: `/api/client/servers/${serverUuid}/backups`,
      method: "POST",
      body,
    });
  }

  /** Poll until a specific backup is completed.
   *  Uses client API with server UUID.
   *  Returns the completed backup attributes, or throws on timeout.
   */
  async pollBackupCompleted(
    serverUuid: string,
    backupUuid: string,
    timeoutMs: number = 300000,
    intervalMs: number = 3000
  ): Promise<PterodactylBackup> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const backups = await this.getServerBackups(serverUuid);
        const backup = backups.find(b => b.attributes.uuid === backupUuid);
        if (backup?.attributes.is_successful || backup?.attributes.completed_at) {
          return backup.attributes;
        }
      } catch (err: any) {
        if (err.code === "NOT_FOUND") throw err;
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new PterodactylClientError(
      "TIMEOUT",
      `Backup ${backupUuid} did not complete within ${timeoutMs / 1000}s`
    );
  }

  /**
   * Download a backup archive.
   * In Pterodactyl v1.x, the client API returns a signed URL that points
   * to the Wings daemon. We fetch the signed URL, then download from it.
   * Returns a readable stream for the backup tar/zip data.
   */
  async downloadBackup(
    serverUuid: string,
    backupUuid: string
  ): Promise<Readable> {
    if (!this.clientApiKey) {
      throw new PterodactylClientError(
        "NO_CLIENT_KEY",
        "Client API key is required for backup download."
      );
    }

    // Step 1: Get the signed download URL from the client API
    const signedResponse = await this.clientApiRequest<{
      object: string;
      attributes: { url: string };
    }>(`/api/client/servers/${serverUuid}/backups/${backupUuid}/download`);

    const downloadUrl = signedResponse.attributes.url;

    // Step 2: Download from the signed URL (points to Wings daemon)
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(downloadUrl);
      const isHttps = parsedUrl.protocol === "https:";
      const transport = isHttps ? https : http;

      const req = transport.request(
        {
          hostname: parsedUrl.hostname,
          port: parseInt(parsedUrl.port || (isHttps ? "443" : "80"), 10),
          path: parsedUrl.pathname + parsedUrl.search,
          method: "GET",
          headers: {
            accept: "*/*",
            "user-agent": "Catalyst-Migration/1.0",
            host: parsedUrl.host,
          },
        },
        (res) => {
          const status = res.statusCode || 0;
          if (status >= 200 && status < 300) {
            resolve(res as unknown as Readable);
          } else {
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => chunks.push(chunk));
            res.on("end", () => {
              const body = Buffer.concat(chunks).toString();
              reject(
                new PterodactylClientError(
                  "DOWNLOAD_FAILED",
                  `Backup download failed: HTTP ${status} - ${body}`,
                  status
                )
              );
            });
          }
        }
      );

      const timeout = setTimeout(() => {
        req.destroy(new Error("Backup download timeout (300s)"));
        reject(new PterodactylClientError("TIMEOUT", "Backup download timeout after 300000ms"));
      }, 300000);

      req.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(new PterodactylClientError("DOWNLOAD_ERROR", err.message));
      });
      req.end();
    });
  }

  /** Get server subusers via client API (uses server UUID). */
  async getServerSubusers(
    serverUuid: string
  ): Promise<PterodactylResource<PterodactylSubuser>[]> {
    try {
      return await this.listAll<PterodactylSubuser>(
        `/api/client/servers/${serverUuid}/users`,
        undefined,
        this.clientApiKey ?? undefined
      );
    } catch {
      return [];
    }
  }

  /** List database hosts (application API).
   *  Note: Removed in Pterodactyl v1.x — returns empty array.
   *  Database host info is embedded in per-server database responses.
   */
  async getDatabaseHosts(): Promise<PterodactylResource<PterodactylDatabaseHost>[]> {
    try {
      return await this.listAll<PterodactylDatabaseHost>(
        "/api/application/database-hosts"
      );
    } catch (err: any) {
      if (err.statusCode === 404 || err.code === "NOT_FOUND") {
        return [];
      }
      throw err;
    }
  }
}
