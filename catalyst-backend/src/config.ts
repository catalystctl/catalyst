/**
 * Catalyst Backend - Environment Configuration
 * 
 * Centralized, validated environment variable access. All env vars are loaded
 * at startup through Zod schemas that enforce types and required values.
 * 
 * Usage:
 *   import { config } from './config.js';
 *   const secret = config.auth.betterAuthSecret;
 *   const dbUrl = config.database.url;
 * 
 * Do NOT access process.env directly in route handlers or services — use this
 * config object instead. Startup will fail fast if required env vars are missing
 * or invalid, preventing runtime errors.
 */

import { z } from 'zod';

// ── Schema Definitions ──────────────────────────────────────────────────

const serverSchema = z.object({
  port: z.coerce.number().int().positive().default(3000),
  host: z.string().default('0.0.0.0'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  workers: z.coerce.number().int().nonnegative().default(0),
});

const databaseSchema = z.object({
  url: z.string().min(1, 'DATABASE_URL is required'),
  hostConnectTimeoutMs: z.coerce.number().int().positive().optional(),
});

const redisSchema = z.object({
  url: z.string().optional(),
  enabled: z.enum(['true', 'false', '0', '1']).optional().transform(val => 
    val === undefined ? true : val === 'true' || val === '1'
  ),
});

const authSchema = z.object({
  betterAuthSecret: z.string().min(1, 'BETTER_AUTH_SECRET is required'),
  betterAuthUrl: z.string().optional(),
  apiKeySecret: z.string().optional(),
  allowLegacyApiKeyHash: z.enum(['0', '1']).optional().transform(val => val === '1'),
  apiKeyCacheTtlMs: z.coerce.number().int().positive().optional(),
});

const backendSchema = z.object({
  externalAddress: z.string().default('http://localhost:3000'),
  url: z.string().optional(),
  publicUrl: z.string().optional(),
  frontendUrl: z.string().optional(),
});

const corsSchema = z.object({
  origin: z.string().default('http://localhost:3000'),
  devExtraOrigins: z.string().optional(),
});

const suspensionSchema = z.object({
  enforced: z.enum(['true', 'false']).optional().transform(val => val !== 'false'),
  deletePolicy: z.enum(['block', 'allow']).optional(),
  deleteBlocked: z.enum(['true', 'false']).optional().transform(val => val !== 'false'),
});

const backupSchema = z.object({
  dir: z.string().default('/var/lib/catalyst/backups'),
  streamDir: z.string().default('/tmp/catalyst-backup-stream'),
  transferDir: z.string().default('/tmp/catalyst-backup-transfer'),
  encryptionKey: z.string().optional(),
  credentialsEncryptionKey: z.string().optional(),
  s3Endpoint: z.string().optional(),
  s3Region: z.string().optional(),
  s3Bucket: z.string().optional(),
  s3AccessKeyId: z.string().optional(),
  s3SecretAccessKey: z.string().optional(),
});

const serverDataSchema = z.object({
  dir: z.string().default('/var/lib/catalyst/servers'),
});

const rateLimitSchema = z.object({
  disabled: z.enum(['0', '1', 'true', 'false']).optional().transform(val => 
    val === '1' || val === 'true'
  ),
  benchmarkDisabled: z.enum(['0', '1', 'true', 'false']).optional().transform(val =>
    val === '1' || val === 'true'
  ),
  benchmarkFair: z.enum(['0', '1', 'true', 'false']).optional().transform(val =>
    val === '1' || val === 'true'
  ),
});

const webhookSchema = z.object({
  secret: z.string().optional(),
  urls: z.string().optional(),
});

const pluginSchema = z.object({
  marketplaceAllowLocal: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
});

const autoUpdateSchema = z.object({
  forceDocker: z.enum(['true', 'false']).optional().transform(val => val === 'true'),
  dockerComposePath: z.string().optional(),
});

const deploySchema = z.object({
  dockerBin: z.string().optional(),
});

const timezoneSchema = z.object({
  tz: z.string().default('UTC'),
});

const clusterSchema = z.object({
  backgroundJobOwner: z.enum(['0', '1']).optional().transform(val => val === '1'),
});

// ── Root Schema ─────────────────────────────────────────────────────────

const configSchema = z.object({
  server: serverSchema,
  database: databaseSchema,
  redis: redisSchema,
  auth: authSchema,
  backend: backendSchema,
  cors: corsSchema,
  suspension: suspensionSchema,
  backup: backupSchema,
  serverData: serverDataSchema,
  rateLimit: rateLimitSchema,
  webhook: webhookSchema,
  plugin: pluginSchema,
  autoUpdate: autoUpdateSchema,
  deploy: deploySchema,
  timezone: timezoneSchema,
  cluster: clusterSchema,
});

// ── Load and Validate ───────────────────────────────────────────────────

function loadConfig() {
  const raw = {
    server: {
      port: process.env.PORT,
      host: '0.0.0.0',
      nodeEnv: process.env.NODE_ENV,
      workers: process.env.WORKERS,
    },
    database: {
      url: process.env.DATABASE_URL,
      hostConnectTimeoutMs: process.env.DATABASE_HOST_CONNECT_TIMEOUT_MS,
    },
    redis: {
      url: process.env.REDIS_URL,
      enabled: process.env.REDIS_ENABLED,
    },
    auth: {
      betterAuthSecret: process.env.BETTER_AUTH_SECRET,
      betterAuthUrl: process.env.BETTER_AUTH_URL,
      apiKeySecret: process.env.API_KEY_SECRET,
      allowLegacyApiKeyHash: process.env.ALLOW_LEGACY_API_KEY_HASH,
      apiKeyCacheTtlMs: process.env.AUTH_APIKEY_CACHE_TTL_MS,
    },
    backend: {
      externalAddress: process.env.BACKEND_EXTERNAL_ADDRESS,
      url: process.env.BACKEND_URL,
      publicUrl: process.env.PUBLIC_URL,
      frontendUrl: process.env.FRONTEND_URL,
    },
    cors: {
      origin: process.env.CORS_ORIGIN,
      devExtraOrigins: process.env.DEV_EXTRA_ORIGINS,
    },
    suspension: {
      enforced: process.env.SUSPENSION_ENFORCED,
      deletePolicy: process.env.SUSPENSION_DELETE_POLICY,
      deleteBlocked: process.env.SUSPENSION_DELETE_BLOCKED,
    },
    backup: {
      dir: process.env.BACKUP_DIR,
      streamDir: process.env.BACKUP_STREAM_DIR,
      transferDir: process.env.BACKUP_TRANSFER_DIR,
      encryptionKey: process.env.BACKUP_ENCRYPTION_KEY,
      credentialsEncryptionKey: process.env.BACKUP_CREDENTIALS_ENCRYPTION_KEY,
      s3Endpoint: process.env.BACKUP_S3_ENDPOINT,
      s3Region: process.env.BACKUP_S3_REGION,
      s3Bucket: process.env.BACKUP_S3_BUCKET,
      s3AccessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID,
      s3SecretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY,
    },
    serverData: {
      dir: process.env.SERVER_DATA_DIR,
    },
    rateLimit: {
      disabled: process.env.DISABLE_RATE_LIMIT,
      benchmarkDisabled: process.env.BENCHMARK_DISABLE_RATE_LIMIT,
      benchmarkFair: process.env.BENCHMARK_FAIR,
    },
    webhook: {
      secret: process.env.WEBHOOK_SECRET,
      urls: process.env.WEBHOOK_URLS,
    },
    plugin: {
      marketplaceAllowLocal: process.env.PLUGIN_MARKETPLACE_ALLOW_LOCAL,
    },
    autoUpdate: {
      forceDocker: process.env.AUTO_UPDATE_FORCE_DOCKER,
      dockerComposePath: process.env.AUTO_UPDATE_DOCKER_COMPOSE_PATH,
    },
    deploy: {
      dockerBin: process.env.DOCKER_BIN,
    },
    timezone: {
      tz: process.env.TZ,
    },
    cluster: {
      backgroundJobOwner: process.env.CATALYST_BACKGROUND_JOB_OWNER,
    },
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    console.error('[config] Environment variable validation failed:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    throw new Error('Invalid environment configuration');
  }

  return result.data;
}

// Skip validation in test environment if BETTER_AUTH_SECRET is not set
// (some unit tests don't need the full config)
export const config = (() => {
  if (process.env.NODE_ENV === 'test' && !process.env.BETTER_AUTH_SECRET) {
    // Return a mock config for tests that don't need full validation
    return {
      server: { port: 3000, host: '0.0.0.0', nodeEnv: 'test' as const, workers: 0 },
      database: { url: process.env.DATABASE_URL || '' },
      redis: { url: undefined, enabled: false },
      auth: { 
        betterAuthSecret: '', 
        betterAuthUrl: undefined,
        apiKeySecret: undefined,
        allowLegacyApiKeyHash: false,
        apiKeyCacheTtlMs: undefined,
      },
      backend: { externalAddress: 'http://localhost:3000', url: undefined, publicUrl: undefined, frontendUrl: undefined },
      cors: { origin: 'http://localhost:3000', devExtraOrigins: undefined },
      suspension: { enforced: false, deletePolicy: undefined, deleteBlocked: false },
      backup: {
        dir: '/var/lib/catalyst/backups',
        streamDir: '/tmp/catalyst-backup-stream',
        transferDir: '/tmp/catalyst-backup-transfer',
        encryptionKey: undefined,
        credentialsEncryptionKey: undefined,
        s3Endpoint: undefined,
        s3Region: undefined,
        s3Bucket: undefined,
        s3AccessKeyId: undefined,
        s3SecretAccessKey: undefined,
      },
      serverData: { dir: '/var/lib/catalyst/servers' },
      rateLimit: { disabled: false, benchmarkDisabled: false, benchmarkFair: false },
      webhook: { secret: undefined, urls: undefined },
      plugin: { marketplaceAllowLocal: false },
      autoUpdate: { forceDocker: false, dockerComposePath: undefined },
      deploy: { dockerBin: undefined },
      timezone: { tz: 'UTC' },
      cluster: { backgroundJobOwner: false },
    } as z.infer<typeof configSchema>;
  }
  return loadConfig();
})();

// Type export for external use
export type Config = z.infer<typeof configSchema>;
