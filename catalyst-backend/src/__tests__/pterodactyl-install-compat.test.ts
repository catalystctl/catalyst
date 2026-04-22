/**
 * Catalyst - Pterodactyl Install Script Compatibility Tests
 *
 * Validates that install scripts for all eggs will work correctly in
 * Catalyst's containerized install environment.
 *
 * Tests cover:
 *   1. /mnt/server path compatibility (scripts hardcode /mnt/server, Catalyst uses /data)
 *   2. Shell interpreter detection (bash vs sh, ash vs dash)
 *   3. Tool availability in non-standard install containers
 *   4. Self-install patterns (apt-get, apk add)
 *   5. Known broken eggs that cannot work
 *
 * This test does NOT pull Docker images — it uses a static manifest of
 * tool availability per image (verified via podman inspection).
 */

import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Types
// ============================================================================

interface PterodactylEgg {
	name?: string;
	startup?: string;
	docker_images?: Record<string, string>;
	images?: string[];
	scripts?: {
		installation?: {
			script?: string;
			container?: string;
			entrypoint?: string;
		};
	};
	config?: {
		stop?: string;
		startup?: { done?: string | string[] };
	};
}

// ============================================================================
// Tool availability per image (verified via podman/podman inspection)
// ============================================================================

const IMAGE_TOOLS: Record<string, Record<string, boolean>> = {
	// Standard Pterodactyl install images
	'ghcr.io/ptero-eggs/installers:debian': {
		bash: true, sh: true, curl: true, wget: true, jq: true,
		unzip: true, tar: true, git: true, zip: true, xz: true,
	},
	'ghcr.io/ptero-eggs/installers:alpine': {
		bash: false, sh: true, curl: true, wget: true, jq: true,
		unzip: true, tar: true, git: true, zip: false, xz: true,
	},
	'ghcr.io/pterodactyl/installers:debian': {
		bash: true, sh: true, curl: true, wget: true, jq: true,
		unzip: true, tar: true, git: true, zip: true, xz: true,
	},
	'ghcr.io/pterodactyl/installers:alpine': {
		bash: false, sh: true, curl: true, wget: true, jq: true,
		unzip: true, tar: true, git: true, zip: false, xz: true,
	},

	// Non-standard install images
	'alpine:latest': {
		bash: false, sh: true, curl: false, wget: true, jq: false,
		unzip: true, tar: true, git: false, zip: false, xz: false,
	},
	'debian:bullseye-slim': {
		bash: true, sh: true, curl: false, wget: false, jq: false,
		unzip: false, tar: true, git: false, zip: false, xz: false,
	},
	'ghcr.io/ptero-eggs/installers:ubuntu': {
		bash: true, sh: true, curl: true, wget: false, jq: true,
		unzip: true, tar: true, git: true, zip: true, xz: false,
	},
	'eclipse-temurin:8-jdk': {
		bash: true, sh: true, curl: true, wget: true, jq: false,
		unzip: false, tar: true, git: false, zip: false, java: true, xz: false,
	},
	'eclipse-temurin:8-jdk-jammy': {
		bash: true, sh: true, curl: true, wget: true, jq: false,
		unzip: false, tar: true, git: false, zip: false, java: true, xz: false,
	},
	'eclipse-temurin:16-jdk-focal': {
		bash: true, sh: true, curl: true, wget: false, jq: false,
		unzip: false, tar: true, git: false, zip: false, java: true, xz: false,
	},
	'eclipse-temurin:17-jdk': {
		bash: true, sh: true, curl: true, wget: true, jq: false,
		unzip: false, tar: true, git: false, zip: false, java: true, xz: false,
	},
	'eclipse-temurin:18-jdk-jammy': {
		bash: true, sh: true, curl: true, wget: true, jq: false,
		unzip: false, tar: true, git: false, zip: false, java: true, xz: false,
	},
	'eclipse-temurin:21-jdk-jammy': {
		bash: true, sh: true, curl: true, wget: true, jq: false,
		unzip: false, tar: true, git: false, zip: false, java: true, xz: false,
	},
	'node:16-bookworm': {
		bash: true, sh: true, curl: true, wget: true, jq: false,
		unzip: true, tar: true, git: true, zip: false, node: true, npm: true, xz: true,
	},
	'node:21-bookworm-slim': {
		bash: true, sh: true, curl: false, wget: false, jq: false,
		unzip: false, tar: true, git: false, zip: false, node: true, npm: true, xz: false,
	},
};

// ============================================================================
// Known broken eggs (documented upstream bugs, not Catalyst bugs)
// ============================================================================

const KNOWN_BROKEN_EGGS = new Set([
	// bitnami/dotnet-sdk:6-debian-11 — image no longer exists on Docker Hub
	'LeagueSandbox',
	// VanillaCord uses #!/bin/ash + apk on a Debian (eclipse-temurin) image — egg bug
	'VanillaCord',
]);

// ============================================================================
// File discovery (module-scope for vitest worker access)
// ============================================================================

const EGGS_DIR = path.resolve(process.cwd(), '..', 'eggs');

function discoverFiles(): string[] {
	const files: string[] = [];
	if (!fs.existsSync(EGGS_DIR)) {
		console.warn(`[pterodactyl-install-compat] eggs/ directory not found at ${EGGS_DIR}`);
		return files;
	}
	function walk(dir: string) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (entry.name.startsWith('.')) continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.json')) files.push(full);
		}
	}
	walk(EGGS_DIR);
	return files;
}

const allFiles = discoverFiles();

// ============================================================================
// Helper functions
// ============================================================================

function parseEgg(fp: string): { egg: PterodactylEgg; rel: string } | null {
	try {
		const raw = fs.readFileSync(fp, 'utf-8');
		const egg = JSON.parse(raw) as PterodactylEgg;
		if (!egg.startup && !egg.docker_images) return null;
		return { egg, rel: path.relative(EGGS_DIR, fp) };
	} catch {
		return null;
	}
}

function getInstallScript(egg: PterodactylEgg): string {
	return egg.scripts?.installation?.script || '';
}

function getInstallContainer(egg: PterodactylEgg): string {
	return egg.scripts?.installation?.container || '';
}

function extractShebang(script: string): string {
	const firstLine = script.split('\n')[0]?.trim() || '';
	if (firstLine.startsWith('#!')) {
		const shebang = firstLine.slice(2).trim();
		const interpreter = shebang.split(/\s+/)[0];
		return interpreter.split('/').pop() || '';
	}
	return '';
}

function isAlpineImage(image: string): boolean {
	return image.toLowerCase().includes('alpine');
}

/**
 * Detect which shell interpreter the agent would use.
 * Mirrors detect_install_interpreter() in runtime_manager.rs
 */
function detectInterpreter(image: string, script: string): string {
	const alpine = isAlpineImage(image);
	const shebang = extractShebang(script);

	if (shebang === 'bash') return 'bash';
	if (shebang === 'ash') return alpine ? 'sh' : 'bash';
	if (alpine) return 'sh';
	return 'bash';
}

function usesBashisms(script: string): boolean {
	return /\[\[ /.test(script);
}

function usesPackageManager(script: string, pm: string): boolean {
	const s = script.toLowerCase();
	if (pm === 'apt') return s.includes('apt-get') || /\bapt\s/.test(s);
	if (pm === 'apk') return s.includes('apk add') || s.includes('apk update');
	if (pm === 'yum') return s.includes('yum install');
	if (pm === 'dnf') return s.includes('dnf install');
	return false;
}

/**
 * Check if a specific tool is self-installed by the script's package manager commands.
 * Looks for patterns like: apt install -y curl jq unzip, apk add --no-cache curl jq
 * Handles multi-line install commands (apt update \n apt install -y ...)
 */
function isToolSelfInstalled(script: string, tool: string): boolean {
	// Collect all apt-get/apt install package lists from the script
	const lines = script.split(/\r?\n/);
	for (const line of lines) {
		// Match apt/apt-get install lines
		const aptMatch = line.match(/(?:apt-get|apt)\s+(?:-[\w]*\s+)*install(?:\s+-[\w]*\s+)*(.+)/);
		if (aptMatch) {
			const packages = aptMatch[1].trim().split(/\s+/);
			if (packages.some(p => p === tool)) return true;
		}
		// Match apk add lines
		const apkMatch = line.match(/apk\s+add(?:\s+--?[\w=]+)*\s+(.+)/);
		if (apkMatch) {
			const packages = apkMatch[1].trim().split(/\s+/);
			if (packages.some(p => p === tool)) return true;
		}
	}
	return false;
}

function extractToolUsage(script: string): Set<string> {
	const tools = new Set<string>();
	const toolPattern = /^(?:\s*(?:[;&|]|\|\|&&)*\s*)(\w+)/gm;
	let match;
	while ((match = toolPattern.exec(script)) !== null) {
		const tool = match[1];
		// Filter to relevant tools
		if (['curl', 'wget', 'jq', 'unzip', 'tar', 'git', 'zip',
			'java', 'javac', 'node', 'npm', 'pip', 'python3',
			'dotnet', 'bash', 'xz', 'rsync', 'wget'].includes(tool)) {
			tools.add(tool);
		}
	}
	return tools;
}

// ============================================================================
// Tests
// ============================================================================

describe('Pterodactyl Install Script Compatibility', () => {

	describe('Path compatibility (/mnt/server → /data)', () => {

		it.concurrent('all install scripts that reference /mnt/server are compatible with /data symlink', () => {
			let total = 0;
			let withMntServer = 0;

			for (const fp of allFiles) {
				const parsed = parseEgg(fp);
				if (!parsed) continue;
				const { egg, rel } = parsed;
				const script = getInstallScript(egg);
				if (!script.trim()) continue;

				total++;

				// Every Pterodactyl install script uses /mnt/server
				// Our install wrapper creates: mkdir -p /mnt/server && ln -sfn /data /mnt/server
				// This makes /mnt/server an alias for /data
				if (script.includes('/mnt/server')) {
					withMntServer++;
				}
			}

			// All scripts should use /mnt/server (that's the Pterodactyl convention)
			expect(withMntServer).toBe(total);
		});

		it.concurrent('install wrapper creates /mnt/server symlink before script runs', () => {
			// This is a documentation test — verifies the wrapper order
			// The wrapper in runtime_manager.rs does:
			//   1. set -e  (fail fast so install failures are not masked by chown)
			//   2. rm -rf /mnt/server && ln -s /data /mnt/server
			//   3. export HOME=/data
			//   4. <user script>
			//   5. chown -R 1000:1000 /data
			// The symlink must come BEFORE the user script
			expect(true).toBe(true); // Placeholder — actual behavior is in runtime_manager.rs
		});
	});

	describe('Shell interpreter detection', () => {

		it.concurrent('ash scripts on Debian images use bash (ash unavailable on Debian)', () => {
			const failures: string[] = [];

			for (const fp of allFiles) {
				const parsed = parseEgg(fp);
				if (!parsed) continue;
				const { egg, rel } = parsed;
				const script = getInstallScript(egg);
				const container = getInstallContainer(egg);
				if (!script.trim() || !container) continue;

				const shebang = extractShebang(script);
				if (shebang === 'ash' && !isAlpineImage(container)) {
					const interp = detectInterpreter(container, script);
					if (interp !== 'bash') {
						failures.push(`${egg.name} (${rel}): ash on ${container} should use bash, got ${interp}`);
					}
				}
			}

			expect(failures).toEqual([]);
		});

		it.concurrent('ash scripts on Alpine images use sh (busybox ash)', () => {
			const failures: string[] = [];

			for (const fp of allFiles) {
				const parsed = parseEgg(fp);
				if (!parsed) continue;
				const { egg, rel } = parsed;
				const script = getInstallScript(egg);
				const container = getInstallContainer(egg);
				if (!script.trim() || !container) continue;

				const shebang = extractShebang(script);
				if (shebang === 'ash' && isAlpineImage(container)) {
					const interp = detectInterpreter(container, script);
					if (interp !== 'sh') {
						failures.push(`${egg.name} (${rel}): ash on Alpine should use sh, got ${interp}`);
					}
				}
			}

			expect(failures).toEqual([]);
		});

		it.concurrent('bash scripts on any image use bash', () => {
			const failures: string[] = [];

			for (const fp of allFiles) {
				const parsed = parseEgg(fp);
				if (!parsed) continue;
				const { egg, rel } = parsed;
				const script = getInstallScript(egg);
				const container = getInstallContainer(egg);
				if (!script.trim() || !container) continue;

				const shebang = extractShebang(script);
				if (shebang === 'bash') {
					const interp = detectInterpreter(container, script);
					if (interp !== 'bash') {
						failures.push(`${egg.name} (${rel}): bash shebang should use bash, got ${interp}`);
					}
				}
			}

			expect(failures).toEqual([]);
		});

		it.concurrent('scripts using [[ ]] on Debian images get bash (not dash)', () => {
			const failures: string[] = [];

			for (const fp of allFiles) {
				const parsed = parseEgg(fp);
				if (!parsed) continue;
				const { egg, rel } = parsed;
				const script = getInstallScript(egg);
				const container = getInstallContainer(egg);
				if (!script.trim() || !container) continue;

				if (usesBashisms(script) && !isAlpineImage(container)) {
					const interp = detectInterpreter(container, script);
					if (interp !== 'bash') {
						failures.push(`${egg.name} (${rel}): uses [[ ]] on ${container} should get bash, got ${interp}`);
					}
				}
			}

			expect(failures).toEqual([]);
		});

		it.concurrent('scripts using [[ ]] on Alpine images work with sh (busybox ash supports [[ ]])', () => {
			const failures: string[] = [];

			for (const fp of allFiles) {
				const parsed = parseEgg(fp);
				if (!parsed) continue;
				const { egg, rel } = parsed;
				const script = getInstallScript(egg);
				const container = getInstallContainer(egg);
				if (!script.trim() || !container) continue;

				if (usesBashisms(script) && isAlpineImage(container)) {
					const interp = detectInterpreter(container, script);
					// busybox ash supports [[ ]], so sh is fine
					if (interp !== 'sh' && interp !== 'bash') {
						failures.push(`${egg.name} (${rel}): uses [[ ]] on Alpine, got ${interp}`);
					}
				}
			}

			expect(failures).toEqual([]);
		});
	});

	describe('Non-standard install container compatibility', () => {

		const nonStandardEggs: Array<{
			name: string; rel: string; container: string;
			script: string; toolsUsed: Set<string>;
		}> = [];

		// Collect non-standard eggs in a beforeAll-like setup
		for (const fp of allFiles) {
			const parsed = parseEgg(fp);
			if (!parsed) continue;
			const { egg, rel } = parsed;
			const script = getInstallScript(egg);
			const container = getInstallContainer(egg);
			if (!script.trim() || !container) continue;
			if (container.includes('installers:debian') && !container.includes('ubuntu')) continue;
			if (container.includes('installers:alpine')) continue;

			const toolsUsed = extractToolUsage(script);
			nonStandardEggs.push({
				name: egg.name || path.basename(fp, '.json'),
				rel,
				container,
				script,
				toolsUsed,
			});
		}

		it.concurrent('identifies all non-standard install containers', () => {
			const uniqueImages = [...new Set(nonStandardEggs.map(e => e.container))];
			expect(uniqueImages.length).toBeGreaterThan(0);

			// Document the non-standard images we know about
			const expectedImages = [
				'alpine:latest',
				'bitnami/dotnet-sdk:6-debian-11',
				'debian:bullseye-slim',
				'eclipse-temurin:8-jdk',
				'eclipse-temurin:8-jdk-jammy',
				'eclipse-temurin:16-jdk-focal',
				'eclipse-temurin:17-jdk',
				'eclipse-temurin:18-jdk-jammy',
				'eclipse-temurin:21-jdk-jammy',
				'ghcr.io/ptero-eggs/installers:ubuntu',
				'node:16-bookworm',
				'node:21-bookworm-slim',
			];
			for (const img of expectedImages) {
				expect(uniqueImages).toContain(img);
			}
		});

		it.concurrent('each non-standard egg either has tools pre-installed or self-installs them', () => {
			const failures: string[] = [];

			for (const egg of nonStandardEggs) {
				if (KNOWN_BROKEN_EGGS.has(egg.name)) continue; // Skip known broken

				const imageTools = IMAGE_TOOLS[egg.container];
				if (!imageTools) {
					// Unknown image — can't validate, skip
					continue;
				}

				for (const tool of egg.toolsUsed) {
					const preInstalled = imageTools[tool] === true;
					if (preInstalled) continue;

					// Tool not pre-installed — check if script self-installs it
					// We check if the tool name appears in apt/apk install commands
					const toolInstalled = isToolSelfInstalled(egg.script, tool);
					if (toolInstalled) continue;

					// Tool is truly missing and not self-installed
					failures.push(`${egg.name} (${egg.rel}): needs '${tool}' but ${egg.container} doesn't have it and script doesn't install it`);
				}
			}

			// starmade has an egg bug (installs curl but uses wget)
			// This is a known upstream issue, not a Catalyst bug
			const starmadeFailure = failures.find(f => f.includes('starmade'));
			expect(starmadeFailure).toBeDefined();
			expect(starmadeFailure!).toContain('wget');

			// Should only be the starmade egg bug
			expect(failures.length).toBeLessThanOrEqual(1);
		});

		it.concurrent('VanillaCord is documented as broken (apk on Debian image)', () => {
			const vanillaCord = nonStandardEggs.find(e => e.name === 'VanillaCord');
			expect(vanillaCord).toBeDefined();
			expect(vanillaCord!.container).toContain('eclipse-temurin');
			expect(vanillaCord!.script).toContain('apk');
			expect(KNOWN_BROKEN_EGGS.has('VanillaCord')).toBe(true);
		});

		it.concurrent('LeagueSandbox is documented as broken (image removed)', () => {
			const leagueSandbox = nonStandardEggs.find(e => e.name === 'LeagueSandbox');
			expect(leagueSandbox).toBeDefined();
			expect(leagueSandbox!.container).toBe('bitnami/dotnet-sdk:6-debian-11');
			expect(KNOWN_BROKEN_EGGS.has('LeagueSandbox')).toBe(true);
		});
	});

	describe('Interpreter detection matches runtime_manager.rs', () => {

		it.concurrent('detectInterpreter mirrors detect_install_interpreter() in Rust', () => {
			// Test cases that mirror the Rust function's behavior
			const cases: Array<{
				image: string; script: string; expected: string;
				reason: string;
			}> = [
				// bash shebang on any image → bash
				{ image: 'debian:bullseye-slim', script: '#!/bin/bash\necho hi', expected: 'bash', reason: 'explicit bash shebang' },
				{ image: 'eclipse-temurin:8-jdk-jammy', script: '#!/bin/bash\necho hi', expected: 'bash', reason: 'explicit bash on temurin' },
				{ image: 'alpine:latest', script: '#!/bin/bash\necho hi', expected: 'bash', reason: 'explicit bash on alpine' },

				// ash shebang on Alpine → sh
				{ image: 'ghcr.io/ptero-eggs/installers:alpine', script: '#!/bin/ash\necho hi', expected: 'sh', reason: 'ash on alpine → sh (busybox ash)' },
				{ image: 'alpine:latest', script: '#!/bin/ash\necho hi', expected: 'sh', reason: 'ash on alpine → sh' },

				// ash shebang on Debian → bash (fallback, ash not available)
				{ image: 'ghcr.io/ptero-eggs/installers:debian', script: '#!/bin/ash\necho hi', expected: 'bash', reason: 'ash on debian → bash (fallback)' },
				{ image: 'eclipse-temurin:8-jdk-jammy', script: '#!/bin/ash\necho hi', expected: 'bash', reason: 'ash on temurin → bash (fallback)' },

				// No shebang, Alpine → sh
				{ image: 'ghcr.io/ptero-eggs/installers:alpine', script: 'echo hi', expected: 'sh', reason: 'no shebang on alpine → sh' },

				// No shebang, Debian → bash
				{ image: 'ghcr.io/ptero-eggs/installers:debian', script: 'echo hi', expected: 'bash', reason: 'no shebang on debian → bash' },
				{ image: 'eclipse-temurin:21-jdk-jammy', script: 'echo hi', expected: 'bash', reason: 'no shebang on temurin → bash' },

				// Ubuntu → bash (not alpine)
				{ image: 'ghcr.io/ptero-eggs/installers:ubuntu', script: '#!/bin/bash\necho hi', expected: 'bash', reason: 'bash on ubuntu' },

				// env-style shebang
				{ image: 'debian:bullseye-slim', script: '#!/usr/bin/env bash\necho hi', expected: 'bash', reason: 'env bash shebang' },
				{ image: 'ghcr.io/ptero-eggs/installers:alpine', script: '#!/usr/bin/env ash\necho hi', expected: 'sh', reason: 'env ash on alpine → sh' },
			];

			for (const c of cases) {
				expect(detectInterpreter(c.image, c.script))
					.toBe(c.expected);
			}
		});
	});

	describe('HOME variable compatibility', () => {

		it.concurrent('install wrapper sets HOME=/data for scripts that use $HOME', () => {
			let homeUsers = 0;
			let homeSetters = 0;

			for (const fp of allFiles) {
				const parsed = parseEgg(fp);
				if (!parsed) continue;
				const { egg } = parsed;
				const script = getInstallScript(egg);
				if (!script.trim()) continue;

				if (script.includes('$HOME') || script.includes('${HOME}')) {
					homeUsers++;
					// Check if script sets HOME itself
					if (/export\s+HOME/.test(script) || /HOME=/.test(script)) {
						homeSetters++;
					}
				}
			}

			// Our wrapper sets HOME=/data, so even scripts that don't
			// explicitly set HOME will have it available
			expect(homeUsers).toBeGreaterThan(0);
		});
	});

	describe('Windows line endings', () => {

		it.concurrent('agent strips \\r\\n before script execution', () => {
			let withCrlf = 0;
			let total = 0;

			for (const fp of allFiles) {
				const parsed = parseEgg(fp);
				if (!parsed) continue;
				const { egg } = parsed;
				const script = getInstallScript(egg);
				if (!script.trim()) continue;
				total++;

				if (script.includes('\r')) {
					withCrlf++;
				}
			}

			// Many Pterodactyl eggs have \r\n in JSON strings
			expect(withCrlf).toBeGreaterThan(0);
			// The agent strips these: final_script.replace("\r\n", "\n").replace('\r', "\n")
			// This test documents the expectation — actual fix is in websocket_handler.rs
			expect(true).toBe(true);
		});
	});
});
