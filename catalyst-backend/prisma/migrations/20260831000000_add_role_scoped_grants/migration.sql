-- Role-scoped grants (Tier 2 RBAC, role wizard "Scoped Access" step).
-- RoleServerGrant: members hold `permissions` on one specific server.
-- RoleNodeGrant: members hold `permissions` on every server hosted on the
-- node (nodeId NULL = all nodes). Both cascade with their role/target.

-- Also closes pre-existing migration drift: schema declares
-- @@index([userId]) on ServerAccess, but no prior migration created it.
-- CreateIndex
CREATE INDEX "ServerAccess_userId_idx" ON "ServerAccess"("userId");

-- CreateTable
CREATE TABLE "RoleServerGrant" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleServerGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleNodeGrant" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "nodeId" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoleNodeGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoleServerGrant_serverId_idx" ON "RoleServerGrant"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleServerGrant_roleId_serverId_key" ON "RoleServerGrant"("roleId", "serverId");

-- CreateIndex
CREATE INDEX "RoleNodeGrant_nodeId_idx" ON "RoleNodeGrant"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "RoleNodeGrant_roleId_nodeId_key" ON "RoleNodeGrant"("roleId", "nodeId");

-- AddForeignKey
ALTER TABLE "RoleServerGrant" ADD CONSTRAINT "RoleServerGrant_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleServerGrant" ADD CONSTRAINT "RoleServerGrant_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleNodeGrant" ADD CONSTRAINT "RoleNodeGrant_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleNodeGrant" ADD CONSTRAINT "RoleNodeGrant_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;
