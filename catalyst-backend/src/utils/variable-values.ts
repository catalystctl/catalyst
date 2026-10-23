/**
 * Boolean ("checkbox") variable values.
 *
 * Pterodactyl eggs and the ptero-eggs yolk entrypoints compare boolean
 * variables against `1`/`0` (`[ "${AUTO_UPDATE}" == "1" ]`), while
 * panel-authored templates historically used `true`/`false`. Storing the wrong
 * format silently changes behaviour after the first save — a Valheim server
 * stops advertising itself and the SteamCMD auto-update is skipped (issue #313).
 *
 * A template variable can pin the pair with `trueValue`/`falseValue`. Without
 * that, the format is derived from the value the server already holds (or the
 * template default), so eggs imported before this existed — whose defaults are
 * `1`/`0` — keep working without a data migration.
 */

export interface CheckboxVariableDefinition {
  name?: string;
  default?: string | null;
  trueValue?: string | null;
  falseValue?: string | null;
}

export interface CheckboxTokens {
  true: string;
  false: string;
}

const TRUTHY = new Set(["true", "1", "on", "yes"]);
const FALSY = new Set(["false", "0", "off", "no", ""]);

/** Values that select the numeric (`1`/`0`) format. */
const NUMERIC = new Set(["1", "0"]);

export function isTruthyVariableValue(value: unknown): boolean {
  return TRUTHY.has(String(value ?? "").trim().toLowerCase());
}

/** True when the submitted value is one we know how to interpret. */
export function isKnownVariableValue(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return TRUTHY.has(normalized) || FALSY.has(normalized);
}

/**
 * The pair of values a checkbox writes. Explicit template values win; then a
 * known `1`/`0` spelling on the stored value or the template default keeps the
 * egg's format; otherwise the panel's `true`/`false`.
 */
export function checkboxTokens(
  definition: CheckboxVariableDefinition,
  currentValue?: unknown,
): CheckboxTokens {
  const explicitTrue = definition.trueValue;
  const explicitFalse = definition.falseValue;
  if (explicitTrue !== undefined && explicitTrue !== null && explicitFalse !== undefined && explicitFalse !== null) {
    return { true: String(explicitTrue), false: String(explicitFalse) };
  }
  const stored = String(currentValue ?? "").trim().toLowerCase();
  const fallback = String(definition.default ?? "").trim().toLowerCase();
  if (NUMERIC.has(stored) || NUMERIC.has(fallback)) {
    return { true: "1", false: "0" };
  }
  return { true: "true", false: "false" };
}

/** True when a stored/submitted value means "on" under the given tokens. */
export function isCheckedValue(value: unknown, tokens: CheckboxTokens): boolean {
  const normalized = String(value ?? "").trim();
  if (normalized === tokens.true) return true;
  return isTruthyVariableValue(normalized);
}

/** Normalize a submitted checkbox value into the variable's token pair. */
export function normalizeCheckboxValue(
  submitted: unknown,
  tokens: CheckboxTokens,
): string {
  return isTruthyVariableValue(submitted) ? tokens.true : tokens.false;
}
