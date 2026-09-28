import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	ENV_VAR_BY_KEY,
	PUBLIC_ENV_VAR_REGISTRY,
	SETUP_ENV_VARS,
} from "../lib/env-registry";
import {
	EnvValidationError,
	ensureInitialized,
	getEnvOverview,
	resetEnvSetting,
	resetEnvSettingsState,
	updateEnvSettings,
	validateEnvValue,
} from "../services/env-settings";
import { prisma } from "../db";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(HERE, "..");

/** Recursively collect non-test source files. */
function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "__tests__" || entry.name === "node_modules") continue;
			sourceFiles(full, out);
		} else if (entry.isFile() && full.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

describe("env registry", () => {
	it("registers every environment variable the source reads", () => {
		const pattern = /process\.env\.([A-Z][A-Z0-9_]*)/g;
		const missing = new Set<string>();
		for (const file of sourceFiles(SRC_ROOT)) {
			// Skip this file's own directory entirely (it is covered above) and
			// the registry doc comment that mentions `process.env.X`.
			const source = fs.readFileSync(file, "utf8");
			for (const match of source.matchAll(pattern)) {
				const key = match[1];
				if (key === "X") continue;
				if (!ENV_VAR_BY_KEY.has(key)) missing.add(key);
			}
		}
		expect([...missing].sort()).toEqual([]);
	});

	it("keeps internal entries out of the public registry", () => {
		for (const spec of PUBLIC_ENV_VAR_REGISTRY) {
			expect(spec.internal).not.toBe(true);
		}
	});

	it("hides settings that have a dedicated editor elsewhere in the panel", () => {
		const publicKeys = new Set(PUBLIC_ENV_VAR_REGISTRY.map((spec) => spec.key));
		// Owned by Theme, System > Updates, Security and the marketplace dialog.
		for (const key of [
			"APP_NAME",
			"WHMCS_OIDC_CLIENT_ID",
			"PAYMENTER_OIDC_CLIENT_SECRET",
			"CONSOLE_OUTPUT_BYTE_LIMIT_BYTES",
			"AUTO_UPDATE_ENABLED",
			"AUTO_UPDATE_AUTO_TRIGGER",
			"AUTO_UPDATE_INTERVAL_MS",
			"PLUGIN_MARKETPLACE_URLS",
		]) {
			expect(publicKeys.has(key)).toBe(false);
		}
		// These have no panel editor, so they stay on the Environment page.
		for (const key of [
			"REGISTRATION_ENABLED",
			"AUTO_UPDATE_DOCKER_COMPOSE_PATH",
			"PLUGIN_MARKETPLACE_ALLOW_LOCAL",
		]) {
			expect(publicKeys.has(key)).toBe(true);
		}
	});

	it("only asks the setup wizard for PUBLIC_URL", () => {
		expect(SETUP_ENV_VARS.map((spec) => spec.key)).toEqual(["PUBLIC_URL"]);
	});

	it("marks bootstrap-only keys as read-only", () => {
		expect(ENV_VAR_BY_KEY.get("DATABASE_URL")?.editable).toBe(false);
		expect(ENV_VAR_BY_KEY.get("NODE_ENV")?.editable).toBe(false);
		expect(ENV_VAR_BY_KEY.get("PORT")?.editable).toBe(false);
		expect(ENV_VAR_BY_KEY.get("LOG_LEVEL")?.editable).toBe(true);
	});
});

describe("validateEnvValue", () => {
	it("canonicalizes booleans", () => {
		const spec = ENV_VAR_BY_KEY.get("DOCS_ENABLED")!;
		expect(validateEnvValue(spec, " TRUE ")).toBe("true");
		expect(validateEnvValue(spec, "0")).toBe("false");
		expect(() => validateEnvValue(spec, "maybe")).toThrow(EnvValidationError);
	});

	it("enforces integer bounds", () => {
		const spec = ENV_VAR_BY_KEY.get("PORT")!;
		expect(() => validateEnvValue(spec, "99999")).toThrow(EnvValidationError);
		expect(() => validateEnvValue(spec, "abc")).toThrow(EnvValidationError);
	});

	it("restricts enum values", () => {
		const spec = ENV_VAR_BY_KEY.get("LOG_LEVEL")!;
		expect(validateEnvValue(spec, "warn")).toBe("warn");
		expect(() => validateEnvValue(spec, "verbose")).toThrow(EnvValidationError);
	});

	it("rejects bootstrap-only keys", () => {
		const spec = ENV_VAR_BY_KEY.get("DATABASE_URL")!;
		expect(() => validateEnvValue(spec, "postgresql://x")).toThrow(EnvValidationError);
	});
});

describe("env settings persistence", () => {
	const LIVE_KEY = "DOCS_ENABLED";
	const RESTART_KEY = "LOG_LEVEL";
	const originalLive = process.env[LIVE_KEY];
	const originalRestart = process.env[RESTART_KEY];

	beforeAll(async () => {
		resetEnvSettingsState();
		await ensureInitialized();
	});

	afterEach(async () => {
		await prisma.envSetting.deleteMany({
			where: { key: { in: [LIVE_KEY, RESTART_KEY] } },
		});
		if (originalLive === undefined) delete process.env[LIVE_KEY];
		else process.env[LIVE_KEY] = originalLive;
		if (originalRestart === undefined) delete process.env[RESTART_KEY];
		else process.env[RESTART_KEY] = originalRestart;
		resetEnvSettingsState();
		await ensureInitialized();
	});

	afterAll(async () => {
		await prisma.envSetting.deleteMany({
			where: { key: { in: [LIVE_KEY, RESTART_KEY] } },
		});
	});

	it("applies a live variable immediately without a restart", async () => {
		const overview = await updateEnvSettings({ [LIVE_KEY]: "true" });
		expect(process.env[LIVE_KEY]).toBe("true");
		const entry = overview.entries.find((item) => item.key === LIVE_KEY);
		expect(entry?.source).toBe("database");
		expect(entry?.changedSinceBoot).toBe(false);
		// A live variable must never be reported as needing a restart.
		expect(overview.changedKeys).not.toContain(LIVE_KEY);
	});

	it("defers a restart-required variable and reports it", async () => {
		const before = process.env[RESTART_KEY];
		const next = before === "debug" ? "warn" : "debug";
		const overview = await updateEnvSettings({ [RESTART_KEY]: next });
		// Not applied to the running process yet.
		expect(process.env[RESTART_KEY]).toBe(before);
		expect(overview.restartRequired).toBe(true);
		expect(overview.changedKeys).toContain(RESTART_KEY);
		const entry = overview.entries.find((item) => item.key === RESTART_KEY);
		expect(entry?.changedSinceBoot).toBe(true);
		expect(entry?.value).toBe(next);
	});

	it("resets an override back to the environment/default value", async () => {
		await updateEnvSettings({ [LIVE_KEY]: "true" });
		const overview = await resetEnvSetting(LIVE_KEY);
		expect(overview.changedKeys).not.toContain(LIVE_KEY);
		const entry = overview.entries.find((item) => item.key === LIVE_KEY);
		expect(entry?.hasOverride).toBe(false);
		expect(entry?.source).not.toBe("database");
	});

	it("rejects unknown or internal keys", async () => {
		await expect(updateEnvSettings({ NOT_A_REAL_VAR: "x" })).rejects.toThrow(
			EnvValidationError,
		);
		await expect(
			updateEnvSettings({ CATALYST_BACKGROUND_JOB_OWNER: "1" }),
		).rejects.toThrow(EnvValidationError);
	});

	it("masks secret values in the overview", async () => {
		const overview = await getEnvOverview();
		const secret = overview.entries.find((item) => item.key === "BETTER_AUTH_SECRET");
		expect(secret).toBeDefined();
		expect(secret?.secret).toBe(true);
		if (secret?.isSet) {
			expect(secret.value).toContain("•");
			expect(secret.value).not.toBe(process.env.BETTER_AUTH_SECRET);
		}
	});
});
