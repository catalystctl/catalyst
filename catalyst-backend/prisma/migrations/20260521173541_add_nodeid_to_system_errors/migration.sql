-- AlterTable
ALTER TABLE "SystemError" ADD COLUMN     "nodeId" TEXT;

-- CreateIndex
CREATE INDEX "SystemError_nodeId_createdAt_idx" ON "SystemError"("nodeId", "createdAt");
