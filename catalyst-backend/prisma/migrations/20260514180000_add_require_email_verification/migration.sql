-- Add requireEmailVerification column to SystemSetting
-- When false, new users can sign in without verifying their email address.
ALTER TABLE "SystemSetting" ADD COLUMN "requireEmailVerification" BOOLEAN NOT NULL DEFAULT true;
