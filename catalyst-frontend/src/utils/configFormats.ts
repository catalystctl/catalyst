export type ConfigPrimitive = string | number | boolean | null;
export type ConfigPrimitive = string | number | boolean | null;
export interface ConfigMap {
  [key: string]: ConfigPrimitive | ConfigMap;
}
export type ConfigNode = ConfigPrimitive | ConfigMap;

const trimQuotes = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
};

const parsePrimitive = (value: string): ConfigPrimitive => {
  const trimmed = trimQuotes(value);
  if (trimmed === 'null') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  return trimmed;
};

export const parseProperties = (content: string): ConfigMap => {
  const lines = content.split(/\r?\n/);
  const output: ConfigMap = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    const match = line.match(/^([^=:#]+)\s*[:=]\s*(.*)$/);
    if (!match) {
      continue;
    }
    const key = match[1].trim();
    const value = match[2].trim();
    output[key] = parsePrimitive(value);
  }
  return output;
};

const serializePropertiesValue = (value: ConfigNode) => {
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
};

export const serializeProperties = (record: ConfigMap) =>
  Object.entries(record)
    .map(([key, value]) => `${key}=${serializePropertiesValue(value)}`)
    .join('\n');

const parseYamlValue = (raw: string): ConfigPrimitive => {
  const trimmed = trimQuotes(raw);
  if (trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed && !Number.isNaN(Number(trimmed))) {
    return Number(trimmed);
  }
  return trimmed;
};

export const parseYaml = (content: string): ConfigMap => {
  const lines = content.split(/\r?\n/);
  const output: ConfigMap = {};
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!value) {
      output[key] = '';
      continue;
    }
    output[key] = parseYamlValue(value);
  }
  return output;
};

const serializeYamlValue = (value: ConfigNode) => {
  if (value && typeof value === 'object') return JSON.stringify(value);
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
};

export const serializeYaml = (record: ConfigMap) =>
  Object.entries(record)
    .map(([key, value]) => `${key}: ${serializeYamlValue(value)}`)
    .join('\n');

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeJsonNode = (value: unknown): ConfigNode => {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (isPlainObject(value)) {
    const output: ConfigMap = {};
    Object.entries(value).forEach(([key, child]) => {
      output[key] = normalizeJsonNode(child);
    });
    return output;
  }
  return String(value);
};

export const parseJson = (content: string): ConfigMap => {
  const parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON config must be an object');
  }
  return normalizeJsonNode(parsed) as ConfigMap;
};

const toJsonNode = (value: ConfigNode): unknown => {
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    Object.entries(value).forEach(([key, child]) => {
      output[key] = toJsonNode(child);
    });
    return output;
  }
  return value;
};

export const serializeJson = (record: ConfigMap) =>
  JSON.stringify(toJsonNode(record), null, 2);

export type ConfigFormat = 'json' | 'yaml' | 'properties';

export const detectConfigFormat = (path: string): ConfigFormat | null => {
  const extension = path.split('.').pop()?.toLowerCase();
  if (!extension) return null;
  if (extension === 'json') return 'json';
  if (extension === 'yml' || extension === 'yaml') return 'yaml';
  if (extension === 'properties') return 'properties';
  return null;
};

export const parseConfig = (format: ConfigFormat, content: string): ConfigMap => {
  switch (format) {
    case 'json':
      return parseJson(content);
    case 'yaml':
      return parseYaml(content);
    case 'properties':
      return parseProperties(content);
    default:
      return {};
  }
};

export const serializeConfig = (format: ConfigFormat, record: ConfigMap) => {
  switch (format) {
    case 'json':
      return serializeJson(record);
    case 'yaml':
      return serializeYaml(record);
    case 'properties':
      return serializeProperties(record);
    default:
      return '';
  }
};
