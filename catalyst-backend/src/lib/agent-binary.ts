import fs from "fs";
import path from "path";
import { getCurrentVersion, normalizePanelVersion } from "./panel-version";

export const DEFAULT_AGENT_RELEASE_REPO = "catalystctl/catalyst";

export type AgentArch = "x86_64" | "aarch64";

export function normalizeAgentArch(arch: string | undefined): AgentArch {
	return arch === "aarch64" || arch === "arm64" ? "aarch64" : "x86_64";
}

export function agentMuslAssetName(arch: AgentArch): string {
	return `catalyst-agent-${arch}-linux-musl`;
}

export function agentReleaseRepo(): string {
	return process.env.AGENT_RELEASE_REPO || DEFAULT_AGENT_RELEASE_REPO;
}

/**
 * Version to fetch when the caller omitted `?version=` or passed a non-semver
 * placeholder (`latest`, `unknown`). Prefer the running panel version so a
 * 1.18.8 panel never installs 1.19.0 from GitHub `/latest`.
 *
 * Returns undefined only when package.json is unreadable. HTTP handlers that
 * receive an explicit invalid version should 400 *before* calling this — this
 * helper itself must never map garbage → `/latest`.
 */
export function defaultAgentVersion(
	requested?: string | null,
): string | undefined {
	const explicit = normalizePanelVersion(requested ?? undefined);
	if (explicit) return explicit;
	return normalizePanelVersion(getCurrentVersion());
}

export function githubReleaseAssetUrl(
	repo: string,
	assetName: string,
	version?: string,
): string {
	if (version) {
		return `https://github.com/${repo}/releases/download/v${version}/${assetName}`;
	}
	return `https://github.com/${repo}/releases/latest/download/${assetName}`;
}

export function agentBinaryDir(): string {
	return (
		process.env.AGENT_BINARY_DIR ||
		process.env.AGENT_TARGET_DIR ||
		path.resolve(process.cwd(), "..", "catalyst-agent", "target")
	);
}

export function resolveLocalAgentBinary(
	dir: string,
	arch: AgentArch,
	assetName: string,
): string | null {
	const assetPath = path.resolve(dir, assetName);
	if (fs.existsSync(assetPath)) return assetPath;

	const legacyPath = path.resolve(
		dir,
		`${arch}-unknown-linux-musl`,
		"release",
		"catalyst-agent",
	);
	if (fs.existsSync(legacyPath)) return legacyPath;

	return null;
}

export function resolveLocalAgentChecksum(
	dir: string,
	assetName: string,
): string | null {
	const localChecksum = path.resolve(dir, `${assetName}.sha256`);
	return fs.existsSync(localChecksum) ? localChecksum : null;
}
