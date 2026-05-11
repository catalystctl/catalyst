-- AlterTable: Add installEntrypoint column to ServerTemplate
ALTER TABLE "ServerTemplate" ADD COLUMN "installEntrypoint" TEXT NOT NULL DEFAULT 'bash';
