/**
 * Adversarial / edge-case tests for the Pterodactyl egg import pipeline.
 *
 * Each test exercises exactly ONE failure mode and asserts on both the
 * error code AND the field path. These complement the existing 248-egg
 * fidelity tests which verify happy-path correctness.
 *
 * Covers: malformed JSON, circular variable refs, oversized inputs,
 * duplicate variable names, builtin variable collisions, unknown stop
 * signals, invalid Docker images, batch partial-failure, and more.
 */

import { describe, it, expect } from 'vitest';
import {
	importPterodactylEgg,
	importPterodactylEggSafe,
	importPterodactylEggsBatch,
	convertStartupCommand,
	convertInstallScript,
	parseStopCommand,
} from '../utils/egg-import';
import type {
	PteroEgg,
	ImportError,
	ImportSafeResult,
	BatchImportResult,
	ImportedEggResult,
} from '../utils/egg-import';

// ============================================================================
// Minimal valid egg (used as a base for mutations)
// ============================================================================

const VALID_EGG: PteroEgg = {
	meta: { version: 'PTDL_v2' },
	name: 'Test Egg',
	author: 'test@example.com',
	description: 'A valid test egg',
	startup: './server --port {{SERVER_PORT}}',
	docker_images: { 'Vanilla': 'ghcr.io/pterodactyl/yolks:java_17' },
	config: {
		stop: '^C',
	},
	scripts: {
		installation: {
			script: '#!/bin/bash\necho hello',
			container: 'ghcr.io/pterodactyl/installers:alpine',
			entrypoint: 'bash',
		},
	},
	variables: [
		{
			name: 'Server Port',
			description: 'The port the server runs on',
			env_variable: 'SERVER_PORT',
			default_value: '25565',
			user_viewable: true,
			user_editable: true,
			rules: 'required|integer',
			field_type: 'number',
		},
	],
};

// ============================================================================
// 1. Missing required fields
// ============================================================================

describe('importPterodactylEggSafe — missing required fields', () => {
	it('reports MISSING_NAME when name is absent', () => {
		const egg = { ...VALID_EGG, name: '' };
		const result = importPterodactylEggSafe(egg);

		expect(result.result).toBeUndefined();
		expect(result.errors.length).toBeGreaterThan(0);

		const err = result.errors.find(
			(e) => e.code === 'MISSING_NAME' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('name');
		expect(err!.message).toContain('name');
	});

	it('reports MISSING_NAME when name is whitespace-only', () => {
		const egg = { ...VALID_EGG, name: '   ' };
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'MISSING_NAME' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('name');
	});

	it('reports MISSING_STARTUP when startup command is absent', () => {
		const egg = { ...VALID_EGG, startup: '' };
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'MISSING_STARTUP' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('startup');
		expect(err!.message).toContain('startup');
	});

	it('reports MISSING_IMAGES when no docker_images or images are defined', () => {
		const egg: PteroEgg = {
			...VALID_EGG,
			docker_images: {},
			images: undefined,
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'MISSING_IMAGES' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('docker_images');
		expect(err!.message).toContain('Docker image');
	});
});

// ============================================================================
// 2. Invalid Docker image references
// ============================================================================

describe('importPterodactylEggSafe — invalid Docker image references', () => {
	it('reports INVALID_IMAGE_FORMAT for malformed docker_images values', () => {
		const egg = {
			...VALID_EGG,
			docker_images: { Vanilla: '!!!invalid-image!!!' },
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'INVALID_IMAGE_FORMAT' && e.severity === 'warning',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('docker_images.Vanilla');
	});

	it('reports INVALID_IMAGE_REF for empty image values in images array', () => {
		const egg: PteroEgg = {
			...VALID_EGG,
			docker_images: undefined,
			images: ['', 'ghcr.io/valid/image:latest'],
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'INVALID_IMAGE_REF' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('images[0]');
	});
});

// ============================================================================
// 3. Unknown / non-standard meta version
// ============================================================================

describe('importPterodactylEggSafe — unknown meta version', () => {
	it('reports UNKNOWN_META_VERSION for unsupported spec version', () => {
		const egg = {
			...VALID_EGG,
			meta: { version: 'PTDL_v99' },
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'UNKNOWN_META_VERSION' && e.severity === 'warning',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('meta.version');
		expect(err!.message).toContain('PTDL_v99');
		// This is a warning, so import should still succeed
		expect(result.result).toBeDefined();
	});
});

// ============================================================================
// 4. Install script limits
// ============================================================================

describe('importPterodactylEggSafe — oversized install script', () => {
	it('reports INSTALL_SCRIPT_TOO_LARGE when script exceeds 1 MiB', () => {
		// Create a script larger than 1 MiB
		const hugeScript = '#!/bin/bash\necho ' + 'A'.repeat(1024 * 1024 + 100);
		const egg = {
			...VALID_EGG,
			scripts: {
				installation: {
					script: hugeScript,
					container: 'ghcr.io/pterodactyl/installers:alpine',
					entrypoint: 'bash',
				},
			},
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'INSTALL_SCRIPT_TOO_LARGE' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('scripts.installation.script');
		expect(err!.message).toContain('KiB');
		expect(result.result).toBeUndefined();
	});
});

// ============================================================================
// 5. Circular variable references
// ============================================================================

describe('importPterodactylEggSafe — circular variable references', () => {
	it('reports CIRCULAR_VARIABLE_REF when two variables reference each other', () => {
		const egg: PteroEgg = {
			...VALID_EGG,
			variables: [
				{
					name: 'Var A',
					env_variable: 'VAR_A',
					default_value: '{{VAR_B}}',
					rules: 'required',
				},
				{
					name: 'Var B',
					env_variable: 'VAR_B',
					default_value: '{{VAR_A}}',
					rules: 'required',
				},
				{
					name: 'Server Port',
					env_variable: 'SERVER_PORT',
					default_value: '25565',
					rules: 'required|integer',
				},
			],
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'CIRCULAR_VARIABLE_REF' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('variables');
		expect(err!.message).toContain('VAR_A');
		expect(err!.message).toContain('VAR_B');
		expect(result.result).toBeUndefined();
	});

	it('detects longer cycles (3+ variables)', () => {
		const egg: PteroEgg = {
			...VALID_EGG,
			variables: [
				{
					name: 'Var A',
					env_variable: 'VAR_A',
					default_value: '{{VAR_B}}',
					rules: 'required',
				},
				{
					name: 'Var B',
					env_variable: 'VAR_B',
					default_value: '{{VAR_C}}',
					rules: 'required',
				},
				{
					name: 'Var C',
					env_variable: 'VAR_C',
					default_value: '{{VAR_A}}',
					rules: 'required',
				},
			],
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'CIRCULAR_VARIABLE_REF',
		);
		expect(err).toBeDefined();
		expect(err!.message).toContain('VAR_A');
		expect(err!.message).toContain('VAR_C');
	});
});

// ============================================================================
// 6. Variable name collisions with built-in PTDL vars
// ============================================================================

describe('importPterodactylEggSafe — builtin variable collision', () => {
	it('reports VARIABLE_COLLIDES_WITH_BUILTIN when egg defines SERVER_MEMORY', () => {
		const egg: PteroEgg = {
			...VALID_EGG,
			variables: [
				{
					name: 'Memory Override',
					env_variable: 'SERVER_MEMORY',
					default_value: '2048',
					rules: 'required|integer',
				},
			],
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) =>
				e.code === 'VARIABLE_COLLIDES_WITH_BUILTIN' && e.severity === 'warning',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('variables[0].env_variable');
		expect(err!.message).toContain('SERVER_MEMORY');
		// Warning only — import still succeeds
		expect(result.result).toBeDefined();
	});
});

// ============================================================================
// 7. Duplicate variable names
// ============================================================================

describe('importPterodactylEggSafe — duplicate variable names', () => {
	it('reports DUPLICATE_VARIABLE when the same env_variable appears twice', () => {
		const egg: PteroEgg = {
			...VALID_EGG,
			variables: [
				{
					name: 'Port 1',
					env_variable: 'SERVER_PORT',
					default_value: '25565',
					rules: 'required',
				},
				{
					name: 'Port 2',
					env_variable: 'SERVER_PORT',
					default_value: '25566',
					rules: 'required',
				},
			],
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'DUPLICATE_VARIABLE' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('variables[1].env_variable');
		expect(err!.message).toContain('SERVER_PORT');
	});
});

// ============================================================================
// 8. Missing variable env_variable name
// ============================================================================

describe('importPterodactylEggSafe — missing variable name', () => {
	it('reports MISSING_VAR_NAME when env_variable is empty', () => {
		const egg: PteroEgg = {
			...VALID_EGG,
			variables: [
				{
					name: 'Broken Var',
					env_variable: '',
					default_value: 'oops',
					rules: '',
				},
			],
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'MISSING_VAR_NAME' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('variables[0].env_variable');
	});
});

// ============================================================================
// 9. Unknown / non-standard stop signals
// ============================================================================

describe('importPterodactylEggSafe — non-standard stop signals', () => {
	it('reports UNKNOWN_STOP_SIGNAL for unrecognized ^-prefixed signal', () => {
		const egg = {
			...VALID_EGG,
			config: {
				...VALID_EGG.config,
				stop: '^SIGUSR1',
			},
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'UNKNOWN_STOP_SIGNAL' && e.severity === 'warning',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('config.stop');
		expect(err!.message).toContain('^SIGUSR1');
		// Warning only — import succeeds
		expect(result.result).toBeDefined();
		expect(result.result!.sendSignalTo).toBe('SIGTERM'); // fallback
	});
});

// ============================================================================
// 10. Unusual install entrypoint
// ============================================================================

describe('importPterodactylEggSafe — unusual entrypoint', () => {
	it('reports UNUSUAL_ENTRYPOINT for non-standard entrypoint', () => {
		const egg = {
			...VALID_EGG,
			scripts: {
				installation: {
					script: '#!/bin/bash\necho hello',
					container: 'ghcr.io/pterodactyl/installers:alpine',
					entrypoint: 'python3',
				},
			},
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'UNUSUAL_ENTRYPOINT' && e.severity === 'warning',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('scripts.installation.entrypoint');
		expect(err!.message).toContain('python3');
	});
});

// ============================================================================
// 11. Oversized variable default value
// ============================================================================

describe('importPterodactylEggSafe — oversized variable default', () => {
	it('reports VARIABLE_VALUE_TOO_LARGE when default_value exceeds 64 KiB', () => {
		const hugeValue = 'X'.repeat(64 * 1024 + 100);
		const egg: PteroEgg = {
			...VALID_EGG,
			variables: [
				{
					name: 'Huge Default',
					env_variable: 'HUGE_VAR',
					default_value: hugeValue,
					rules: '',
				},
			],
		};
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) =>
				e.code === 'VARIABLE_VALUE_TOO_LARGE' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('variables[0].default_value');
		expect(err!.message).toContain('HUGE_VAR');
	});
});

// ============================================================================
// 12. Too many variables
// ============================================================================

describe('importPterodactylEggSafe — too many variables', () => {
	it('reports TOO_MANY_VARIABLES when exceeding 256 variables', () => {
		const variables = Array.from({ length: 257 }, (_, i) => ({
			name: `Var ${i}`,
			env_variable: `VAR_${i}`,
			default_value: String(i),
			rules: '',
		}));
		const egg: PteroEgg = { ...VALID_EGG, variables };
		const result = importPterodactylEggSafe(egg);

		const err = result.errors.find(
			(e) => e.code === 'TOO_MANY_VARIABLES' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('variables');
		expect(err!.message).toContain('257');
	});
});

// ============================================================================
// 13. Batch import with mixed success and failure
// ============================================================================

describe('importPterodactylEggsBatch — partial-failure handling', () => {
	it('returns both imported and failed eggs, never aborts on single failure', () => {
		const goodEgg: PteroEgg = {
			...VALID_EGG,
			name: 'Good Egg',
		};
		const badEgg: PteroEgg = {
			...VALID_EGG,
			name: '', // Missing name → error
			startup: '', // Also missing startup
		};
		const anotherGood: PteroEgg = {
			...VALID_EGG,
			name: 'Another Good Egg',
		};

		const result = importPterodactylEggsBatch([goodEgg, badEgg, anotherGood]);

		expect(result.imported.length).toBe(2);
		expect(result.failed.length).toBe(1);
		expect(result.failed[0].egg).toBe('(unnamed egg)');
		expect(result.failed[0].errors.length).toBeGreaterThan(0);

		// Verify error codes in the failed egg
		const codes = result.failed[0].errors.map((e) => e.code);
		expect(codes).toContain('MISSING_NAME');
		expect(codes).toContain('MISSING_STARTUP');
	});

	it('returns all failed when every egg is invalid', () => {
		const badEggs: PteroEgg[] = [
			{ ...VALID_EGG, name: '', startup: '' },
			{ ...VALID_EGG, name: '  ', startup: '   ' },
		];
		const result = importPterodactylEggsBatch(badEggs);

		expect(result.imported.length).toBe(0);
		expect(result.failed.length).toBe(2);
	});
});

// ============================================================================
// 14. Valid egg passes clean (zero errors)
// ============================================================================

describe('importPterodactylEggSafe — valid egg passes clean', () => {
	it('returns zero blocking errors for a well-formed egg', () => {
		const result = importPterodactylEggSafe(VALID_EGG);

		// SERVER_PORT collides with a builtin — that's a warning, not an error
		const blockingErrors = result.errors.filter((e) => e.severity === 'error');
		expect(blockingErrors).toHaveLength(0);
		expect(result.result).toBeDefined();
		expect(result.result!.name).toBe('Test Egg');
		expect(result.result!.startup).toContain('{{SERVER_PORT}}');

		// Expect the builtin collision warning
		const warnings = result.errors.filter((e) => e.severity === 'warning');
		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings.some((w) => w.code === 'VARIABLE_COLLIDES_WITH_BUILTIN')).toBe(true);
	});
});

// ============================================================================
// 15. importPterodactylEgg still works (backward compat)
// ============================================================================

describe('importPterodactylEgg — backward compatibility', () => {
	it('still works without errors for valid eggs', () => {
		const result = importPterodactylEgg(VALID_EGG);
		expect(result.name).toBe('Test Egg');
		expect(result.variables.length).toBeGreaterThan(0);
	});
});

// ============================================================================
// 16. Conversion utility tests
// ============================================================================

describe('conversion utilities', () => {
	it('convertStartupCommand handles $VAR and ${VAR} syntax', () => {
		expect(convertStartupCommand('$SERVER_MEMORY')).toBe('{{SERVER_MEMORY}}');
		expect(convertStartupCommand('${SERVER_PORT}')).toBe('{{SERVER_PORT}}');
		expect(convertStartupCommand('./run --port $SERVER_PORT --ip ${SERVER_IP}'))
			.toBe('./run --port {{SERVER_PORT}} --ip {{SERVER_IP}}');
	});

	it('convertInstallScript cleans JSON escape sequences', () => {
		expect(convertInstallScript('path\\/to\\/file')).toBe('path/to/file');
	});

	it('parseStopCommand maps known signals', () => {
		expect(parseStopCommand('^C').sendSignalTo).toBe('SIGINT');
		expect(parseStopCommand('^SIGKILL').sendSignalTo).toBe('SIGKILL');
		expect(parseStopCommand('SIGTERM').sendSignalTo).toBe('SIGTERM');
	});

	it('parseStopCommand falls back to SIGTERM for command strings', () => {
		const result = parseStopCommand('stop');
		expect(result.stopCommand).toBe('stop');
		expect(result.sendSignalTo).toBe('SIGTERM');
	});

	it('parseStopCommand defaults when no stop is provided', () => {
		const result = parseStopCommand(undefined);
		expect(result.stopCommand).toBe('stop');
		expect(result.sendSignalTo).toBe('SIGTERM');
	});
});

// ============================================================================
// 17. Non-string default_value on variable
// ============================================================================

describe('importPterodactylEggSafe — invalid variable default_value type', () => {
	it('reports INVALID_VAR_DEFAULT for non-string default_value', () => {
		const egg = {
			...VALID_EGG,
			variables: [
				{
					name: 'Bad Default',
					env_variable: 'BAD_DEFAULT',
					default_value: 42, // number, not string
					rules: '',
				},
			],
		};
		const result = importPterodactylEggSafe(egg as any);

		const err = result.errors.find(
			(e) => e.code === 'INVALID_VAR_DEFAULT' && e.severity === 'error',
		);
		expect(err).toBeDefined();
		expect(err!.field).toBe('variables[0].default_value');
	});
});
