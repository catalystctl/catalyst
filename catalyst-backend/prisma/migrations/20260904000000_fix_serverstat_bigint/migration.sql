-- Alter ServerStat byte columns from INTEGER to BIGINT.
-- INTEGER (int4) maxes at 2,147,483,647 bytes (~2GiB), so any server with
-- more than 2GB allocated (e.g. an 8GB Minecraft server) had both
-- memoryUsed and memoryLimit clamped to 2GB in history. BIGINT holds TiBs.
ALTER TABLE "ServerStat" ALTER COLUMN "memoryUsed" TYPE BIGINT;
ALTER TABLE "ServerStat" ALTER COLUMN "memoryLimit" TYPE BIGINT;
ALTER TABLE "ServerStat" ALTER COLUMN "diskUsed" TYPE BIGINT;
