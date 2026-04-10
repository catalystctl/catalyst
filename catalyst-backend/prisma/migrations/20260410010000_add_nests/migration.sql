-- CreateTable
CREATE TABLE "Nest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Nest_name_key" ON "Nest"("name");

-- AlterTable: Add nestId to ServerTemplate
ALTER TABLE "ServerTemplate" ADD COLUMN "nestId" TEXT;

-- AddForeignKey
ALTER TABLE "ServerTemplate" ADD CONSTRAINT "ServerTemplate_nestId_fkey" FOREIGN KEY ("nestId") REFERENCES "Nest" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
