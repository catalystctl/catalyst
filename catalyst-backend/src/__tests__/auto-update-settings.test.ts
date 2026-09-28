/**
 * Update automation settings moved from env-only to the DB so admins can
 * change them at runtime. These tests pin the two behaviours that matter:
 * the environment only seeds an unconfigured instance, and saved values win
 * from then on.
 */
import 'dotenv/config';
import { afterEach, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db.js';
import { invalidateConfig, clearConfigCacheMemory } from '../lib/config-cache.js';
import {
	AUTO_UPDATE_SETTING_ID,
	DEFAULT_AUTO_UPDATE_INTERVAL_MS,
	MAX_AUTO_UPDATE_INTERVAL_MS,
	MIN_AUTO_UPDATE_INTERVAL_MS,
	clampAutoUpdateInterval,
	getAutoUpdateSettings,
	readStoredAutoUpdateSettings,
	updateAutoUpdateSettings,
} from '../services/auto-update-settings';

const originalEnv = {
	enabled: process.env.AUTO_UPDATE_ENABLED,
	trigger: process.env.AUTO_UPDATE_AUTO_TRIGGER,
	interval: process.env.AUTO_UPDATE_INTERVAL_MS,
};

function restoreEnv() {
	const pairs: [string, string | undefined][] = [
		['AUTO_UPDATE_ENABLED', originalEnv.enabled],
		['AUTO_UPDATE_AUTO_TRIGGER', originalEnv.trigger],
		['AUTO_UPDATE_INTERVAL_MS', originalEnv.interval],
	];
	for (const [key, value] of pairs) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

async function dropSettingRow() {
	await prisma.systemSetting.deleteMany({ where: { id: AUTO_UPDATE_SETTING_ID } });
	// invalidateConfig clears the L1 map and the Redis L2 entry; a bare
	// clearConfigCacheMemory() would leave a stale value in Redis for later suites.
	await invalidateConfig('auto_update');
	clearConfigCacheMemory();
}

beforeEach(async () => {
	await dropSettingRow();
});

afterEach(async () => {
	restoreEnv();
	await dropSettingRow();
});

afterAll(async () => {
	await dropSettingRow();
});

describe('clampAutoUpdateInterval', () => {
	it('keeps a value inside the allowed range', () => {
		expect(clampAutoUpdateInterval(2 * 60 * 60 * 1000)).toBe(2 * 60 * 60 * 1000);
	});

	it('raises a too-small value to the floor', () => {
		expect(clampAutoUpdateInterval(1)).toBe(MIN_AUTO_UPDATE_INTERVAL_MS);
	});

	it('caps a too-large value', () => {
		expect(clampAutoUpdateInterval(Number.MAX_SAFE_INTEGER)).toBe(MAX_AUTO_UPDATE_INTERVAL_MS);
	});

	it('falls back to the default for non-positive or invalid input', () => {
		expect(clampAutoUpdateInterval(0)).toBe(DEFAULT_AUTO_UPDATE_INTERVAL_MS);
		expect(clampAutoUpdateInterval(Number.NaN)).toBe(DEFAULT_AUTO_UPDATE_INTERVAL_MS);
	});
});

describe('environment seeding', () => {
	it('defaults to disabled manual updates when nothing is configured', async () => {
		delete process.env.AUTO_UPDATE_ENABLED;
		delete process.env.AUTO_UPDATE_AUTO_TRIGGER;
		delete process.env.AUTO_UPDATE_INTERVAL_MS;
		await invalidateConfig('auto_update');
		clearConfigCacheMemory();

		const settings = await getAutoUpdateSettings();
		expect(settings).toEqual({
			enabled: false,
			autoTrigger: false,
			intervalMs: DEFAULT_AUTO_UPDATE_INTERVAL_MS,
		});
		expect(await readStoredAutoUpdateSettings()).toBeNull();
	});

	it('seeds from the AUTO_UPDATE_* env vars when the row is missing', async () => {
		process.env.AUTO_UPDATE_ENABLED = 'true';
		process.env.AUTO_UPDATE_AUTO_TRIGGER = 'true';
		process.env.AUTO_UPDATE_INTERVAL_MS = '1800000';
		await invalidateConfig('auto_update');
		clearConfigCacheMemory();

		expect(await getAutoUpdateSettings()).toEqual({
			enabled: true,
			autoTrigger: true,
			intervalMs: 1_800_000,
		});
	});
});

describe('saved settings', () => {
	it('round-trips and takes precedence over the environment', async () => {
		process.env.AUTO_UPDATE_ENABLED = 'true';
		process.env.AUTO_UPDATE_AUTO_TRIGGER = 'true';
		await invalidateConfig('auto_update');
		clearConfigCacheMemory();

		await updateAutoUpdateSettings({ enabled: false, autoTrigger: false, intervalMs: 7_200_000 });

		const settings = await getAutoUpdateSettings();
		expect(settings).toEqual({ enabled: false, autoTrigger: false, intervalMs: 7_200_000 });
		expect(await readStoredAutoUpdateSettings()).toEqual(settings);
	});

	it('clamps an out-of-range interval on write', async () => {
		await updateAutoUpdateSettings({ enabled: true, autoTrigger: false, intervalMs: 5 });
		expect((await getAutoUpdateSettings()).intervalMs).toBe(MIN_AUTO_UPDATE_INTERVAL_MS);
	});

	it('reports a stored row as configured', async () => {
		await updateAutoUpdateSettings({ enabled: true, autoTrigger: false, intervalMs: 3_600_000 });
		expect(await readStoredAutoUpdateSettings()).not.toBeNull();
	});
});
