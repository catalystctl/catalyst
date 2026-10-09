import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { Readable } from "node:stream";
import path from "node:path";

const state = vi.hoisted(() => ({
  result: null as any,
  queueRequest: vi.fn(),
}));

vi.mock("../db.js", () => ({
  prisma: {
    node: { findUnique: vi.fn(async () => ({ isOnline: true, name: "node-1" })) },
  },
}));

vi.mock("../routes/servers/_helpers.js", () => ({
  Actor: {},
  captureSystemError: vi.fn(),
  ensureServerAccess: vi.fn(async () => ({
    id: "server-1",
    uuid: "uuid-1",
    nodeId: "node-1",
    status: "running",
  })),
  fileRateLimitMax: 100,
  fileRateLimitWindowMs: "1 minute",
  isArchiveName: vi.fn(() => true),
  path,
  validateAndNormalizePath: vi.fn((value: string) => value),
}));

vi.mock("../services/mailer.js", () => ({
  getSecuritySettings: vi.fn(async () => ({ fileTunnelMaxUploadMb: 10 })),
  MAX_UPLOAD_MB_CEILING: 10 * 1024,
  maxUploadBytesFromMb: vi.fn((mb: number) => mb * 1024 * 1024),
}));

vi.mock("../lib/http-error.js", () => ({
  apiError: (reply: any, status: number, _code: string, message: string) =>
    reply.status(status).send({ error: message }),
}));

vi.mock("../shared-types.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared-types.js")>()),
  ErrorCodes: {},
}));

function buildApp() {
  vi.resetModules();
  const app = Fastify({ logger: false });
  const stream = Readable.from([Buffer.from("backup "), Buffer.from("archive")]);
  const consumed = new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
    stream.on("error", reject);
  });
  state.result = {
    success: true,
    contentType: "application/x-backup",
    stream,
  };
  state.queueRequest.mockReset().mockResolvedValue(state.result);
  app.decorate("authenticate", async (request: any) => {
    request.user = { userId: "user-1", permissions: ["file.read"] };
  });
  app.decorate("fileTunnel", {
    queueRequest: state.queueRequest,
    isNodeConnected: () => true,
    createStagingPath: () => "/tmp/unused",
  });
  return import("../routes/servers/files").then(({ serverFilesRoutes }) => {
    app.register(serverFilesRoutes, { prefix: "/api/servers" });
    return { app, consumed };
  });
}

describe("server file download streamed tunnel responses", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("consumes result.stream and returns its bytes instead of reporting missing file data", async () => {
    const { app, consumed } = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/servers/server-1/files/download?path=%2Fbackup.tar.gz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-backup");
    expect(await consumed).toBe("backup archive");
    expect(state.queueRequest).toHaveBeenCalledWith(
      "node-1",
      "download",
      "uuid-1",
      "/backup.tar.gz",
      undefined,
      undefined,
    );
    await app.close();
  });

  it("still reports an error when the successful tunnel result has neither body nor stream", async () => {
    const { app } = await buildApp();
    state.queueRequest.mockResolvedValue({ success: true });

    const response = await app.inject({
      method: "GET",
      url: "/api/servers/server-1/files/download?path=%2Fmissing.tar.gz",
    });

    expect(response.statusCode).toBe(500);
    await app.close();
  });
});
