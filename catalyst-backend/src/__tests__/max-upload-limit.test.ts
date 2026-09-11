import { describe, it, expect } from "vitest";
import {
  DEFAULT_SECURITY_SETTINGS,
  MAX_UPLOAD_MB_CEILING,
  maxUploadBytesFromMb,
  sanitizeMaxUploadMb,
} from "../services/mailer";
import { MAX_UPLOAD_TRANSFER_MS, uploadTransferTimeoutMs } from "../services/file-tunnel";

describe("sanitizeMaxUploadMb", () => {
  it("defaults invalid values to the panel default", () => {
    expect(sanitizeMaxUploadMb(undefined)).toBe(DEFAULT_SECURITY_SETTINGS.fileTunnelMaxUploadMb);
    expect(sanitizeMaxUploadMb(0)).toBe(DEFAULT_SECURITY_SETTINGS.fileTunnelMaxUploadMb);
    expect(sanitizeMaxUploadMb(-10)).toBe(DEFAULT_SECURITY_SETTINGS.fileTunnelMaxUploadMb);
  });

  it("clamps to the agent's 10GiB operator ceiling", () => {
    expect(MAX_UPLOAD_MB_CEILING).toBe(10 * 1024);
    expect(sanitizeMaxUploadMb(MAX_UPLOAD_MB_CEILING + 100)).toBe(MAX_UPLOAD_MB_CEILING);
    expect(maxUploadBytesFromMb(MAX_UPLOAD_MB_CEILING)).toBe(10 * 1024 * 1024 * 1024);
  });

  it("accepts a 10GiB panel setting", () => {
    expect(sanitizeMaxUploadMb(10240)).toBe(10240);
  });
});

describe("uploadTransferTimeoutMs", () => {
  it("keeps tiny files near the 60s floor", () => {
    expect(uploadTransferTimeoutMs(1024)).toBeGreaterThanOrEqual(60_000);
    expect(uploadTransferTimeoutMs(1024)).toBeLessThan(120_000);
  });

  it("keeps the largest allowed upload under the 8h cap", () => {
    const timeout = uploadTransferTimeoutMs(MAX_UPLOAD_MB_CEILING * 1024 * 1024);
    expect(timeout).toBeGreaterThan(60_000);
    expect(timeout).toBeLessThan(MAX_UPLOAD_TRANSFER_MS);
  });

  it("clamps oversized inputs to the 8h cap", () => {
    expect(uploadTransferTimeoutMs(MAX_UPLOAD_MB_CEILING * 8 * 1024 * 1024)).toBe(MAX_UPLOAD_TRANSFER_MS);
  });
});
