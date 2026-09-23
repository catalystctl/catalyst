-- Stable, opaque install identity handed to plugins as `ctx.installId`.
-- Third-party vendor license servers bind seats to it, so it must be stable
-- across restarts and plugin reinstalls and must never be derived from
-- anything an operator could leak. Exactly one row (id = "local").
--
-- IF NOT EXISTS so databases that received the table out-of-band stay valid.

CREATE TABLE IF NOT EXISTS "PanelIdentity" (
    "id" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PanelIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PanelIdentity_installId_key" ON "PanelIdentity"("installId");
