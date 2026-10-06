-- CreateIndex
-- Speeds up verifyApiKey's prefix-bucket lookup (uncached path). Additive only.
CREATE INDEX "apikey_prefix_idx" ON "apikey"("prefix");
