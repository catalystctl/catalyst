import { describe, expect, it } from "vitest";
import { filterPterodactylServersByScope } from "../services/migration/index";

const servers = [
  { attributes: { id: 1, node: 1 } },
  { attributes: { id: 2, node: 2 } },
  { attributes: { id: 3, node: 3 } },
  { attributes: { id: 4, node: 2 } },
];

describe("filterPterodactylServersByScope", () => {
  it("filters full/node scopes by node IDs", () => {
    expect(filterPterodactylServersByScope(servers, "full", new Set(), new Set([1, 2, 3])))
      .toHaveLength(4);
    expect(filterPterodactylServersByScope(servers, "node", new Set(), new Set([2])))
      .toEqual([servers[1], servers[3]]);
  });

  it("filters server scope by server IDs", () => {
    expect(filterPterodactylServersByScope(servers, "server", new Set([2, 4]), new Set()))
      .toEqual([servers[1], servers[3]]);
  });
});
