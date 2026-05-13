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
// Error Types
// ============================================================================

/** Structured import error with machine-readable code and field path. */
export interface ImportError {
	/** Machine-readable error code for programmatic handling. */
	code: string;
	/** Human-readable description of what went wrong and how to fix it. */
	message: string;
	/** Dot-path into the egg JSON where the error occurred (e.g. "config.stop", "variables[2].env_variable"). */
	field: string;
	/** "error" blocks import; "warning" allows import but signals a potential issue. */
	severity: "error" | "warning";
}

/** Result from the safe import function — empty errors array means success. */
export interface ImportSafeResult {
	/** The converted result, present only when no error-severity errors occurred. */
	result?: ImportedEggResult;
	/** All validation issues found (warnings + errors). Empty means clean import. */
	errors: ImportError[];
}

/** Batch import result — never aborts on single egg failure. */
export interface BatchImportResult {
	/** Successfully imported eggs. */
	imported: ImportedEggResult[];
	/** Eggs that failed to import, with per-egg error details. */
	failed: Array<{ egg: string; errors: ImportError[] }>;
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
	const cleaned = script.replace(/\\\//g, "/");

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

// ============================================================================
// Validation Helpers for importPterodactylEggSafe()
// ============================================================================

/** Known Pterodactyl/Pelican meta version strings. */
const VALID_META_VERSIONS = new Set(["PTDL_v1", "PTDL_v2", "PTDL_v3"]);

/** Maximum install script size (1 MiB — prevents memory/CPU abuse). */
const MAX_INSTALL_SCRIPT_BYTES = 1024 * 1024;

/** Maximum variable default value size (64 KiB). */
const MAX_VARIABLE_VALUE_BYTES = 64 * 1024;

/** Maximum number of variables per egg. */
const MAX_VARIABLES = 256;

/** Well-known Docker registry domain patterns. */
const DOCKER_IMAGE_REF_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*(:[a-zA-Z0-9._-]+)?(@sha256:[a-fA-F0-9]{64})?$/;

/**
 * Detect circular variable references in startup commands.
 *
 * A circular reference occurs when variable A's default value references
 * variable B, and B's default references A (or longer cycles), causing
 * infinite expansion at runtime.
 *
 * @returns Array of cycles found, each cycle being an ordered list of variable names.
 */
function detectCircularRefs(
	variables: PteroEggVariable[],
): Array<string[]> {
	const varMap = new Map<string, string>(); // env_variable → default_value
	for (const v of variables) {
		if (v.env_variable && v.default_value && typeof v.default_value === 'string') {
			varMap.set(v.env_variable, v.default_value);
		}
	}

	const cycles: Array<string[]> = [];
	const visited = new Set<string>();
	const inStack = new Set<string>();
	const path: string[] = [];

	function dfs(name: string) {
		if (inStack.has(name)) {
			// Found a cycle — extract it from the path
			const cycleStart = path.indexOf(name);
			if (cycleStart >= 0) {
				cycles.push([...path.slice(cycleStart), name]);
			}
			return;
		}
		if (visited.has(name)) return;

		visited.add(name);
		inStack.add(name);
		path.push(name);

		const defaultValue = varMap.get(name);
		if (defaultValue && typeof defaultValue === 'string') {
			// Find all {{VAR}} references in the default value
			const refs = [...defaultValue.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)]
				.map((m) => m[1]);
			for (const ref of refs) {
				if (varMap.has(ref)) {
					dfs(ref);
				}
			}
		}

		path.pop();
		inStack.delete(name);
	}

	for (const name of varMap.keys()) {
		dfs(name);
	}

	return cycles;
}

/**
 * Validate a Pterodactyl/Pelican egg and return structured errors.
 *
 * This does NOT modify the egg — it only inspects it and collects
 * all issues found. Each error includes a code, message, field path,
 * and severity so callers can decide what to do.
 *
 * Warnings do not block import; errors do.
 */
function validateEgg(egg: PteroEgg): ImportError[] {
	const errors: ImportError[] = [];

	// ── Required fields ────────────────────────────────────────────────
	if (!egg.name || typeof egg.name !== "string" || !egg.name.trim()) {
		errors.push({
			code: "MISSING_NAME",
			message: "Egg must have a non-empty 'name' field. Add a descriptive name for this egg.",
			field: "name",
			severity: "error",
		});
	}

	if (!egg.startup || typeof egg.startup !== "string" || !egg.startup.trim()) {
		errors.push({
			code: "MISSING_STARTUP",
			message: "Egg must have a non-empty 'startup' command. This is the command executed when the server starts.",
			field: "startup",
			severity: "error",
		});
	}

	// ── Docker images ──────────────────────────────────────────────────
	const hasImages = (Array.isArray(egg.images) && egg.images.length > 0)
		|| (egg.docker_images && typeof egg.docker_images === "object" && Object.keys(egg.docker_images).length > 0);
	if (!hasImages) {
		errors.push({
			code: "MISSING_IMAGES",
			message: "Egg must define at least one Docker image in 'docker_images' or 'images'. The server cannot start without a container image.",
			field: "docker_images",
			severity: "error",
		});
	} else {
		// Validate individual image refs
		if (Array.isArray(egg.images)) {
			egg.images.forEach((img, i) => {
				if (typeof img !== "string" || !img.trim()) {
					errors.push({
						code: "INVALID_IMAGE_REF",
						message: `Image at index ${i} is empty or not a string. Provide a valid Docker image reference like 'ghcr.io/owner/image:tag'.`,
						field: `images[${i}]`,
						severity: "error",
					});
				} else if (!DOCKER_IMAGE_REF_RE.test(img.trim())) {
					errors.push({
						code: "INVALID_IMAGE_FORMAT",
						message: `Image '${img.slice(0, 60)}' does not match a valid Docker image reference format. Expected [registry/]namespace/name[:tag][@sha256:digest].`,
						field: `images[${i}]`,
						severity: "warning",
					});
				}
			});
		}
		if (egg.docker_images && typeof egg.docker_images === "object") {
			for (const [key, val] of Object.entries(egg.docker_images)) {
				if (typeof val !== "string" || !val.trim()) {
					errors.push({
						code: "INVALID_IMAGE_REF",
						message: `Docker image '${key}' has an empty or invalid value. Provide a valid Docker image reference.`,
						field: `docker_images.${key}`,
						severity: "error",
					});
				} else if (!DOCKER_IMAGE_REF_RE.test((val as string).trim())) {
					errors.push({
						code: "INVALID_IMAGE_FORMAT",
						message: `Docker image '${key}' value '${(val as string).slice(0, 60)}' may not be a valid Docker reference. Expected [registry/]namespace/name[:tag][@sha256:digest].`,
						field: `docker_images.${key}`,
						severity: "warning",
					});
				}
			}
		}
	}

	// ── Meta version ───────────────────────────────────────────────────
	if (egg.meta?.version && !VALID_META_VERSIONS.has(egg.meta.version)) {
		errors.push({
			code: "UNKNOWN_META_VERSION",
			message: `Meta version '${egg.meta.version}' is not a recognized Pterodactyl spec version. Known versions: ${[...VALID_META_VERSIONS].join(', ')}. Import will proceed but compatibility is not guaranteed.`,
			field: "meta.version",
			severity: "warning",
		});
	}

	// ── Install script ────────────────────────────────────────────────
	const installScript = egg.scripts?.installation?.script;
	if (installScript && typeof installScript === "string") {
		if (installScript.length > MAX_INSTALL_SCRIPT_BYTES) {
			errors.push({
				code: "INSTALL_SCRIPT_TOO_LARGE",
				message: `Install script is ${Math.round(installScript.length / 1024)} KiB, exceeding the ${MAX_INSTALL_SCRIPT_BYTES / 1024} KiB limit. Split the script into smaller parts or remove unnecessary content.`,
				field: "scripts.installation.script",
				severity: "error",
			});
		}
	} else if (installScript !== undefined && typeof installScript !== "string") {
		errors.push({
			code: "INVALID_INSTALL_SCRIPT",
			message: "Install script must be a string. Got a non-string value that cannot be executed as a shell script.",
			field: "scripts.installation.script",
			severity: "error",
		});
	}

	// ── Variables ──────────────────────────────────────────────────────
	const rawVars: PteroEggVariable[] = Array.isArray(egg.variables) ? egg.variables : [];

	if (rawVars.length > MAX_VARIABLES) {
		errors.push({
			code: "TOO_MANY_VARIABLES",
			message: `Egg defines ${rawVars.length} variables, exceeding the ${MAX_VARIABLES} variable limit. Remove unused variables to reduce complexity.`,
			field: "variables",
			severity: "error",
		});
	}

	const seenVarNames = new Set<string>();
	for (let i = 0; i < rawVars.length; i++) {
		const v = rawVars[i];

		// Missing env_variable name
		if (!v.env_variable || typeof v.env_variable !== "string" || !v.env_variable.trim()) {
			errors.push({
				code: "MISSING_VAR_NAME",
				message: `Variable at index ${i} is missing an 'env_variable' name. Every variable must have a unique environment variable name like 'SERVER_MEMORY'.`,
				field: `variables[${i}].env_variable`,
				severity: "error",
			});
			continue;
		}

		// Duplicate variable names
		if (seenVarNames.has(v.env_variable)) {
			errors.push({
				code: "DUPLICATE_VARIABLE",
				message: `Variable '${v.env_variable}' is defined more than once. Each env_variable name must be unique within an egg.`,
				field: `variables[${i}].env_variable`,
				severity: "error",
			});
		}
		seenVarNames.add(v.env_variable);

		// Variable name collision with built-in PTDL vars
		const builtinNames = new Set(PTDL_BUILTIN_VARIABLES.map((b) => b.name));
		if (builtinNames.has(v.env_variable)) {
			errors.push({
				code: "VARIABLE_COLLIDES_WITH_BUILTIN",
				message: `Variable '${v.env_variable}' collides with a built-in Pterodactyl system variable. Built-in variables (${[...builtinNames].join(', ')}) are auto-injected when referenced. Rename this variable or remove the duplicate definition.`,
				field: `variables[${i}].env_variable`,
				severity: "warning",
			});
		}

		// Overly long default value
		if (v.default_value && typeof v.default_value === "string" && v.default_value.length > MAX_VARIABLE_VALUE_BYTES) {
			errors.push({
				code: "VARIABLE_VALUE_TOO_LARGE",
				message: `Default value for '${v.env_variable}' is ${Math.round(v.default_value.length / 1024)} KiB, exceeding the ${MAX_VARIABLE_VALUE_BYTES / 1024} KiB limit. Use a shorter default or reference an external config file.`,
				field: `variables[${i}].default_value`,
				severity: "error",
			});
		}

		// Invalid default_value type
		if (v.default_value !== undefined && typeof v.default_value !== "string") {
			errors.push({
				code: "INVALID_VAR_DEFAULT",
				message: `Variable '${v.env_variable}' has a non-string default_value. Pterodactyl variables must have string defaults.`,
				field: `variables[${i}].default_value`,
				severity: "error",
			});
		}
	}

	// ── Circular variable references ───────────────────────────────────
	const cycles = detectCircularRefs(rawVars);
	for (const cycle of cycles) {
		errors.push({
			code: "CIRCULAR_VARIABLE_REF",
			message: `Circular variable reference detected: ${cycle.join(' → ')}. Variable defaults reference each other, causing infinite expansion at runtime. Break the cycle by changing one of the default values.`,
			field: `variables`,
			severity: "error",
		});
	}

	// ── Stop command ───────────────────────────────────────────────────
	if (egg.config?.stop !== undefined) {
		const rawStop = tryParseJson(egg.config.stop) || egg.config.stop;
		const stopStr = typeof rawStop === "string" ? rawStop : String(rawStop);
		if (stopStr && !STOP_SIGNAL_MAP[stopStr] && stopStr.length > 128) {
			errors.push({
				code: "STOP_COMMAND_TOO_LONG",
				message: `Stop command is ${stopStr.length} characters, which is unusually long. Consider using a shorter stop command or a signal like '^C'.`,
				field: "config.stop",
				severity: "warning",
			});
		}

		// Non-standard stop signal
		if (typeof rawStop === "string" && rawStop.startsWith("^") && !STOP_SIGNAL_MAP[rawStop]) {
			errors.push({
				code: "UNKNOWN_STOP_SIGNAL",
				message: `Stop signal '${rawStop}' is not in the known signal map. Known signals: ${Object.keys(STOP_SIGNAL_MAP).filter(k => k.startsWith('^')).join(', ')}. The server will fall back to SIGTERM, which may not stop the process cleanly.`,
				field: "config.stop",
				severity: "warning",
			});
		}
	}

	// ── Install container entrypoint ───────────────────────────────────
	const entrypoint = egg.scripts?.installation?.entrypoint;
	if (entrypoint && typeof entrypoint === "string") {
		const validEntrypoints = new Set(["bash", "sh", "/bin/bash", "/bin/sh"]);
		if (!validEntrypoints.has(entrypoint)) {
			errors.push({
				code: "UNUSUAL_ENTRYPOINT",
				message: `Install entrypoint '${entrypoint}' is unusual. Pterodactyl eggs typically use 'bash' or 'sh'. Custom entrypoints may not work with the Catalyst agent runtime.`,
				field: "scripts.installation.entrypoint",
				severity: "warning",
			});
		}
	}

	return errors;
}

// ============================================================================
// Safe Import Function
// ============================================================================

/**
 * Import a Pterodactyl/Pelican egg with structured error reporting.
 *
 * Unlike `importPterodactylEgg()` which throws on bad input, this function
 * validates the egg first and returns a result object with an errors array.
 * If the errors array is empty, the import was fully successful.
 * If any error has severity "error", the result field will be undefined.
 * Warnings are reported but do not block import.
 *
 * @param egg - The Pterodactyl/Pelican egg JSON object.
 * @param options - Optional import options (nestId, rawImport).
 * @returns ImportSafeResult with optional result and errors array.
 */
export function importPterodactylEggSafe(
	egg: PteroEgg,
	options?: { nestId?: string | null; rawImport?: boolean },
): ImportSafeResult {
	// Validate the egg structure before attempting conversion
	const validationErrors = validateEgg(egg);

	// If there are error-severity issues, return early without converting
	const hasErrors = validationErrors.some((e) => e.severity === "error");
	if (hasErrors) {
		return { errors: validationErrors };
	}

	// Attempt conversion — catch any unexpected throws and convert to errors
	try {
		const result = importPterodactylEgg(egg, options);
		return { result, errors: validationErrors };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			errors: [
				...validationErrors,
				{
					code: "CONVERSION_FAILED",
					message: `Unexpected error during egg conversion: ${message}. The egg data may be corrupt or in an unsupported format.`,
					field: "",
					severity: "error",
				},
			],
		};
	}
}

// ============================================================================
// Batch Import Helper
// ============================================================================

/**
 * Import multiple Pterodactyl/Pelican eggs with partial-failure handling.
 *
 * Never aborts on a single egg failure — collects all errors per egg and
 * returns a structure with both successfully imported eggs and failed ones.
 *
 * @param eggs - Array of egg objects to import.
 * @param options - Optional shared import options (nestId, rawImport).
 * @returns BatchImportResult with imported results and per-egg failures.
 */
export function importPterodactylEggsBatch(
	eggs: PteroEgg[],
	options?: { nestId?: string | null; rawImport?: boolean },
): BatchImportResult {
	const imported: ImportedEggResult[] = [];
	const failed: Array<{ egg: string; errors: ImportError[] }> = [];

	for (const egg of eggs) {
		const eggName = (egg.name || "").trim() || "(unnamed egg)";
		const safeResult = importPterodactylEggSafe(egg, options);

		if (safeResult.result) {
			imported.push(safeResult.result);
		} else {
			failed.push({ egg: eggName, errors: safeResult.errors });
		}
	}

	return { imported, failed };
}
