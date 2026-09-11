import { describe, it, expect } from "vitest";
import { isHostNetworkDisabledAgentError } from "../routes/servers/_helpers.js";

/**
 * The panel turns this agent rejection into a one-click "enable host
 * networking and start" flow, so the exact wording the agent emits must map
 * to HOST_NETWORK_DISABLED (containerd.allow_host_network gate).
 */
describe("host-network-disabled agent error mapping", () => {
  it("matches the agent rejection for networkMode host", () => {
    expect(
      isHostNetworkDisabledAgentError(
        'Invalid request: networkMode "host" is disabled on this node',
      ),
    ).toBe(true);
    expect(
      isHostNetworkDisabledAgentError('networkMode "host" is disabled on this node'),
    ).toBe(true);
  });

  it("does not match unrelated agent failures", () => {
    expect(isHostNetworkDisabledAgentError("")).toBe(false);
    expect(isHostNetworkDisabledAgentError("Invalid request: missing serverUuid")).toBe(false);
    expect(isHostNetworkDisabledAgentError("Container failed to start")).toBe(false);
  });
});
