-- Remove the built-in DNS system (Cloudflare linking + automatic A/SRV
-- records, per-server subdomains, per-template SRV config) so it can be
-- reintroduced as a plugin. Drops dedicated columns from SystemSetting,
-- ServerTemplate, and Server.

ALTER TABLE "SystemSetting" DROP COLUMN IF EXISTS "dnsProvider";
ALTER TABLE "SystemSetting" DROP COLUMN IF EXISTS "dnsBaseDomain";
ALTER TABLE "SystemSetting" DROP COLUMN IF EXISTS "dnsCloudflareApiToken";
ALTER TABLE "SystemSetting" DROP COLUMN IF EXISTS "dnsCloudflareZoneId";
ALTER TABLE "SystemSetting" DROP COLUMN IF EXISTS "dnsEnabled";

ALTER TABLE "ServerTemplate" DROP COLUMN IF EXISTS "srvService";
ALTER TABLE "ServerTemplate" DROP COLUMN IF EXISTS "srvProtocol";

-- The inline @unique on Server.subdomain created this index; dropping the
-- column removes the constraint automatically on PostgreSQL.
ALTER TABLE "Server" DROP COLUMN IF EXISTS "subdomain";
