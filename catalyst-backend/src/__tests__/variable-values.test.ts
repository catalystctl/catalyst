/**
 * Boolean ("checkbox") variable values — issue #313.
 *
 * Imported Pterodactyl eggs and yolk entrypoints compare against `1`/`0`, so a
 * save must not rewrite them to `true`/`false`.
 */
import { describe, it, expect } from "vitest";
import {
	checkboxTokens,
	isCheckedValue,
	isKnownVariableValue,
	normalizeCheckboxValue,
} from "../utils/variable-values";

describe("checkboxTokens", () => {
	it("uses an explicit template pair", () => {
		expect(
			checkboxTokens({ trueValue: "yes", falseValue: "no", default: "1" }),
		).toEqual({ true: "yes", false: "no" });
	});

	it("keeps 1/0 for imported eggs (stored value or default)", () => {
		// Already-imported template: no explicit pair, default from the egg.
		expect(checkboxTokens({ default: "1" }, "1")).toEqual({ true: "1", false: "0" });
		expect(checkboxTokens({ default: "0" }, "0")).toEqual({ true: "1", false: "0" });
		// Stored value is numeric even though the default is not (legacy data).
		expect(checkboxTokens({ default: "true" }, "1")).toEqual({ true: "1", false: "0" });
	});

	it("defaults to true/false for panel-authored checkboxes", () => {
		expect(checkboxTokens({ default: "true" }, "true")).toEqual({
			true: "true",
			false: "false",
		});
		expect(checkboxTokens({}, undefined)).toEqual({ true: "true", false: "false" });
		expect(checkboxTokens({ default: "" }, "")).toEqual({ true: "true", false: "false" });
	});

	it("requires both halves of an explicit pair", () => {
		expect(checkboxTokens({ trueValue: "1", default: "true" })).toEqual({
			true: "true",
			false: "false",
		});
	});
});

describe("normalizeCheckboxValue", () => {
	it("writes the numeric pair for imported eggs", () => {
		const tokens = { true: "1", false: "0" };
		expect(normalizeCheckboxValue("true", tokens)).toBe("1");
		expect(normalizeCheckboxValue("1", tokens)).toBe("1");
		expect(normalizeCheckboxValue("on", tokens)).toBe("1");
		expect(normalizeCheckboxValue("false", tokens)).toBe("0");
		expect(normalizeCheckboxValue("0", tokens)).toBe("0");
		expect(normalizeCheckboxValue(undefined, tokens)).toBe("0");
	});

	it("writes the panel pair for true/false templates", () => {
		const tokens = { true: "true", false: "false" };
		expect(normalizeCheckboxValue("1", tokens)).toBe("true");
		expect(normalizeCheckboxValue("", tokens)).toBe("false");
	});
});

describe("isCheckedValue / isKnownVariableValue", () => {
	it("recognises both spellings", () => {
		const numeric = { true: "1", false: "0" };
		expect(isCheckedValue("1", numeric)).toBe(true);
		expect(isCheckedValue("0", numeric)).toBe(false);
		expect(isCheckedValue("true", numeric)).toBe(true);
		const words = { true: "true", false: "false" };
		expect(isCheckedValue("true", words)).toBe(true);
		expect(isCheckedValue("false", words)).toBe(false);
	});

	it("knows which submitted values are interpretable", () => {
		for (const value of ["true", "false", "1", "0", "on", "off", "yes", "no"]) {
			expect(isKnownVariableValue(value)).toBe(true);
		}
		expect(isKnownVariableValue("maybe")).toBe(false);
	});
});
