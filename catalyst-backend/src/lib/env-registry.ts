/**
 * Environment-variable registry.
 *
 * Single source of truth for every environment variable an operator can set,
 * plus the metadata the panel needs to render it (category, type, default,
 * whether it is secret, and whether changing it needs a restart).
 *
 * Two classes of variable:
 *
 *  - `editable: false` (bootstrap-only) — the process needs the value *before*
 *    it can reach the database that stores overrides (`DATABASE_URL`, the
 *    listen `PORT`, `NODE_ENV`, ...). These stay in `.env` / the container
 *    environment and the panel shows them read-only.
 *  - everything else — the database is the source of truth. A row in
 *    `EnvSetting` is applied to `process.env` by `services/env-settings.ts`
 *    before the app modules are imported, so values survive restarts and are
 *    editable from Admin > Environment.
 *
 * `internal: true` entries are process plumbing (test/CLI/worker flags) and are
 * never exposed through the API. The completeness test in
 * `src/__tests__/env-registry.test.ts` scans the source for `process.env.X`
 * reads and fails when a key is neither registered nor internal, so this file
 * cannot silently drift behind new code.
 */

export type EnvCategory =
	| "general"
	| "urls"
	| "server"
	| "database"
	| "auth"
	| "oauth"
	| "limits"
	| "suspension"
	| "storage"
	| "backups"
	| "plugins"
	| "redis"
	| "performance"
	| "updates"
	| "developer";

export type EnvValueType =
	| "string"
	| "number"
	| "boolean"
	| "enum"
	| "url"
	| "path"
	| "list"
	| "secret";

export interface EnvVarSpec {
	/** Environment variable name (also the primary key in `EnvSetting`). */
	key: string;
	category: EnvCategory;
	type: EnvValueType;
	/** Effective value when neither the database nor the environment sets it. */
	default?: string;
	/** Mask the value in API responses and never echo it back. */
	secret?: boolean;
	/** False for bootstrap-only keys that must be set in `.env`. */
	editable: boolean;
	/** Human title; falls back to a humanized key. */
	title?: string;
	/** Short English description shown under the field. */
	description?: string;
	/** Allowed values for `enum`. */
	options?: readonly string[];
	/** Bounds for `number`. */
	min?: number;
	max?: number;
	/** Suggested input placeholder. */
	placeholder?: string;
	/** Surface this variable in the first-run setup wizard. */
	setup?: boolean;
	/**
	 * Changing this requires a restart for the value to take effect. Almost
	 * everything is read once at boot; the few false entries are read through
	 * a DB-backed settings cache that invalidates immediately.
	 */
	restartRequired?: boolean;
	/**
	 * The panel page that already owns this setting. Such variables are hidden
	 * from Admin > Environment so a setting never has two editors.
	 */
	managedBy?: string;
	/** Never render or expose through the API. */
	internal?: boolean;
}

/**
 * Variables read before the database is available, so they cannot be
 * DB-managed. Kept as a set for the boot loader and the API.
 */
const BOOTSTRAP_KEYS = new Set([
	"DATABASE_URL",
	"NODE_ENV",
	"PORT",
	"POSTGRES_PASSWORD",
	"TZ",
	"WORKERS",
]);

/** Aliases for typed literals used in the registry table below. */
const base = (
	key: string,
	category: EnvCategory,
	type: EnvValueType,
	extra: Partial<EnvVarSpec> = {},
): EnvVarSpec => ({
	key,
	category,
	type,
	// A setting owned by a dedicated page is shown here for discoverability but
	// edited there, so the two never fight over the same value.
	editable: !BOOTSTRAP_KEYS.has(key) && !extra.managedBy,
	restartRequired: true,
	...extra,
});

export const ENV_VAR_REGISTRY: readonly EnvVarSpec[] = [
	// ── General ───────────────────────────────────────────────────────────
	base("NODE_ENV", "general", "enum", {
		options: ["development", "production", "test"],
		default: "development",
		description:
			"Runtime mode. Controls HSTS, secure cookies and error detail. Set in .env before startup.",
	}),
	base("LOG_LEVEL", "general", "enum", {
		options: ["trace", "debug", "info", "warn", "error"],
		default: "info",
		description: "Backend log verbosity.",
	}),
	base("TZ", "general", "string", {
		default: "UTC",
		placeholder: "UTC",
		description:
			"IANA timezone used for scheduled tasks and timestamps. Set in .env before startup.",
	}),
	base("APP_NAME", "general", "string", {
		default: "Catalyst",
		// The panel name is edited under Admin > Theme; APP_NAME is only the
		// fallback used before a theme row exists.
		managedBy: "theme",
		description: "Panel name used in emails, passkeys and generated metadata.",
	}),
	base("ENABLE_COMPRESSION", "general", "boolean", {
		default: "true",
		description: "Compress HTTP responses (gzip/br/deflate). Leave on behind TLS.",
	}),
	base("DOCS_ENABLED", "general", "boolean", {
		default: "false",
		// Read per request by the /docs guard, so it applies without a restart.
		restartRequired: false,
		description: "Expose the Swagger API reference at /docs in production.",
	}),
	base("TRUST_PROXY", "general", "boolean", {
		default: "false",
		description:
			"Trust X-Forwarded-* headers. Enable only when a reverse proxy overwrites them.",
	}),

	// ── URLs & CORS ───────────────────────────────────────────────────────
	base("PUBLIC_URL", "urls", "url", {
		setup: true,
		placeholder: "https://panel.example.com",
		description:
			"Canonical URL users reach the panel from. Drives CORS, auth callbacks and generated links.",
	}),
	base("FRONTEND_URL", "urls", "url", {
		placeholder: "https://panel.example.com",
		description: "Frontend origin. Defaults to PUBLIC_URL.",
	}),
	base("BACKEND_URL", "urls", "url", {
		placeholder: "http://localhost:3000",
		description: "Backend base URL used in generated deployment artifacts.",
	}),
	base("BACKEND_EXTERNAL_ADDRESS", "urls", "url", {
		placeholder: "https://api.example.com",
		description: "Externally reachable backend address used in generated links.",
	}),
	base("CORS_ORIGIN", "urls", "list", {
		description: "Comma-separated extra CORS origins. Defaults to PUBLIC_URL and FRONTEND_URL.",
		placeholder: "https://a.example.com,https://b.example.com",
	}),
	base("DEV_EXTRA_ORIGINS", "urls", "list", {
		description: "Additional CORS origins allowed in development only.",
	}),

	// ── Server ────────────────────────────────────────────────────────────
	base("PORT", "server", "number", {
		default: "3000",
		min: 1,
		max: 65535,
		description: "HTTP listen port. Set in .env / the container environment.",
	}),

	// ── Database ──────────────────────────────────────────────────────────
	base("DATABASE_URL", "database", "secret", {
		secret: true,
		description: "PostgreSQL connection string. Required before startup; cannot be DB-managed.",
	}),
	base("POSTGRES_PASSWORD", "database", "secret", {
		secret: true,
		description:
			"Postgres password used by the bundled container. Set in .env; only used here for weak-secret warnings.",
	}),
	base("DB_POOL_MAX", "database", "number", {
		default: "15",
		min: 1,
		max: 1000,
		description: "Maximum PostgreSQL connection pool size.",
	}),
	base("DATABASE_HOST_CONNECT_TIMEOUT_MS", "database", "number", {
		default: "5000",
		min: 0,
		description: "Timeout when connecting to admin-managed MySQL/Postgres hosts.",
	}),

	// ── Auth & secrets ────────────────────────────────────────────────────
	base("BETTER_AUTH_SECRET", "auth", "secret", {
		secret: true,
		description: "Signing secret for sessions and tokens. Rotating it signs everyone out.",
	}),
	base("BETTER_AUTH_URL", "auth", "url", {
		description: "Auth callback base URL. Defaults to PUBLIC_URL.",
	}),
	base("PASSKEY_RP_ID", "auth", "string", {
		placeholder: "panel.example.com",
		description: "WebAuthn relying-party ID (the panel's domain).",
	}),
	base("API_KEY_SECRET", "auth", "secret", {
		secret: true,
		description: "HMAC secret hashing panel/agent API keys. Falls back to BETTER_AUTH_SECRET.",
	}),
	base("WEBHOOK_SECRET", "auth", "secret", {
		secret: true,
		description: "HMAC secret used to sign outgoing webhook payloads.",
	}),
	base("ALLOW_PLAINTEXT_CREDS", "auth", "boolean", {
		default: "false",
		description: "Allow storing credentials in plaintext. Dangerous; for migration only.",
	}),
	base("ALLOW_LEGACY_API_KEY_HASH", "auth", "boolean", {
		default: "false",
		description: "Accept API keys hashed with the legacy scheme.",
	}),
	base("COOKIE_SECURE", "auth", "boolean", {
		default: "true",
		description: "Force the Secure flag on auth cookies. Disable only for plain-HTTP setups.",
	}),
	base("WEBHOOK_URLS", "auth", "list", {
		description: "Comma-separated default webhook URLs.",
		placeholder: "https://hooks.example.com/catalyst",
	}),

	// ── OAuth providers ───────────────────────────────────────────────────
	base("WHMCS_OIDC_CLIENT_ID", "oauth", "string", {
		managedBy: "oidc",
		description: "WHMCS OIDC client ID. Also configurable under SSO settings.",
	}),
	base("WHMCS_OIDC_CLIENT_SECRET", "oauth", "secret", {
		secret: true,
		managedBy: "oidc",
		description: "WHMCS OIDC client secret.",
	}),
	base("WHMCS_OIDC_DISCOVERY_URL", "oauth", "url", {
		managedBy: "oidc",
		description: "WHMCS OIDC discovery document URL.",
	}),
	base("PAYMENTER_OIDC_CLIENT_ID", "oauth", "string", {
		managedBy: "oidc",
		description: "Paymenter OIDC client ID.",
	}),
	base("PAYMENTER_OIDC_CLIENT_SECRET", "oauth", "secret", {
		secret: true,
		managedBy: "oidc",
		description: "Paymenter OIDC client secret.",
	}),
	base("PAYMENTER_OIDC_DISCOVERY_URL", "oauth", "url", {
		managedBy: "oidc",
		description: "Paymenter OIDC discovery document URL.",
	}),

	// ── Limits ────────────────────────────────────────────────────────────
	base("CONSOLE_OUTPUT_BYTE_LIMIT_BYTES", "limits", "number", {
		default: "262144",
		min: 65536,
		max: 2097152,
		managedBy: "security",
		description: "Per-server console output cap in bytes per second.",
	}),
	base("MAX_DISK_MB", "limits", "number", {
		default: "10240",
		min: 1,
		description: "Default maximum disk per server, in MB.",
	}),

	// ── Suspension ────────────────────────────────────────────────────────
	base("SUSPENSION_ENFORCED", "suspension", "boolean", {
		default: "true",
		description: "Block power actions and file access on suspended servers.",
	}),
	base("SUSPENSION_DELETE_POLICY", "suspension", "enum", {
		options: ["block", "delete"],
		default: "block",
		description: "What happens to suspended servers on deletion.",
	}),
	base("SUSPENSION_DELETE_BLOCKED", "suspension", "boolean", {
		default: "true",
		description: "Block file deletion while a server is suspended.",
	}),

	// ── Storage ───────────────────────────────────────────────────────────
	base("SERVER_DATA_DIR", "storage", "path", {
		default: "/var/lib/catalyst/servers",
		description: "Root directory for server data on the panel.",
	}),
	base("BACKUP_DIR", "storage", "path", {
		default: "/var/lib/catalyst/backups",
		description: "Local backup storage directory.",
	}),
	base("BACKUP_STREAM_DIR", "storage", "path", {
		default: "/tmp/catalyst-backup-stream",
		description: "Scratch directory for streaming backups.",
	}),
	base("BACKUP_TRANSFER_DIR", "storage", "path", {
		default: "/tmp/catalyst-backup-transfer",
		description: "Scratch directory for backup transfers.",
	}),
	base("BACKUP_STORAGE_MODE", "storage", "enum", {
		options: ["local", "s3"],
		default: "local",
		description: "Where backups are stored.",
	}),

	// ── Backups: encryption & S3 ──────────────────────────────────────────
	base("BACKUP_CREDENTIALS_ENCRYPTION_KEY", "backups", "secret", {
		secret: true,
		description: "Key encrypting stored backup credentials (openssl rand -hex 32).",
	}),
	base("BACKUP_ENCRYPTION_KEY", "backups", "secret", {
		secret: true,
		description: "Optional key encrypting backup archives.",
	}),
	base("BACKUP_S3_ENDPOINT", "backups", "url", {
		description: "S3-compatible endpoint for backups.",
		placeholder: "https://s3.example.com",
	}),
	base("BACKUP_S3_REGION", "backups", "string", {
		default: "us-east-1",
		description: "S3 region.",
	}),
	base("BACKUP_S3_BUCKET", "backups", "string", {
		description: "S3 bucket name.",
	}),
	base("BACKUP_S3_ACCESS_KEY", "backups", "string", {
		description: "S3 access key ID.",
	}),
	base("BACKUP_S3_SECRET_KEY", "backups", "secret", {
		secret: true,
		description: "S3 secret access key.",
	}),
	base("BACKUP_S3_PATH_STYLE", "backups", "boolean", {
		default: "false",
		description: "Use path-style S3 addressing (MinIO and most self-hosted stores).",
	}),

	// ── Plugins ───────────────────────────────────────────────────────────
	base("PLUGINS_DIR", "plugins", "path", {
		default: "/var/lib/catalyst/plugins",
		description: "Directory scanned for backend plugins.",
	}),
	base("PLUGIN_HOT_RELOAD", "plugins", "boolean", {
		default: "true",
		description: "Reload plugins on file change. Disable in production.",
	}),
	base("PLUGIN_PROCESS_HEAP_LIMIT_MB", "plugins", "number", {
		min: 16,
		description: "Heap limit for sandboxed plugin processes, in MB.",
	}),
	base("PLUGIN_MARKETPLACE_URLS", "plugins", "list", {
		// Marketplace sources are added and enabled from the marketplace dialog;
		// this env var only seeds the source list on upgraded installs.
		managedBy: "plugins",
		description: "Comma-separated plugin marketplace index URLs.",
	}),
	base("PLUGIN_MARKETPLACE_ALLOW_LOCAL", "plugins", "boolean", {
		default: "false",
		description: "Allow installing plugins from local file paths.",
	}),
	base("PLUGIN_MARKETPLACE_DISABLE_OFFICIAL", "plugins", "boolean", {
		default: "false",
		description: "Hide the official plugin marketplace.",
	}),

	// ── Redis ─────────────────────────────────────────────────────────────
	base("REDIS_URL", "redis", "secret", {
		secret: true,
		description: "Redis connection URL. Unset disables Redis and uses degraded mode.",
		placeholder: "redis://:password@localhost:6379",
	}),
	base("REDIS_ENABLED", "redis", "boolean", {
		description: "Force Redis off while REDIS_URL stays configured.",
	}),
	base("REDIS_PASSWORD", "redis", "secret", {
		secret: true,
		description: "Redis password (used by the bundled container).",
	}),

	// ── Performance & agent ───────────────────────────────────────────────
	base("WORKERS", "performance", "number", {
		default: "0",
		min: 0,
		description: "Worker processes (0 = single process / cluster off). Set in .env before startup.",
	}),
	base("MAX_AGENT_CONNECTIONS", "performance", "number", {
		default: "2000",
		min: 1,
		description: "Maximum concurrent agent WebSocket connections.",
	}),
	base("MAX_CLIENT_CONNECTIONS", "performance", "number", {
		default: "15000",
		min: 1,
		description: "Maximum concurrent client connections.",
	}),
	base("MAX_CONNECTIONS_PER_USER", "performance", "number", {
		default: "10",
		min: 1,
		description: "Maximum concurrent connections per user.",
	}),
	base("WS_MAX_PAYLOAD_BYTES", "performance", "number", {
		default: "2097152",
		min: 1048576,
		max: 2097152,
		description: "WebSocket maximum payload size, in bytes.",
	}),
	base("METRICS_RETENTION_DAYS", "performance", "number", {
		default: "30",
		min: 1,
		description: "How long server/node metrics are retained.",
	}),
	base("AGENT_RELEASE_REPO", "performance", "string", {
		default: "catalystctl/catalyst",
		description: "GitHub repository used to fetch agent releases.",
	}),
	base("AGENT_BINARY_DIR", "performance", "path", {
		description: "Directory containing pre-downloaded agent binaries.",
	}),
	base("AGENT_TARGET_DIR", "performance", "path", {
		default: "/opt/catalyst-agent",
		description: "Install directory for the agent on nodes.",
	}),
	base("DEPLOY_SCRIPT_PATH", "performance", "path", {
		description: "Path to a custom agent deployment script.",
	}),
	base("DOCKER_BIN", "performance", "path", {
		default: "docker",
		description: "Path to the Docker binary used by the panel self-updater.",
	}),
	base("AGENT_BACKPRESSURE_BYTES", "performance", "number", {
		min: 1,
		description: "Per-agent relay backpressure high-water mark, in bytes.",
	}),
	base("RELAY_BACKPRESSURE_CEILING_BYTES", "performance", "number", {
		min: 1,
		description: "Hard ceiling for relay buffering, in bytes.",
	}),
	base("RELAY_BACKPRESSURE_HIGH_BYTES", "performance", "number", {
		min: 1,
		description: "Relay high-water mark, in bytes.",
	}),
	base("RELAY_BACKPRESSURE_LOW_BYTES", "performance", "number", {
		min: 0,
		description: "Relay low-water mark, in bytes.",
	}),
	base("RELAY_STALL_MS", "performance", "number", {
		min: 0,
		description: "Milliseconds before a stalled relay is reset.",
	}),
	base("STUCK_TRANSFER_STATE_TIMEOUT_MS", "performance", "number", {
		default: "3600000",
		min: 1000,
		description: "Age after which an in-flight transfer is considered stuck.",
	}),
	base("STUCK_BACKUP_STATE_TIMEOUT_MS", "performance", "number", {
		min: 1000,
		description: "Age after which an in-flight backup is considered stuck.",
	}),
	base("STUCK_BACKUP_STATE_INTERVAL_MS", "performance", "number", {
		min: 1000,
		description: "How often the stuck-backup watchdog runs.",
	}),

	// ── Updates ───────────────────────────────────────────────────────────
	base("AUTO_UPDATE_DOCKER_COMPOSE_PATH", "updates", "path", {
		// The enable/trigger/interval live in System > Updates; the compose path
		// is deployment-specific and has no panel editor, so it stays here.
		description: "docker-compose.yml used by the panel self-updater.",
	}),
	base("AUTO_UPDATE_FORCE_DOCKER", "updates", "boolean", {
		default: "false",
		description: "Force the Docker update path even when it cannot be detected.",
	}),

	// ── Developer / aggressive ────────────────────────────────────────────
	base("DISABLE_RATE_LIMIT", "developer", "boolean", {
		default: "false",
		description: "Disable rate limiting. Never honored in production.",
	}),
	base("BENCHMARK_FAIR", "developer", "boolean", {
		default: "false",
		description: "Benchmark mode: rate limits off and external polling suppressed.",
	}),
	base("BENCHMARK_DISABLE_RATE_LIMIT", "developer", "boolean", {
		default: "false",
		description: "Benchmark mode: bypass rate limiting.",
	}),
	base("REGISTRATION_ENABLED", "auth", "boolean", {
		default: "false",
		description: "Allow open self-registration from the public sign-up page.",
	}),

	// ── Managed elsewhere (hidden from Admin > Environment) ───────────────
	// These have a dedicated editor in the panel, so showing them here too
	// would give two places to change one setting. `managedBy` documents the
	// owner and keeps them out of the API/UI while staying registered for the
	// completeness test.
	base("AUTO_UPDATE_ENABLED", "updates", "boolean", {
		managedBy: "updates",
		description: "Panel self-update polling. Configure under System > Updates.",
	}),
	base("AUTO_UPDATE_AUTO_TRIGGER", "updates", "boolean", {
		managedBy: "updates",
		description: "Apply releases without confirmation. Configure under System > Updates.",
	}),
	base("AUTO_UPDATE_INTERVAL_MS", "updates", "number", {
		managedBy: "updates",
		min: 60000,
		description: "Release-check cadence. Configure under System > Updates.",
	}),

	// ── Internal plumbing (never exposed) ─────────────────────────────────
	base("CATALYST_BACKGROUND_JOB_OWNER", "developer", "string", { internal: true }),
	base("REDIS_TEST_HOST", "developer", "string", { internal: true }),
	base("REDIS_TEST_PORT", "developer", "string", { internal: true }),
	base("CATALYST_ADMIN_EMAIL", "developer", "string", { internal: true }),
	base("CATALYST_ADMIN_USERNAME", "developer", "string", { internal: true }),
	base("CATALYST_ADMIN_PASSWORD", "developer", "secret", { internal: true, secret: true }),
	base("CATALYST_ADMIN_NAME", "developer", "string", { internal: true }),
	base("SEED_ALLOW_DEFAULT_ADMIN", "developer", "boolean", { internal: true }),
	base("SEED_NODE_PUBLIC_ADDRESS", "developer", "string", { internal: true }),
	base("SEED_NODE_HOSTNAME", "developer", "string", { internal: true }),
	base("CATALYST_RESTART_SUPERVISED", "developer", "boolean", { internal: true }),
];

export const ENV_VAR_BY_KEY: ReadonlyMap<string, EnvVarSpec> = new Map(
	ENV_VAR_REGISTRY.map((spec) => [spec.key, spec]),
);

/**
 * Entries exposed through the admin API. Internal plumbing is never exposed,
 * and settings owned by another panel page (`managedBy`) are hidden so the
 * panel keeps a single editor for each value.
 */
export const PUBLIC_ENV_VAR_REGISTRY: readonly EnvVarSpec[] = ENV_VAR_REGISTRY.filter(
	(spec) => !spec.internal && !spec.managedBy,
);

/** Registry entries the first-run wizard asks for. */
export const SETUP_ENV_VARS: readonly EnvVarSpec[] = PUBLIC_ENV_VAR_REGISTRY.filter(
	(spec) => spec.setup,
);

/** Humanized fallback title, e.g. `BACKUP_S3_BUCKET` -> `Backup S3 Bucket`. */
export function humanizeEnvKey(key: string): string {
	return key
		.toLowerCase()
		.split("_")
		.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
		.join(" ");
}

export function envVarTitle(spec: EnvVarSpec): string {
	return spec.title ?? humanizeEnvKey(spec.key);
}

export function isBootstrapOnly(key: string): boolean {
	return BOOTSTRAP_KEYS.has(key);
}
