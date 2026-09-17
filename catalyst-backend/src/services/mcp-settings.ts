import { prisma } from "../db";
import { cachedConfig, invalidateConfig } from "../lib/config-cache";

/** Row id carrying the panel-hosted MCP toggle. */
export const MCP_SETTING_ID = "mcp";

export interface McpSettings {
  /** Master switch for Streamable HTTP at /api/mcp. Default false. */
  enabled: boolean;
  /** Max tool calls per minute per API key. Bounds agentic loops. */
  toolRateLimitMax: number;
}

export const DEFAULT_MCP_SETTINGS: McpSettings = {
  enabled: false,
  toolRateLimitMax: 300,
};

function normalizeToolRateLimitMax(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MCP_SETTINGS.toolRateLimitMax;
  return Math.min(5000, Math.max(10, Math.floor(n)));
}

export async function getMcpSettings(): Promise<McpSettings> {
  return cachedConfig("mcp", async () => {
    const row = await prisma.systemSetting.findUnique({ where: { id: MCP_SETTING_ID } });
    if (!row) return { ...DEFAULT_MCP_SETTINGS };
    return {
      enabled: row.mcpEnabled ?? false,
      toolRateLimitMax: normalizeToolRateLimitMax(
        row.mcpToolRateLimitMax ?? DEFAULT_MCP_SETTINGS.toolRateLimitMax,
      ),
    };
  });
}

export async function upsertMcpSettings(input: Partial<McpSettings>): Promise<McpSettings> {
  const enabled = typeof input.enabled === "boolean" ? input.enabled : false;
  const toolRateLimitMax = normalizeToolRateLimitMax(
    input.toolRateLimitMax ?? DEFAULT_MCP_SETTINGS.toolRateLimitMax,
  );
  await prisma.systemSetting.upsert({
    where: { id: MCP_SETTING_ID },
    create: { id: MCP_SETTING_ID, mcpEnabled: enabled, mcpToolRateLimitMax: toolRateLimitMax },
    update: { mcpEnabled: enabled, mcpToolRateLimitMax: toolRateLimitMax },
  });
  // Immediate effect on every worker/host: no restart needed.
  await invalidateConfig("mcp");
  return getMcpSettings();
}
