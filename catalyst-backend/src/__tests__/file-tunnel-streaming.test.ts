import { describe, expect, it, vi, afterEach } from "vitest";
import { Readable } from "node:stream";
import { promises as fs } from "node:fs";
import path from "node:path";
import { FileTunnelService } from "../services/file-tunnel";

vi.mock("../services/mailer", () => ({
  getSecuritySettings: vi.fn(async () => ({
    fileTunnelMaxPendingPerNode: 100,
    fileTunnelMaxUploadMb: 10,
  })),
}));

vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../services/error-logger", () => ({ captureSystemError: vi.fn(async () => {}) }));

const logger = {
  child: () => logger,
  error: vi.fn(),
  warn: vi.fn(),
} as any;

async function queue(service: FileTunnelService, nodeId = "node-1") {
  const response = service.queueRequest(nodeId, "download", "server-1", "/file");
  const requests = await service.pollRequests(nodeId);
  expect(requests).toHaveLength(1);
  return { response, requestId: requests[0].requestId };
}

async function exists(filePath: string) {
  return fs.access(filePath).then(() => true).catch(() => false);
}

describe("FileTunnelService staged response streams", () => {
  let service: FileTunnelService;

  afterEach(() => {
    service?.destroy();
  });

  it("stages a response without retaining bytes, returns a readable stream, and removes it on close", async () => {
    service = new FileTunnelService(logger);
    const { response, requestId } = await queue(service);
    const source = Readable.from([Buffer.from("hello "), Buffer.from("stream")]);

    expect(await service.stageResponseStream(requestId, "node-1", source, 100, {
      success: true,
      contentType: "text/plain",
    })).toBe(true);

    const result = await response;
    expect(result.body).toBeUndefined();
    expect(result.bodySize).toBe(12);
    expect(result.stream).toBeDefined();
    expect(await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      result.stream!.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      result.stream!.on("error", reject);
      result.stream!.on("end", () => resolve(Buffer.concat(chunks).toString()));
    })).toBe("hello stream");

    await new Promise<void>((resolve) => result.stream!.once("close", resolve));
    const stagedPath = path.join("/tmp", "catalyst-uploads", `response-${requestId}.bin`);
    expect(await exists(stagedPath)).toBe(false);
  });

  it("destroys the source, cleans the partial file, and rejects when the size limit is exceeded", async () => {
    service = new FileTunnelService(logger);
    await fs.mkdir(path.join("/tmp", "catalyst-uploads"), { recursive: true });
    const { response, requestId } = await queue(service);
    const source = Readable.from([Buffer.alloc(4), Buffer.alloc(4)]);
    const destroy = vi.spyOn(source, "destroy");

    expect(await service.stageResponseStream(requestId, "node-1", source, 4, { success: true })).toBe(false);
    await expect(response).rejects.toThrow("exceeds maximum size");
    expect(destroy).toHaveBeenCalled();
    expect(await exists(path.join("/tmp", "catalyst-uploads", `response-${requestId}.bin`))).toBe(false);
    expect(service.getPendingCount("node-1")).toBe(0);
  });

  it("destroys an unsolicited source instead of staging it", async () => {
    service = new FileTunnelService(logger);
    const source = Readable.from([Buffer.from("orphan")]);
    const destroy = vi.spyOn(source, "destroy");

    expect(await service.stageResponseStream("missing", "node-1", source, 100, { success: true })).toBe(false);
    expect(destroy).toHaveBeenCalled();
  });
});
