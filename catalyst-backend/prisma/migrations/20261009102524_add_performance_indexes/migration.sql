-- Add compound index on ServerLog for efficient log queries
CREATE INDEX IF NOT EXISTS "ServerLog_serverId_stream_timestamp_idx" ON "ServerLog"("serverId", "stream", "timestamp");

-- Add index on AuditLog.action for action-based filtering
CREATE INDEX IF NOT EXISTS "AuditLog_action_timestamp_idx" ON "AuditLog"("action", "timestamp");

-- Add compound index on Alert for type + severity queries
-- Note: Alert already has several indexes including type/severity/resolved,
-- but this adds a more specific index for type+severity queries without resolved filter
CREATE INDEX IF NOT EXISTS "Alert_type_severity_createdAt_idx" ON "Alert"("type", "severity", "createdAt");
