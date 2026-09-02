/**
 * Regression tests for wave-3 security fixes (2026-09 audit).
 *
 * 1. Setup wizard re-arm: once setup completed, the wizard must stay closed
 *    even when the last administrator is deleted (flag row in SystemSetting).
 * 2. Placeholder secret boot guard: CHANGE_ME_* secrets must abort startup.
 * 3. Backup credentials: production must refuse to store S3/SFTP secrets
 *    unencrypted when BACKUP_CREDENTIALS_ENCRYPTION_KEY is missing.
 * 4. Nginx must overwrite (not append to) X-Forwarded-For.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("setup wizard completion flag", () => {
  afterEach(() => {
    vi.doUnmock("../db.js");
    vi.doUnmock("../auth.js");
    vi.resetModules();
  });

  it("POST /complete is rejected with 409 once the flag row exists, even with zero admins", async () => {
    vi.resetModules();
    const adminCount = 0; // last admin deleted
    const userCount = 1; // regular users remain
    let flagRowExists = true; // setup completed previously
    const createdUsers: any[] = [];

    vi.doMock("../db.js", () => ({
      prisma: {
        user: {
          count: async (args: any) =>
            args?.where?.roles ? adminCount : userCount,
          findUnique: async () => null,
          create: async (args: any) => {
            createdUsers.push(args);
            return { id: "new-admin" };
          },
        },
        systemSetting: {
          findUnique: async ({ where }: any) =>
            flagRowExists ? { id: where.id, createdAt: new Date() } : null,
          upsert: async ({ where }: any) => {
            flagRowExists = true;
            return { id: where.id };
          },
        },
        role: {
          upsert: async () => ({ id: "role-admin", permissions: ["*"] }),
          findUnique: async () => ({ id: "role-admin" }),
        },
        themeSettings: { upsert: async () => ({}) },
      },
    }));
    vi.doMock("../auth.js", () => ({ auth: { api: {} } }));

    const mod = await import("../routes/setup.js");
    const app = {
      get: () => {},
      post: (_path: string, _opts: any, handler: any) => {
        (app as any).completeHandler = handler;
      },
      log: { warn: () => {}, error: () => {} },
    } as any;
    await mod.setupRoutes(app);

    const reply = {
      status(code: number) {
        (reply as any)._code = code;
        return reply;
      },
      send(body: any) {
        (reply as any)._body = body;
        return reply;
      },
    };
    await app.completeHandler(
      { body: { email: "a@b.c", password: "Str0ngPass!x", username: "attacker", panelName: "p" }, log: { warn: () => {} } },
      reply,
    );
    expect((reply as any)._code).toBe(409);
    expect(createdUsers).toHaveLength(0);
  });
});

describe("placeholder secret boot guard", () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("throws when BETTER_AUTH_SECRET is the public placeholder", async () => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_SECRET =
      "CHANGE_ME_GENERATE_WITH_OPENSSL_RAND_BASE64_32";
    process.env.DATABASE_URL = "postgres://x:y@localhost:5432/z";
    await expect(import("../auth.js")).rejects.toThrow(/placeholder/i);
  });

  it("throws when REDIS_PASSWORD keeps the placeholder", async () => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_SECRET = "a".repeat(43);
    process.env.REDIS_PASSWORD = "CHANGE_ME_REDIS_PASSWORD";
    process.env.DATABASE_URL = "postgres://x:y@localhost:5432/z";
    await expect(import("../auth.js")).rejects.toThrow(/REDIS_PASSWORD/);
  });

  it("accepts real secrets", async () => {
    process.env.NODE_ENV = "production";
    process.env.BETTER_AUTH_SECRET = "a".repeat(43);
    process.env.DATABASE_URL = "postgres://x:y@localhost:5432/z";
    await expect(import("../auth.js")).resolves.toBeTruthy();
  });
});

describe("backup credential encryption fail-closed", () => {
  const ORIGINAL_ENV = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("refuses to encrypt (and store) credentials in production without a key", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY;
    const { encryptBackupConfig } = await import("../services/backup-credentials.js");
    expect(() =>
      encryptBackupConfig({
        endpoint: "https://s3.example.com",
        accessKeyId: "AKIA...",
        secretAccessKey: "supersecret",
      }),
    ).toThrow(/unencrypted/i);
  });

  it("still encrypts when a valid key is configured", async () => {
    process.env.NODE_ENV = "production";
    process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY =
      Buffer.alloc(32, 7).toString("base64");
    const { encryptBackupConfig, decryptBackupConfig } = await import(
      "../services/backup-credentials.js"
    );
    const encrypted = encryptBackupConfig({ secretAccessKey: "supersecret" });
    expect(JSON.stringify(encrypted)).toContain("v1:");
    expect(decryptBackupConfig(encrypted as any)).toEqual({
      secretAccessKey: "supersecret",
    });
  });
});

describe("nginx X-Forwarded-For overwrite (static contract)", () => {
  it("both nginx configs overwrite XFF with $remote_addr instead of appending", async () => {
    const fs = await import("fs");
    const backendConf = await fs.promises.readFile(
      new URL("../../../catalyst-docker/nginx/default.conf", import.meta.url),
      "utf8",
    );
    const frontendConf = await fs.promises.readFile(
      new URL("../../../catalyst-frontend/nginx.conf", import.meta.url),
      "utf8",
    );
    for (const [name, conf] of [
      ["backend", backendConf],
      ["frontend", frontendConf],
    ] as const) {
      expect(conf, name).not.toContain("$proxy_add_x_forwarded_for");
      expect(conf, name).toContain("X-Forwarded-For $remote_addr;");
    }
  });
});
