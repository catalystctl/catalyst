/**
 * Update automation settings (row id `auto_update`).
 *
 * These used to be read straight from `AUTO_UPDATE_*` environment variables,
 * which meant changing them required a redeploy and every worker had to agree.
 * The database is now the source of truth so admins can change them at runtime
 * from Admin > System.
 *
 * For upgraded installs the environment variables still win exactly once: the
 * first read seeds the row from them, so an instance that opted in via
 * `AUTO_UPDATE_ENABLED=true` keeps its behaviour instead of silently going
 * quiet. Fresh installs fall back to disabled / manual confirmation.
 *
 * The panel self-update (`enabled`, `autoTrigger`) and the per-node agent
 * fan-out are separate concerns: whether a specific node may update itself is
 * `Node.autoUpdateEnabled` (see services/node-update-policy.ts).
 */
import { prisma } from '../db.js';
import { cachedConfig, invalidateConfig } from '../lib/config-cache.js';

export const AUTO_UPDATE_SETTING_ID = 'auto_update';

/** Check cadence used when nothing has been configured. */
export const DEFAULT_AUTO_UPDATE_INTERVAL_MS = 60 * 60 * 1000;
/** Guard rails for the poll cadence — never hammer the GitHub API. */
export const MIN_AUTO_UPDATE_INTERVAL_MS = 60 * 1000;
export const MAX_AUTO_UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type AutoUpdateSettings = {
	/** Panel self-update polling on/off. */
	enabled: boolean;
	/** Apply a new panel release without an admin confirming it. */
	autoTrigger: boolean;
	/** Panel release-check cadence, in milliseconds. */
	intervalMs: number;
};

export const DEFAULT_AUTO_UPDATE_SETTINGS: AutoUpdateSettings = {
	enabled: false,
	autoTrigger: false,
	intervalMs: DEFAULT_AUTO_UPDATE_INTERVAL_MS,
};

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined || value === "") return fallback;
	return value === "true";
}

function parseIntervalEnv(value: string | undefined): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return DEFAULT_AUTO_UPDATE_INTERVAL_MS;
	}
	return clampAutoUpdateInterval(parsed);
}

export function clampAutoUpdateInterval(value: number): number {
	if (!Number.isFinite(value) || value <= 0) return DEFAULT_AUTO_UPDATE_INTERVAL_MS;
	return Math.min(
		Math.max(Math.round(value), MIN_AUTO_UPDATE_INTERVAL_MS),
		MAX_AUTO_UPDATE_INTERVAL_MS,
	);
}

/** Environment seed, evaluated once per process on first read. */
function environmentSettings(): AutoUpdateSettings {
	return {
		enabled: parseBooleanEnv(process.env.AUTO_UPDATE_ENABLED, false),
		autoTrigger: parseBooleanEnv(process.env.AUTO_UPDATE_AUTO_TRIGGER, false),
		intervalMs: parseIntervalEnv(process.env.AUTO_UPDATE_INTERVAL_MS),
	};
}

function rowSettings(row: {
	autoUpdateEnabled: boolean | null;
	autoUpdateAutoTrigger: boolean | null;
	autoUpdateIntervalMs: number | null;
} | null): AutoUpdateSettings {
	if (!row) return environmentSettings();
	return {
		enabled: row.autoUpdateEnabled ?? false,
		autoTrigger: row.autoUpdateAutoTrigger ?? false,
		intervalMs:
			row.autoUpdateIntervalMs && row.autoUpdateIntervalMs > 0
				? clampAutoUpdateInterval(row.autoUpdateIntervalMs)
				: DEFAULT_AUTO_UPDATE_INTERVAL_MS,
	};
}

/** Settings as stored, without the environment seed. Used by the admin API
 *  so the UI can say whether the row has been configured yet. */
export async function readStoredAutoUpdateSettings(): Promise<AutoUpdateSettings | null> {
	const row = await prisma.systemSetting.findUnique({
		where: { id: AUTO_UPDATE_SETTING_ID },
		select: {
			autoUpdateEnabled: true,
			autoUpdateAutoTrigger: true,
			autoUpdateIntervalMs: true,
		},
	});
	if (!row) return null;
	return rowSettings(row);
}

export const getAutoUpdateSettings = async (): Promise<AutoUpdateSettings> => {
	return cachedConfig('auto_update', async () => {
		const row = await prisma.systemSetting.findUnique({
			where: { id: AUTO_UPDATE_SETTING_ID },
			select: {
				autoUpdateEnabled: true,
				autoUpdateAutoTrigger: true,
				autoUpdateIntervalMs: true,
			},
		});
		return rowSettings(row);
	});
};

export const updateAutoUpdateSettings = async (
	input: AutoUpdateSettings,
): Promise<AutoUpdateSettings> => {
	const next: AutoUpdateSettings = {
		enabled: Boolean(input.enabled),
		autoTrigger: Boolean(input.autoTrigger),
		intervalMs: clampAutoUpdateInterval(input.intervalMs),
	};
	await prisma.systemSetting.upsert({
		where: { id: AUTO_UPDATE_SETTING_ID },
		create: {
			id: AUTO_UPDATE_SETTING_ID,
			autoUpdateEnabled: next.enabled,
			autoUpdateAutoTrigger: next.autoTrigger,
			autoUpdateIntervalMs: next.intervalMs,
		},
		update: {
			autoUpdateEnabled: next.enabled,
			autoUpdateAutoTrigger: next.autoTrigger,
			autoUpdateIntervalMs: next.intervalMs,
		},
	});
	await invalidateConfig('auto_update');
	return next;
};
