import { describe, expect, it } from "vitest";
import { backupMigrationSkipReason, PterodactylClientError } from "../services/migration/pterodactyl-client";

describe("backupMigrationSkipReason", () => {
  it("explains an uninstalled server returned by the client API", () => {
    expect(backupMigrationSkipReason(new PterodactylClientError(
      "SERVER_STATE_CONFLICT",
      "This server has not yet completed its installation process, please try again later.",
      409,
    ))).toBe("Server has not completed installation on its Wings node");
  });

  it("classifies unavailable backup endpoints and permissions", () => {
    expect(backupMigrationSkipReason(new PterodactylClientError("NOT_FOUND", "missing", 404)))
      .toBe("Backups endpoint not available");
    expect(backupMigrationSkipReason(new PterodactylClientError("AUTH", "forbidden", 403)))
      .toBe("Client API key cannot access backups");
  });

  it("does not hide unexpected backup failures", () => {
    expect(backupMigrationSkipReason(new PterodactylClientError("SERVER_ERROR", "upstream failed", 500)))
      .toBeNull();
  });
});
