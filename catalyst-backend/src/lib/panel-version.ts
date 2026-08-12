import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Resolve the running panel version from package.json.
 *
 * Layouts we have to support:
 *   - Docker image:   /app/dist/services/foo.js  → /app/package.json
 *   - Compiled local: catalyst-backend/dist/...  → catalyst-backend/package.json
 *   - tsx / tests:    catalyst-backend/src/...   → catalyst-backend/package.json
 *   - monorepo root:  one more hop               → repo package.json
 *
 * The first readable file with a `version` field wins. Callers must treat
 * `"unknown"` as "could not determine" (do not download vunknown).
 */
export function getCurrentVersion(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const candidates = [
		path.resolve(here, "..", "..", "package.json"), // /app/package.json or catalyst-backend/package.json
		path.resolve(here, "..", "..", "..", "package.json"), // repo root from src/ or dist/
		path.resolve(process.cwd(), "package.json"),
	];

	for (const pkgPath of candidates) {
		try {
			if (!fs.existsSync(pkgPath)) continue;
			const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
				version?: unknown;
			};
			if (typeof pkg.version === "string" && pkg.version.trim()) {
				return pkg.version.trim().replace(/^v/i, "");
			}
		} catch {
			// try the next candidate
		}
	}

	return "unknown";
}

/** True when `version` is a usable semver (optional leading `v`, 2 or 3 numeric parts). */
export function isPanelSemver(version: string | null | undefined): boolean {
	if (!version) return false;
	const normalized = version.trim().replace(/^v/i, "");
	return /^\d+\.\d+(\.\d+)?$/.test(normalized);
}

/** Strip a leading `v` and reject anything that is not 2/3-part numeric semver. */
export function normalizePanelVersion(
	version: string | null | undefined,
): string | undefined {
	if (!version) return undefined;
	const normalized = version.trim().replace(/^v/i, "");
	if (!/^\d+\.\d+(\.\d+)?$/.test(normalized)) return undefined;
	return normalized;
}
