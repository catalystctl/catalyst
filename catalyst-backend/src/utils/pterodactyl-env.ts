/**
 * Pterodactyl/Wings environment-variable compatibility helpers.
 *
 * Kept in utils/ (not routes/_helpers) so the WebSocket gateway and other
 * light modules can import without pulling route-side top-level awaits.
 */

export type PteroEnvServer = {
	uuid: string;
	name: string;
	primaryIp: string | null;
	primaryPort: number;
	allocatedMemoryMb: number;
	allocatedDiskMb: number;
	location?: string | null;
};

/**
 * Inject Pterodactyl-compatible environment variables for egg install/start.
 *
 * Pterodactyl/Wings always provides a set of built-in variables to install
 * scripts and startup commands (SERVER_MEMORY, SERVER_PORT, SERVER_IP, …).
 * Imported eggs reference these via $VAR / ${VAR} / {{VAR}} and via
 * config.files placeholders like {{server.build.default.port}}.
 *
 * Always inject the core builtins from the live server allocation. Optional
 * keys that were only present for migrations keep their "if already defined"
 * behaviour so non-Pterodactyl templates are not polluted with extras.
 */
export function injectPterodactylCompatibilityVars(
	environment: Record<string, string>,
	server: PteroEnvServer,
	portBindings?: Record<number, number>,
	options?: { startupCommand?: string | null },
): Record<string, string> {
	const env = { ...environment };

	// ── Always-on Wings builtins ─────────────────────────────────────────
	env.SERVER_MEMORY = String(server.allocatedMemoryMb);
	env.MEMORY = env.MEMORY ?? String(server.allocatedMemoryMb);
	env.SERVER_PORT = String(server.primaryPort);
	env.SERVER_IP = server.primaryIp || env.SERVER_IP || "0.0.0.0";
	env.SERVER_UUID = server.uuid;
	env.P_SERVER_UUID = server.uuid;
	env.UUID = env.UUID ?? server.uuid;
	env.P_SERVER_LOCATION = server.location || env.P_SERVER_LOCATION || "catalyst";
	env.HOSTNAME = env.HOSTNAME || server.name || "catalyst";
	env.TZ = env.TZ || "UTC";

	if (options?.startupCommand) {
		env.STARTUP = options.startupCommand;
	}

	// Wine yolks' /entrypoint.sh only starts Xvfb when XVFB=1. Dedicated
	// Windows servers (SotF, etc.) fail with "Failed to create batch mode
	// window" otherwise. Do not override an explicit value.
	const wineStartup = (env.STARTUP || "").toLowerCase().includes("wine");
	if (
		env.XVFB === undefined &&
		(Boolean(env.WINEARCH || env.WINDOWS_INSTALL || env.WINETRICKS_RUN || env.WINEPREFIX) ||
			wineStartup)
	) {
		env.XVFB = "1";
	}

	// ── Optional keys (only when already present / egg-defined) ──────────
	if ("SERVER_NAME" in env) {
		env.SERVER_NAME = server.name;
	}

	if ("SERVER_TOTAL_MEMORY" in env) {
		env.SERVER_TOTAL_MEMORY = String(server.allocatedMemoryMb);
	}

	if ("SERVER_TOTAL_DISK" in env) {
		env.SERVER_TOTAL_DISK = String(server.allocatedDiskMb);
	}

	if ("SERVER_PRIMARY_PORT" in env) {
		env.SERVER_PRIMARY_PORT = String(server.primaryPort);
	}

	if ("SERVER_PRIMARY_IP" in env && server.primaryIp) {
		env.SERVER_PRIMARY_IP = server.primaryIp;
	}

	if ("SERVER_DESCRIPTION" in env && server.name) {
		env.SERVER_DESCRIPTION = server.name;
	}

	if (portBindings) {
		for (const [containerPort] of Object.entries(portBindings)) {
			const key = `SERVER_PORT_${containerPort}`;
			if (key in env) {
				env[key] = containerPort;
			}
		}
	}

	return env;
}

