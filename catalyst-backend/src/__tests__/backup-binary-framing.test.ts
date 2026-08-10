/**
 * Regression: binary backup frames must carry the FULL requestId
 * (length-prefixed), not a truncated 16-byte UUID prefix.
 */
import { describe, it, expect } from "vitest";
import { encodeBackupBinaryHeader } from "../services/backup-storage";

describe("encodeBackupBinaryHeader — length-prefixed full requestId", () => {
  it("encodes a full UUID with 2-byte BE length prefix", () => {
    const id = "abcdef01-2345-6789-abcd-ef0123456789";
    const header = encodeBackupBinaryHeader(id);
    expect(header.readUInt16BE(0)).toBe(Buffer.byteLength(id, "utf-8"));
    expect(header.subarray(2).toString("utf-8")).toBe(id);
    // Must not be the legacy fixed 16-byte form
    expect(header.length).toBe(2 + id.length);
    expect(header.length).toBeGreaterThan(18);
  });

  it("rejects empty requestId", () => {
    expect(() => encodeBackupBinaryHeader("")).toThrow(/Invalid backup requestId length/);
  });

  it("round-trips with agent-compatible layout", () => {
    const id = crypto.randomUUID();
    const payload = Buffer.from("TARDATA");
    const header = encodeBackupBinaryHeader(id);
    const frame = Buffer.concat([header, payload]);

    const idLen = frame.readUInt16BE(0);
    const parsedId = frame.subarray(2, 2 + idLen).toString("utf-8");
    const parsedPayload = frame.subarray(2 + idLen);
    expect(parsedId).toBe(id);
    expect(Buffer.compare(parsedPayload, payload)).toBe(0);
  });
});
