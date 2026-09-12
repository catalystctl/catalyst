import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { CatalystClient } from "../client.js";
import { toJsonText } from "../client.js";

function text(value: unknown) {
  return { content: [{ type: "text" as const, text: toJsonText(value) }] };
}

export function registerNodeTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_nodes",
    {
      description: "List compute nodes with online status (GET /api/nodes).",
      inputSchema: z.object({
        search: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) => text(await client.get("/nodes", args)),
  );

  server.registerTool(
    "get_node",
    {
      description: "Full details for one node (GET /api/nodes/:id).",
      inputSchema: z.object({ nodeId: z.string() }),
    },
    async (args) => text(await client.get(`/nodes/${args.nodeId}`)),
  );

  server.registerTool(
    "create_node",
    {
      description: "Register a new compute node (POST /api/nodes). The response includes the agent secret.",
      inputSchema: z.object({
        name: z.string(),
        hostname: z.string().describe("Agent-visible hostname or IP"),
        publicAddress: z.string().describe("Public address players connect to"),
        locationId: z.string(),
        maxMemoryMb: z.number().int().min(128),
        maxCpuCores: z.number().min(1),
        description: z.string().optional(),
        sftpPort: z.number().int().min(1).max(65535).optional(),
      }),
    },
    async (args) => text(await client.post("/nodes", args)),
  );

  server.registerTool(
    "update_node",
    {
      description: "Update node capacity, addresses, or metadata (PUT /api/nodes/:id).",
      inputSchema: z.object({
        nodeId: z.string(),
        name: z.string().optional(),
        hostname: z.string().optional(),
        publicAddress: z.string().optional(),
        maxMemoryMb: z.number().int().min(128).optional(),
        maxCpuCores: z.number().min(1).optional(),
        description: z.string().optional(),
      }),
    },
    async (args) => {
      const { nodeId, ...body } = args;
      return text(await client.put(`/nodes/${nodeId}`, body));
    },
  );

  server.registerTool(
    "delete_node",
    {
      description: "Delete an empty node (DELETE /api/nodes/:id). Move or delete its servers first.",
      inputSchema: z.object({ nodeId: z.string() }),
    },
    async (args) => text(await client.delete(`/nodes/${args.nodeId}`)),
  );

  server.registerTool(
    "list_node_allocations",
    {
      description: "IP/port allocations on a node (GET /api/nodes/:id/allocations).",
      inputSchema: z.object({ nodeId: z.string() }),
    },
    async (args) => text(await client.get(`/nodes/${args.nodeId}/allocations`)),
  );

  server.registerTool(
    "create_node_allocation",
    {
      description: "Add an IP/port allocation pool entry to a node (POST /api/nodes/:id/allocations).",
      inputSchema: z.object({
        nodeId: z.string(),
        ip: z.string().describe("Bind IP, e.g. 0.0.0.0"),
        ports: z.string().describe("Ports or ranges, e.g. 25565-25570, 19132"),
        alias: z.string().optional(),
      }),
    },
    async (args) => {
      const { nodeId, ...body } = args;
      return text(await client.post(`/nodes/${nodeId}/allocations`, body));
    },
  );

  server.registerTool(
    "delete_node_allocation",
    {
      description: "Delete a free node allocation (DELETE /api/nodes/:id/allocations/:allocationId).",
      inputSchema: z.object({ nodeId: z.string(), allocationId: z.string() }),
    },
    async (args) => text(await client.delete(`/nodes/${args.nodeId}/allocations/${args.allocationId}`)),
  );

  server.registerTool(
    "get_node_stats",
    {
      description: "Resource usage and capacity for a node (GET /api/nodes/:id/stats).",
      inputSchema: z.object({ nodeId: z.string() }),
    },
    async (args) => text(await client.get(`/nodes/${args.nodeId}/stats`)),
  );
}

export function registerLocationTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_locations",
    {
      description: "List datacenter locations with node counts (GET /api/locations).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/locations")),
  );

  server.registerTool(
    "get_location",
    {
      description: "One location with its nodes (GET /api/locations/:id).",
      inputSchema: z.object({ locationId: z.string() }),
    },
    async (args) => text(await client.get(`/locations/${args.locationId}`)),
  );

  server.registerTool(
    "create_location",
    {
      description: "Create a location (POST /api/locations).",
      inputSchema: z.object({ name: z.string(), description: z.string().optional() }),
    },
    async (args) => text(await client.post("/locations", args)),
  );

  server.registerTool(
    "update_location",
    {
      description: "Update a location (PUT /api/locations/:id).",
      inputSchema: z.object({
        locationId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
      }),
    },
    async (args) => {
      const { locationId, ...body } = args;
      return text(await client.put(`/locations/${locationId}`, body));
    },
  );

  server.registerTool(
    "delete_location",
    {
      description: "Delete an empty location (DELETE /api/locations/:id).",
      inputSchema: z.object({ locationId: z.string() }),
    },
    async (args) => text(await client.delete(`/locations/${args.locationId}`)),
  );
}

export function registerTemplateTools(server: McpServer, client: CatalystClient): void {
  server.registerTool(
    "list_templates",
    {
      description: "List server templates/eggs (GET /api/templates).",
      inputSchema: z.object({
        search: z.string().optional(),
        nestId: z.string().optional(),
        page: z.number().int().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
    },
    async (args) => text(await client.get("/templates", args)),
  );

  server.registerTool(
    "get_template",
    {
      description: "Full template including variables and install script (GET /api/templates/:id).",
      inputSchema: z.object({ templateId: z.string() }),
    },
    async (args) => text(await client.get(`/templates/${args.templateId}`)),
  );

  server.registerTool(
    "list_nests",
    {
      description: "Template categories/nests (GET /api/nests).",
      inputSchema: z.object({}),
    },
    async () => text(await client.get("/nests")),
  );
}
