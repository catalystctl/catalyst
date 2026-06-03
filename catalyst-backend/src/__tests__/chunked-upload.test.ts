/**
Unit tests for the chunked-upload service (issue #135).
These tests verify session lifecycle, chunk assembly, sizing limits,
and resumed upload scenarios without requiring a database or a real file tunnel.
*/

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { Readable } from "stream";
import { ChunkedUploadService, ChunkedUploadError } from "../services/chunked-upload";
import type { FileTunnelService } from "../services/file-tunnel";
import pino from "pino";

// Mock getSecuritySettings so tests don't need a database
vi.mock("../services/mailer", () => ({
  getSecuritySettings: vi.fn(async () => ({
    chunkedUploadMaxFileMb: 100,
    chunkedUploadChunkMb: 1,
    chunkedUploadSessionTtlMs: 60_000,
  })),
}));

const logger = pino({ level: "silent" });

describe("ChunkedUploadService", () => {
  let service: ChunkedUploadService;
  let mockTunnel: FileTunnelService;

  beforeEach(() => {
    mockTunnel = {
      queueRequest: async () => ({
        requestId: randomUUID(),
        success: true,
      }),
    } as unknown as FileTunnelService;
    service = new ChunkedUploadService(logger, mockTunnel);
  });

  afterEach(() => {
    service.destroy();
  });

  it("creates a session and returns upload metadata", async () => {
    const result = await service.init({
      userId: "user-1",
      serverId: "server-1",
      serverUuid: "uuid-1",
      nodeId: "node-1",
      targetDir: "/mods",
      filename: "plugin.jar",
      totalSize: 1024,
    });
    expect(result.uploadId).toBeTruthy();
    expect(result.chunkSize).toBeGreaterThan(0);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it("writes a chunk and updates status", async () => {
    const { uploadId } = await service.init({
      userId: "user-1",
      serverId: "server-1",
      serverUuid: "uuid-1",
      nodeId: "node-1",
      targetDir: "/mods",
      filename: "plugin.jar",
      totalSize: 10,
    });

    const buf = Buffer.from("0123456789");
    await service.writeChunk(uploadId, "user-1", "server-1", 0, buf);

    const status = service.getStatus(uploadId, "user-1", "server-1")!;
    expect(status.totalChunks).toBe(1);
    expect(status.receivedChunks).toEqual([0]);
    expect(status.receivedBytes).toBe(10);
    expect(status.status).toBe("uploading");
  });

  it("throws on duplicate chunk index", async () => {
    const { uploadId } = await service.init({
      userId: "user-1",
      serverId: "server-1",
      serverUuid: "uuid-1",
      nodeId: "node-1",
      targetDir: "/mods",
      filename: "plugin.jar",
      totalSize: 10,
    });

    await service.writeChunk(uploadId, "user-1", "server-1", 0, Buffer.from("0123456789"));
    await expect(
      service.writeChunk(uploadId, "user-1", "server-1", 0, Buffer.from("0123456789")),
    ).rejects.toBeInstanceOf(ChunkedUploadError);
  });

  it("throws 404 when user does not own the session", async () => {
    const { uploadId } = await service.init({
      userId: "user-1",
      serverId: "server-1",
      serverUuid: "uuid-1",
      nodeId: "node-1",
      targetDir: "/mods",
      filename: "plugin.jar",
      totalSize: 10,
    });

    await expect(
      service.writeChunk(uploadId, "user-2", "server-1", 0, Buffer.from("0123456789")),
    ).rejects.toBeInstanceOf(ChunkedUploadError);
  });

  it("completes a single-chunk upload", async () => {
    const { uploadId } = await service.init({
      userId: "user-1",
      serverId: "server-1",
      serverUuid: "uuid-1",
      nodeId: "node-1",
      targetDir: "/mods",
      filename: "plugin.jar",
      totalSize: 10,
    });

    await service.writeChunk(uploadId, "user-1", "server-1", 0, Buffer.from("0123456789"));
    const result = await service.complete(uploadId, "user-1", "server-1");
    expect(result.path).toBe("/mods/plugin.jar");
    expect(result.size).toBe(10);
  });

  it("assembles multiple chunks in order", async () => {
    // Use 3 MB total split into 3 chunks of 1 MB so chunk-size validation
    // (1 MB minimum) and the multi-chunk assembly path are both exercised.
    const chunkSize = 1 * 1024 * 1024;
    const totalSize = 3 * chunkSize;
    const { uploadId } = await service.init({
      userId: "user-1",
      serverId: "server-1",
      serverUuid: "uuid-1",
      nodeId: "node-1",
      targetDir: "/mods",
      filename: "plugin.jar",
      totalSize,
      chunkSize,
    });

    for (let i = 0; i < 3; i++) {
      const buf = Buffer.alloc(chunkSize, i + 0x30); // 0x30, 0x31, 0x32
      await service.writeChunk(uploadId, "user-1", "server-1", i, buf);
    }

    const status = service.getStatus(uploadId, "user-1", "server-1")!;
    expect(status.receivedChunks).toEqual([0, 1, 2]);

    const result = await service.complete(uploadId, "user-1", "server-1");
    expect(result.size).toBe(totalSize);
  });

  it("cancels an in-progress session and cleans up disk", async () => {
    const { uploadId } = await service.init({
      userId: "user-1",
      serverId: "server-1",
      serverUuid: "uuid-1",
      nodeId: "node-1",
      targetDir: "/mods",
      filename: "plugin.jar",
      totalSize: 10,
    });

    const sessionDir = path.join((service as any).rootDir, uploadId);
    expect(fs.existsSync(sessionDir)).toBe(true);

    const ok = await service.cancel(uploadId, "user-1", "server-1");
    expect(ok).toBe(true);
    expect(fs.existsSync(sessionDir)).toBe(false);

    const status = service.getStatus(uploadId, "user-1", "server-1");
    expect(status).toBeNull();
  });

  it("garbage-collects stale sessions on cleanup", async () => {
    const { uploadId } = await service.init({
      userId: "user-1",
      serverId: "server-1",
      serverUuid: "uuid-1",
      nodeId: "node-1",
      targetDir: "/mods",
      filename: "plugin.jar",
      totalSize: 10,
    });

    // Force session to be very old
    const session = (service as any).sessions.get(uploadId);
    session.lastActivity = Date.now() - 1000 * 60 * 60 * 3; // 3 hours ago

    const sessionDir = path.join((service as any).rootDir, uploadId);
    expect(fs.existsSync(sessionDir)).toBe(true);

    // Trigger cleanup
    (service as any).cleanup();

    expect((service as any).sessions.has(uploadId)).toBe(false);
  });
});
