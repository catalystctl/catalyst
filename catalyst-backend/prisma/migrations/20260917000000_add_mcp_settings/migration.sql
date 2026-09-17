-- Panel-hosted MCP (Streamable HTTP at /api/mcp). Backs the Admin > Security
-- opt-in toggle (row id "mcp"); the endpoint 404s until an admin enables it.
-- IF NOT EXISTS so databases that received the columns out-of-band stay valid.
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "mcpEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "mcpToolRateLimitMax" INTEGER;
