-- Template default disk + permanent SFTP tokens.
--
-- ServerTemplate.allocatedDiskMb is the disk allocation a server created from
-- the template starts with. It defaults to the historical 10 GiB value and is
-- backfilled from the old `features.recommendedDiskMb` hint that egg import
-- used to write, so imported templates keep their recommendation.
ALTER TABLE "ServerTemplate" ADD COLUMN IF NOT EXISTS "allocatedDiskMb" INTEGER NOT NULL DEFAULT 10240;

UPDATE "ServerTemplate"
SET "allocatedDiskMb" = LEAST(1048576, GREATEST(1024, ("features" ->> 'recommendedDiskMb')::integer))
WHERE "features" ->> 'recommendedDiskMb' ~ '^[0-9]{1,9}$';

-- Admin opt-in for non-expiring SFTP passwords (row id "security"). Off by
-- default: a permanent credential is a deliberate admin choice, and existing
-- installs keep the short-lived token behaviour until they turn it on.
ALTER TABLE "SystemSetting" ADD COLUMN IF NOT EXISTS "sftpPermanentTokensEnabled" BOOLEAN NOT NULL DEFAULT false;

-- A non-expiring SFTP password for one user on one server. Persisted so it
-- survives panel restarts (the short-lived tokens live in memory only).
-- tokenHash validates the credential; tokenCiphertext lets the panel show the
-- value back to its owner and is encrypted with a key derived from
-- BETTER_AUTH_SECRET.
CREATE TABLE "SftpPermanentToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "SftpPermanentToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SftpPermanentToken_tokenHash_key" ON "SftpPermanentToken"("tokenHash");
CREATE UNIQUE INDEX "SftpPermanentToken_userId_serverId_key" ON "SftpPermanentToken"("userId", "serverId");
CREATE INDEX "SftpPermanentToken_serverId_idx" ON "SftpPermanentToken"("serverId");
CREATE INDEX "SftpPermanentToken_userId_idx" ON "SftpPermanentToken"("userId");

ALTER TABLE "SftpPermanentToken" ADD CONSTRAINT "SftpPermanentToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SftpPermanentToken" ADD CONSTRAINT "SftpPermanentToken_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;
