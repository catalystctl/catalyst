/**
 * Regression tests for the SEC-M hardening wave.
 *
 * Each finding gets at least one behavioral or static-contract test:
 * node binding (1), bulk 403 (2), deploy header auth (3), SSE revoke (5),
 * SFTP revoke (6), DB scope (6), encrypt fail-closed (7), redaction (8),
 * lockout IP isolation (9), revoke immediate (9), outbox drop (9),
 * salt uniqueness (10).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SEC-M-08 central redaction", () => {
  it("redacts tokens, secrets, DATABASE_URL, Authorization/Cookie", async () => {
    const { redactSecrets, capMetadata, redactUrlForLog } = await import(
      "../lib/secret-redaction.js"
    );
    const out = redactSecrets({
      apiKey: "catalyst_abc123",
      nested: { DATABASE_URL: "postgres://u:p@h/db" },
      headers: { Authorization: "Bearer xyz", Cookie: "session=1" },
      BACKUP_S3_SECRET_KEY: "shh",
      ok: "visible",
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).DATABASE_URL).toBe("[REDACTED]");
    expect((out.headers as Record<string, unknown>).Authorization).toBe("[REDACTED]");
    expect((out.headers as Record<string, unknown>).Cookie).toBe("[REDACTED]");
    expect(out.BACKUP_S3_SECRET_KEY).toBe("[REDACTED]");
    expect(out.ok).toBe("visible");
    expect(redactUrlForLog("/api/deploy/abc?apiKey=catalyst_x")).toBe("/api/deploy/abc");
    const capped = capMetadata({ a: "x".repeat(9000) }) as Record<string, unknown>;
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(4096 + 64);
  });
});

describe("SEC-M-07 encrypt fail-closed", () => {
  it("throws in all envs without a key unless ALLOW_PLAINTEXT_CREDS=1", async () => {
    vi.stubEnv("ALLOW_PLAINTEXT_CREDS", "");
    delete process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY;
    for (const env of ["test", "development", "production"]) {
      vi.stubEnv("NODE_ENV", env);
      const { encryptSecretValue } = await import("../services/backup-credentials.js");
      expect(() => encryptSecretValue("s3-secret")).toThrow();
      vi.resetModules();
    }
  });

  it("ALLOW_PLAINTEXT_CREDS=1 is refused in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_PLAINTEXT_CREDS", "1");
    delete process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY;
    const { encryptSecretValue } = await import("../services/backup-credentials.js");
    expect(() => encryptSecretValue("s3-secret")).toThrow(/ALLOW_PLAINTEXT/);
  });

  it("encrypts with a valid key", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ALLOW_PLAINTEXT_CREDS", "");
    vi.stubEnv(
      "BACKUP_CREDENTIALS_ENCRYPTION_KEY",
      Buffer.alloc(32, 9).toString("base64"),
    );
    const { encryptSecretValue, decryptSecretValue } = await import(
      "../services/backup-credentials.js"
    );
    const enc = encryptSecretValue("s3-secret") as string;
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptSecretValue(enc)).toBe("s3-secret");
  });
});

describe("SEC-M-10 API-key salt", () => {
  it("mints unique salts and verifies with the stored salt", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("API_KEY_SECRET", "test-secret-for-salts");
    delete process.env.BETTER_AUTH_SECRET;
    const { hashApiKey, newApiKeySalt } = await import("../services/api-key-service.js");
    const s1 = newApiKeySalt();
    const s2 = newApiKeySalt();
    expect(s1).not.toBe(s2);
    expect(s1).toMatch(/^[a-f0-9]{32}$/);
    const h1 = hashApiKey("catalyst_samekey", s1);
    const h2 = hashApiKey("catalyst_samekey", s2);
    expect(h1).not.toBe(h2);
    expect(hashApiKey("catalyst_samekey", s1)).toBe(h1);
  });

  it("requires a dedicated API_KEY_SECRET in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("API_KEY_SECRET", "");
    vi.stubEnv("BETTER_AUTH_SECRET", "fallback-should-not-work");
    const { resolveApiKeySecret } = await import("../services/api-key-service.js");
    expect(() => resolveApiKeySecret()).toThrow(/API_KEY_SECRET.*production/);
  });

  it("gates legacy hashes behind ALLOW_LEGACY_API_KEY_HASH", async () => {
    const { isLegacyHashAllowed } = await import("../services/api-key-service.js");
    vi.stubEnv("ALLOW_LEGACY_API_KEY_HASH", "");
    expect(isLegacyHashAllowed()).toBe(false);
    vi.stubEnv("ALLOW_LEGACY_API_KEY_HASH", "1");
    const { isLegacyHashAllowed: allowed } = await import("../services/api-key-service.js");
    expect(allowed()).toBe(true);
  });
});

describe("SEC-M-06 SFTP tokens", () => {
  it("defaults to a short TTL and clamps the max to 24h", async () => {
    const { resolveSftpTtl, SFTP_TTL_OPTIONS } = await import(
      "../services/sftp-token-manager.js"
    );
    expect(resolveSftpTtl(undefined)).toBe(15 * 60 * 1000);
    expect(resolveSftpTtl(365 * 24 * 3600 * 1000)).toBe(24 * 3600 * 1000);
    expect(Math.max(...SFTP_TTL_OPTIONS.map((o) => o.value))).toBeLessThanOrEqual(
      24 * 3600 * 1000,
    );
  });

  it("heartbeat revalidation fails closed on ban and revokes the token", async () => {
    const manager = await import("../services/sftp-token-manager.js");
    const minted = manager.generateSftpToken("user-1", "server-1");
    expect(minted.token.startsWith("sftp_")).toBe(true);
    const { prisma } = await import("../db.js");
    const spy = vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      banned: true,
      lockedUntil: null,
    } as never);
    const ok = await manager.revalidateSftpSession("user-1", "server-1");
    expect(ok).toBe(false);
    spy.mockRestore();
  });
});

describe("SEC-M-09 agent lockout IP isolation", () => {
  it("locks out the offending IP only, not other IPs on the same node", async () => {
    const { WebSocketGateway } = await import("../websocket/gateway.js");
    const prisma = {} as never;
    const logger = {
      child: () => logger,
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as never;
    const gw = new WebSocketGateway(prisma, logger) as unknown as {
      recordAgentAuthFailure: (node: string, ip?: string) => number;
      checkAgentLockout: (node: string, ip?: string) => { locked: boolean };
      clearAgentAuthFailures: (node: string, ip?: string) => void;
    };
    gw.recordAgentAuthFailure("node-1", "10.0.0.9");
    expect(gw.checkAgentLockout("node-1", "10.0.0.9").locked).toBe(true);
    expect(gw.checkAgentLockout("node-1", "10.0.0.10").locked).toBe(false);
    expect(gw.checkAgentLockout("node-1").locked).toBe(false);
    gw.clearAgentAuthFailures("node-1", "10.0.0.9");
    expect(gw.checkAgentLockout("node-1", "10.0.0.9").locked).toBe(false);
    (gw as unknown as { destroy: () => void }).destroy?.();
  });
});

describe("SEC-M contracts (static)", () => {
  async function readSrc(path: string) {
    // Resolve relative to this test file (import.meta.url) so the suite
    // passes regardless of the process CWD (root vs catalyst-backend).
    const fs = await import("fs");
    return fs.promises.readFile(
      new URL(`../${path}`, import.meta.url),
      "utf8",
    );
  }

  it("SEC-M-01 SFTP validate-token binds server.nodeId to the header node", async () => {
    const src = await readSrc("index.ts");
    expect(src).toContain("sftpvServer.nodeId !== headerNodeId");
    expect(src).toContain("SFTP validate-token node mismatch");
  });

  it("SEC-M-02 admin bulk uses decideServerAccess (no bare hasNodeAccess grant)", async () => {
    const src = await readSrc("routes/admin.ts");
    const bulkIdx = src.indexOf("/servers/actions");
    expect(bulkIdx).toBeGreaterThan(-1);
    const bulkBlock = src.slice(bulkIdx, bulkIdx + 4000);
    expect(bulkBlock).toContain("decideServerAccess");
    expect(bulkBlock).toContain("requiredPermission");
  });

  it("SEC-M-03 deploy takes the key from Authorization, refuses ?apiKey=", async () => {
    const src = await readSrc("index.ts");
    const deployIdx = src.indexOf("/api/deploy/:token");
    expect(deployIdx).toBeGreaterThan(-1);
    const block = src.slice(deployIdx, deployIdx + 4000);
    expect(block).toContain("bearerKey");
    expect(block).toContain("apiKey in query string");
    // Script template (same file): key via 0600 file, never argv/query.
    expect(src).toContain("CATALYST_API_KEY_FILE");
    expect(src).toContain("chmod 600");
  });

  it("SEC-M-04 ws query ?token= deprecated, TRUST_PROXY defaults false, WS caps", async () => {
    const indexSrc = await readSrc("index.ts");
    expect(indexSrc).toContain("TRUST_PROXY");
    expect(indexSrc).toContain("defaults FALSE");
    expect(indexSrc).toContain("perMessageDeflate");
    expect(indexSrc).toContain("idleTimeout");
    expect(indexSrc).toContain("sock:");
    const gwSrc = await readSrc("websocket/gateway.ts");
    expect(gwSrc).toContain("?token= is deprecated");
  });

  it("SEC-M-04 cookies are Secure/HttpOnly/SameSite=Lax with https enforced", async () => {
    const src = await readSrc("auth.ts");
    expect(src).toContain("FRONTEND_URL must use https");
    expect(src).toContain("sameSite: 'lax'");
    expect(src).toContain("secure: process.env.NODE_ENV === 'production'");
    expect(src).toContain("httpOnly: true");
  });

  it("SEC-M-05 SSE stores userId and checks the allowlist on emit", async () => {
    const gwSrc = await readSrc("websocket/gateway.ts");
    expect(gwSrc).toContain("userId?: string");
    expect(gwSrc).toContain("Per-emit allowlist");
    expect(gwSrc).toContain("pruneServerSubscriptions");
    expect(gwSrc).toContain("bypassCache");
  });

  it("SEC-M-06 DB usernames are srv_-prefixed, passwords encrypted, host verified", async () => {
    const src = await readSrc("routes/servers/databases.ts");
    expect(src).toContain("srv_${shortServer}_");
    expect(src).toContain("encryptSecretValue");
    expect(src).toContain("Database host mismatch");
    expect(src).toContain("One-time display");
  });

  it("SEC-M-09 revoke closes sockets + fails pending; outbox stamps grants", async () => {
    const gwSrc = await readSrc("websocket/gateway.ts");
    expect(gwSrc).toContain("closeAgentConnections");
    expect(gwSrc).toContain("failPendingRequestsForNodePublic");
    expect(gwSrc).toContain("grantVersion");
    expect(gwSrc).toContain("Outbox entry dropped: grant changed");
    expect(gwSrc).toContain("Outbox entry expired without drain");
    const keySrc = await readSrc("services/api-key-service.ts");
    expect(keySrc).toContain("closeAgentConnections");
  });
});
