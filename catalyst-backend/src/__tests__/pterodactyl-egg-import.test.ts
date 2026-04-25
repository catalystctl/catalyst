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
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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
	// Aggregate statistics (sequential — needs all files processed)
	// -----------------------------------------------------------------------
	describe('aggregate statistics', () => {
		let eggData: Array<{ egg: PterodactylEgg; imported: ImportedTemplate; relativePath: string }>;
		let skippedNonEggs: string[];

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
	});
});
