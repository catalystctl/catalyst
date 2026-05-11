/**
 * Converts a Pterodactyl/Pelican egg to the Catalyst template format.
 * Detects PTDL format automatically via meta.version or known fields.
 * Supports both JSON (Pterodactyl) and YAML (Pelican) formats.
 */

import * as yaml from 'js-yaml';

interface PtdlVariable {
  name: string;
  description?: string;
  env_variable: string;
  default_value: string;
  user_viewable?: boolean;
  user_editable?: boolean;
  rules?: string;
  field_type?: string;
  sortable?: boolean; // Pelican-specific
}

interface PtdlConfigFile {
  parser?: string;
  file?: string;
  replace?: Array<{
    match?: string;
    replace?: string;
    if_value?: string;
  }>;
  find?: Record<string, string>;
}

interface PtdlStartupConfig {
  done?: string;
}

interface PtdlEgg {
  meta?: { version?: string; update_url?: string }; // update_url is Pelican-specific
  name?: string;
  author?: string;
  description?: string;
  docker_images?: Record<string, string>;
  startup?: string;
  config?: {
    stop?: string;
    startup?: PtdlStartupConfig | string;
    files?: Record<string, PtdlConfigFile> | string; // Can be object or JSON string
    logs?: string;
    file?: string;
  };
  scripts?: {
    installation?: {
      script?: string;
      container?: string;
      entrypoint?: string;
    };
  };
  variables?: PtdlVariable[];
  features?: string[];
  tags?: string[]; // Pelican-specific
  // Pelican-specific fields that may be at root level
  update_url?: string;
  export_files?: string[]; // Files to export from container
}

/** Signal type mapping for stop commands */
type SignalType = 'SIGTERM' | 'SIGINT' | 'SIGKILL';

/** Result of parsing stop command */
interface StopCommandResult {
  stopCommand: string;
  sendSignalTo: SignalType;
}

/** Built-in Pterodactyl variables that need to be mapped */
const PTDL_BUILTIN_VARIABLES = [
  { name: 'SERVER_MEMORY', description: 'Allocated memory in MB', default: '1024' },
  { name: 'SERVER_PORT', description: 'Primary server port', default: '25565' },
  { name: 'SERVER_IP', description: 'Server IP address (0.0.0.0 for all interfaces)', default: '0.0.0.0' },
  { name: 'TZ', description: 'Server timezone', default: 'UTC' },
];

/** Returns true if the JSON object looks like a Pterodactyl or Pelican egg. */
export function isPterodactylEgg(data: unknown): data is PtdlEgg {
  if (!data || typeof data !== 'object') return false;
  const obj = data as Record<string, unknown>;

  // Check for PTDL meta version tag (Pterodactyl)
  if (
    obj.meta &&
    typeof obj.meta === 'object' &&
    'version' in obj.meta &&
    typeof (obj.meta as Record<string, unknown>).version === 'string' &&
    ((obj.meta as Record<string, unknown>).version as string).startsWith('PTDL')
  ) {
    return true;
  }

  // Check for Pelican format (may have different meta structure or no meta at all)
  // Pelican eggs often have: docker_images, startup, variables, tags, update_url
  if (
    obj.meta &&
    typeof obj.meta === 'object' &&
    'version' in obj.meta &&
    typeof (obj.meta as Record<string, unknown>).version === 'string'
  ) {
    // Could be Pelican - check for other egg fields
    if (obj.docker_images || obj.startup || obj.variables || obj.tags) {
      return true;
    }
  }

  // Pelican-specific: check for update_url field
  if (obj.update_url && typeof obj.update_url === 'string') {
    return true;
  }

  // Pelican-specific: check for tags array
  if (Array.isArray(obj.tags) && (obj.docker_images || obj.startup || obj.variables)) {
    return true;
  }

  // Fallback: presence of docker_images + variables with env_variable fields
  if (obj.docker_images && typeof obj.docker_images === 'object' && Array.isArray(obj.variables)) {
    const vars = obj.variables as Record<string, unknown>[];
    return vars.length > 0 && vars.some((v) => 'env_variable' in v || ('name' in v && 'default_value' in v));
  }

  // Also check for Pelican-style with just variables (may have name as env variable)
  if (Array.isArray(obj.variables)) {
    const vars = obj.variables as Record<string, unknown>[];
    // Pelican variables have name, description, env_variable, default_value, rules
    if (vars.length > 0 && vars.some((v) =>
      ('env_variable' in v) ||
      ('name' in v && 'default_value' in v) ||
      ('name' in v && 'default' in v)
    )) {
      // Make sure we also have docker_images or startup to confirm it's an egg
      if (obj.docker_images || obj.startup || obj.config || obj.scripts) {
        return true;
      }
    }
  }

  return false;
}

/** Check if a string is valid YAML and parse it. */
export function parseYamlEgg(content: string): unknown {
  try {
    const parsed = yaml.load(content);
    return parsed;
  } catch {
    return null;
  }
}

/** Check if content looks like YAML (vs JSON). */
export function isYamlContent(content: string): boolean {
  const trimmed = content.trim();

  // If it starts with { or [, it's likely JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false;
  }

  // Check for YAML-specific patterns (key: value)
  if (/^[\w-]+:\s/m.test(trimmed)) {
    return true;
  }

  // Check for YAML document start
  if (trimmed.startsWith('---')) {
    return true;
  }

  // Check for common Pelican egg fields
  if (/^(name|meta|docker_images|startup|variables|scripts|config|tags):/m.test(trimmed)) {
    return true;
  }

  return false;
}

/** Infer Catalyst input type from Pterodactyl rules string. */
function inferInputType(rules: string): 'text' | 'number' | 'select' | 'checkbox' {
  if (rules.includes('boolean')) return 'checkbox';
  if (rules.includes('integer') || rules.includes('numeric')) return 'number';
  if (rules.includes('in:')) return 'select';
  return 'text';
}

/** Convert Pterodactyl rules string to Catalyst rules array. */
function convertRules(rules: string): string[] {
  if (!rules) return [];
  const catalystRules: string[] = [];
  const parts = rules.split('|').map((r) => r.trim());

  for (const part of parts) {
    // Skip rules handled by other fields
    if (
      part === 'required' ||
      part === 'nullable' ||
      part === 'string' ||
      part === 'boolean' ||
      part === 'integer' ||
      part === 'numeric'
    ) {
      continue;
    }

    // Keep validation rules
    if (
      part.startsWith('in:') ||
      part.startsWith('between:') ||
      part.startsWith('max:') ||
      part.startsWith('min:') ||
      part.startsWith('regex:') ||
      part.startsWith('alpha') ||
      part.startsWith('alpha_num') ||
      part.startsWith('url')
    ) {
      catalystRules.push(part);
    }
  }

  return catalystRules;
}

/** Convert Pterodactyl startup command variables from $VAR / ${VAR} to {{VAR}} syntax. */
function convertStartupCommand(startup: string): string {
  // Replace ${VAR_NAME} and $VAR_NAME patterns with {{VAR_NAME}}
  // First handle ${VAR} syntax (including nested ${} like ${SERVER_MEMORY})
  let result = startup.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, '{{$1}}');
  // Then handle $VAR syntax (only uppercase env var names to avoid false matches)
  result = result.replace(/\$([A-Z_][A-Z0-9_]*)(?![A-Z0-9_])/g, '{{$1}}');
  return result;
}

/**
 * Convert Pterodactyl install script for Catalyst compatibility.
 *
 * The Catalyst agent already handles at runtime:
 *   - /mnt/server compatibility: creates symlink /mnt/server → /data
 *   - {{SERVER_DIR}} substitution: replaces with /data
 *   - Shell interpreter detection: picks bash/sh based on image + shebang
 *   - Carriage return stripping: removes \\r before execution
 *   - set -e: adds to wrapper script automatically
 *   - HOME=/data: sets in wrapper script
 *   - File ownership: chowns to 1000:1000 after install
 *
 * So we only need minimal cleanup:
 *   - Fix JSON escape sequences (\\/ → /) from Pterodactyl export format
 *   - Preserve original shebang (agent reads it for interpreter selection)
 *   - Do NOT convert /mnt/server paths (agent symlink handles it)
 *   - Do NOT convert [[ ]] to [ ] (agent picks correct interpreter per image)
 *   - Do NOT add pre-flight packages (agent + images already have them)
 *   - Do NOT add set -e (agent wrapper already includes it)
 */
function convertInstallScript(script: string): string {
  // Clean up JSON escape sequences from Pterodactyl export format
  // (Pterodactyl JSON-escapes forward slashes as \/)
  let cleaned = script.replace(/\\\//g, '/');

  return cleaned;
}

/**
 * Parse the stop command and determine the appropriate stop method.
 * Pterodactyl uses special syntax like ^C for signals.
 */
function parseStopCommand(stopValue: string | undefined): StopCommandResult {
  if (!stopValue) {
    return { stopCommand: 'stop', sendSignalTo: 'SIGTERM' };
  }

  // Handle signal-based stop commands
  // Full signal map matching Pterodactyl spec (including ^C variants and ^X)
  const signalMap: Record<string, SignalType> = {
    '^C': 'SIGINT',
    '^c': 'SIGINT',
    '^^C': 'SIGINT',  // Double-caret variant
    '^SIGKILL': 'SIGKILL',
    '^X': 'SIGKILL',
    'SIGINT': 'SIGINT',
    'SIGTERM': 'SIGTERM',
    'SIGKILL': 'SIGKILL',
  };

  // Check if it's a signal
  if (signalMap[stopValue]) {
    return {
      stopCommand: '', // No command needed when using signal
      sendSignalTo: signalMap[stopValue],
    };
  }

  // Strip leading slash from command (Pterodactyl convention)
  const cleanCommand = stopValue.replace(/^\//, '');

  return {
    stopCommand: cleanCommand,
    sendSignalTo: 'SIGTERM',
  };
}

/**
 * Add built-in Pterodactyl variables if they're used in the startup command or scripts.
 * These variables are automatically provided by Pterodactyl and need to exist in Catalyst.
 */
function addBuiltinVariables(
  variables: Array<{
    name: string;
    description: string;
    default: string;
    required: boolean;
    input: 'text' | 'number' | 'select' | 'checkbox';
    rules?: string[];
  }>,
  startup: string,
  installScript: string | undefined,
): Array<{
  name: string;
  description: string;
  default: string;
  required: boolean;
  input: 'text' | 'number' | 'select' | 'checkbox';
  rules?: string[];
}> {
  const existingVarNames = new Set(variables.map((v) => v.name));
  const combinedContent = `${startup} ${installScript || ''}`;
  const result = [...variables];

  for (const builtin of PTDL_BUILTIN_VARIABLES) {
    // Check if this variable is referenced in startup or install script
    const varPatterns = [
      new RegExp(`\\$\\{${builtin.name}\\}`, 'g'),
      new RegExp(`\\$${builtin.name}(?![A-Z0-9_])`, 'g'),
      new RegExp(`\\{\\{${builtin.name}\\}\\}`, 'g'),
    ];

    const isUsed = varPatterns.some((pattern) => pattern.test(combinedContent));

    if (isUsed && !existingVarNames.has(builtin.name)) {
      result.push({
        name: builtin.name,
        description: builtin.description,
        default: builtin.default,
        required: false,
        input: builtin.name === 'SERVER_PORT' || builtin.name === 'SERVER_MEMORY' ? 'number' : 'text',
      });
      existingVarNames.add(builtin.name);
    }
  }

  return result;
}

/** Convert a Pterodactyl/Pelican egg to a Catalyst-compatible template object. */
export function convertPterodactylEgg(egg: PtdlEgg): Record<string, unknown> {
  // Extract docker images
  const dockerImages = egg.docker_images ?? {};
  const imageEntries = Object.entries(dockerImages);
  const primaryImage = imageEntries.length > 0 ? imageEntries[0][1] : '';

  const images =
    imageEntries.length > 1
      ? imageEntries.map(([label, img]) => ({
          name: label.split('/').pop()?.replace(/:/g, '-') ?? label,
          label,
          image: img,
        }))
      : [];

  // Convert variables - handle both Pterodactyl and Pelican formats
  let variables = (egg.variables ?? []).map((v) => {
    const rules = convertRules(v.rules ?? '');
    const isRequired = (v.rules ?? '').includes('required');

    // Pelican may use env_variable directly, or fall back to name as the env variable
    // In Pelican, 'name' is often the display name and 'env_variable' is the actual env var
    // But some eggs only have 'name' which serves as both
    const envVarName = v.env_variable || v.name || '';
    const displayName = v.description || v.name || envVarName;
    const defaultValue = v.default_value ?? '';

    // Infer input type from field_type + rules for better UX
    const inputType = inferInputType(v.rules ?? '');

    // Parse select options from "in:" rule if this is a select field
    const selectOptions = inputType === 'select'
      ? (v.rules ?? '').match(/\bin:([^|]+)/)?.[1]?.split(',').filter(Boolean)
      : undefined;

    return {
      name: envVarName,
      description: displayName,
      default: defaultValue,
      required: isRequired,
      userViewable: v.user_viewable ?? true,
      userEditable: v.user_editable ?? true,
      input: inputType as 'text' | 'number' | 'select' | 'checkbox' | 'password',
      ...(selectOptions?.length ? { options: selectOptions } : {}),
      ...(rules.length ? { rules } : {}),
    };
  });

  // Convert startup command
  const startup = convertStartupCommand(egg.startup ?? '');

  // Extract and convert install script
  const installScript = egg.scripts?.installation?.script
    ? convertInstallScript(egg.scripts.installation.script)
    : undefined;
  const installImage = egg.scripts?.installation?.container ?? undefined;

  // Add built-in variables if they're used
  variables = addBuiltinVariables(variables, startup, installScript);

  // Parse stop command and determine signal
  const { stopCommand, sendSignalTo } = parseStopCommand(egg.config?.stop);

  // Extract startup detection pattern - can be object or JSON string
  let startupDonePattern: string | undefined;
  if (egg.config?.startup) {
    if (typeof egg.config.startup === 'object') {
      startupDonePattern = egg.config.startup.done;
    } else if (typeof egg.config.startup === 'string') {
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(egg.config.startup);
        if (parsed && typeof parsed === 'object' && 'done' in parsed) {
          startupDonePattern = parsed.done;
        }
      } catch {
        // Not valid JSON, use as-is
        startupDonePattern = egg.config.startup;
      }
    }
  }

  // Extract config files - can be object or JSON string
  let configFiles: Record<string, PtdlConfigFile> | undefined;
  if (egg.config?.files) {
    if (typeof egg.config.files === 'object') {
      configFiles = egg.config.files;
    } else if (typeof egg.config.files === 'string') {
      try {
        const parsed = JSON.parse(egg.config.files);
        if (parsed && typeof parsed === 'object') {
          configFiles = parsed as Record<string, PtdlConfigFile>;
        }
      } catch {
        // Not valid JSON, ignore
      }
    }
  }

  // Build a slug-style ID from the name
  const id = (egg.name ?? 'imported')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  // Try to extract a port from variables or startup command
  const portVar = variables.find(
    (v) =>
      v.name === 'SERVER_PORT' ||
      v.name === 'PORT' ||
      v.name === 'GAME_PORT' ||
      v.name === 'QUERY_PORT',
  );
  const defaultPort = portVar ? Number(portVar.default) || 25565 : 25565;

  // Try to extract memory from variables
  const memoryVar = variables.find(
    (v) => v.name === 'SERVER_MEMORY' || v.name === 'MEMORY' || v.name === 'MAX_MEMORY',
  );
  const defaultMemory = memoryVar ? Number(memoryVar.default) || 1024 : 1024;

  // Build features object
  const features: Record<string, unknown> = {
    restartOnExit: true,
  };

  // Add startup detection pattern — store the full object for runtime use
  if (egg.config?.startup) {
    try {
      const parsed = typeof egg.config.startup === 'string'
        ? JSON.parse(egg.config.startup)
        : egg.config.startup;
      if (parsed && typeof parsed === 'object') {
        features.startupDetection = parsed;
        if (parsed.done) features.startupDonePattern = parsed.done;
      }
    } catch { /* ignore */ }
  }

  // Add log detection if available
  if (egg.config?.logs) {
    try {
      const parsed = typeof egg.config.logs === 'string'
        ? JSON.parse(egg.config.logs)
        : egg.config.logs;
      if (parsed && typeof parsed === 'object') {
        features.logDetection = parsed;
      }
    } catch { /* ignore */ }
  }

  // Preserve Pterodactyl features array (e.g., ["steam_disk_space"])
  if (Array.isArray(egg.features) && egg.features.length > 0) {
    features.pterodactylFeatures = egg.features;
  }

  // Add config files metadata if available — preserve full object AND keys list
  if (configFiles && Object.keys(configFiles).length > 0) {
    features.pterodactylConfigFiles = configFiles;
    // Get the first config file as the primary one
    const configKeys = Object.keys(configFiles);
    if (configKeys.length > 0) {
      features.configFile = configKeys[0];
      features.configFiles = configKeys;  // ALL config file keys for multi-file eggs
    }
  }

  // Preserve file denylist for security enforcement
  const fileDenylist = [
    ...(Array.isArray((egg as any).file_denylist) ? (egg as any).file_denylist : []),
    ...(Array.isArray(egg.config?.file_denylist) ? egg.config!.file_denylist : []),
  ];
  if (fileDenylist.length > 0) {
    features.fileDenylist = fileDenylist;
  }

  // Preserve install entrypoint for runtime
  const installEntrypoint = egg.scripts?.installation?.entrypoint;
  if (installEntrypoint) {
    features.installEntrypoint = installEntrypoint;
  }

  // Preserve PTDL spec version separately from template version
  if (egg.meta?.version) {
    features.pterodactylSpecVersion = egg.meta.version;
  }
  if ((egg as any).exported_at) {
    features.exportedAt = (egg as any).exported_at;
  }

  // Add tags if available (Pelican)
  if (egg.tags && egg.tags.length > 0) {
    features.tags = egg.tags;
  }

  // Add export files if available (Pelican-specific)
  if (egg.export_files && egg.export_files.length > 0) {
    features.exportFiles = egg.export_files;
  }

  // Add update URL if available (Pelican-specific)
  const updateUrl = egg.update_url || egg.meta?.update_url;
  if (updateUrl) {
    features.updateUrl = updateUrl;
  }

  // Detect if this is a Pelican egg based on features
  const isPelican = !!(egg.tags?.length || egg.update_url || egg.meta?.update_url || egg.export_files?.length);

  return {
    id,
    name: egg.name ?? 'Imported Egg',
    description: egg.description ?? '',
    author: egg.author ?? (isPelican ? 'Imported from Pelican' : 'Imported from Pterodactyl'),
    version: '1.0.0',
    image: primaryImage,
    ...(images.length ? { images } : {}),
    defaultImage: primaryImage || undefined,
    installImage,
    installEntrypoint: egg.scripts?.installation?.entrypoint || 'bash',
    startup,
    stopCommand,
    sendSignalTo,
    variables,
    installScript,
    supportedPorts: [defaultPort],
    allocatedMemoryMb: defaultMemory,
    allocatedCpuCores: 2,
    features,
  };
}

/**
 * Parse content that might be JSON or YAML and return as an object.
 * Handles both Pterodactyl JSON eggs and Pelican YAML eggs.
 */
export function parseEggContent(content: string): unknown {
  const trimmed = content.trim();

  // Try JSON first
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(content);
    } catch {
      // Fall through to YAML
    }
  }

  // Try YAML (for Pelican eggs)
  return parseYamlEgg(content);
}

/**
 * Auto-detect format and normalize to Catalyst template format.
 * If the input is a Pterodactyl/Pelican egg, converts it first.
 * Otherwise returns the data as-is (assumed Catalyst format).
 *
 * @param data - Parsed JSON/YAML object or raw string content
 */
export function normalizeTemplateImport(data: unknown): Record<string, unknown> {
  // If data is a string, try to parse it
  if (typeof data === 'string') {
    const parsed = parseEggContent(data);
    if (parsed) {
      return normalizeTemplateImport(parsed);
    }
    // If parsing failed, return as-is (shouldn't happen in normal use)
    return { raw: data } as Record<string, unknown>;
  }

  // Check if it's a Pterodactyl/Pelican egg
  if (isPterodactylEgg(data)) {
    return convertPterodactylEgg(data as PtdlEgg);
  }

  // Return as-is (already Catalyst format or unknown format)
  return data as Record<string, unknown>;
}

/**
 * Validate that a converted template has all required fields.
 * Returns an array of missing or invalid field names.
 */
export function validateConvertedTemplate(template: Record<string, unknown>): string[] {
  const requiredFields = ['id', 'name', 'author', 'version', 'image', 'startup', 'variables'];
  const errors: string[] = [];

  for (const field of requiredFields) {
    if (!(field in template) || template[field] === undefined || template[field] === '') {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // stopCommand can be empty if sendSignalTo is set (signal-based stop)
  if (!template.stopCommand && template.stopCommand !== '' && !template.sendSignalTo) {
    errors.push('Missing required field: stopCommand (or sendSignalTo for signal-based stop)');
  }

  // Validate variables array
  if (Array.isArray(template.variables)) {
    for (let i = 0; i < template.variables.length; i++) {
      const v = template.variables[i] as Record<string, unknown>;
      if (!v.name) {
        errors.push(`Variable at index ${i} missing name`);
      }
      if (v.default === undefined) {
        errors.push(`Variable ${v.name || i} missing default value`);
      }
    }
  }

  return errors;
}
