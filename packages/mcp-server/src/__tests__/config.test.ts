import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config.js";

describe("resolveConfig", () => {
  it("appends /api when the URL has no suffix", () => {
    const config = resolveConfig({
      CATALYST_URL: "https://panel.example.com/",
      CATALYST_API_KEY: "catalyst_test",
    } as NodeJS.ProcessEnv);
    expect(config.panelBase).toBe("https://panel.example.com");
    expect(config.apiBase).toBe("https://panel.example.com/api");
  });

  it("keeps a trailing /api suffix", () => {
    const config = resolveConfig({
      CATALYST_URL: "https://panel.example.com/api",
      CATALYST_API_KEY: "catalyst_test",
    } as NodeJS.ProcessEnv);
    expect(config.apiBase).toBe("https://panel.example.com/api");
  });

  it("accepts alias env vars", () => {
    const config = resolveConfig({
      CATALYST_PANEL_URL: "https://panel.example.com",
      CATALYST_TOKEN: "catalyst_test",
    } as NodeJS.ProcessEnv);
    expect(config.apiBase).toBe("https://panel.example.com/api");
  });

  it("throws when configuration is missing", () => {
    expect(() => resolveConfig({} as NodeJS.ProcessEnv)).toThrow(/panel URL/i);
    expect(() =>
      resolveConfig({ CATALYST_URL: "https://panel.example.com" } as NodeJS.ProcessEnv),
    ).toThrow(/API key/i);
  });
});
