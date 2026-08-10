-- AlterTable: registration defaults OFF (invite/admin only).
-- Existing DBs that already have the column keep their stored value;
-- only the column default is tightened for new rows.
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "registrationEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SystemSetting" ALTER COLUMN "registrationEnabled" SET DEFAULT false;
