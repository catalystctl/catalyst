-- AlterTable
ALTER TABLE "Server" ADD COLUMN IF NOT EXISTS "subdomain" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Server_subdomain_key" ON "Server"("subdomain");

-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "dnsProvider" TEXT;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "dnsBaseDomain" TEXT;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "dnsCloudflareApiToken" TEXT;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "dnsCloudflareZoneId" TEXT;
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "dnsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ServerTemplate" ADD COLUMN IF NOT EXISTS "srvService" TEXT;
ALTER TABLE "ServerTemplate" ADD COLUMN IF NOT EXISTS "srvProtocol" TEXT NOT NULL DEFAULT 'tcp';
