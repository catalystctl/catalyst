import crypto from "crypto";

const ENCRYPTION_VERSION = "v1";
const KEY_ENV = "BACKUP_CREDENTIALS_ENCRYPTION_KEY";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

const getKey = () => {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new Error(`${KEY_ENV} is required to encrypt backup credentials`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`${KEY_ENV} must be 32 bytes (base64 encoded)`);
  }
  return key;
};

const encryptValue = (value: string) => {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_VERSION}:${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
};

const decryptValue = (value: string) => {
  if (!value || typeof value !== "string") return value;
  const [version, payload] = value.split(":", 2);
  if (version !== ENCRYPTION_VERSION || !payload) return value;
  const key = getKey();
  const buffer = Buffer.from(payload, "base64");
  const iv = buffer.subarray(0, IV_LENGTH);
  const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
};

/**
 * Whether stored credentials can be encrypted right now: the key must be
 * present and decode to 32 bytes. Routes check this BEFORE provisioning or
 * rotating anything, so a missing key fails fast with 400 instead of
 * leaving a provisioned-but-unstorable credential behind.
 */
export const isCredentialEncryptionConfigured = (): boolean => {
  const raw = process.env[KEY_ENV];
  if (!raw) return false;
  try {
    return Buffer.from(raw, "base64").length === KEY_LENGTH;
  } catch {
    return false;
  }
};

/**
 * Encrypt a single secret string with the backup-credentials AES key.
 *
 * Fail-closed in every environment: a missing or invalid key is a hard error
 * so credentials are never persisted as cleartext. Tests must provision a
 * 32-byte base64 BACKUP_CREDENTIALS_ENCRYPTION_KEY; the only escape hatch is
 * the explicit ALLOW_PLAINTEXT_CREDS=1 opt-in (local debugging only, refused
 * in production).
 */
export const encryptSecretValue = (value: string | null | undefined): string | null | undefined => {
  if (value === null || value === undefined || value === '') return value;
  if (process.env.ALLOW_PLAINTEXT_CREDS === '1') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Refusing to store backup credentials unencrypted: ALLOW_PLAINTEXT_CREDS=1 is not honored in production',
      );
    }
    return value;
  }
  // Fail closed: no silent plaintext fallback. Keep the legacy message shape
  // (mentions "unencrypted") so existing fail-closed assertions keep passing.
  try {
    return encryptValue(value);
  } catch (err) {
    throw new Error(
      `Refusing to store backup credentials unencrypted: ${(err as Error)?.message ?? 'encryption key unavailable'} ` +
        `(set BACKUP_CREDENTIALS_ENCRYPTION_KEY to a 32-byte base64 value)`,
    );
  }
};

/**
 * Decrypt a value previously produced by encryptSecretValue / encryptBackupConfig.
 * Plaintext (non v1:) values pass through unchanged.
 */
export const decryptSecretValue = (value: string | null | undefined): string | null | undefined => {
  if (value === null || value === undefined || value === '') return value;
  try {
    return decryptValue(value);
  } catch {
    return value;
  }
};

export const encryptBackupConfig = (config: Record<string, any> | null | undefined) => {
  if (!config) return config;
  return {
    ...config,
    secretAccessKey: config.secretAccessKey ? encryptSecretValue(config.secretAccessKey) : config.secretAccessKey,
    password: config.password ? encryptSecretValue(config.password) : config.password,
    privateKey: config.privateKey ? encryptSecretValue(config.privateKey) : config.privateKey,
    privateKeyPassphrase: config.privateKeyPassphrase
      ? encryptSecretValue(config.privateKeyPassphrase)
      : config.privateKeyPassphrase,
  };
};

export const decryptBackupConfig = (config: Record<string, any> | null | undefined) => {
  if (!config) return config;
  return {
    ...config,
    secretAccessKey: config.secretAccessKey ? decryptValue(config.secretAccessKey) : config.secretAccessKey,
    password: config.password ? decryptValue(config.password) : config.password,
    privateKey: config.privateKey ? decryptValue(config.privateKey) : config.privateKey,
    privateKeyPassphrase: config.privateKeyPassphrase
      ? decryptValue(config.privateKeyPassphrase)
      : config.privateKeyPassphrase,
  };
};

export const redactBackupConfig = (config: Record<string, any> | null | undefined) => {
  if (!config) return config;
  return {
    ...config,
    secretAccessKey: config.secretAccessKey ? "********" : config.secretAccessKey,
    password: config.password ? "********" : config.password,
    privateKey: config.privateKey ? "********" : config.privateKey,
    privateKeyPassphrase: config.privateKeyPassphrase ? "********" : config.privateKeyPassphrase,
  };
};
