import { describe, it, expect } from "vitest";
import {
  isCpuAffinityUnavailableAgentError,
  isInvalidCpuAffinityAgentError,
} from "../routes/servers/_helpers.js";

/**
 * The agent owns the live CPU set, so a pin the panel accepted (because the node
 * had not reported its set) can still be refused when the container is created.
 * The power route maps these exact prefixes to CPU_AFFINITY_UNAVAILABLE /
 * CPU_AFFINITY_INVALID instead of a dead-end "agent command failed"; the strings
 * are produced in catalyst-agent/src/runtime_manager/helpers.rs.
 */
describe("CPU affinity agent error mapping", () => {
  it("matches the agent's unavailable-set rejection", () => {
    expect(
      isCpuAffinityUnavailableAgentError(
        "cpu_affinity_unavailable: CPUs 0-31 are not available on this node (available: 0-15)",
      ),
    ).toBe(true);
    expect(
      isCpuAffinityUnavailableAgentError(
        "Invalid request: cpu_affinity_unavailable: CPUs 4 are not available on this node (available: 0-3)",
      ),
    ).toBe(true);
  });

  it("matches the agent's malformed-mask rejection", () => {
    expect(isInvalidCpuAffinityAgentError("invalid_cpu_affinity: '3-1' is not a valid CPU list")).toBe(
      true,
    );
  });

  it("does not match unrelated failures", () => {
    for (const message of [
      "",
      "Invalid request: missing serverUuid",
      'networkMode "host" is disabled on this node',
      "Container failed to start",
      // Near-miss: the prefix must be the actual token, not a substring of prose.
      "the cpu affinity is unavailable for this container",
    ]) {
      expect(isCpuAffinityUnavailableAgentError(message), message).toBe(false);
      expect(isInvalidCpuAffinityAgentError(message), message).toBe(false);
    }
  });
});
