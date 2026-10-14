-- Pin important backups so the retention job never prunes them.
--
-- The periodic retention service (services/backup-retention.ts) and the
-- gateway's inline post-backup prune both honour this flag: a pinned backup is
-- skipped and does not consume a "keep last N" slot. Default false keeps the
-- previous behaviour for every existing row.
ALTER TABLE "Backup" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
