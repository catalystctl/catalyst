import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
	DEFAULT_AGENT_RELEASE_REPO,
	agentMuslAssetName,
	defaultAgentVersion,
	githubReleaseAssetUrl,
	normalizeAgentArch,
	resolveLocalAgentBinary,
	resolveLocalAgentChecksum,
} from "../lib/agent-binary";
import { getCurrentVersion } from "../lib/panel-version";

describe("normalizeAgentArch", () => {
	it("maps arm aliases to aarch64 and everything else to x86_64", () => {
		expect(normalizeAgentArch("aarch64")).toBe("aarch64");
		expect(normalizeAgentArch("arm64")).toBe("aarch64");
		expect(normalizeAgentArch("x86_64")).toBe("x86_64");
		expect(normalizeAgentArch(undefined)).toBe("x86_64");
		expect(normalizeAgentArch("ppc64")).toBe("x86_64");
	});
});

describe("agentMuslAssetName", () => {
	it("matches the GitHub release asset convention", () => {
		expect(agentMuslAssetName("x86_64")).toBe(
			"catalyst-agent-x86_64-linux-musl",
		);
		expect(agentMuslAssetName("aarch64")).toBe(
			"catalyst-agent-aarch64-linux-musl",
		);
	});
});

describe("githubReleaseAssetUrl", () => {
	it("pins a tag when version is known", () => {
		expect(
			githubReleaseAssetUrl(
				DEFAULT_AGENT_RELEASE_REPO,
				"catalyst-agent-x86_64-linux-musl",
				"1.18.8",
			),
		).toBe(
			"https://github.com/catalystctl/catalyst/releases/download/v1.18.8/catalyst-agent-x86_64-linux-musl",
		);
	});

	it("uses /latest only when version is omitted", () => {
		expect(
			githubReleaseAssetUrl(
				DEFAULT_AGENT_RELEASE_REPO,
				"catalyst-agent-x86_64-linux-musl",
			),
		).toBe(
			"https://github.com/catalystctl/catalyst/releases/latest/download/catalyst-agent-x86_64-linux-musl",
		);
	});
});

describe("defaultAgentVersion", () => {
	it("prefers an explicit valid version", () => {
		expect(defaultAgentVersion("v1.2.3")).toBe("1.2.3");
	});

	it("falls through to the running panel version when requested is missing or non-semver", () => {
		const panel = getCurrentVersion();
		expect(panel).not.toBe("unknown");
		expect(defaultAgentVersion(undefined)).toBe(panel);
		expect(defaultAgentVersion(null)).toBe(panel);
		expect(defaultAgentVersion("latest")).toBe(panel);
		expect(defaultAgentVersion("unknown")).toBe(panel);
		expect(defaultAgentVersion("garbage")).toBe(panel);
	});
});

describe("resolveLocalAgentBinary", () => {
	const tmpDirs: string[] = [];

	afterEach(() => {
		for (const dir of tmpDirs) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
		tmpDirs.length = 0;
	});

	it("prefers the release-asset filename over the cargo target layout", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bin-"));
		tmpDirs.push(dir);
		const asset = "catalyst-agent-x86_64-linux-musl";
		fs.writeFileSync(path.join(dir, asset), "asset");
		fs.mkdirSync(path.join(dir, "x86_64-unknown-linux-musl", "release"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(dir, "x86_64-unknown-linux-musl", "release", "catalyst-agent"),
			"legacy",
		);

		expect(resolveLocalAgentBinary(dir, "x86_64", asset)).toBe(
			path.join(dir, asset),
		);
	});

	it("falls back to the cargo target layout", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bin-"));
		tmpDirs.push(dir);
		const asset = "catalyst-agent-x86_64-linux-musl";
		const legacy = path.join(
			dir,
			"x86_64-unknown-linux-musl",
			"release",
			"catalyst-agent",
		);
		fs.mkdirSync(path.dirname(legacy), { recursive: true });
		fs.writeFileSync(legacy, "legacy");

		expect(resolveLocalAgentBinary(dir, "x86_64", asset)).toBe(legacy);
	});

	it("returns null when nothing is on disk", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bin-"));
		tmpDirs.push(dir);
		expect(
			resolveLocalAgentBinary(dir, "x86_64", "catalyst-agent-x86_64-linux-musl"),
		).toBeNull();
		expect(
			resolveLocalAgentChecksum(dir, "catalyst-agent-x86_64-linux-musl"),
		).toBeNull();
	});
});
