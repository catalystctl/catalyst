-- AlterTable: add configurable path fields to Node
-- These are all optional; existing installations continue working with agent defaults.

ALTER TABLE "Node" ADD COLUMN "consoleLogDir" TEXT;
ALTER TABLE "Node" ADD COLUMN "cniDir" TEXT;
ALTER TABLE "Node" ADD COLUMN "cniBinDir" TEXT;
ALTER TABLE "Node" ADD COLUMN "cniDataDir" TEXT;
ALTER TABLE "Node" ADD COLUMN "cniResultsDir" TEXT;
ALTER TABLE "Node" ADD COLUMN "cniBridgeName" TEXT;
ALTER TABLE "Node" ADD COLUMN "cniBridgeSubnet" TEXT;
ALTER TABLE "Node" ADD COLUMN "systemdOverrideDir" TEXT;
ALTER TABLE "Node" ADD COLUMN "agentConfigPath" TEXT;
ALTER TABLE "Node" ADD COLUMN "agentReleaseRepo" TEXT;
