/**
 * Regression: template-variable rules must follow Laravel semantics, which
 * imported Pterodactyl eggs rely on. `between:min,max` is a string-length
 * check unless the ruleset declares numeric/integer — otherwise Ptero-style
 * version variables (e.g. MC_VERSION "1.21.1" with required|string|between:3,15)
 * fail PATCH /variables with 422 "Invalid numeric value".
 */
import { describe, it, expect } from "vitest";
import { validateVariableRule } from "../routes/servers/_helpers";

describe("validateVariableRule — between (Laravel semantics)", () => {
  const pteroVersionRules = ["required", "string", "between:3,15"];

  it("accepts a version string within the length range", () => {
    expect(validateVariableRule("1.21.1", "between:3,15", pteroVersionRules)).toBeNull();
    expect(validateVariableRule("latest", "between:3,15", pteroVersionRules)).toBeNull();
  });

  it("rejects strings outside the length range", () => {
    expect(validateVariableRule("1.2", "between:4,15", pteroVersionRules)).toBe(
      "Must be between 4 and 15 characters",
    );
    expect(validateVariableRule("a".repeat(16), "between:3,15", pteroVersionRules)).toBe(
      "Must be between 3 and 15 characters",
    );
  });

  it("treats between as numeric range when rules declare numeric", () => {
    const rules = ["required", "numeric", "between:1,100"];
    expect(validateVariableRule("42", "between:1,100", rules)).toBeNull();
    expect(validateVariableRule("101", "between:1,100", rules)).toBe("Must be between 1 and 100");
    expect(validateVariableRule("abc", "between:1,100", rules)).toBe("Must be between 1 and 100");
  });

  it("treats between as numeric range when rules declare integer", () => {
    const rules = ["required", "integer", "between:1024,65535"];
    expect(validateVariableRule("25565", "between:1024,65535", rules)).toBeNull();
    expect(validateVariableRule("80", "between:1024,65535", rules)).toBe("Must be between 1024 and 65535");
  });

  it("defaults to string-length semantics when no full ruleset is passed", () => {
    expect(validateVariableRule("1.21.1", "between:3,15")).toBeNull();
    expect(validateVariableRule("12", "between:3,15")).toBe("Must be between 3 and 15 characters");
  });

  it("ignores malformed between params instead of failing every save", () => {
    expect(validateVariableRule("anything", "between:x,y", ["string"])).toBeNull();
    expect(validateVariableRule("anything", "between:10,1", ["string"])).toBeNull();
  });
});

describe("validateVariableRule — other rules", () => {
  it("in: enforces the allowed list", () => {
    expect(validateVariableRule("paper", "in:vanilla,paper", ["required"])).toBeNull();
    expect(validateVariableRule("forge", "in:vanilla,paper", ["required"])).toBe(
      "Must be one of: vanilla, paper",
    );
  });

  it("regex: enforces the pattern", () => {
    expect(validateVariableRule("open_fortress", "regex:/^(open_fortress)$/", ["required"])).toBeNull();
    expect(validateVariableRule("nope", "regex:/^(open_fortress)$/", ["required"])).toBe("Invalid format");
  });

  it("unknown rules pass through", () => {
    expect(validateVariableRule("whatever", "alpha_num", [])).toBeNull();
  });
});
