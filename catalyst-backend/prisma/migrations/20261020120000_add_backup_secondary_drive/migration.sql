-- Secondary ("another drive") backup destination.
--
-- A panel-wide extra directory an admin can enable so a finished backup is
-- additionally copied there (typically a mounted second disk). Disabled by
-- default, so existing installs behave exactly as before: no path is
-- configured and the create-backup option stays hidden.
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "backupSecondaryEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "backupSecondaryPath" TEXT;
