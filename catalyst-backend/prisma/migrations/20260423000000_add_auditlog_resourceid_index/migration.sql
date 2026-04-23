-- Add index on AuditLog.resourceId and timestamp for efficient server activity queries
CREATE INDEX IF NOT EXISTS "AuditLog_resourceId_timestamp_idx" ON "AuditLog"("resourceId", "timestamp");
