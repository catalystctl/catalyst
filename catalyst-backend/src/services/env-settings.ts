/**
 * Runtime environment overrides (Admin > Environment).
 *
 * The database (`EnvSetting`) is the source of truth for every non-bootstrap
 * variable. `initializeEnvOverrides()` runs from `src/start.ts` *before* the
 * application modules are imported, so a value stored here is already on
 * `process.env` by the time anything reads it. That is why most variables are
 * marked `restartRequired`: the running process keeps the value it booted with
 * until it is restarted, and the admin UI surfaces a reboot prompt.
 *
 * A handful of variables (`restartRequired: false`) are read per request; those
 * are applied to `process.env` immediately on save.
 *
 * Nothing here is cached: the admin page and the restart-status poll are low
 * frequency, and a stale "restart required" answer is worse than a cheap query.
 */
import { prisma } from "../db.js";
import {
	ENV_VAR_BY_KEY,
	PUBLIC_ENV_VAR_REGISTRY,
	SETUP_ENV_VARS,
	envVarTitle,
	isBootstrapOnly,
	type EnvCategory,
	type EnvValueType,
	type EnvVarSpec,
} from "../lib/env-registry.js";

export const ENV_SETTING_TABLE = "EnvSetting";

export type EnvValueSource = "database" | "environment" | "default" | "unset";

export interface EnvEntry {
	key: string;
	title: string;
	category: EnvCategory;
	type: EnvValueType;
	editable: boolean;
	secret: boolean;
	/** True when the value will not take effect until the panel restarts. */
	restartRequired: boolean;
	/** This entry differs from the value the running process booted with. */
	changedSinceBoot: boolean;
	source: EnvValueSource;
	/** Masked for secrets. Null when nothing sets the value. */
	value: string | null;
	/** A secret has a value somewhere (database or environment). */
	isSet: boolean;
	/** A database override row exists. */
	hasOverride: boolean;
	default: string | null;
	options?: readonly string[];
	min?: number;
	max?: number;
	placeholder?: string;
	description?: string;
}

export interface EnvOverview {
	/** At least one changed variable needs a restart to take effect. */
	restartRequired: boolean;
	/** Keys that differ from the running process. */
	changedKeys: string[];
	entries: EnvEntry[];
}

export class EnvValidationError extends Error {
	readonly key: string;
	constructor(key: string, message: string) {
		super(message);
		this.name = "EnvValidationError";
		this.key = key;
	}
}

// ── Boot state ────────────────────────────────────────────────────────────
// Captured once per process: the .env/container values that were present
// before DB overrides were applied, and the effective values the process is
// actually running with. The diff between "desired" (database) and
// "bootEffective" is what drives the restart prompt.

let initialized = false;
let baseEnvironment = new Map<string, string | undefined>();
let bootEffective = new Map<string, string | null>();

function captureBaseEnvironment(): void {
	baseEnvironment = new Map();
	for (const spec of PUBLIC_ENV_VAR_REGISTRY) {
		baseEnvironment.set(spec.key, process.env[spec.key]);
	}
}

/** Effective value from the database, falling back to env, then default. */
function desiredValue(
	key: string,
	dbValue: string | undefined,
): { value: string | null; source: EnvValueSource } {
	if (dbValue !== undefined) return { value: dbValue, source: "database" };
	const envValue = baseEnvironment.get(key);
	if (envValue !== undefined && envValue !== "") {
		return { value: envValue, source: "environment" };
	}
	const spec = ENV_VAR_BY_KEY.get(key);
	if (spec?.default !== undefined) return { value: spec.default, source: "default" };
	return { value: null, source: "unset" };
}

async function readOverrideRows(): Promise<Map<string, string>> {
	const rows = await prisma.envSetting.findMany({ select: { key: true, value: true } });
	return new Map(rows.map((row) => [row.key, row.value]));
}

/**
 * Apply database overrides to `process.env`. Must run before the app modules
 * are imported (see `src/start.ts`). Safe to call more than once; later calls
 * refresh the boot snapshot.
 */
export async function initializeEnvOverrides(): Promise<void> {
	captureBaseEnvironment();
	let rows = new Map<string, string>();
	try {
		rows = await readOverrideRows();
	} catch (error) {
		// First boot before migrations, unreachable DB, or a test process with
		// no database: run with .env values rather than crashing the panel.
		console.warn(
			"[env-settings] Could not read environment overrides; using .env values only:",
			error instanceof Error ? error.message : error,
		);
		initialized = true;
		bootEffective = new Map();
		for (const spec of PUBLIC_ENV_VAR_REGISTRY) {
			const envValue = process.env[spec.key];
			bootEffective.set(spec.key, envValue ?? spec.default ?? null);
		}
		return;
	}

	bootEffective = new Map();
	for (const spec of PUBLIC_ENV_VAR_REGISTRY) {
		const override = rows.get(spec.key);
		if (override !== undefined) {
			process.env[spec.key] = override;
		}
		const effective = override ?? process.env[spec.key] ?? spec.default ?? null;
		bootEffective.set(spec.key, normalizeEffective(effective));
	}
	initialized = true;
}

/**
 * An empty environment assignment (`FOO=`) means "not set": `desiredValue`
 * treats it that way, so the boot snapshot must too or every empty `.env`
 * entry would look like a pending change.
 */
function normalizeEffective(value: string | null): string | null {
	return value === "" ? null : value;
}

/** Test/CLI helper — treats the current environment as the boot snapshot. */
export async function ensureInitialized(): Promise<void> {
	if (initialized) return;
	// Late initialization: this process did not boot through the loader
	// (`src/index.ts`), so the database overrides were never applied. Do NOT
	// apply them now — a value that requires a restart must not leak into a
	// running process (rotating BETTER_AUTH_SECRET mid-flight would invalidate
	// live sessions). Treat the current environment as the boot value instead,
	// so every stored override correctly surfaces as "restart required".
	captureBaseEnvironment();
	bootEffective = new Map();
	for (const spec of PUBLIC_ENV_VAR_REGISTRY) {
		bootEffective.set(
			spec.key,
			normalizeEffective(process.env[spec.key] ?? spec.default ?? null),
		);
	}
	initialized = true;
}

/** Test helper: forget the boot snapshot so the next call re-reads it. */
export function resetEnvSettingsState(): void {
	initialized = false;
	baseEnvironment = new Map();
	bootEffective = new Map();
}

/** Snapshot of the effective values the running process booted with. */
export function getBootEffective(key: string): string | null {
	return bootEffective.get(key) ?? null;
}

// ── Validation ────────────────────────────────────────────────────────────

const MAX_STRING_LENGTH = 4096;
const MAX_SECRET_LENGTH = 16_384;

const TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/**
 * Validate and canonicalize a raw string for a registry entry. Throws
 * `EnvValidationError` on bad input. Returns the value to persist.
 */
export function validateEnvValue(spec: EnvVarSpec, raw: string): string {
	const value = raw.trim();
	if (!spec.editable) {
		throw new EnvValidationError(spec.key, `${spec.key} is managed in .env and cannot be changed here`);
	}
	const maxLength = spec.secret ? MAX_SECRET_LENGTH : MAX_STRING_LENGTH;
	if (value.length > maxLength) {
		throw new EnvValidationError(spec.key, `${spec.key} must be at most ${maxLength} characters`);
	}
	switch (spec.type) {
		case "boolean": {
			const lower = value.toLowerCase();
			if (TRUE_VALUES.has(lower)) return "true";
			if (FALSE_VALUES.has(lower)) return "false";
			throw new EnvValidationError(spec.key, `${spec.key} must be true or false`);
		}
		case "number": {
			if (!/^-?\d+$/.test(value)) {
				throw new EnvValidationError(spec.key, `${spec.key} must be an integer`);
			}
			const parsed = Number.parseInt(value, 10);
			if (spec.min !== undefined && parsed < spec.min) {
				throw new EnvValidationError(spec.key, `${spec.key} must be at least ${spec.min}`);
			}
			if (spec.max !== undefined && parsed > spec.max) {
				throw new EnvValidationError(spec.key, `${spec.key} must be at most ${spec.max}`);
			}
			return String(parsed);
		}
		case "enum": {
			if (!spec.options || !spec.options.includes(value)) {
				throw new EnvValidationError(
					spec.key,
					`${spec.key} must be one of: ${(spec.options ?? []).join(", ")}`,
				);
			}
			return value;
		}
		case "url": {
			if (!/^https?:\/\/[^\s]+$/i.test(value)) {
				throw new EnvValidationError(spec.key, `${spec.key} must be an http(s) URL`);
			}
			return value;
		}
		case "list": {
			const parts = value
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean);
			return parts.join(",");
		}
		default:
			return value;
	}
}

// ── Reads ─────────────────────────────────────────────────────────────────

function maskSecret(value: string): string {
	if (!value) return "";
	if (value.length <= 4) return "•".repeat(value.length);
	return `${"•".repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

async function buildEntries(): Promise<{
	entries: EnvEntry[];
	changedKeys: string[];
}> {
	await ensureInitialized();
	const rows = await readOverrideRows();
	const entries: EnvEntry[] = [];
	const changedKeys: string[] = [];

	for (const spec of PUBLIC_ENV_VAR_REGISTRY) {
		const hasOverride = rows.has(spec.key);
		const desired = desiredValue(spec.key, rows.get(spec.key));
		const running = bootEffective.get(spec.key) ?? null;
		const changedSinceBoot = desired.value !== running;
		const isSet = desired.value !== null && desired.value !== "";
		if (changedSinceBoot) changedKeys.push(spec.key);

		entries.push({
			key: spec.key,
			title: envVarTitle(spec),
			category: spec.category,
			type: spec.type,
			editable: spec.editable,
			secret: Boolean(spec.secret),
			restartRequired: spec.restartRequired !== false,
			changedSinceBoot,
			source: desired.source,
			value: spec.secret ? (isSet ? maskSecret(desired.value ?? "") : null) : desired.value,
			isSet,
			hasOverride,
			default: spec.default ?? null,
			options: spec.options,
			min: spec.min,
			max: spec.max,
			placeholder: spec.placeholder,
			description: spec.description,
		});
	}

	return { entries, changedKeys };
}

/**
 * Whether a restart is needed for pending changes to take effect. Only
 * restart-required variables count; live variables are applied on save.
 */
export function restartRequiredKeys(
	entries: EnvEntry[],
): string[] {
	return entries
		.filter((entry) => entry.changedSinceBoot && entry.restartRequired && entry.editable)
		.map((entry) => entry.key);
}

export async function getEnvOverview(): Promise<EnvOverview> {
	const { entries, changedKeys } = await buildEntries();
	const restartKeys = restartRequiredKeys(entries);
	return {
		restartRequired: restartKeys.length > 0,
		changedKeys,
		entries,
	};
}

/** Cheap endpoint polled by the global restart banner. */
export async function getEnvRestartStatus(): Promise<{
	restartRequired: boolean;
	changedKeys: string[];
}> {
	const { entries } = await buildEntries();
	const changedKeys = restartRequiredKeys(entries);
	return { restartRequired: changedKeys.length > 0, changedKeys };
}

/** Setup-wizard specs: the variables flagged for first-run capture. */
export function getSetupEnvVars(): Array<{
	key: string;
	title: string;
	type: EnvValueType;
	default: string | null;
	placeholder?: string;
	description?: string;
	secret: boolean;
	options?: readonly string[];
}> {
	return PUBLIC_ENV_VAR_REGISTRY.filter((spec) => spec.setup).map((spec) => ({
		key: spec.key,
		title: envVarTitle(spec),
		type: spec.type,
		default: spec.default ?? null,
		placeholder: spec.placeholder,
		description: spec.description,
		secret: Boolean(spec.secret),
		options: spec.options,
	}));
}

// ── Writes ────────────────────────────────────────────────────────────────

/**
 * Persist operator-supplied overrides. `null` or an empty string removes the
 * override and falls back to .env / the built-in default. Variables that do
 * not need a restart are applied to `process.env` immediately.
 */
export async function updateEnvSettings(
	updates: Record<string, string | null>,
): Promise<EnvOverview> {
	await ensureInitialized();

	const normalized = new Map<string, string | null>();
	for (const [key, raw] of Object.entries(updates)) {
		const spec = ENV_VAR_BY_KEY.get(key);
		if (!spec || spec.internal) {
			throw new EnvValidationError(key, `Unknown environment variable: ${key}`);
		}
		if (!spec.editable) {
			throw new EnvValidationError(
				key,
				`${key} is required before startup and must be set in .env`,
			);
		}
		if (raw === null || raw.trim() === "") {
			normalized.set(key, null);
		} else {
			normalized.set(key, validateEnvValue(spec, raw));
		}
	}

	if (normalized.size > 0) {
		await prisma.$transaction(
			[...normalized.entries()].map(([key, value]) =>
				value === null
					? prisma.envSetting.deleteMany({ where: { key } })
					: prisma.envSetting.upsert({
							where: { key },
							create: { key, value },
							update: { value },
						}),
			),
		);
	}

	// Apply variables that do not need a restart so they take effect now.
	// This mutates only the handling process: with WORKERS>1 the other workers
	// keep the old value until restart. Multi-worker is discouraged for the
	// panel (agent sockets are process-local), and every restart-required
	// variable is applied consistently at boot, so that is an accepted limit.
	for (const [key, value] of normalized) {
		const spec = ENV_VAR_BY_KEY.get(key);
		if (!spec || spec.restartRequired !== false) continue;
		const effective = value ?? baseEnvironment.get(key) ?? spec.default ?? null;
		if (effective === null || effective === "") {
			delete process.env[key];
		} else {
			process.env[key] = effective;
		}
		bootEffective.set(key, effective === "" ? null : effective);
	}

	return getEnvOverview();
}

/** Remove a single database override, restoring the .env / default value. */
export async function resetEnvSetting(key: string): Promise<EnvOverview> {
	return updateEnvSettings({ [key]: null });
}

/**
 * Persist the environment values captured by the first-run wizard.
 *
 * The setup endpoint is unauthenticated, so only keys flagged `setup` in the
 * registry are accepted — anything else is ignored rather than rejected, which
 * keeps an older/newer frontend from breaking setup.
 */
export async function applySetupEnvVars(
	values: Record<string, string>,
): Promise<void> {
	const allowed = new Set(SETUP_ENV_VARS.map((spec) => spec.key));
	const updates: Record<string, string | null> = {};
	for (const [key, raw] of Object.entries(values)) {
		if (!allowed.has(key)) continue;
		const spec = ENV_VAR_BY_KEY.get(key);
		if (!spec) continue;
		const trimmed = typeof raw === "string" ? raw.trim() : "";
		if (!trimmed) continue;
		updates[key] = validateEnvValue(spec, trimmed);
	}
	if (Object.keys(updates).length > 0) {
		await updateEnvSettings(updates);
	}
}

/** Bootstrap-only keys, surfaced so the UI can explain why they are read-only. */
export function bootstrapOnlyKeys(): string[] {
	return PUBLIC_ENV_VAR_REGISTRY.filter((spec) => isBootstrapOnly(spec.key)).map(
		(spec) => spec.key,
	);
}
