-- Add configurable time window fields for rate limits.
-- These store the time window in milliseconds alongside the existing max-count fields,
-- allowing admins to configure "X per Y" (e.g. 15 per hour, 1000 per day) from the UI.

-- AlterTable: add 4 new nullable Int columns to SystemSetting
ALTER TABLE "SystemSetting" ADD COLUMN "authRateLimitWindowMs" INTEGER;
ALTER TABLE "SystemSetting" ADD COLUMN "fileRateLimitWindowMs" INTEGER;
ALTER TABLE "SystemSetting" ADD COLUMN "consoleRateLimitWindowMs" INTEGER;
ALTER TABLE "SystemSetting" ADD COLUMN "fileTunnelRateLimitWindowMs" INTEGER;

-- Backfill existing rows: default all time windows to 60000ms (1 minute)
-- to match the previously hardcoded "1 minute" timeWindow values.
UPDATE "SystemSetting"
SET
  "authRateLimitWindowMs" = 60000,
  "fileRateLimitWindowMs" = 60000,
  "consoleRateLimitWindowMs" = 60000,
  "fileTunnelRateLimitWindowMs" = 60000
WHERE "id" = 'security';
