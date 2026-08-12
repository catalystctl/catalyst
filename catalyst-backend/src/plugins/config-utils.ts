/**
 * Plugin config helpers.
 *
 * plugin.json stores field *schemas* (`{ type, default, description }`).
 * Runtime getConfig/setConfig must deal in plain values. These helpers
 * unwrap schema objects and merge DB-persisted values over defaults.
 *
 * Important: legitimate object-shaped *values* (e.g. `{ type: 'incident',
 * description: 'Sev1' }`) must not be mistaken for schema pollution.
 */

/** Field `type` keywords allowed in plugin.json config schemas. */
export const KNOWN_CONFIG_FIELD_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'select',
  'text',
  'password',
  'object',
  'array',
]);

const SCHEMA_META_KEYS = new Set([
  'type',
  'default',
  'description',
  'options',
  'required',
  'enum',
  'min',
  'max',
  'label',
]);

/** True when a value looks like a plugin.json config field schema. */
export function isConfigSchemaField(value: unknown): value is {
  type: string;
  default?: unknown;
  description?: string;
  [key: string]: unknown;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  // `type` must be a known schema keyword — free-form values like
  // `{ type: 'incident', description: 'Sev1' }` are NOT schemas.
  if (typeof v.type !== 'string' || !KNOWN_CONFIG_FIELD_TYPES.has(v.type)) {
    return false;
  }
  const keys = Object.keys(v);
  // Pure `{ type: 'boolean' }` is still a schema field
  if (keys.length === 1 && keys[0] === 'type') return true;
  // Require at least one schema meta key beyond type, OR only schema keys
  const hasMeta = keys.some((k) => k !== 'type' && SCHEMA_META_KEYS.has(k));
  if (!hasMeta) return false;
  // Reject objects that mix schema keys with arbitrary payload keys
  // (e.g. a user object that happens to include type+description+id)
  const onlySchemaKeys = keys.every((k) => SCHEMA_META_KEYS.has(k));
  return onlySchemaKeys;
}

/** Declared field type from a schema entry, if recognizable. */
export function getDeclaredFieldType(schemaVal: unknown): string | undefined {
  if (isConfigSchemaField(schemaVal)) return schemaVal.type;
  return undefined;
}

/**
 * Whether a stored value is leftover schema pollution that should be unwrapped,
 * vs a legitimate runtime value that merely looks object-shaped.
 *
 * Under object/array fields, only pure object/array schemas are pollution —
 * values like `{ type: 'incident', description: 'Sev1' }` are kept.
 */
export function isStoredSchemaPollution(
  storedVal: unknown,
  declaredType?: string,
): boolean {
  if (!isConfigSchemaField(storedVal)) return false;

  // Object/array fields hold free-form objects; only treat as pollution when
  // the stored blob is itself an object/array *schema* left from first install.
  if (declaredType === 'object' || declaredType === 'array') {
    return storedVal.type === 'object' || storedVal.type === 'array';
  }

  // Scalar / select fields: any schema-shaped leftover is pollution
  return true;
}

/** Resolve a single config entry to its runtime value. */
export function resolveConfigValue<T = unknown>(value: unknown): T | undefined {
  if (value === undefined) return undefined;
  if (isConfigSchemaField(value)) {
    return value.default as T;
  }
  return value as T;
}

/**
 * Build the runtime config map (plain values only) from:
 * - schemaConfig: original plugin.json `config` (field schemas)
 * - storedConfig: values persisted in the Plugin row (may be mixed)
 */
export function buildRuntimeConfig(
  schemaConfig: Record<string, unknown> | undefined,
  storedConfig: Record<string, unknown> | undefined | null,
): Record<string, unknown> {
  const runtime: Record<string, unknown> = {};
  const schema = schemaConfig || {};
  const stored = storedConfig || {};

  for (const [key, schemaVal] of Object.entries(schema)) {
    const storedVal = stored[key];
    const declaredType = getDeclaredFieldType(schemaVal);

    if (storedVal !== undefined) {
      if (isStoredSchemaPollution(storedVal, declaredType)) {
        // Prefer unwrapping the stored leftover schema, else schema default
        const fromStored = resolveConfigValue(storedVal);
        runtime[key] =
          fromStored !== undefined ? fromStored : resolveConfigValue(schemaVal);
      } else {
        // Legitimate stored value (incl. object-shaped settings)
        runtime[key] = storedVal;
      }
    } else {
      runtime[key] = resolveConfigValue(schemaVal);
    }
  }

  // Preserve extra keys written by setConfig that are not in the schema
  for (const [key, storedVal] of Object.entries(stored)) {
    if (key in runtime) continue;
    // No declared type — only unwrap if it's pure known-type schema pollution
    if (isStoredSchemaPollution(storedVal, undefined)) {
      runtime[key] = resolveConfigValue(storedVal);
    } else {
      runtime[key] = storedVal;
    }
  }

  return runtime;
}
