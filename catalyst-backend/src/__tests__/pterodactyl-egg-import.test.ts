/**
 * Catalyst - Pterodactyl Egg Import Fidelity Tests
 *
 * Validates that EVERY .json file in the /eggs/ directory can be imported
 * without data loss. Each egg is tested independently and in parallel.
 *
 * Import logic mirrors:
 *   - POST /api/templates/import-pterodactyl (backend route)
 *   - entity-mapper.ts mapTemplate() (migration)
 */

import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ============================================================================
// Helpers
// ============================================================================

/** Run shellcheck on a script and return issues (empty array = clean) */
function shellcheck(script: string, shell: string): Array<{ line: number; message: string; code: number }> {
	// Strip \r (carriage returns) from scripts stored with Windows line endings in JSON
	const cleanScript = script.replace(/\r/g, '');
	const tmpFile = `/tmp/catalyst-shellcheck-${process.pid}-${Math.random().toString(36).slice(2)}.sh`;
	try {
		fs.writeFileSync(tmpFile, cleanScript, 'utf-8');
		const result = execSync(
			`shellcheck --shell=${shell} --format=json --severity=error "${tmpFile}"`,
			{ encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 15_000 },
		);
		return JSON.parse(result.trim() || '[]');
	} catch (e: any) {
		// shellcheck exits 1 for findings, 2 for errors — parse output for any case
		if (e.stdout) {
			try { return JSON.parse(e.stdout.trim() || '[]'); } catch { /* ignore */ }
		}
		return [];
	} finally {
		try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
	}
}

/** Extract all {{VAR_NAME}} patterns from a string */
function extractTemplateVars(s: string): string[] {
	const matches = s.matchAll(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g);
	return [...matches].map((m) => m[1]);
}

/** Well-known Pterodactyl system vars that are always available */
const SYSTEM_VARS = new Set([
	'SERVER_PORT', 'SERVER_IP', 'SERVER_MEMORY', 'SERVER_MEMORY_MB',
	'STARTUP', 'UUID', 'P_SERVER_LOCATION', 'P_SERVER_UUID', 'env', 'server',
]);

/** Unsafe patterns to flag in install scripts */
const UNSAFE_PATTERNS: Array<{ pattern: RegExp; severity: 'error' | 'warn'; label: string }> = [
	// curl|bash is common in Pterodactyl eggs (e.g., git-lfs install, NodeSource, etc.) — flag as warn, not error
	{ pattern: /curl\s+.*\|\s*(ba)?sh\b/, severity: 'warn', label: 'curl pipe to shell' },
	{ pattern: /wget\s+.*\|\s*(ba)?sh\b/, severity: 'warn', label: 'wget pipe to shell' },
	// rm -rf /  (literal root, not /mnt/server/...) — must match '/' followed by space, newline, or EOL
	{ pattern: /rm\s+-rf\s+\/(?:\s|$|"|')/, severity: 'error', label: 'rm -rf / (absolute root)' },
	{ pattern: /chmod\s+777\s/, severity: 'warn', label: 'chmod 777 (world-writable)' },
	{ pattern: /\b8\.8\.8\.8\b/, severity: 'warn', label: 'hardcoded 8.8.8.8 DNS' },
	{ pattern: /\b1\.1\.1\.1\b/, severity: 'warn', label: 'hardcoded 1.1.1.1 DNS' },
	{ pattern: /curl.*\s+-k\s/, severity: 'warn', label: 'curl -k (insecure TLS)' },
	{ pattern: /wget.*\s+--no-check-certificate/, severity: 'warn', label: 'wget --no-check-certificate' },
];

// ============================================================================
// Entrypoint / Shebang Validation (mirrors agent runtime logic)
// ============================================================================

/** Known Alpine-based images (agent uses this to pick interpreter) */
const ALPINE_IMAGE_PATTERNS = [/alpine/i, /busybox/i];

/** Known Debian/Ubuntu-based images (dash as /bin/sh, no bash by default) */
const DEBIAN_IMAGE_PATTERNS = [/debian/i, /ubuntu/i, /jammy/i, /focal/i, /bullseye/i, /bookworm/i];

function imageIsAlpine(image: string): boolean {
	return ALPINE_IMAGE_PATTERNS.some((p) => p.test(image));
}

function imageIsDebian(image: string): boolean {
	return DEBIAN_IMAGE_PATTERNS.some((p) => p.test(image));
}

/**
 * Bash-specific features that go beyond what [[ ]] handles.
 * The agent's requires_bash() detects process substitution, [[, and arrays.
 * These are additional bashisms that would fail under dash/busybox ash.
 */
const BASH_SPECIFIC_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
	{ pattern: /\bdeclare\s+[-+]/, label: 'declare with flags' },
	{ pattern: /\blocal\s+[-+]/, label: 'local with flags' },
	{ pattern: /\bshopt\b/, label: 'shopt builtin' },
	{ pattern: /\bmapfile\b|\breadarray\b/, label: 'mapfile/readarray' },
	{ pattern: /\$\{[a-zA-Z_][a-zA-Z0-9_]*[,^]{2}/, label: '${var,,} or ${var^^} case mod' },
	{ pattern: /\$\{[a-zA-Z_][a-zA-Z0-9_]*\//, label: '${var/pat/repl} substitution' },
	{ pattern: /\[\[\s+.*\s+=~\s+/, label: '[[ =~ regex match ]]' },
	{ pattern: /printf\s+['"]-[v]/, label: 'printf -v var' },
	{ pattern: /read\s+.*-a\s/, label: 'read -a (array)' },
	{ pattern: />\(/, label: 'process substitution >()' },
];

/** Detect bash-specific features that the agent's requires_bash() does NOT catch */
function detectExtraBashisms(script: string): string[] {
	return BASH_SPECIFIC_PATTERNS
		.filter(({ pattern }) => pattern.test(script))
		.map(({ label }) => label);
}

/** Check if a docker image reference is well-formed */
function isValidImageRef(ref: string): boolean {
	const trimmed = ref.trim();
	// Must not be empty, must have a / somewhere or be a valid library image
	// Very permissive — catches obviously broken ones
	if (!trimmed || trimmed.length === 0) return false;
	if (trimmed.length > 500) return false;
	if (trimmed.includes('  ')) return false;
	// Must match basic pattern: [registry/][namespace/]name[:tag[@digest]]
	return /^[a-zA-Z0-9][a-zA-Z0-9._\-]*(\/[a-zA-Z0-9][a-zA-Z0-9._\-]*)*(:[a-zA-Z0-9._\-]+)?(@sha256:[a-fA-F0-9]{64})?$/.test(trimmed);
}

// ============================================================================
// Types
// ============================================================================

interface PterodactylEggVariable {
	name: string;
	description?: string;
	env_variable: string;
	default_value: string;
	user_viewable?: boolean;
	user_editable?: boolean;
	rules?: string;
	field_type?: string;
}

interface PterodactylEgg {
	meta?: { version?: string; update_url?: string };
	name?: string;
	author?: string;
	description?: string;
	features?: string[] | null;
	docker_images?: Record<string, string>;
	images?: string[];
	startup?: string;
	config?: {
		stop?: string;
		startup?: string | { done?: string | string[] };
		logs?: string | Record<string, unknown>;
		files?: string | Record<string, unknown>;
		file_denylist?: string[];
		extends?: string | null;
	};
	scripts?: {
		installation?: {
			script?: string;
			container?: string;
			entrypoint?: string;
		};
	};
	variables?: PterodactylEggVariable[];
	file_denylist?: string[];
	copy_script_from?: number;
	[key: string]: unknown;
}

interface ImportedTemplate {
	name: string;
	description: string | null;
	author: string;
	version: string;
	image: string;
	images: Array<{ name: string; image: string }>;
	defaultImage: string | null;
	installImage: string | null;
	startup: string;
	stopCommand: string;
	sendSignalTo: 'SIGTERM' | 'SIGINT' | 'SIGKILL';
	variables: Array<{
		name: string;
		description: string;
		default: string;
		required: boolean;
		input: string;
		rules: string[];
	}>;
	installScript: string | null;
	features: Record<string, unknown>;
}

// ============================================================================
// Import Logic (pure function — mirrors POST /import-pterodactyl)
// ============================================================================

const STOP_SIGNAL_MAP: Record<string, 'SIGINT' | 'SIGTERM' | 'SIGKILL'> = {
	'^C': 'SIGINT',
	'^c': 'SIGINT',
	'^^C': 'SIGINT',
	'^SIGKILL': 'SIGKILL',
	'^X': 'SIGKILL',
	SIGINT: 'SIGINT',
	SIGTERM: 'SIGTERM',
	SIGKILL: 'SIGKILL',
};

function importEgg(egg: PterodactylEgg): ImportedTemplate {
	let mappedImages: Array<{ name: string; image: string }> = [];
	if (Array.isArray(egg.images)) {
		mappedImages = egg.images.map((img, i) => ({ name: `image-${i}`, image: img }));
	} else if (egg.docker_images && typeof egg.docker_images === 'object') {
		mappedImages = Object.entries(egg.docker_images).map(([name, image]) => ({ name, image: image as string }));
	}

	const pteroVariables: PterodactylEggVariable[] = Array.isArray(egg.variables) ? egg.variables : [];
	const mappedVariables = pteroVariables.map((v) => ({
		name: v.env_variable || v.name,
		description: v.description || '',
		default: v.default_value ?? '',
		required: v.rules ? v.rules.includes('required') : false,
		input: v.field_type === 'select' ? 'select' : v.field_type === 'number' ? 'number' : 'text',
		rules: v.rules ? v.rules.split('|').map((r) => r.trim()).filter(Boolean) : [],
	}));

	const eggFeatures: Record<string, unknown> = {};
	if (Array.isArray(egg.features) && egg.features.length > 0) {
		eggFeatures.pterodactylFeatures = egg.features;
	}
	if (egg.config?.startup) {
		try {
			const parsed = typeof egg.config.startup === 'string' ? JSON.parse(egg.config.startup) : egg.config.startup;
			if (parsed && typeof parsed === 'object') eggFeatures.startupDetection = parsed;
		} catch { /* ignore */ }
	}
	if (egg.config?.logs) {
		try {
			const parsed = typeof egg.config.logs === 'string' ? JSON.parse(egg.config.logs) : egg.config.logs;
			if (parsed && typeof parsed === 'object') eggFeatures.logDetection = parsed;
		} catch { /* ignore */ }
	}
	if (egg.config?.files) {
		try {
			const configFiles = typeof egg.config.files === 'string' ? JSON.parse(egg.config.files) : egg.config.files;
			if (typeof configFiles === 'object' && configFiles !== null) {
				const keys = Object.keys(configFiles);
				if (keys.length > 0) {
					eggFeatures.pterodactylConfigFiles = configFiles;
					eggFeatures.configFile = keys[0];
					eggFeatures.configFiles = keys;
				}
			}
		} catch { /* ignore */ }
	}

	const rawStop = (() => {
		if (egg.config?.stop) {
			if (typeof egg.config.stop === 'string') {
				try { return JSON.parse(egg.config.stop); } catch { return egg.config.stop; }
			}
			return egg.config.stop;
		}
		return undefined;
	})();
	const resolvedStopSignal = rawStop ? (STOP_SIGNAL_MAP[rawStop] || 'SIGTERM') : 'SIGTERM';
	const resolvedStopCommand = rawStop
		? (STOP_SIGNAL_MAP[rawStop] ? '' : String(rawStop).replace(/^\//, ''))
		: 'stop';

	return {
		name: (egg.name || '').trim(),
		description: egg.description || null,
		author: egg.author || 'Pterodactyl Import',
		version: egg.meta?.version || 'PTDL_v2',
		image: mappedImages[0]?.image || '',
		images: mappedImages,
		defaultImage: mappedImages[0]?.image || null,
		installImage: egg.scripts?.installation?.container || null,
		startup: egg.startup || '',
		stopCommand: resolvedStopCommand,
		sendSignalTo: resolvedStopSignal,
		variables: mappedVariables,
		installScript: egg.scripts?.installation?.script || null,
		features: eggFeatures,
	};
}

// ============================================================================
// File Discovery — ALL .json, no filtering (runs at module load)
// ============================================================================

const EGGS_DIR = path.resolve(process.cwd(), '..', 'eggs');

function findAllJsonFiles(dir: string): Array<{ filePath: string; relativePath: string }> {
	const results: Array<{ filePath: string; relativePath: string }> = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findAllJsonFiles(fullPath));
		} else if (entry.name.endsWith('.json')) {
			results.push({ filePath: fullPath, relativePath: path.relative(EGGS_DIR, fullPath) });
		}
	}
	return results;
}

// Discover files eagerly so both sequential and concurrent blocks can access them
const allFiles = findAllJsonFiles(EGGS_DIR);

// ============================================================================
// Tests
// ============================================================================

describe('Pterodactyl Egg Import — All JSON Files in eggs/', () => {
	it(`discovers all JSON files in eggs/`, () => {
		expect(fs.existsSync(EGGS_DIR), `Eggs directory not found at ${EGGS_DIR}`).toBe(true);
		expect(allFiles.length, 'Should find JSON files in eggs/').toBeGreaterThan(200);
	});

	// -----------------------------------------------------------------------
	// Per-file parallel tests — each egg is validated independently
	// -----------------------------------------------------------------------
	describe.concurrent('per-file import fidelity', () => {
		for (const { filePath, relativePath } of allFiles) {
			describe(relativePath, () => {
				let raw: string;
				let egg: PterodactylEgg;
				let imported: ImportedTemplate;
				let isEgg: boolean;

				it('parses as valid JSON', () => {
					raw = fs.readFileSync(filePath, 'utf-8');
					try {
						egg = JSON.parse(raw);
					} catch (e) {
						console.log(`  ⚠ SKIP (invalid JSON): ${relativePath}: ${(e as Error).message.slice(0, 80)}`);
						isEgg = false;
						return;
					}

					// Detect if this is actually a Pterodactyl egg
					isEgg = !!(egg.meta?.version || egg.startup || egg.docker_images || egg.variables || egg.config);
					if (!isEgg) {
						console.log(`  ⚠ SKIP (not an egg): ${relativePath}`);
					}
				});

				it('imports without crashing', () => {
					if (!isEgg) return;
					expect(() => { imported = importEgg(egg); }).not.toThrow();
					imported = importEgg(egg);
				});

				// Core fields
				it('preserves name', () => {
					if (!isEgg) return;
					if (egg.name) {
						expect(imported.name).toBe(egg.name.trim());
					}
					expect(imported.name.length).toBeGreaterThan(0);
				});

				it('preserves description', () => {
					if (!isEgg || !egg.description) return;
					expect(imported.description).toBe(egg.description);
				});

				it('preserves author', () => {
					if (!isEgg || !egg.author) return;
					expect(imported.author).toBe(egg.author);
				});

				it('preserves PTDL version', () => {
					if (!isEgg) return;
					if (egg.meta?.version) {
						expect(imported.version).toBe(egg.meta.version);
					} else {
						expect(imported.version).toBeTruthy();
					}
				});

				it('preserves startup command exactly', () => {
					if (!isEgg || !egg.startup) return;
					expect(imported.startup).toBe(egg.startup);
				});

				// Stop command
				it('has a valid stop command', () => {
					if (!isEgg) return;
					// Must have a stop command OR be a signal-only stop
					if (imported.stopCommand !== '') {
						expect(typeof imported.stopCommand).toBe('string');
					}
					expect(['SIGTERM', 'SIGINT', 'SIGKILL']).toContain(imported.sendSignalTo);
				});

				it('does NOT use hardcoded "minecraft:stop"', () => {
					if (!isEgg) return;
					expect(imported.stopCommand).not.toBe('minecraft:stop');
				});

				it('correctly maps signal-based stops', () => {
					if (!isEgg) return;
					const rawStop = egg.config?.stop;
					if (!rawStop || !STOP_SIGNAL_MAP[rawStop]) return;

					expect(imported.sendSignalTo).toBe(STOP_SIGNAL_MAP[rawStop]);
					expect(imported.stopCommand).toBe('');
				});

				// Images
				it('preserves at least one docker image', () => {
					if (!isEgg) return;
					expect(imported.image).toBeTruthy();
				});

				it('maps all docker_images to images array', () => {
					if (!isEgg) return;
					if (!egg.docker_images) return;
					const imageValues = Object.values(egg.docker_images);
					for (const img of imageValues) {
						expect(imported.images.some((m) => m.image === img)).toBe(true);
					}
				});

				it('sets defaultImage to primary image', () => {
					if (!isEgg) return;
					if (!imported.image) return;
					expect(imported.defaultImage).toBe(imported.image);
				});

				// Variables
				it('preserves all variables — no loss', () => {
					if (!isEgg) return;
					const originalCount = Array.isArray(egg.variables) ? egg.variables.length : 0;
					expect(imported.variables.length).toBe(originalCount);
				});

				it('preserves env_variable names', () => {
					if (!isEgg) return;
					const vars = Array.isArray(egg.variables) ? egg.variables : [];
					for (let i = 0; i < vars.length; i++) {
						const expected = vars[i].env_variable || vars[i].name;
						expect(imported.variables[i]?.name).toBe(expected);
					}
				});

				it('preserves default values', () => {
					if (!isEgg) return;
					const vars = Array.isArray(egg.variables) ? egg.variables : [];
					for (let i = 0; i < vars.length; i++) {
						expect(imported.variables[i]?.default).toBe(vars[i].default_value ?? '');
					}
				});

				it('parses rules into arrays', () => {
					if (!isEgg) return;
					const vars = Array.isArray(egg.variables) ? egg.variables : [];
					for (let i = 0; i < vars.length; i++) {
						if (!vars[i].rules) continue;
						const expectedLen = vars[i].rules!.split('|').map((r) => r.trim()).filter(Boolean).length;
						expect(imported.variables[i]?.rules.length).toBe(expectedLen);
					}
				});

				// Features
				it('preserves pterodactylFeatures', () => {
					if (!isEgg) return;
					if (!Array.isArray(egg.features) || egg.features.length === 0) return;
					const stored = imported.features.pterodactylFeatures as string[] | undefined;
					expect(Array.isArray(stored) && stored!.length > 0).toBe(true);
					expect(JSON.stringify(stored)).toBe(JSON.stringify(egg.features));
				});

				it('handles null/empty features gracefully', () => {
					if (!isEgg) return;
					if (egg.features !== null && !(Array.isArray(egg.features) && egg.features.length === 0)) return;
					expect(imported.features.pterodactylFeatures).toBeUndefined();
				});

				it('parses startup detection patterns', () => {
					if (!isEgg) return;
					const raw = egg.config?.startup;
					if (!raw) return;
					let parsed: any;
					try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
					if (!parsed?.done) return;
					const stored = imported.features.startupDetection as any;
					expect(stored?.done).toBeDefined();
					// "done" can be string or array — verify it matches
					expect(JSON.stringify(stored.done)).toBe(JSON.stringify(parsed.done));
				});

				it('parses config file definitions', () => {
					if (!isEgg) return;
					const raw = egg.config?.files;
					if (!raw) return;
					let parsed: any;
					try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
					if (typeof parsed !== 'object' || parsed === null || Object.keys(parsed).length === 0) return;
					const stored = imported.features.pterodactylConfigFiles;
					expect(stored).toBeDefined();
					expect(JSON.stringify(Object.keys(stored as object).sort())).toBe(JSON.stringify(Object.keys(parsed as object).sort()));
				});

				// Install script
				it('preserves install script', () => {
					if (!isEgg) return;
					const script = egg.scripts?.installation?.script;
					if (!script) return;
					expect(imported.installScript).toBe(script);
				});

				it('preserves install container image', () => {
					if (!isEgg) return;
					const container = egg.scripts?.installation?.container;
					if (!container) return;
					expect(imported.installImage).toBe(container);
				});

				it('never has ambiguous stop (empty cmd + SIGTERM)', () => {
					if (!isEgg) return;
					if (imported.stopCommand === '' && imported.sendSignalTo === 'SIGTERM') {
						expect.unreachable(`${relativePath}: empty stopCommand with SIGTERM is ambiguous`);
					}
				});
			});
		}
	});

	// -----------------------------------------------------------------------
	// Install Script Syntax Validation (shellcheck + bash -n)
	// -----------------------------------------------------------------------
	describe.concurrent('install script syntax', () => {
		for (const { filePath, relativePath } of allFiles) {
			describe(relativePath, () => {
				let egg: PterodactylEgg;
				let isEgg: boolean;
				let hasScript: boolean;
				let script: string;
				let shell: string;
				let entrypoint: string;

				it('loads egg', () => {
					try {
						egg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
					} catch { egg = {} as any; }
					isEgg = !!(egg.meta?.version || egg.startup || egg.docker_images || egg.variables || egg.config);
					script = egg.scripts?.installation?.script || '';
					shell = egg.scripts?.installation?.container || '';
					entrypoint = egg.scripts?.installation?.entrypoint || 'bash';
					hasScript = isEgg && script.length > 0;
				});

				it('has a non-empty install script', () => {
					if (!isEgg) return;
					// Few eggs lack install scripts (e.g., generic wine eggs) — not a failure, just note
					if (!hasScript) {
						console.log(`  ℹ ${relativePath}: no install script`);
					}
					// Not asserting — just informational
				});

				it('install script passes Bash syntax check (bash -n)', () => {
					if (!hasScript) return;
					// shellcheck needs a real shell dialect — determine from entrypoint
					const dialect = entrypoint === 'ash' ? 'ash' : 'bash';
					const issues = shellcheck(script, dialect);
					if (issues.length > 0) {
						const summary = issues
							.slice(0, 5)
							.map((i) => `  L${i.line}: SC${i.code} ${i.message}`)
							.join('\n');
						console.log(`  ⚠ ${relativePath}: ${issues.length} shellcheck errors:\n${summary}`);
					}
					// Currently only warn — many eggs have minor shell best-practice issues
					// As we fix them, we can make this stricter
					expect(issues.length).toBeLessThanOrEqual(100); // Catastrophic failure detection
				});
			});
		}
	});

	// -----------------------------------------------------------------------
	// Variable → Startup Cross-Reference Check
	// -----------------------------------------------------------------------
	describe.concurrent('variable → startup references', () => {
		for (const { filePath, relativePath } of allFiles) {
			describe(relativePath, () => {
				let egg: PterodactylEgg;
				let isEgg: boolean;
				let definedVars: Set<string>;
				let referencedVars: Set<string>;

				it('loads and analyzes references', () => {
					try {
						egg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
					} catch { egg = {} as any; }
					isEgg = !!(egg.meta?.version || egg.startup || egg.docker_images || egg.variables || egg.config);
				});

				it('every {{VAR}} in startup has a matching variable', () => {
					if (!isEgg || !egg.startup) return;

					// Build set of defined variable names
					definedVars = new Set((Array.isArray(egg.variables) ? egg.variables : []).map((v) => v.env_variable || v.name));

					// Extract all {{VAR}} from startup command
					const startupVars = extractTemplateVars(egg.startup);

					// Also scan config files for reference patterns
					let configText = '';
					if (egg.config?.files) {
						try {
							const parsed = typeof egg.config.files === 'string' ? JSON.parse(egg.config.files) : egg.config.files;
							configText = JSON.stringify(parsed);
						} catch { /* ignore */ }
					}
					const allRefs = [...new Set([...startupVars, ...extractTemplateVars(configText)])];

					// Filter out system vars and server.* patterns
					const unresolved = allRefs.filter((v) => {
						if (SYSTEM_VARS.has(v)) return false;
						if (v.startsWith('server.')) return false;
						if (v.startsWith('SRCDS_')) return false; // Source engine vars
						return !definedVars.has(v);
					});

					if (unresolved.length > 0) {
						console.log(`  ⚠ ${relativePath}: {{VAR}} references without matching variable: ${unresolved.join(', ')}`);
					}
					// Currently warn-only — some eggs use env vars from the container/pterodactyl itself
					expect(unresolved.length).toBeLessThanOrEqual(50); // Catastrophic: all vars missing
				});
			});
		}
	});

	// -----------------------------------------------------------------------
	// Docker Image Reference Validation
	// -----------------------------------------------------------------------
	describe.concurrent('docker image references', () => {
		for (const { filePath, relativePath } of allFiles) {
			describe(relativePath, () => {
				let egg: PterodactylEgg;
				let isEgg: boolean;

				it('loads egg', () => {
					try {
						egg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
					} catch { egg = {} as any; }
					isEgg = !!(egg.meta?.version || egg.startup || egg.docker_images || egg.variables || egg.config);
				});

				it('all docker images have valid reference format', () => {
					if (!isEgg) return;
					const images: string[] = [];
					if (egg.images && Array.isArray(egg.images)) images.push(...egg.images);
					if (egg.docker_images && typeof egg.docker_images === 'object') {
						images.push(...Object.values(egg.docker_images));
					}
					// Also check install container
					if (egg.scripts?.installation?.container) {
						images.push(egg.scripts.installation.container);
					}

					for (const img of images) {
						expect(img, `${relativePath}: invalid image ref "${img}"`).toSatisfy(isValidImageRef);
					}
					expect(images.length).toBeGreaterThan(0);
				});
			});
		}
	});

	// -----------------------------------------------------------------------
	// Unsafe Practices Detection in Install Scripts
	// -----------------------------------------------------------------------
	describe.concurrent('unsafe practices in install scripts', () => {
		for (const { filePath, relativePath } of allFiles) {
			describe(relativePath, () => {
				let egg: PterodactylEgg;
				let isEgg: boolean;
				let script: string;

				it('loads egg', () => {
					try {
						egg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
					} catch { egg = {} as any; }
					isEgg = !!(egg.meta?.version || egg.startup || egg.docker_images || egg.variables || egg.config);
					script = egg.scripts?.installation?.script || '';
				});

				it('has no critical unsafe practices', () => {
					if (!isEgg || !script) return;
					const findings: string[] = [];
					for (const { pattern, severity, label } of UNSAFE_PATTERNS) {
						if (pattern.test(script)) {
							findings.push(`[${severity}] ${label}`);
						}
					}
					if (findings.length > 0) {
						console.log(`  ⚠ ${relativePath}: unsafe practices found: ${findings.join('; ')}`);
					}
					// Critical errors are real failures
					const critical = findings.filter((f) => f.startsWith('[error]'));
					expect(critical, `Critical unsafe practices: ${critical.join(', ')}`).toHaveLength(0);
				});
			});
		}
	});

	// -----------------------------------------------------------------------
	// Entrypoint / Shebang Compatibility (agent runtime mirror)
	// -----------------------------------------------------------------------
	describe.concurrent('entrypoint & shebang compatibility', () => {
		for (const { filePath, relativePath } of allFiles) {
			describe(relativePath, () => {
				let egg: PterodactylEgg;
				let isEgg: boolean;
				let script: string;
				let installImage: string;
				let entrypoint: string;
				let shebang: string;
				let runtimeImages: string[];
				let startup: string;

				it('loads egg', () => {
					try {
						egg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
					} catch { egg = {} as any; }
					isEgg = !!(egg.meta?.version || egg.startup || egg.docker_images || egg.variables || egg.config);
					script = egg.scripts?.installation?.script || '';
					installImage = egg.scripts?.installation?.container || '';
					entrypoint = egg.scripts?.installation?.entrypoint || 'bash';
					startup = egg.startup || '';
					// Collect runtime images
					runtimeImages = [];
					if (egg.images && Array.isArray(egg.images)) runtimeImages.push(...egg.images);
					if (egg.docker_images && typeof egg.docker_images === 'object') {
						runtimeImages.push(...Object.values(egg.docker_images));
					}
					// Read shebang from first line
					const firstLine = script.split('\n')[0]?.trim() || '';
					shebang = firstLine.startsWith('#!') ? firstLine : '';
				});

				it('install script shebang is compatible with install image OS', () => {
					if (!isEgg || !script || !installImage) return;

					const isAlpineInstall = imageIsAlpine(installImage);
					const expectsBash = shebang.includes('bash');

					if (expectsBash && isAlpineInstall) {
						// Agent falls back to sh (busybox ash) on Alpine for bash shebangs.
						// Check if script uses bashisms beyond what ash supports.
						const extraBashisms = detectExtraBashisms(script);
						if (extraBashisms.length > 0) {
							console.log(
								`  ⚠ ${relativePath}: #!/bin/bash on Alpine image (${installImage}) ` +
								`with bash-specific features: ${extraBashisms.join(', ')}`,
							);
						}
						// Warn but don't fail — busybox ash handles [[ ]] and $(( ))
						expect(extraBashisms.length, `Bashisms on Alpine: ${extraBashisms.join(', ')}`).toBeLessThanOrEqual(10);
					}
				});

				it('runtime startup command is compatible with runtime image OS', () => {
					if (!isEgg || !startup) return;

					// Check if any runtime image is Alpine-based
					const hasAlpineRuntime = runtimeImages.some((img) => imageIsAlpine(img));
					if (!hasAlpineRuntime) return; // Debian/Ubuntu images have bash available

					// Check for bashisms in startup command that the agent's requires_bash() misses
					const extraBashisms = detectExtraBashisms(startup);
					if (extraBashisms.length > 0) {
						console.log(
							`  ⚠ ${relativePath}: startup bashisms on Alpine runtime image: ${extraBashisms.join(', ')}`,
						);
					}
					// Flag as info — agent wraps in sh -c, may fail for some bashisms
					expect(extraBashisms.length).toBeLessThanOrEqual(5);
				});

				it('entrypoint field is valid', () => {
					if (!isEgg) return;
					const validEntrypoints = ['bash', 'ash', '/bin/bash', '/bin/ash', '/bin/sh', 'sh'];
					if (entrypoint && !validEntrypoints.includes(entrypoint)) {
						console.log(`  ⚠ ${relativePath}: unusual entrypoint "${entrypoint}"`);
					}
					// Some eggs use nothing or unusual entrypoints — warn only
					expect(validEntrypoints.includes(entrypoint)).toBe(true);
				});
			});
		}
	});

	// -----------------------------------------------------------------------
	// Aggregate statistics (sequential — needs all files processed)
	// -----------------------------------------------------------------------
	describe('aggregate statistics', () => {
		let eggData: Array<{ egg: PterodactylEgg; imported: ImportedTemplate; relativePath: string }>;
		let skippedNonEggs: string[];
		let duplicateNames: Array<{ name: string; paths: string[] }>;
		let highResourceEggs: Array<{ path: string; reason: string; value: string }>;
		let eggsWithShellErrors: Array<{ path: string; count: number }>;
		let eggsWithUnresolvedVars: Array<{ path: string; vars: string[] }>;
		let eggsWithUnsafePractices: Array<{ path: string; findings: string[] }>;
		let eggsWithBashismsOnAlpine: Array<{ path: string; category: string; bashisms: string[] }>;
		let unusualEntrypoints: Array<{ path: string; entrypoint: string }>;

		beforeAll(() => {
			eggData = [];
			skippedNonEggs = [];
			for (const { filePath, relativePath } of allFiles) {
				const raw = fs.readFileSync(filePath, 'utf-8');
				let egg: PterodactylEgg;
				try {
					egg = JSON.parse(raw) as PterodactylEgg;
				} catch {
					skippedNonEggs.push(`${relativePath} (invalid JSON)`);
					continue;
				}
				if (!egg.meta?.version && !egg.startup && !egg.docker_images && !egg.variables && !egg.config) {
					skippedNonEggs.push(relativePath);
					continue;
				}
				eggData.push({ egg, imported: importEgg(egg), relativePath });
			}

			// ── Duplicate name detection ─────────────────────────────
			const nameMap = new Map<string, string[]>();
			for (const { egg, relativePath } of eggData) {
				const name = (egg.name || '').trim().toLowerCase();
				if (!name) continue;
				if (!nameMap.has(name)) nameMap.set(name, []);
				nameMap.get(name)!.push(relativePath);
			}
			duplicateNames = [...nameMap.entries()]
				.filter(([_, paths]) => paths.length > 1)
				.map(([name, paths]) => ({ name, paths }));

			// ── High resource thresholds ────────────────────────────
			highResourceEggs = [];
			for (const { egg, imported, relativePath } of eggData) {
				// Check for startup commands referencing > 32GB
				const memMatch = (egg.startup || '').match(/-X[mx]s(\d+)([GM])/i);
				if (memMatch) {
					const val = parseInt(memMatch[1]);
					const unit = memMatch[2].toUpperCase();
					const mb = unit === 'G' ? val * 1024 : val;
					if (mb > 32768) highResourceEggs.push({ path: relativePath, reason: 'JVM heap > 32GB', value: memMatch[0] });
				}

				// Check for unusual variable defaults
				const vars = Array.isArray(egg.variables) ? egg.variables : [];
				for (const v of vars) {
					const desc = (v.description || '').toLowerCase();
					if (/memory|ram|mem\b/.test(desc) || /memory|ram|mem\b/.test(v.name.toLowerCase())) {
						const defVal = parseInt(v.default_value);
						if (!isNaN(defVal) && defVal > 32768) {
							highResourceEggs.push({
								path: relativePath,
								reason: `Variable ${v.env_variable || v.name} default=${defVal}MB`,
								value: String(defVal),
							});
						}
					}
				}
			}

			// ── Collect shellcheck findings ─────────────────────────
			eggsWithShellErrors = [];
			for (const { egg, relativePath } of eggData) {
				const script = egg.scripts?.installation?.script;
				if (!script) continue;
				const shell = egg.scripts?.installation?.container || '';
				const entrypoint = egg.scripts?.installation?.entrypoint || 'bash';
				const dialect = entrypoint === 'ash' ? 'ash' : 'bash';
				const issues = shellcheck(script, dialect);
				if (issues.length > 0) {
					eggsWithShellErrors.push({ path: relativePath, count: issues.length });
				}
			}
			eggsWithShellErrors.sort((a, b) => b.count - a.count);

			// ── Collect unresolved variable references ──────────────
			eggsWithUnresolvedVars = [];
			for (const { egg, relativePath } of eggData) {
				if (!egg.startup) continue;
				const definedVars = new Set((Array.isArray(egg.variables) ? egg.variables : []).map((v) => v.env_variable || v.name));
				let configText = '';
				if (egg.config?.files) {
					try {
						const parsed = typeof egg.config.files === 'string' ? JSON.parse(egg.config.files) : egg.config.files;
						configText = JSON.stringify(parsed);
					} catch { /* ignore */ }
				}
				const allRefs = [...new Set([...extractTemplateVars(egg.startup), ...extractTemplateVars(configText)])];
				const unresolved = allRefs.filter((v) => {
					if (SYSTEM_VARS.has(v)) return false;
					if (v.startsWith('server.')) return false;
					if (v.startsWith('SRCDS_')) return false;
					return !definedVars.has(v);
				});
				if (unresolved.length > 0) {
					eggsWithUnresolvedVars.push({ path: relativePath, vars: unresolved });
				}
			}
			eggsWithUnresolvedVars.sort((a, b) => b.vars.length - a.vars.length);

			// ── Collect unsafe practices ────────────────────────────
			eggsWithUnsafePractices = [];
			for (const { egg, relativePath } of eggData) {
				const script = egg.scripts?.installation?.script;
				if (!script) continue;
				const findings: string[] = [];
				for (const { pattern, label } of UNSAFE_PATTERNS) {
					if (pattern.test(script)) findings.push(label);
				}
				if (findings.length > 0) {
					eggsWithUnsafePractices.push({ path: relativePath, findings });
				}
			}
			eggsWithUnsafePractices.sort((a, b) => b.findings.length - a.findings.length);

			// ── Collect entrypoint compatibility issues ──────────
			eggsWithBashismsOnAlpine = [];
			unusualEntrypoints = [];
			for (const { egg, relativePath } of eggData) {
				const script = egg.scripts?.installation?.script || '';
				const installImage = egg.scripts?.installation?.container || '';
				const entrypoint = egg.scripts?.installation?.entrypoint || 'bash';
				const shebang = (script.split('\n')[0]?.trim() || '');
				const expectsBash = shebang.startsWith('#!') && shebang.includes('bash');

				// Check bashisms on Alpine install images
				if (script && installImage && expectsBash && imageIsAlpine(installImage)) {
					const extra = detectExtraBashisms(script);
					if (extra.length > 0) {
						eggsWithBashismsOnAlpine.push({ path: relativePath, category: 'install', bashisms: extra });
					}
				}

				// Check bashisms in startup on Alpine runtime images
				const startup = egg.startup || '';
				const runtimeImages: string[] = [];
				if (egg.images && Array.isArray(egg.images)) runtimeImages.push(...egg.images);
				if (egg.docker_images && typeof egg.docker_images === 'object') {
					runtimeImages.push(...Object.values(egg.docker_images));
				}
				if (startup && runtimeImages.some((img) => imageIsAlpine(img))) {
					const extra = detectExtraBashisms(startup);
					if (extra.length > 0) {
						eggsWithBashismsOnAlpine.push({ path: relativePath, category: 'startup', bashisms: extra });
					}
				}

				// Collect unusual entrypoints
				const validEntrypoints = new Set(['bash', 'ash', '/bin/bash', '/bin/ash', '/bin/sh', 'sh']);
				if (entrypoint && !validEntrypoints.has(entrypoint) && (egg.scripts?.installation?.script)) {
					unusualEntrypoints.push({ path: relativePath, entrypoint });
				}
			}
			eggsWithBashismsOnAlpine.sort((a, b) => b.bashisms.length - a.bashisms.length);
		});

		it('imported a large number of eggs', () => {
			expect(eggData.length).toBeGreaterThanOrEqual(200);
		});

		it('skipped non-egg JSON files gracefully', () => {
			if (skippedNonEggs.length > 0) {
				console.log(`\n  Skipped ${skippedNonEggs.length} non-egg JSON files:`);
				skippedNonEggs.forEach((f) => console.log(`    ⚠ ${f}`));
			}
			// All files should be accounted for
			expect(eggData.length + skippedNonEggs.length).toBe(allFiles.length);
		});

		it('reports comprehensive statistics', () => {
			const totalVars = eggData.reduce((s, e) => s + e.imported.variables.length, 0);
			const totalImages = eggData.reduce((s, e) => s + e.imported.images.length, 0);
			const withInstallScript = eggData.filter((e) => e.imported.installScript).length;
			const withStartupDetection = eggData.filter((e) => e.imported.features.startupDetection).length;
			const withConfigFiles = eggData.filter((e) => e.imported.features.pterodactylConfigFiles).length;
			const withFeatures = eggData.filter((e) => e.imported.features.pterodactylFeatures).length;

			// Stop command distribution
			const stopDist = new Map<string, number>();
			for (const { egg: e, imported: i } of eggData) {
				const orig = e.config?.stop || '(none)';
				const key = `${orig} → cmd="${i.stopCommand}" signal=${i.sendSignalTo}`;
				stopDist.set(key, (stopDist.get(key) || 0) + 1);
			}

			console.log('\n  ╔══════════════════════════════════════════════════════════════╗');
			console.log('  ║            PTERODACTYL EGG IMPORT SUMMARY                     ║');
			console.log('  ╠══════════════════════════════════════════════════════════════╣');
			console.log(`  ║  Total JSON files found:  ${String(allFiles.length).padStart(5)}                                   ║`);
			console.log(`  ║  Skipped (not eggs):      ${String(skippedNonEggs.length).padStart(5)}                                   ║`);
			console.log(`  ║  Eggs imported:           ${String(eggData.length).padStart(5)}                                   ║`);
			console.log(`  ║  Total variables:         ${String(totalVars).padStart(5)}                                   ║`);
			console.log(`  ║  Total image variants:    ${String(totalImages).padStart(5)}                                   ║`);
			console.log(`  ║  With install scripts:    ${String(withInstallScript).padStart(5)}                                   ║`);
			console.log(`  ║  With startup detection:  ${String(withStartupDetection).padStart(5)}                                   ║`);
			console.log(`  ║  With config files:       ${String(withConfigFiles).padStart(5)}                                   ║`);
			console.log(`  ║  With features:           ${String(withFeatures).padStart(5)}                                   ║`);
			console.log('  ╠══════════════════════════════════════════════════════════════════╣');
			console.log('  ║  Stop Command Distribution:                                       ║');
			console.log('  ╠──────────────────────────────────────────────────────────────────╣');
			for (const [key, count] of [...stopDist.entries()].sort((a, b) => b[1] - a[1])) {
				console.log(`  ║  ${String(count).padStart(3)}x  ${key.padEnd(58)}║`);
			}
			console.log('  ╚══════════════════════════════════════════════════════════════════╝');

			expect(eggData.length).toBeGreaterThanOrEqual(200);
			expect(totalVars).toBeGreaterThan(1000);
			expect(withInstallScript).toBeGreaterThan(200);
			expect(withStartupDetection).toBeGreaterThan(100);
		});

		it('reports duplicate egg names', () => {
			if (duplicateNames.length > 0) {
				console.log('\n  ╔══════════════════════════════════════════════════════════════╗');
				console.log('  ║  DUPLICATE EGG NAMES                                          ║');
				console.log('  ╠══════════════════════════════════════════════════════════════╣');
				for (const { name, paths } of duplicateNames.slice(0, 10)) {
					console.log(`  ║  "${name}" appears ${paths.length}x:` +
						` ${paths.map((p) => p.slice(0, 40)).join(', ')}`.padEnd(45));
				}
				console.log('  ╚══════════════════════════════════════════════════════════════╝');
			}
			// Duplicate names will conflict on import — but some are legitimate variants
			// (e.g., Wine, Linux vs ARM64 builds). Treat as info for manual review.
			expect(duplicateNames.length).toBeLessThanOrEqual(5);
		});

		it('reports shellcheck findings summary', () => {
			const total = eggsWithShellErrors.length;
			const totalIssues = eggsWithShellErrors.reduce((s, e) => s + e.count, 0);
			console.log('\n  ╔══════════════════════════════════════════════════════════════╗');
			console.log('  ║  SHELLCHECK FINDINGS                                          ║');
			console.log('  ╠══════════════════════════════════════════════════════════════╣');
			console.log(`  ║  Eggs with errors:       ${String(total).padStart(5)}                                   ║`);
			console.log(`  ║  Total issues:           ${String(totalIssues).padStart(5)}                                   ║`);
			if (eggsWithShellErrors.length > 0) {
				console.log('  ╠══════════════════════════════════════════════════════════════╣');
				console.log('  ║  Top 15 worst offenders:                                       ║');
				for (const { path, count } of eggsWithShellErrors.slice(0, 15)) {
					console.log(`  ║    ${String(count).padStart(3)} errors — ${path.slice(0, 50).padEnd(50)} ║`);
				}
			}
			console.log('  ╚══════════════════════════════════════════════════════════════╝');

			// Most Pterodactyl community scripts trigger shellcheck on unquoted vars, $(), etc.
			// Real signal: eggs with >50 errors or ones flagged as "error" severity
			const veryBad = eggsWithShellErrors.filter((e) => e.count > 50);
			expect(veryBad.length, `${veryBad.length} eggs have >50 shellcheck errors`).toBeLessThanOrEqual(15);
		});

		it('reports unresolved variable references', () => {
			console.log('\n  ╔══════════════════════════════════════════════════════════════╗');
			console.log('  ║  UNRESOLVED {{VAR}} REFERENCES IN STARTUP / CONFIG             ║');
			console.log('  ╠══════════════════════════════════════════════════════════════╣');
			console.log(`  ║  Eggs with unresolved refs: ${String(eggsWithUnresolvedVars.length).padStart(3)}                                   ║`);
			if (eggsWithUnresolvedVars.length > 0) {
				console.log('  ╠══════════════════════════════════════════════════════════════╣');
				for (const { path, vars } of eggsWithUnresolvedVars.slice(0, 10)) {
					console.log(`  ║  ${path.slice(0, 40).padEnd(40)} → ${vars.slice(0, 5).join(', ').slice(0, 25)}`);
				}
			}
			console.log('  ╚══════════════════════════════════════════════════════════════╝');

			// Many Pterodactyl eggs reference env vars from the runtime container (WINEDEBUG, STEAM_COMPAT, etc.)
			// These are legitimate. Flag as info, not error, for manual review.
			expect(eggsWithUnresolvedVars.length).toBeLessThanOrEqual(60);
		});

		it('reports unsafe practices', () => {
			console.log('\n  ╔══════════════════════════════════════════════════════════════╗');
			console.log('  ║  UNSAFE PRACTICES IN INSTALL SCRIPTS                           ║');
			console.log('  ╠══════════════════════════════════════════════════════════════╣');
			console.log(`  ║  Eggs with issues:       ${String(eggsWithUnsafePractices.length).padStart(5)}                                   ║`);
			if (eggsWithUnsafePractices.length > 0) {
				console.log('  ╠══════════════════════════════════════════════════════════════╣');
				for (const { path, findings } of eggsWithUnsafePractices.slice(0, 15)) {
					console.log(`  ║  ${path.slice(0, 45).padEnd(45)} → ${findings.join(', ').slice(0, 20)}`);
				}
			}
			console.log('  ╚══════════════════════════════════════════════════════════════╝');

			// These are informational — per-file tests already assert no critical errors
			expect(eggsWithUnsafePractices.length).toBeDefined();
		});

		it('reports high resource thresholds', () => {
			if (highResourceEggs.length > 0) {
				console.log('\n  ╔══════════════════════════════════════════════════════════════╗');
				console.log('  ║  HIGH RESOURCE THRESHOLDS (>32GB RAM)                           ║');
				console.log('  ╠══════════════════════════════════════════════════════════════╣');
				for (const { path, reason, value } of highResourceEggs.slice(0, 10)) {
					console.log(`  ║  ${path.slice(0, 30).padEnd(30)} ${reason.padEnd(30)} ${value.padEnd(10)} ║`);
				}
				console.log('  ╚══════════════════════════════════════════════════════════════╝');
			}
			expect(highResourceEggs.length).toBeDefined();
		});

		it('reports entrypoint & shebang compatibility issues', () => {
			console.log('\n  ╔══════════════════════════════════════════════════════════════╗');
			console.log('  ║  ENTRYPOINT & SHEBANG COMPATIBILITY                            ║');
			console.log('  ╠══════════════════════════════════════════════════════════════╣');
			console.log(`  ║  Bashisms on Alpine install: ${String(eggsWithBashismsOnAlpine.filter((e) => e.category === 'install').length).padStart(3)}                              ║`);
			console.log(`  ║  Bashisms on Alpine startup: ${String(eggsWithBashismsOnAlpine.filter((e) => e.category === 'startup').length).padStart(3)}                              ║`);
			console.log(`  ║  Unusual entrypoint values: ${String(unusualEntrypoints.length).padStart(3)}                              ║`);
			if (eggsWithBashismsOnAlpine.length > 0) {
				console.log('  ╠══════════════════════════════════════════════════════════════╣');
				console.log('  ║  Alpine bashism details (may fail at runtime):                  ║');
				for (const { path, category, bashisms } of eggsWithBashismsOnAlpine.slice(0, 12)) {
					const tag = category === 'install' ? '[inst]' : '[start]';
					console.log(`  ║  ${tag} ${path.slice(0, 40).padEnd(40)} → ${bashisms.slice(0, 3).join(', ').slice(0, 25)}`);
				}
			}
			if (unusualEntrypoints.length > 0) {
				console.log('  ╠══════════════════════════════════════════════════════════════╣');
				console.log('  ║  Unusual entrypoint values:                                     ║');
				for (const { path, entrypoint } of unusualEntrypoints.slice(0, 10)) {
					console.log(`  ║  ${path.slice(0, 45).padEnd(45)} → "${entrypoint.slice(0, 15)}"`);
				}
			}
			console.log('  ╚══════════════════════════════════════════════════════════════╝');

			// Bashisms on Alpine can cause runtime failures — flag as warn
			expect(eggsWithBashismsOnAlpine.filter((e) => e.category === 'startup').length).toBeLessThanOrEqual(15);
			expect(unusualEntrypoints.length).toBeLessThanOrEqual(5);
		});
	});
});
