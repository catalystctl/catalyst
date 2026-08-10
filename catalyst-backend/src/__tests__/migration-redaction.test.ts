/**
 * Ensure migration job API payloads never leak Pterodactyl source/client keys.
 */
import { describe, it, expect } from "vitest";
import { redactMigrationJobSecrets } from "../services/migration/index";

describe("redactMigrationJobSecrets", () => {
  it("redacts sourceKey when present", () => {
    const redacted = redactMigrationJobSecrets({
      id: "job-1",
      sourceKey: "ptla_super_secret_application_key",
      config: {},
    });
    expect(redacted.sourceKey).toBe("********");
    expect(redacted.id).toBe("job-1");
  });

  it("leaves null/empty sourceKey alone", () => {
    expect(redactMigrationJobSecrets({ sourceKey: null }).sourceKey).toBeNull();
    expect(redactMigrationJobSecrets({ sourceKey: undefined }).sourceKey).toBeUndefined();
    expect(redactMigrationJobSecrets({ sourceKey: "" }).sourceKey).toBe("");
  });

  it("redacts clientApiKey inside config", () => {
    const redacted = redactMigrationJobSecrets({
      sourceKey: "ptla_abc",
      config: {
        scope: "full",
        clientApiKey: "ptlc_client_secret_value",
        nodeMappings: { a: "b" },
      },
    });
    expect(redacted.sourceKey).toBe("********");
    expect((redacted.config as any).clientApiKey).toBe("********");
    expect((redacted.config as any).scope).toBe("full");
    expect((redacted.config as any).nodeMappings).toEqual({ a: "b" });
  });

  it("does not invent a clientApiKey when missing", () => {
    const redacted = redactMigrationJobSecrets({
      sourceKey: "ptla_abc",
      config: { scope: "node" },
    });
    expect((redacted.config as any).clientApiKey).toBeNull();
    expect((redacted.config as any).scope).toBe("node");
  });

  it("preserves non-object config", () => {
    expect(redactMigrationJobSecrets({ sourceKey: "x", config: null }).config).toBeNull();
    expect(redactMigrationJobSecrets({ sourceKey: "x", config: "raw" }).config).toBe("raw");
  });

  it("does not mutate the original job object", () => {
    const original = {
      sourceKey: "ptla_live",
      config: { clientApiKey: "ptlc_live", extra: 1 },
    };
    const snapshot = structuredClone(original);
    redactMigrationJobSecrets(original);
    expect(original).toEqual(snapshot);
  });
});
