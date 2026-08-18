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

  it("clamps to the 100GB implementation ceiling", () => {
    expect(MAX_UPLOAD_MB_CEILING).toBe(100 * 1024);
    expect(sanitizeMaxUploadMb(MAX_UPLOAD_MB_CEILING + 100)).toBe(MAX_UPLOAD_MB_CEILING);
    expect(maxUploadBytesFromMb(MAX_UPLOAD_MB_CEILING)).toBe(100 * 1024 * 1024 * 1024);
  });

  it("accepts a 100GB panel setting", () => {
    expect(sanitizeMaxUploadMb(102400)).toBe(102400);
  });
});

describe("uploadTransferTimeoutMs", () => {
  it("keeps tiny files near the 60s floor", () => {
    expect(uploadTransferTimeoutMs(1024)).toBeGreaterThanOrEqual(60_000);
    expect(uploadTransferTimeoutMs(1024)).toBeLessThan(120_000);
  });

  it("caps a 100GB transfer at 8 hours", () => {
    expect(uploadTransferTimeoutMs(100 * 1024 * 1024 * 1024)).toBe(MAX_UPLOAD_TRANSFER_MS);
  });
});
