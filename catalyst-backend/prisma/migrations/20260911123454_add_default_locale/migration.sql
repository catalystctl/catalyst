-- Add the instance-wide default language backing GET /api/settings/locale and
-- the Localization settings page. Backends since v1.49.0 query this column on
-- every boot, so a database without it fails login with HTTP 500.
-- IF NOT EXISTS so databases that received the column out-of-band stay valid.
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "defaultLocale" TEXT;

-- Reconcile with schema.prisma: MarketplaceSource.updatedAt is written by
-- Prisma's @updatedAt and the datamodel carries no database default.
ALTER TABLE "MarketplaceSource" ALTER COLUMN "updatedAt" DROP DEFAULT;
