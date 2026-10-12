import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `api-key-service` reads its secrets from the centralised `config` object
 * (config.ts snapshots `process.env` once, at import time), so each case
 * stubs the environment and re-imports the module graph instead of mutating
 * `process.env` under an already-loaded module.
 */
async function loadService(env: Record<string, string>) {
  vi.stubEnv("NODE_ENV", "test");
  for (const [key, value] of Object.entries(env)) {
    vi.stubEnv(key, value);
  }
  vi.resetModules();
  return import("../services/api-key-service");
}

const ORIGINAL_API_KEY_SECRET = process.env.API_KEY_SECRET;
const ORIGINAL_BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  if (ORIGINAL_API_KEY_SECRET === undefined) {
    delete process.env.API_KEY_SECRET;
  } else {
    process.env.API_KEY_SECRET = ORIGINAL_API_KEY_SECRET;
  }
  if (ORIGINAL_BETTER_AUTH_SECRET === undefined) {
    delete process.env.BETTER_AUTH_SECRET;
  } else {
    process.env.BETTER_AUTH_SECRET = ORIGINAL_BETTER_AUTH_SECRET;
  }
});

describe("resolveApiKeySecret", () => {
  it("prefers a dedicated API_KEY_SECRET", async () => {
    const { resolveApiKeySecret } = await loadService({
      API_KEY_SECRET: "dedicated-api-key-secret",
      BETTER_AUTH_SECRET: "better-auth-secret",
    });

    expect(resolveApiKeySecret()).toBe("dedicated-api-key-secret");
  });

  it("falls back to BETTER_AUTH_SECRET when API_KEY_SECRET is unset", async () => {
    const { resolveApiKeySecret } = await loadService({
      API_KEY_SECRET: "",
      BETTER_AUTH_SECRET: "better-auth-secret-only",
    });

    expect(resolveApiKeySecret()).toBe("better-auth-secret-only");
    // Cached for subsequent lookups / other modules
    expect(process.env.API_KEY_SECRET).toBe("better-auth-secret-only");
  });

  it("falls back when API_KEY_SECRET is empty/whitespace", async () => {
    const { resolveApiKeySecret } = await loadService({
      API_KEY_SECRET: "   ",
      BETTER_AUTH_SECRET: "better-auth-secret-whitespace",
    });

    expect(resolveApiKeySecret()).toBe("better-auth-secret-whitespace");
  });

  it("throws when neither secret is available", async () => {
    const { resolveApiKeySecret } = await loadService({
      API_KEY_SECRET: "",
      BETTER_AUTH_SECRET: "",
    });

    expect(() => resolveApiKeySecret()).toThrow(/API_KEY_SECRET/);
  });

  it("hashes with the resolved fallback secret", async () => {
    const { hashApiKey } = await loadService({
      API_KEY_SECRET: "",
      BETTER_AUTH_SECRET: "hash-fallback-secret",
    });

    const a = hashApiKey("catalyst_testkey_abcdefghijklmnop");
    const b = hashApiKey("catalyst_testkey_abcdefghijklmnop");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("hashApiKeyPreviousSecret", () => {
  it("reproduces a hash minted under the pre-rotation auth secret", async () => {
    // Key minted before the dedicated secret existed (HMAC under auth secret).
    const before = await loadService({
      API_KEY_SECRET: "",
      BETTER_AUTH_SECRET: "old-shared-secret",
    });
    const oldHash = before.hashApiKey("catalyst_testkey_abcdefghijklmnop");

    // Reconfigure mints the dedicated secret; current hash no longer matches.
    const after = await loadService({
      API_KEY_SECRET: "new-dedicated-secret",
      BETTER_AUTH_SECRET: "old-shared-secret",
    });
    expect(after.hashApiKey("catalyst_testkey_abcdefghijklmnop")).not.toBe(oldHash);

    // The rotation grace path reproduces the stored hash.
    expect(after.hashApiKeyPreviousSecret("catalyst_testkey_abcdefghijklmnop")).toBe(oldHash);
  });

  it("returns null when there is no distinct previous secret", async () => {
    const same = await loadService({
      API_KEY_SECRET: "same-secret",
      BETTER_AUTH_SECRET: "same-secret",
    });
    expect(same.hashApiKeyPreviousSecret("catalyst_testkey_abcdefghijklmnop")).toBeNull();

    const noFallback = await loadService({
      API_KEY_SECRET: "same-secret",
      BETTER_AUTH_SECRET: "",
    });
    expect(noFallback.hashApiKeyPreviousSecret("catalyst_testkey_abcdefghijklmnop")).toBeNull();
  });
});
