-- Runtime environment overrides edited from Admin > Environment.
--
-- The .env file remains the bootstrap source for variables the process needs
-- before it can reach this table (DATABASE_URL, PORT, NODE_ENV, ...). Every
-- other variable can be set here; the boot loader applies these rows to
-- process.env before the application modules are imported, so changes take
-- effect on the next panel restart. Deleting a row restores the .env value.
CREATE TABLE IF NOT EXISTS "EnvSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnvSetting_pkey" PRIMARY KEY ("key")
);
