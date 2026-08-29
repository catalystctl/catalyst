-- Add missing list indexes: schema.prisma declares these @@index definitions
-- but no prior migration creates them (server/template list ordering queries).

-- CreateIndex
CREATE INDEX "Server_updatedAt_idx" ON "Server"("updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Server_ownerId_updatedAt_idx" ON "Server"("ownerId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "Server_nodeId_updatedAt_idx" ON "Server"("nodeId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "ServerTemplate_createdAt_idx" ON "ServerTemplate"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ServerTemplate_nestId_idx" ON "ServerTemplate"("nestId");

-- CreateIndex
CREATE INDEX "ServerTemplate_nestId_createdAt_idx" ON "ServerTemplate"("nestId", "createdAt" DESC);
