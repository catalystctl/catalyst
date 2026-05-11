/**
 * Shared Pterodactyl / Pelican egg import utilities.
 *
 * This module contains the SINGLE SOURCE OF TRUTH for converting
 * Pterodactyl/Pelican egg JSON into Catalyst ServerTemplate data.
 *
 * Used by:
 *   - POST /api/templates/import-pterodactyl (routes/templates.ts)
 *   - EntityMapper.mapTemplate() (services/migration/entity-mapper.ts)
 *   - Tests (__tests__/pterodactyl-egg-import.test.ts)
 *
 * DESIGN DECISIONS:
 *   - Startup commands: Convert $VAR / ${VAR} → {{VAR}} syntax (Catalyst native)
 *   - Install scripts: Convert /mnt/server → {{SERVER_DIR}}, fix shebangs,
 *     add pre-flight packages, convert bashisms to POSIX
 *   - Variables: Preserve user_viewable, user_editable; parse select options
 *   - Pelican fields: Preserve tags, update_url, export_files
 *   - File denylist: Preserve for runtime enforcement
 */

// ============================================================================
// Types
// ============================================================================

export interface PteroEggVariable {
	name: string;
	description?: string;
	env_variable: string;
	default_value: string;
	user_viewable?: boolean;
	user_editable?: boolean;
	rules?: string;
	field_type?: string;
	sortable?: boolean; // Pelican
}

export interface PteroEggConfigFile {
	parser?: string;
	file?: string;
	replace?: Array<{
		match?: string;
		replace?: string;
		if_value?: string;
	}>;
	find?: Record<string, string>;
}

export interface PteroEgg {
	_comment?: string;
	meta?: { version?: string; update_url?: string };
	exported_at?: string;
	name?: string;
	author?: string;
	description?: string;
	features?: string[] | null;
	docker_images?: Record<string, string>;
	images?: string[]; // Pelican array format
	startup?: string;
	config?: {
		files?: Record<string, PteroEggConfigFile> | string;
		startup?: { done?: string | string[] } | string;
		logs?: Record<string, unknown> | string;
		stop?: string;
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
	variables?: PteroEggVariable[];
	file_denylist?: string[];
	copy_script_from?: number;
	// Pelican-specific
	tags?: string[] | null;
	update_url?: string;
	export_files?: string[];
	[key: string]: unknown;
}

export interface MappedVariable {
	name: string;
	description: string;
	default: string;
	required: boolean;
	userViewable: boolean;
	userEditable: boolean;
	input: "text" | "number" | "select" | "checkbox" | "password";
	options?: string[];
	rules: string[];
}

export interface MappedImage {
	name: string;
	label?: string;
	image: string;
}

export interface ImportedEggResult {
	name: string;
	description: string | null;
	author: string;
	version: string;
	image: string;
	images: MappedImage[];
	defaultImage: string | null;
	installImage: string | null;
	installEntrypoint: string;
	startup: string;
	stopCommand: string;
	sendSignalTo: "SIGTERM" | "SIGINT" | "SIGKILL";
	variables: MappedVariable[];
	installScript: string | null;
	supportedPorts: number[];
	allocatedMemoryMb: number;
	allocatedCpuCores: number;
	features: Record<string, unknown>;
	nestId?: string | null;
	srvService?: string | null;
	srvProtocol?: string;
}

// ============================================================================
// Signal Mapping
// ============================================================================

const STOP_SIGNAL_MAP: Record<string, "SIGINT" | "SIGTERM" | "SIGKILL"> = {
	"^C": "SIGINT",
	"^c": "SIGINT",
	"^^C": "SIGINT",
	"^SIGKILL": "SIGKILL",
	"^X": "SIGKILL",
	SIGINT: "SIGINT",
	SIGTERM: "SIGTERM",
	SIGKILL: "SIGKILL",
};

// ============================================================================
// Built-in Pterodactyl Variables
// ============================================================================

const PTDL_BUILTIN_VARIABLES = [
	{
		name: "SERVER_MEMORY",
		description: "Allocated memory in MB",
		default: "1024",
		input: "number" as const,
	},
	{
		name: "SERVER_PORT",
		description: "Primary server port",
		default: "25565",
		input: "number" as const,
	},
	{
		name: "SERVER_IP",
		description: "Server IP address (0.0.0.0 for all interfaces)",
		default: "0.0.0.0",
		input: "text" as const,
	},
	{
		name: "TZ",
		description: "Server timezone",
		default: "UTC",
		input: "text" as const,
	},
];

// ============================================================================
// Variable Conversion
// ============================================================================

/** Infer Catalyst input type from Pterodactyl field_type + rules. */
function inferInputType(
	fieldType: string | undefined,
	rules: string | undefined,
): "text" | "number" | "select" | "checkbox" | "password" {
	// Explicit field_type takes precedence
	if (fieldType === "select") return "select";
	if (fieldType === "number") return "number";
	if (fieldType === "password") return "password";

	// Infer from rules
	const rulesStr = rules || "";
	if (rulesStr.includes("boolean")) return "checkbox";
	if (rulesStr.includes("integer") || rulesStr.includes("numeric"))
		return "number";
	if (rulesStr.includes("in:")) return "select";

	return "text";
}

/** Parse select options from Pterodactyl "in:" rule. */
function parseSelectOptions(
	rules: string | undefined,
): string[] | undefined {
	if (!rules) return undefined;
	const inMatch = rules.match(/\bin:([^|]+)/);
	if (!inMatch) return undefined;
	return inMatch[1].split(",").filter(Boolean);
}

/** Convert Pterodactyl rules string to Catalyst rules array.
 *  Filters out type-related rules that are already expressed via `input` field. */
function convertRules(rules: string | undefined): string[] {
	if (!rules) return [];
	const parts = rules.split("|").map((r) => r.trim()).filter(Boolean);
	// Keep all rules — both type-related and validation rules
	// Type rules are useful for server-side validation too
	return parts;
}

/** Map a single Pterodactyl variable to Catalyst format. */
function mapVariable(v: PteroEggVariable): MappedVariable {
	const rules = v.rules || "";
	const isRequired = rules.includes("required");
	const input = inferInputType(v.field_type, rules);
	const options = input === "select" ? parseSelectOptions(rules) : undefined;

	return {
		name: v.env_variable || v.name,
		description: v.description || v.name || "",
		default: v.default_value ?? "",
		required: isRequired,
		userViewable: v.user_viewable ?? true,
		userEditable: v.user_editable ?? true,
		input,
		options,
		rules: convertRules(rules),
	};
}

/** Add built-in Pterodactyl variables if they're referenced but not defined. */
function addBuiltinVariables(
	variables: MappedVariable[],
	startup: string,
	installScript: string | null | undefined,
): MappedVariable[] {
	const existingVarNames = new Set(variables.map((v) => v.name));
	const combinedContent = `${startup} ${installScript || ""}`;
	const result = [...variables];

	for (const builtin of PTDL_BUILTIN_VARIABLES) {
		// Check if this variable is referenced in startup or install script
		const patterns = [
			new RegExp(`\\$\\{${builtin.name}\\}`, "g"),
			new RegExp(`\\$${builtin.name}(?![A-Z0-9_])`, "g"),
			new RegExp(`\\{\\{${builtin.name}\\}\\}`, "g"),
		];

		const isUsed = patterns.some((p) => p.test(combinedContent));

		if (isUsed && !existingVarNames.has(builtin.name)) {
			result.push({
				name: builtin.name,
				description: builtin.description,
				default: builtin.default,
				required: false,
				userViewable: false,
				userEditable: false,
				input: builtin.input,
				rules: [],
			});
			existingVarNames.add(builtin.name);
		}
	}

	return result;
}

// ============================================================================
// Startup Command Conversion
// ============================================================================

/** Convert Pterodactyl startup command variables from $VAR / ${VAR} to {{VAR}} syntax. */
export function convertStartupCommand(startup: string): string {
	// First handle ${VAR} syntax (including nested ${SERVER_MEMORY})
	let result = startup.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, "{{$1}}");
	// Then handle $VAR syntax (only uppercase env var names to avoid false matches)
	result = result.replace(/\$([A-Z_][A-Z0-9_]*)(?![A-Z0-9_])/g, "{{$1}}");
	return result;
}

// ============================================================================
// Install Script Conversion
// ============================================================================

/**
 * Convert Pterodactyl install script for Catalyst compatibility.
 *
 * The Catalyst agent already handles:
 *   - /mnt/server compatibility: creates symlink /mnt/server → /data at runtime
 *   - {{SERVER_DIR}} substitution: replaces with /data at runtime
 *   - Shell interpreter detection: picks bash/sh based on image + shebang
 *   - Carriage return stripping: removes \r before execution
 *   - set -e: adds to the wrapper script automatically
 *   - HOME=/data: sets in wrapper script
 *   - File ownership: chowns to 1000:1000 after install
 *
 * So we only need to do minimal cleanup:
 *   - Fix JSON escape sequences (\/ → /) from Pterodactyl export format
 *   - Preserve the original shebang (agent reads it for interpreter selection)
 *   - Do NOT convert /mnt/server paths (agent symlink handles it)
 *   - Do NOT convert [[ ]] to [ ] (agent picks correct interpreter per image)
 *   - Do NOT add pre-flight packages (agent + images already have them)
 *   - Do NOT add set -e (agent wrapper already includes it)
 */
export function convertInstallScript(script: string): string {
	// Clean up JSON escape sequences from Pterodactyl export format
	// (Pterodactyl JSON-escapes forward slashes as \/)
	let cleaned = script.replace(/\\\//g, "/");

	return cleaned;
}

// ============================================================================
// Stop Command Parsing
// ============================================================================

/** Parse Pterodactyl stop command and determine stop method. */
export function parseStopCommand(
	stopValue: string | undefined,
): { stopCommand: string; sendSignalTo: "SIGTERM" | "SIGINT" | "SIGKILL" } {
	if (!stopValue) {
		return { stopCommand: "stop", sendSignalTo: "SIGTERM" };
	}

	// Handle signal-based stop commands
	if (STOP_SIGNAL_MAP[stopValue]) {
		return {
			stopCommand: "", // No command needed when using signal
			sendSignalTo: STOP_SIGNAL_MAP[stopValue],
		};
	}

	// Strip leading slash from command (Pterodactyl convention)
	const cleanCommand = stopValue.replace(/^\//, "");

	return {
		stopCommand: cleanCommand,
		sendSignalTo: "SIGTERM",
	};
}

// ============================================================================
// Config Parsing Helpers
// ============================================================================

/** Try to parse a value that may be a JSON string or already an object. */
function tryParseJson<T>(value: T | string | undefined): T | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "object") return value as T;
	if (typeof value === "string") {
		try {
			return JSON.parse(value) as T;
		} catch {
			return undefined;
		}
	}
	return undefined;
}

// ============================================================================
// Main Import Function
// ============================================================================

/** Convert a Pterodactyl/Pelican egg to Catalyst-compatible template data. */
export function importPterodactylEgg(
	egg: PteroEgg,
	options?: { nestId?: string | null; rawImport?: boolean },
): ImportedEggResult {
	// ── Images ────────────────────────────────────────────────────────
	let mappedImages: MappedImage[] = [];
	if (Array.isArray(egg.images)) {
		// Pelican array format
		mappedImages = egg.images.map((img, i) => ({
			name: `image-${i}`,
			image: img,
		}));
	} else if (egg.docker_images && typeof egg.docker_images === "object") {
		mappedImages = Object.entries(egg.docker_images).map(
			([name, image]) => ({
				name,
				label: name,
				image: image as string,
			}),
		);
	}

	const primaryImage = mappedImages[0]?.image || "";

	// ── Variables ──────────────────────────────────────────────────────
	const rawVars: PteroEggVariable[] = Array.isArray(egg.variables)
		? egg.variables
		: [];
	let mappedVariables = rawVars.map(mapVariable);

	// ── Startup Command ───────────────────────────────────────────────
	// Convert $VAR / ${VAR} → {{VAR}} for Catalyst native syntax
	const startup = egg.startup
		? convertStartupCommand(egg.startup)
		: "";

	// ── Install Script ─────────────────────────────────────────────────
	const rawInstallScript = egg.scripts?.installation?.script;
	const installScript = rawInstallScript
		? convertInstallScript(rawInstallScript)
		: null;
	const installImage = egg.scripts?.installation?.container || null;
	const installEntrypoint =
		egg.scripts?.installation?.entrypoint || "bash";

	// ── Add builtin variables if referenced ────────────────────────────
	mappedVariables = addBuiltinVariables(
		mappedVariables,
		startup,
		installScript,
	);

	// ── Stop Command ───────────────────────────────────────────────────
	// Parse stop from config — may be JSON string or direct value
	const rawStop = (() => {
		if (egg.config?.stop) {
			return tryParseJson(egg.config.stop) || egg.config.stop;
		}
		return undefined;
	})();
	const { stopCommand, sendSignalTo } = parseStopCommand(
		typeof rawStop === "string" ? rawStop : undefined,
	);

	// ── Features ───────────────────────────────────────────────────────
	const features: Record<string, unknown> = {
		restartOnExit: true,
	};

	// Pterodactyl features array (e.g., ["steam_disk_space"])
	if (Array.isArray(egg.features) && egg.features.length > 0) {
		features.pterodactylFeatures = egg.features;
	}

	// Startup detection pattern
	const startupConfig = tryParseJson(egg.config?.startup);
	if (startupConfig && typeof startupConfig === "object") {
		features.startupDetection = startupConfig;
		if ("done" in (startupConfig as Record<string, unknown>)) {
			features.startupDonePattern = (startupConfig as Record<string, unknown>).done;
		}
	}

	// Log detection
	const logsConfig = tryParseJson(egg.config?.logs);
	if (logsConfig && typeof logsConfig === "object") {
		features.logDetection = logsConfig;
	}

	// Config files
	const configFiles = tryParseJson(egg.config?.files);
	if (configFiles && typeof configFiles === "object" && configFiles !== null) {
		const keys = Object.keys(configFiles);
		if (keys.length > 0) {
			features.pterodactylConfigFiles = configFiles;
			features.configFile = keys[0];
			features.configFiles = keys;
		}
	}

	// File denylist (security)
	const fileDenylist = [
		...(Array.isArray(egg.file_denylist) ? egg.file_denylist : []),
		...(Array.isArray(egg.config?.file_denylist)
			? (egg.config?.file_denylist as string[])
			: []),
	];
	if (fileDenylist.length > 0) {
		features.fileDenylist = fileDenylist;
	}

	// Pelican-specific fields
	if (egg.tags && Array.isArray(egg.tags) && egg.tags.length > 0) {
		features.tags = egg.tags;
	}
	const updateUrl = egg.update_url || egg.meta?.update_url;
	if (updateUrl) {
		features.updateUrl = updateUrl;
	}
	if (egg.export_files && egg.export_files.length > 0) {
		features.exportFiles = egg.export_files;
	}

	// Store PTDL spec version separately from template version
	if (egg.meta?.version) {
		features.pterodactylSpecVersion = egg.meta.version;
	}
	if (egg.exported_at) {
		features.exportedAt = egg.exported_at;
	}

	// ── Default Resource Values ────────────────────────────────────────
	// Extract port from variables if possible
	const portVar = mappedVariables.find(
		(v) =>
			v.name === "SERVER_PORT" ||
			v.name === "PORT" ||
			v.name === "GAME_PORT" ||
			v.name === "QUERY_PORT",
	);
	const defaultPort = portVar ? Number(portVar.default) || 25565 : 25565;

	// Extract memory from variables if possible
	const memoryVar = mappedVariables.find(
		(v) =>
			v.name === "SERVER_MEMORY" ||
			v.name === "MEMORY" ||
			v.name === "MAX_MEMORY",
	);
	const defaultMemory = memoryVar
		? Number(memoryVar.default) || 1024
		: 1024;

	return {
		name: (egg.name || "").trim(),
		description: egg.description || null,
		author: egg.author || "Pterodactyl Import",
		version: "1.0.0",
		image: primaryImage,
		images: mappedImages,
		defaultImage: primaryImage || null,
		installImage,
		installEntrypoint,
		startup,
		stopCommand,
		sendSignalTo,
		variables: mappedVariables,
		installScript,
		supportedPorts: [defaultPort],
		allocatedMemoryMb: defaultMemory,
		allocatedCpuCores: 2,
		features,
		nestId: options?.nestId || null,
		srvProtocol: "tcp",
	};
}
