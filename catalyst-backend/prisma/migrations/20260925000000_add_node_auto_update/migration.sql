-- Per-node opt-in for automatic agent updates. Default false: an agent is only
-- updated automatically when an admin has approved that specific node, so a bad
-- release cannot roll out everywhere at once.
-- IF NOT EXISTS so databases that received the column out-of-band stay valid.
ALTER TABLE "Node" ADD COLUMN IF NOT EXISTS "autoUpdateEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Update automation settings live in the DB (row id "auto_update") so they are
-- editable at runtime from Admin > System instead of requiring a redeploy.
-- NULL means "not configured yet" — the backend then seeds the row from the
-- AUTO_UPDATE_* environment variables, preserving behaviour for existing
-- installs and defaulting every value to false/1h for fresh ones.
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "autoUpdateEnabled" BOOLEAN;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "autoUpdateAutoTrigger" BOOLEAN;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "autoUpdateIntervalMs" INTEGER;
