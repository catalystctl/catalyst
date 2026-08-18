/**
 * Preview + import allocation handling for Pterodactyl 1.12.
 *
 * Server list payloads often have allocations: null and only a numeric
 * primary allocation id. Additional ports live on the node allocations
 * endpoint via server_id / relationships.server.
 */
import { describe, it, expect } from "vitest";
import {
  buildPreviewNode,
  buildPreviewServerAllocations,
} from "../services/migration/pterodactyl-client";
import { EntityMapper, indexPterodactylAllocations } from "../services/migration/entity-mapper";
import type { PterodactylAllocation, PterodactylNode, PterodactylServer } from "../services/migration/types";

const node: PterodactylNode = {
  id: 7,
  name: "nyc",
  location_id: 3,
  fqdn: "node.example.com",
  scheme: "https",
  behind_proxy: false,
  memory: 65536,
  memory_overallocate: 50,
  disk: 500000,
  disk_overallocate: 0,
  upload_size: 100,
  daemon_base: "/var/lib/pterodactyl/volumes",
  daemon_sftp: 2022,
  daemon_listen: 8080,
  maintenance_mode: false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const nodeAllocations: PterodactylAllocation[] = [
  { id: 11, ip: "203.0.113.10", port: 25565, server_id: 42, ip_alias: "mc.example.com" },
  { id: 12, ip: "203.0.113.10", port: 25566, server_id: 42 },
  { id: 13, ip: "203.0.113.10", port: 19132, assigned: false },
  {
    id: 14,
    ip: "203.0.113.11",
    port: 27015,
    relationships: { server: { attributes: { id: 99 } } },
  },
];

const server: PterodactylServer = {
  id: 42,
  uuid: "srv-uuid-42",
  name: "Survival",
  identifier: "abc123",
  suspended: false,
  node: 7,
  nest: 1,
  egg: 5,
  limits: { memory: 4096, swap: 0, disk: 10240, io: 500, cpu: 200 },
  feature_limits: { databases: 1, allocations: 3, backups: 2 },
  allocation: 11,
  allocations: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("buildPreviewNode", () => {
  it("exposes node config, location, and allocation inventory", () => {
    const preview = buildPreviewNode(node, {
      serverCount: 2,
      locationName: "New York",
      allocations: nodeAllocations,
    });

    expect(preview).toMatchObject({
      id: 7,
      name: "nyc",
      fqdn: "node.example.com",
      scheme: "https",
      behindProxy: false,
      locationId: 3,
      locationName: "New York",
      memory: 65536,
      memoryOverallocate: 50,
      disk: 500000,
      daemonBase: "/var/lib/pterodactyl/volumes",
      daemonSftp: 2022,
      daemonListen: 8080,
      serverCount: 2,
    });
    expect(preview.allocations).toHaveLength(4);
    expect(preview.allocations.find((allocation) => allocation.id === 11)).toMatchObject({
      ip: "203.0.113.10",
      port: 25565,
      alias: "mc.example.com",
      assigned: true,
      serverId: 42,
    });
    expect(preview.allocations.find((allocation) => allocation.id === 13)?.assigned).toBe(false);
    expect(preview.allocations.find((allocation) => allocation.id === 14)?.serverId).toBe(99);
  });
});

describe("buildPreviewServerAllocations", () => {
  it("resolves primary and additional allocations from the node endpoint", () => {
    const allocations = buildPreviewServerAllocations(server, nodeAllocations);

    expect(allocations.map((allocation) => allocation.port)).toEqual([25565, 25566]);
    expect(allocations[0]).toMatchObject({ id: 11, primary: true, assigned: true });
    expect(allocations[1]).toMatchObject({ id: 12, primary: false, assigned: true });
  });

  it("falls back to the inline primary object when the node inventory is empty", () => {
    const allocations = buildPreviewServerAllocations({
      ...server,
      allocation: { id: 11, ip: "203.0.113.10", port: 25565, ip_alias: "mc.example.com" },
    });

    expect(allocations).toEqual([
      {
        id: 11,
        ip: "203.0.113.10",
        port: 25565,
        alias: "mc.example.com",
        assigned: true,
        serverId: 42,
        primary: true,
      },
    ]);
  });
});

describe("indexPterodactylAllocations + mapServer", () => {
  it("includes every assigned node allocation in portBindings when server.allocations is null", () => {
    const indexed = indexPterodactylAllocations(nodeAllocations);
    const mapper = new EntityMapper({} as any);
    mapper.pteroAllocationMap = indexed.byId;
    mapper.pteroServerAllocationMap = indexed.byServer;

    const mapped = mapper.mapServer(
      server,
      "template-1",
      "node-1",
      "owner-1",
      "location-1",
      {},
      "10.0.0.8",
    );

    expect(mapped.data.primaryPort).toBe(25565);
    expect(mapped.data.primaryIp).toBe("10.0.0.8");
    expect(mapped.data.portBindings).toEqual({
      25565: 25565,
      25566: 25566,
    });
  });

  it("keeps extra ports from the server payload when they are present", () => {
    const mapper = new EntityMapper({} as any);
    mapper.pteroAllocationMap.set(11, { id: 11, ip: "203.0.113.10", port: 25565, serverId: 42 });
    mapper.pteroServerAllocationMap.set(42, [
      { id: 11, ip: "203.0.113.10", port: 25565, serverId: 42 },
    ]);

    const mapped = mapper.mapServer(
      {
        ...server,
        allocations: [
          { id: 11, ip: "203.0.113.10", port: 25565, server_id: 42 },
          { id: 15, ip: "203.0.113.10", port: 25575, server_id: 42 },
        ],
      },
      "template-1",
      "node-1",
      "owner-1",
      "location-1",
      {},
    );

    expect(mapped.data.portBindings).toEqual({
      25565: 25565,
      25575: 25575,
    });
  });
});
