/**
 * Regression: uncompressed backups must be named `.tar`, and the default
 * (no explicit flag) must stay the historical `.tar.gz`.
 */
import { describe, it, expect } from "vitest";
import { buildBackupPaths } from "../services/backup-storage";

const server = {
  backupS3Config: { bucket: "b", region: "us-east-1", accessKeyId: "k", secretAccessKey: "s" },
  backupSftpConfig: { host: "h", port: 22, username: "u", password: "p", basePath: "/backups" },
};

describe("buildBackupPaths — compression flag", () => {
  it("defaults to gzip", () => {
    const paths = buildBackupPaths("uuid-1", "nightly", "local");
    expect(paths.agentPath.endsWith("nightly.tar.gz")).toBe(true);
    expect(paths.storagePath.endsWith("nightly.tar.gz")).toBe(true);
  });

  it("uses a plain .tar when compression is off", () => {
    const paths = buildBackupPaths("uuid-1", "nightly", "local", undefined, false);
    expect(paths.agentPath.endsWith("nightly.tar")).toBe(true);
    expect(paths.storagePath.endsWith("nightly.tar")).toBe(true);
  });

  it("carries the extension into S3 and SFTP storage keys", () => {
    const s3 = buildBackupPaths("uuid-1", "nightly", "s3", server, false);
    expect(s3.storageKey).toBe("backups/uuid-1/nightly.tar");
    expect(s3.storagePath).toBe("s3://b/backups/uuid-1/nightly.tar");

    const sftp = buildBackupPaths("uuid-1", "nightly", "sftp", server, false);
    expect(sftp.storageKey).toBe("/backups/backups/uuid-1/nightly.tar");
  });

  it("keeps .tar.gz for explicitly compressed backups", () => {
    const paths = buildBackupPaths("uuid-1", "nightly", "stream", undefined, true);
    expect(paths.agentPath.endsWith("nightly.tar.gz")).toBe(true);
  });
});
