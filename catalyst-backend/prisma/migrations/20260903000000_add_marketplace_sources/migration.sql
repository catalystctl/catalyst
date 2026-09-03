-- Panel-managed marketplace sources (Plugins → Marketplace → add source).
-- Env PLUGIN_MARKETPLACE_URLS and the official index remain read-only.

CREATE TABLE IF NOT EXISTS "MarketplaceSource" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "MarketplaceSource_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MarketplaceSource_url_key" ON "MarketplaceSource"("url");
CREATE INDEX IF NOT EXISTS "MarketplaceSource_enabled_idx" ON "MarketplaceSource"("enabled");
