-- Plugin safety consent + effective permission grants
ALTER TABLE "Plugin" ADD COLUMN "safetyAcceptedAt" TIMESTAMP(3);
ALTER TABLE "Plugin" ADD COLUMN "safetyAcceptedBy" TEXT;
ALTER TABLE "Plugin" ADD COLUMN "safetyDisclaimerVersion" TEXT;
ALTER TABLE "Plugin" ADD COLUMN "safetyAcceptedPluginVersion" TEXT;
ALTER TABLE "Plugin" ADD COLUMN "safetyAcceptedPermissions" JSONB;
ALTER TABLE "Plugin" ADD COLUMN "grantedPermissions" JSONB;
