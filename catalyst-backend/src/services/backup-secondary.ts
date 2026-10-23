/**
 * Secondary ("another drive") backup destination.
 *
 * A panel-wide, admin-managed extra directory — typically a mounted second
 * disk — that a finished backup can additionally be copied to. The path is
 * NEVER taken from a request: only an admin sets it (Admin > System), and a
 * request can only say "also copy this backup there". Every path derived from
 * that setting is validated, resolved and then re-checked against the
 * canonical root before it is created, written, read or unlinked, so a crafted
 * server uuid, backup name or stored metadata value cannot escape the
 * configured directory.
 *
 * Disabled is the default: with the toggle off the option is hidden in the UI
 * and backup creation rejects requests that ask for it. Existing copies stay
 * downloadable while the path is still configured.
 */
import * as fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { prisma } from "../db.js";
import { cachedConfig, invalidateConfig } from "../lib/config-cache.js";

export const BACKUP_SECONDARY_SETTING_ID = "backup_secondary";

/** Longest accepted configured path; anything longer is a configuration error. */
const MAX_PATH_LENGTH = 4096;

export type BackupSecondarySettings = {
  /** Admin toggle. When false, new copies cannot be requested. */
  enabled: boolean;
  /** Absolute directory on the panel host, or null when unconfigured. */
  path: string | null;
};

export const DEFAULT_BACKUP_SECONDARY_SETTINGS: BackupSecondarySettings = {
  enabled: false,
  path: null,
};

/** A configured path failed validation (bad shape or reserved location). */
export class BackupSecondaryPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupSecondaryPathError";
  }
}

/** Directories the secondary destination must never overlap. */
const reservedDirectories = () => [
  process.env.BACKUP_DIR || "/var/lib/catalyst/backups",
  process.env.BACKUP_STREAM_DIR || "/tmp/catalyst-backup-stream",
  process.env.BACKUP_TRANSFER_DIR || "/tmp/catalyst-backup-transfer",
  process.env.SERVER_DATA_DIR || "/var/lib/catalyst/servers",
];

/** True when `candidate` is `root` or lives beneath it (both already resolved). */
export const isPathInside = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  if (relative === "") return true;
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const overlaps = (a: string, b: string) => isPathInside(a, b) || isPathInside(b, a);

/**
 * Reject a destination that is too broad or collides with a managed tree.
 *
 * Applied both to the configured path and — critically — to its canonical
 * form: a configured directory that is a symlink to `/` or to BACKUP_DIR must
 * be refused, not trusted because its own name looks fine.
 */
const assertUsableRoot = (resolved: string) => {
  if (resolved === path.sep) {
    throw new BackupSecondaryPathError("Secondary backup directory must not be the filesystem root");
  }
  // A single top-level directory (/backups, /mnt) is too broad: the panel would
  // create per-server trees directly in it. /mnt/backup-drive is fine.
  const depth = resolved.split(path.sep).filter(Boolean).length;
  if (depth < 2) {
    throw new BackupSecondaryPathError(
      "Secondary backup directory must be at least two levels deep (for example /mnt/backup-drive)",
    );
  }
  for (const reserved of reservedDirectories()) {
    const reservedResolved = path.resolve(reserved);
    if (overlaps(reservedResolved, resolved)) {
      throw new BackupSecondaryPathError(
        `Secondary backup directory must not overlap ${reservedResolved}`,
      );
    }
  }
};

/**
 * Validate an admin-supplied destination directory.
 *
 * Returns the normalized absolute path, or null for "no destination". Throws
 * `BackupSecondaryPathError` for anything rejected, so the caller can surface
 * a precise validation message instead of silently storing a dangerous value.
 */
export const normalizeSecondaryBackupPath = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") {
    throw new BackupSecondaryPathError("Secondary backup directory must be a string");
  }
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed.length > MAX_PATH_LENGTH) {
    throw new BackupSecondaryPathError("Secondary backup directory is too long");
  }
  // Control characters (including NUL) have no business in a filesystem path
  // and can only be an attempt to confuse downstream consumers.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new BackupSecondaryPathError("Secondary backup directory contains control characters");
  }
  if (!path.isAbsolute(trimmed)) {
    throw new BackupSecondaryPathError("Secondary backup directory must be an absolute path");
  }
  const rawSegments = trimmed.split("/");
  if (rawSegments.some((segment) => segment === ".." || segment === ".")) {
    throw new BackupSecondaryPathError("Secondary backup directory must not contain '.' or '..' segments");
  }
  const resolved = path.resolve(trimmed);
  assertUsableRoot(resolved);
  return resolved;
};

export const readBackupSecondarySettings = async (): Promise<BackupSecondarySettings> => {
  const row = await prisma.systemSetting.findUnique({
    where: { id: BACKUP_SECONDARY_SETTING_ID },
    select: { backupSecondaryEnabled: true, backupSecondaryPath: true },
  });
  if (!row) return { ...DEFAULT_BACKUP_SECONDARY_SETTINGS };
  return {
    enabled: row.backupSecondaryEnabled === true,
    path: row.backupSecondaryPath ?? null,
  };
};

export const getBackupSecondarySettings = async (): Promise<BackupSecondarySettings> =>
  cachedConfig(BACKUP_SECONDARY_SETTING_ID, readBackupSecondarySettings);

export const updateBackupSecondarySettings = async (
  input: BackupSecondarySettings,
): Promise<BackupSecondarySettings> => {
  const next: BackupSecondarySettings = {
    enabled: input.enabled === true,
    path: normalizeSecondaryBackupPath(input.path),
  };
  await prisma.systemSetting.upsert({
    where: { id: BACKUP_SECONDARY_SETTING_ID },
    create: {
      id: BACKUP_SECONDARY_SETTING_ID,
      backupSecondaryEnabled: next.enabled,
      backupSecondaryPath: next.path,
    },
    update: {
      backupSecondaryEnabled: next.enabled,
      backupSecondaryPath: next.path,
    },
  });
  await invalidateConfig(BACKUP_SECONDARY_SETTING_ID);
  return next;
};

/**
 * Canonical secondary root, or null when no destination is configured.
 *
 * `realpath` is the anchor for every containment check: if the admin pointed
 * the setting at a symlink to the mounted drive, we compare against where it
 * actually resolves. A missing/unmounted directory throws instead of being
 * created implicitly — writing to an unmounted mountpoint would silently fill
 * the root filesystem.
 */
export const resolveSecondaryBackupRoot = async (): Promise<string | null> => {
  const settings = await getBackupSecondarySettings();
  if (!settings.path) return null;
  const normalized = normalizeSecondaryBackupPath(settings.path);
  if (!normalized) return null;
  let real: string;
  try {
    real = await fs.realpath(normalized);
  } catch {
    throw new BackupSecondaryPathError(
      `Secondary backup directory is not available: ${normalized}`,
    );
  }
  const stats = await fs.stat(real);
  if (!stats.isDirectory()) {
    throw new BackupSecondaryPathError(
      `Secondary backup directory is not a directory: ${real}`,
    );
  }
  // The canonical form is what every later containment check uses, so it — not
  // just the configured name — must be a narrow, non-overlapping directory.
  assertUsableRoot(real);
  return real;
};

/**
 * Resolve a stored secondary path against the current root, rejecting anything
 * that is not a plain absolute path inside it.
 */
export const assertSecondaryTarget = async (
  storedPath: unknown,
): Promise<{ root: string; target: string }> => {
  if (typeof storedPath !== "string" || storedPath.trim() === "") {
    throw new BackupSecondaryPathError("Missing secondary backup path");
  }
  if (!path.isAbsolute(storedPath)) {
    throw new BackupSecondaryPathError("Secondary backup path must be absolute");
  }
  if (storedPath.split("/").some((segment) => segment === ".." || segment === ".")) {
    throw new BackupSecondaryPathError("Secondary backup path must not traverse");
  }
  const root = await resolveSecondaryBackupRoot();
  if (!root) {
    throw new BackupSecondaryPathError("Secondary backup directory is not configured");
  }
  const target = path.resolve(storedPath);
  if (!isPathInside(root, target) || target === root) {
    throw new BackupSecondaryPathError("Secondary backup path is outside the configured directory");
  }
  return { root, target };
};

const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/**
 * Build the destination for a server's archive. Both segments are validated
 * and the result is containment-checked, so even a hostile uuid or name
 * (defense in depth — both are server-generated) cannot leave the root.
 */
export const planSecondaryBackupPath = (
  root: string,
  serverUuid: string,
  fileName: string,
): string => {
  if (!SAFE_SEGMENT.test(serverUuid)) {
    throw new BackupSecondaryPathError("Invalid server uuid for secondary backup path");
  }
  if (!SAFE_SEGMENT.test(fileName)) {
    throw new BackupSecondaryPathError("Invalid backup file name for secondary backup path");
  }
  const target = path.resolve(root, serverUuid, fileName);
  if (!isPathInside(root, target) || target === path.resolve(root)) {
    throw new BackupSecondaryPathError("Secondary backup path is outside the configured directory");
  }
  return target;
};

/** Create (and re-verify) the per-server directory underneath the root. */
const ensureSecondaryServerDir = async (root: string, target: string) => {
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const stats = await fs.lstat(dir);
  if (stats.isSymbolicLink()) {
    throw new BackupSecondaryPathError("Secondary backup directory is a symbolic link");
  }
  const realDir = await fs.realpath(dir);
  if (!isPathInside(root, realDir)) {
    throw new BackupSecondaryPathError("Secondary backup directory escapes the configured root");
  }
};

/**
 * Copy an archive into the secondary destination atomically.
 *
 * `fetchTo` receives a temporary sibling path and must place the archive
 * there; the file only appears under its final name once the copy succeeded.
 */
export const materializeSecondaryCopy = async (params: {
  secondaryPath: string;
  fetchTo: (destination: string) => Promise<void>;
}): Promise<string> => {
  const { root, target } = await assertSecondaryTarget(params.secondaryPath);
  await ensureSecondaryServerDir(root, target);

  // Never write through an existing symlink at the destination.
  try {
    const existing = await fs.lstat(target);
    if (existing.isSymbolicLink()) {
      throw new BackupSecondaryPathError("Refusing to overwrite a symbolic link");
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }

  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.part`;
  try {
    await params.fetchTo(temporary);
    const written = await fs.lstat(temporary);
    if (!written.isFile() || written.size <= 0) {
      throw new Error("Secondary backup copy produced no data");
    }
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
  return target;
};

/** Copy a file already present on the panel host (stream-mode archives). */
export const copyLocalArchiveToSecondary = async (
  sourcePath: string,
  secondaryPath: string,
): Promise<string> =>
  materializeSecondaryCopy({
    secondaryPath,
    fetchTo: (destination) => fs.copyFile(sourcePath, destination),
  });

/**
 * Resolve a stored secondary path to a readable file.
 *
 * Returns null for anything missing, not a regular file, or a symlink, so the
 * download route never serves something outside the configured root.
 */
export const resolveSecondaryBackupFile = async (
  storedPath: unknown,
): Promise<{ path: string; size: number } | null> => {
  if (typeof storedPath !== "string" || storedPath.trim() === "") return null;
  let root: string;
  let target: string;
  try {
    ({ root, target } = await assertSecondaryTarget(storedPath));
  } catch {
    return null;
  }
  try {
    const stats = await fs.lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0) return null;
    const real = await fs.realpath(target);
    if (!isPathInside(root, real)) return null;
    return { path: real, size: stats.size };
  } catch {
    return null;
  }
};

/**
 * Remove a backup's secondary copy. Best-effort by design: deletion must not
 * fail because the drive was unmounted or the admin cleared the setting.
 * Returns true only when a file was actually unlinked.
 */
export const deleteSecondaryBackupCopy = async (
  storedPath: unknown,
): Promise<boolean> => {
  if (typeof storedPath !== "string" || storedPath.trim() === "") return false;
  let target: string;
  try {
    ({ target } = await assertSecondaryTarget(storedPath));
  } catch {
    return false;
  }
  try {
    const stats = await fs.lstat(target);
    if (!stats.isFile() || stats.isSymbolicLink()) return false;
    await fs.unlink(target);
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    return false;
  }
  // Drop the now-empty per-server directory; ignore failures.
  await fs.rmdir(path.dirname(target)).catch(() => {});
  return true;
};
