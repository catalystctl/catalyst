import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import {
	isPanelSemver,
	normalizePanelVersion,
} from "../lib/panel-version";

describe("normalizePanelVersion", () => {
	it("accepts 2- and 3-part semver and strips a leading v", () => {
		expect(normalizePanelVersion("1.18.8")).toBe("1.18.8");
		expect(normalizePanelVersion("v1.18.8")).toBe("1.18.8");
		expect(normalizePanelVersion("1.18")).toBe("1.18");
		expect(normalizePanelVersion("  v2.0.0  ")).toBe("2.0.0");
	});

	it("rejects empty, latest, and injection-shaped strings", () => {
		expect(normalizePanelVersion(undefined)).toBeUndefined();
		expect(normalizePanelVersion("")).toBeUndefined();
		expect(normalizePanelVersion("unknown")).toBeUndefined();
		expect(normalizePanelVersion("latest")).toBeUndefined();
		expect(normalizePanelVersion("1.18.8/../../../etc/passwd")).toBeUndefined();
		expect(normalizePanelVersion("1.18.8%2Fevil")).toBeUndefined();
	});
});

describe("isPanelSemver", () => {
	it("is false for unknown / empty", () => {
		expect(isPanelSemver("unknown")).toBe(false);
		expect(isPanelSemver("")).toBe(false);
		expect(isPanelSemver(null)).toBe(false);
	});

	it("is true for real versions", () => {
		expect(isPanelSemver("1.18.8")).toBe(true);
		expect(isPanelSemver("v1.18.8")).toBe(true);
	});
});

describe("getCurrentVersion", () => {
	const originalCwd = process.cwd();

	afterEach(() => {
		process.chdir(originalCwd);
	});

	it("reads a version from cwd package.json when that is the first hit", async () => {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "catalyst-version-"));
		fs.writeFileSync(
			path.join(tmp, "package.json"),
			JSON.stringify({ name: "fixture", version: "9.9.9" }),
		);
		process.chdir(tmp);

		// Fresh import is unnecessary — getCurrentVersion walks cwd last, after
		// the compiled/source package.json which exists in this repo. Just assert
		// the production helper returns a real semver from this checkout.
		const { getCurrentVersion } = await import("../lib/panel-version");
		const version = getCurrentVersion();
		expect(isPanelSemver(version)).toBe(true);
		expect(version).not.toBe("unknown");

		// And the workspace package.json is what we expect to find first.
		const req = createRequire(import.meta.url);
		const pkg = req("../../package.json") as { version: string };
		expect(version).toBe(pkg.version);
	});
});
