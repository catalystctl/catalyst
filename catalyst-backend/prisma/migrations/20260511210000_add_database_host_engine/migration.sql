-- AlterTable
ALTER TABLE "DatabaseHost" ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'mysql';
ALTER TABLE "DatabaseHost" ADD COLUMN "database" TEXT NOT NULL DEFAULT 'postgres';
