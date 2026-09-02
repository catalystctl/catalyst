-- better-auth two-factor plugin expects brute-force protection fields on the
-- twoFactor table (failedVerificationCount with server default 0 and
-- lockedUntil). Without them, enableTwoFactor inserts fail with 42703
-- (undefined column), surfacing as HTTP 500 on POST /api/auth/two-factor/enable.

ALTER TABLE "twoFactor" ADD COLUMN "failedVerificationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "twoFactor" ADD COLUMN "lockedUntil" TIMESTAMP(3);
