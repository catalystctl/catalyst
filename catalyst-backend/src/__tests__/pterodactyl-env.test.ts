/**
 * Unit tests for Pterodactyl environment-variable injection.
 */
import { describe, it, expect } from 'vitest';
import { injectPterodactylCompatibilityVars } from '../utils/pterodactyl-env';

const baseServer = {
	uuid: 'srv-uuid-1',
	name: 'My Server',
	primaryIp: '10.0.0.5',
	primaryPort: 25565,
	allocatedMemoryMb: 4096,
	allocatedDiskMb: 20480,
	subdomain: 'play',
	location: 'us-east',
};

describe('injectPterodactylCompatibilityVars', () => {
	it('always injects Wings builtins from live allocation', () => {
		const env = injectPterodactylCompatibilityVars({}, baseServer);
		expect(env.SERVER_MEMORY).toBe('4096');
		expect(env.MEMORY).toBe('4096');
		expect(env.SERVER_PORT).toBe('25565');
		expect(env.SERVER_IP).toBe('10.0.0.5');
		expect(env.SERVER_UUID).toBe('srv-uuid-1');
		expect(env.P_SERVER_UUID).toBe('srv-uuid-1');
		expect(env.UUID).toBe('srv-uuid-1');
		expect(env.P_SERVER_LOCATION).toBe('us-east');
		expect(env.HOSTNAME).toBe('My Server');
		expect(env.TZ).toBe('UTC');
	});

	it('does not overwrite user-provided MEMORY / UUID / HOSTNAME / TZ', () => {
		const env = injectPterodactylCompatibilityVars(
			{
				MEMORY: '512',
				UUID: 'custom',
				HOSTNAME: 'custom-host',
				TZ: 'America/New_York',
			},
			baseServer,
		);
		expect(env.MEMORY).toBe('512');
		expect(env.SERVER_MEMORY).toBe('4096'); // always from allocation
		expect(env.UUID).toBe('custom');
		expect(env.HOSTNAME).toBe('custom-host');
		expect(env.TZ).toBe('America/New_York');
	});

	it('sets STARTUP when provided', () => {
		const env = injectPterodactylCompatibilityVars({}, baseServer, undefined, {
			startupCommand: 'java -jar server.jar',
		});
		expect(env.STARTUP).toBe('java -jar server.jar');
	});

	it('only fills optional keys when already present', () => {
		const bare = injectPterodactylCompatibilityVars({}, baseServer);
		expect(bare.SERVER_NAME).toBeUndefined();
		expect(bare.SERVER_TOTAL_MEMORY).toBeUndefined();

		const withOptional = injectPterodactylCompatibilityVars(
			{
				SERVER_NAME: 'old',
				SERVER_TOTAL_MEMORY: '0',
				SERVER_DESCRIPTION: 'x',
			},
			baseServer,
		);
		expect(withOptional.SERVER_NAME).toBe('My Server');
		expect(withOptional.SERVER_TOTAL_MEMORY).toBe('4096');
		expect(withOptional.SERVER_DESCRIPTION).toBe('My Server');
	});

	it('defaults SERVER_IP to 0.0.0.0 when primaryIp is null', () => {
		const env = injectPterodactylCompatibilityVars({}, { ...baseServer, primaryIp: null });
		expect(env.SERVER_IP).toBe('0.0.0.0');
	});

	it('defaults XVFB=1 for wine / Windows dedicated servers', () => {
		const wine = injectPterodactylCompatibilityVars(
			{ WINEARCH: 'win64', WINDOWS_INSTALL: '1' },
			baseServer,
		);
		expect(wine.XVFB).toBe('1');

		const fromStartup = injectPterodactylCompatibilityVars({}, baseServer, undefined, {
			startupCommand: 'wine ./SonsOfTheForestDS.exe',
		});
		expect(fromStartup.XVFB).toBe('1');
	});

	it('does not override an explicit XVFB value', () => {
		const env = injectPterodactylCompatibilityVars(
			{ WINEARCH: 'win64', XVFB: '0' },
			baseServer,
		);
		expect(env.XVFB).toBe('0');
	});

	it('does not set XVFB for non-wine servers', () => {
		const env = injectPterodactylCompatibilityVars({}, baseServer, undefined, {
			startupCommand: 'java -jar server.jar',
		});
		expect(env.XVFB).toBeUndefined();
	});
});
