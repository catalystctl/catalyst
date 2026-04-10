-- CreateTable
CREATE TABLE "ServerStat" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memoryUsed" INTEGER NOT NULL,
    "memoryLimit" INTEGER NOT NULL,
    "diskUsed" INTEGER,
    "netRx" DOUBLE PRECISION,
    "netTx" DOUBLE PRECISION,
    "blockRead" DOUBLE PRECISION,
    "blockWrite" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServerStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServerStat_serverId_createdAt_idx" ON "ServerStat"("serverId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "ServerStat" ADD CONSTRAINT "ServerStat_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
