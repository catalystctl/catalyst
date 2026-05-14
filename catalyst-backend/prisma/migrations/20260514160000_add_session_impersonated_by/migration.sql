-- AlterTable: add impersonatedBy column for Better Auth admin plugin impersonation support
ALTER TABLE "session" ADD COLUMN "impersonatedBy" TEXT;
