import { afterEach, describe, expect, it } from "vitest";
import {
  hashApiKey,
  hashApiKeyPreviousSecret,
  resolveApiKeySecret,
} from "../services/api-key-service";

const ORIGINAL_API_KEY_SECRET = process.env.API_KEY_SECRET;
const ORIGINAL_BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;

afterEach(() => {
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
  it("prefers a dedicated API_KEY_SECRET", () => {
    process.env.API_KEY_SECRET = "dedicated-api-key-secret";
    process.env.BETTER_AUTH_SECRET = "better-auth-secret";

    expect(resolveApiKeySecret()).toBe("dedicated-api-key-secret");
  });

  it("falls back to BETTER_AUTH_SECRET when API_KEY_SECRET is unset", () => {
    delete process.env.API_KEY_SECRET;
    process.env.BETTER_AUTH_SECRET = "better-auth-secret-only";

    expect(resolveApiKeySecret()).toBe("better-auth-secret-only");
    // Cached for subsequent lookups / other modules
    expect(process.env.API_KEY_SECRET).toBe("better-auth-secret-only");
  });

  it("falls back when API_KEY_SECRET is empty/whitespace", () => {
    process.env.API_KEY_SECRET = "   ";
    process.env.BETTER_AUTH_SECRET = "better-auth-secret-whitespace";

    expect(resolveApiKeySecret()).toBe("better-auth-secret-whitespace");
  });

  it("throws when neither secret is available", () => {
    delete process.env.API_KEY_SECRET;
    delete process.env.BETTER_AUTH_SECRET;

    expect(() => resolveApiKeySecret()).toThrow(/API_KEY_SECRET/);
  });

  it("hashes with the resolved fallback secret", () => {
    delete process.env.API_KEY_SECRET;
    process.env.BETTER_AUTH_SECRET = "hash-fallback-secret";

    const a = hashApiKey("catalyst_testkey_abcdefghijklmnop");
    const b = hashApiKey("catalyst_testkey_abcdefghijklmnop");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("hashApiKeyPreviousSecret", () => {
  it("reproduces a hash minted under the pre-rotation auth secret", () => {
    // Key minted before the dedicated secret existed (HMAC under auth secret).
    delete process.env.API_KEY_SECRET;
    process.env.BETTER_AUTH_SECRET = "old-shared-secret";
    const oldHash = hashApiKey("catalyst_testkey_abcdefghijklmnop");

    // Reconfigure mints the dedicated secret; current hash no longer matches.
    process.env.API_KEY_SECRET = "new-dedicated-secret";
    expect(hashApiKey("catalyst_testkey_abcdefghijklmnop")).not.toBe(oldHash);

    // The rotation grace path reproduces the stored hash.
    expect(hashApiKeyPreviousSecret("catalyst_testkey_abcdefghijklmnop")).toBe(oldHash);
  });

  it("returns null when there is no distinct previous secret", () => {
    process.env.API_KEY_SECRET = "same-secret";
    process.env.BETTER_AUTH_SECRET = "same-secret";
    expect(hashApiKeyPreviousSecret("catalyst_testkey_abcdefghijklmnop")).toBeNull();

    delete process.env.BETTER_AUTH_SECRET;
    expect(hashApiKeyPreviousSecret("catalyst_testkey_abcdefghijklmnop")).toBeNull();
  });
});
