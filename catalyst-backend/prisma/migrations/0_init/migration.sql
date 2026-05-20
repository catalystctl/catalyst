-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "role" TEXT,
    "banned" BOOLEAN NOT NULL DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "username" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastFailedLogin" TIMESTAMP(3),
    "lastSuccessfulLogin" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "impersonatedBy" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jwks" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aaguid" TEXT,

    CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "twoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "userId" TEXT NOT NULL,

    CONSTRAINT "twoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apikey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "start" TEXT,
    "prefix" TEXT,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refillInterval" INTEGER,
    "refillAmount" INTEGER,
    "lastRefillAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rateLimitTimeWindow" INTEGER NOT NULL DEFAULT 60000,
    "rateLimitMax" INTEGER NOT NULL DEFAULT 100,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "remaining" INTEGER,
    "lastRequest" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "allPermissions" BOOLEAN NOT NULL DEFAULT false,
    "permissions" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apikey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerRole" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerAccessInvite" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "permissions" TEXT[],
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "ServerAccessInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeAssignment" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT,
    "userId" TEXT,
    "roleId" TEXT,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "smtpHost" TEXT,
    "smtpPort" INTEGER,
    "smtpUsername" TEXT,
    "smtpPassword" TEXT,
    "smtpFrom" TEXT,
    "smtpReplyTo" TEXT,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpRequireTls" BOOLEAN NOT NULL DEFAULT false,
    "smtpPool" BOOLEAN NOT NULL DEFAULT false,
    "smtpMaxConnections" INTEGER,
    "smtpMaxMessages" INTEGER,
    "curseforgeApiKey" TEXT,
    "modrinthApiKey" TEXT,
    "authRateLimitMax" INTEGER,
    "fileRateLimitMax" INTEGER,
    "consoleRateLimitMax" INTEGER,
    "consoleOutputLinesMax" INTEGER,
    "consoleOutputByteLimitBytes" INTEGER,
    "agentMessageMax" INTEGER,
    "agentMetricsMax" INTEGER,
    "serverMetricsMax" INTEGER,
    "lockoutMaxAttempts" INTEGER,
    "lockoutWindowMinutes" INTEGER,
    "lockoutDurationMinutes" INTEGER,
    "auditRetentionDays" INTEGER,
    "maxBufferMb" INTEGER,
    "authRateLimitWindowMs" INTEGER,
    "fileRateLimitWindowMs" INTEGER,
    "consoleRateLimitWindowMs" INTEGER,
    "fileTunnelRateLimitWindowMs" INTEGER,
    "fileTunnelRateLimitMax" INTEGER,
    "fileTunnelMaxUploadMb" INTEGER,
    "fileTunnelMaxPendingPerNode" INTEGER,
    "fileTunnelConcurrentMax" INTEGER,
    "requireEmailVerification" BOOLEAN NOT NULL DEFAULT true,
    "dnsProvider" TEXT,
    "dnsBaseDomain" TEXT,
    "dnsCloudflareApiToken" TEXT,
    "dnsCloudflareZoneId" TEXT,
    "dnsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ThemeSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "panelName" TEXT NOT NULL DEFAULT 'Catalyst',
    "logoUrl" TEXT,
    "faviconUrl" TEXT,
    "defaultTheme" TEXT NOT NULL DEFAULT 'dark',
    "enabledThemes" TEXT[] DEFAULT ARRAY['light', 'dark']::TEXT[],
    "customCss" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#3b82f6',
    "secondaryColor" TEXT NOT NULL DEFAULT '#8b5cf6',
    "accentColor" TEXT NOT NULL DEFAULT '#06b6d4',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ThemeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Node" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "serverDataDir" TEXT NOT NULL DEFAULT '/var/lib/catalyst/servers',
    "consoleLogDir" TEXT,
    "cniDir" TEXT,
    "cniBinDir" TEXT,
    "cniDataDir" TEXT,
    "cniResultsDir" TEXT,
    "cniBridgeName" TEXT,
    "cniBridgeSubnet" TEXT,
    "systemdOverrideDir" TEXT,
    "agentConfigPath" TEXT,
    "agentReleaseRepo" TEXT,
    "locationId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "publicAddress" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "maxMemoryMb" INTEGER NOT NULL,
    "maxCpuCores" INTEGER NOT NULL,
    "sftpPort" INTEGER NOT NULL DEFAULT 2022,
    "sftpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "memoryOverallocatePercent" INTEGER NOT NULL DEFAULT 0,
    "cpuOverallocatePercent" INTEGER NOT NULL DEFAULT 0,
    "agentVersion" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Node_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpPool" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "networkName" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "gateway" TEXT,
    "startIp" TEXT,
    "endIp" TEXT,
    "reserved" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IpPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpAllocation" (
    "id" TEXT NOT NULL,
    "poolId" TEXT NOT NULL,
    "serverId" TEXT,
    "ip" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "IpAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeAllocation" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "serverId" TEXT,
    "ip" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "alias" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NodeAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeploymentToken" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeploymentToken_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ServerTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "author" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "images" JSONB NOT NULL DEFAULT '[]',
    "defaultImage" TEXT,
    "installImage" TEXT,
    "installEntrypoint" TEXT NOT NULL DEFAULT 'bash',
    "startup" TEXT NOT NULL,
    "stopCommand" TEXT NOT NULL,
    "sendSignalTo" TEXT NOT NULL DEFAULT 'SIGTERM',
    "variables" JSONB NOT NULL,
    "installScript" TEXT,
    "supportedPorts" INTEGER[],
    "allocatedMemoryMb" INTEGER NOT NULL,
    "allocatedCpuCores" INTEGER NOT NULL,
    "features" JSONB NOT NULL DEFAULT '{}',
    "nestId" TEXT,
    "srvService" TEXT,
    "srvProtocol" TEXT NOT NULL DEFAULT 'tcp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Server" (
    "id" TEXT NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "templateId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "suspendedAt" TIMESTAMP(3),
    "suspendedByUserId" TEXT,
    "suspensionReason" TEXT,
    "allocatedMemoryMb" INTEGER NOT NULL,
    "allocatedCpuCores" INTEGER NOT NULL,
    "allocatedDiskMb" INTEGER NOT NULL DEFAULT 10240,
    "allocatedSwapMb" INTEGER NOT NULL DEFAULT 0,
    "ioWeight" INTEGER NOT NULL DEFAULT 500,
    "containerId" TEXT,
    "containerName" TEXT,
    "networkMode" TEXT NOT NULL DEFAULT 'bridge',
    "primaryPort" INTEGER NOT NULL,
    "primaryIp" TEXT,
    "subdomain" TEXT,
    "portBindings" JSONB NOT NULL DEFAULT '{}',
    "environment" JSONB NOT NULL DEFAULT '{}',
    "startupCommand" TEXT,
    "backupStorageMode" TEXT NOT NULL DEFAULT 'local',
    "backupRetentionCount" INTEGER NOT NULL DEFAULT 0,
    "backupRetentionDays" INTEGER NOT NULL DEFAULT 0,
    "backupAllocationMb" INTEGER NOT NULL DEFAULT 0,
    "databaseAllocation" INTEGER NOT NULL DEFAULT 0,
    "backupS3Config" JSONB NOT NULL DEFAULT '{}',
    "backupSftpConfig" JSONB NOT NULL DEFAULT '{}',
    "restartPolicy" TEXT NOT NULL DEFAULT 'on-failure',
    "crashCount" INTEGER NOT NULL DEFAULT 0,
    "maxCrashCount" INTEGER NOT NULL DEFAULT 5,
    "lastCrashAt" TIMESTAMP(3),
    "lastExitCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Server_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstalledMod" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'mod',
    "provider" TEXT NOT NULL,
    "game" TEXT,
    "projectId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "projectName" TEXT,
    "latestVersionId" TEXT,
    "latestVersionName" TEXT,
    "updateCheckedAt" TIMESTAMP(3),
    "hasUpdate" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstalledMod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseHost" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 3306,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "engine" TEXT NOT NULL DEFAULT 'mysql',
    "database" TEXT NOT NULL DEFAULT 'postgres',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseHost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerDatabase" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerDatabase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "storageMode" TEXT NOT NULL DEFAULT 'local',
    "sizeMb" DOUBLE PRECISION NOT NULL,
    "compressed" BOOLEAN NOT NULL DEFAULT true,
    "checksum" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledTask" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "schedule" TEXT NOT NULL,
    "timeOffset" INTEGER NOT NULL DEFAULT 0,
    "sequenceId" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerLog" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "stream" TEXT NOT NULL DEFAULT 'stdout',
    "data" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthLockout" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "userAgent" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "firstFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFailedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthLockout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "details" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemError" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "metadata" JSONB,
    "requestId" TEXT,
    "userId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemError_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ServerMetrics" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memoryUsageMb" INTEGER NOT NULL,
    "networkRxBytes" BIGINT NOT NULL,
    "networkTxBytes" BIGINT NOT NULL,
    "diskIoMb" INTEGER NOT NULL DEFAULT 0,
    "diskUsageMb" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NodeMetrics" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "cpuPercent" DOUBLE PRECISION NOT NULL,
    "memoryUsageMb" INTEGER NOT NULL,
    "memoryTotalMb" INTEGER NOT NULL,
    "diskUsageMb" INTEGER NOT NULL,
    "diskTotalMb" INTEGER NOT NULL,
    "networkRxBytes" BIGINT NOT NULL,
    "networkTxBytes" BIGINT NOT NULL,
    "containerCount" INTEGER NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NodeMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "userId" TEXT,
    "serverId" TEXT,
    "nodeId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "targetId" TEXT,
    "userId" TEXT,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDelivery" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plugin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plugin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginStorage" (
    "id" TEXT NOT NULL,
    "pluginName" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginStorage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceUrl" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "bypassToken" TEXT,
    "currentPhase" TEXT,
    "progress" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MigrationStep" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "sourceId" TEXT,
    "targetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "durationMs" INTEGER,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "MigrationStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginActionAudit" (
    "id" TEXT NOT NULL,
    "pluginName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "userId" TEXT,
    "ipAddress" TEXT,
    "duration" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PluginActionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginCollectionItem" (
    "id" TEXT NOT NULL,
    "pluginName" TEXT NOT NULL,
    "collectionName" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "document" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginCollectionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RoleToUser" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_RoleToUser_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "passkey_userId_idx" ON "passkey"("userId");

-- CreateIndex
CREATE INDEX "passkey_credentialID_idx" ON "passkey"("credentialID");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "verification_expiresAt_idx" ON "verification"("expiresAt");

-- CreateIndex
CREATE INDEX "verification_value_idx" ON "verification"("value");

-- CreateIndex
CREATE INDEX "twoFactor_userId_idx" ON "twoFactor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "apikey_key_key" ON "apikey"("key");

-- CreateIndex
CREATE INDEX "apikey_userId_idx" ON "apikey"("userId");

-- CreateIndex
CREATE INDEX "apikey_key_idx" ON "apikey"("key");

-- CreateIndex
CREATE INDEX "apikey_expiresAt_idx" ON "apikey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ServerRole_serverId_roleId_key" ON "ServerRole"("serverId", "roleId");

-- CreateIndex
CREATE INDEX "ServerAccess_serverId_userId_idx" ON "ServerAccess"("serverId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ServerAccess_userId_serverId_key" ON "ServerAccess"("userId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "ServerAccessInvite_token_key" ON "ServerAccessInvite"("token");

-- CreateIndex
CREATE INDEX "ServerAccessInvite_serverId_email_idx" ON "ServerAccessInvite"("serverId", "email");

-- CreateIndex
CREATE INDEX "ServerAccessInvite_expiresAt_idx" ON "ServerAccessInvite"("expiresAt");

-- CreateIndex
CREATE INDEX "ServerAccessInvite_serverId_idx" ON "ServerAccessInvite"("serverId");

-- CreateIndex
CREATE INDEX "NodeAssignment_userId_idx" ON "NodeAssignment"("userId");

-- CreateIndex
CREATE INDEX "NodeAssignment_roleId_idx" ON "NodeAssignment"("roleId");

-- CreateIndex
CREATE INDEX "NodeAssignment_nodeId_expiresAt_idx" ON "NodeAssignment"("nodeId", "expiresAt");

-- CreateIndex
CREATE INDEX "NodeAssignment_userId_nodeId_idx" ON "NodeAssignment"("userId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeAssignment_nodeId_userId_key" ON "NodeAssignment"("nodeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeAssignment_nodeId_roleId_key" ON "NodeAssignment"("nodeId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_name_key" ON "Location"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Node_name_key" ON "Node"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Node_secret_key" ON "Node"("secret");

-- CreateIndex
CREATE UNIQUE INDEX "IpPool_nodeId_networkName_key" ON "IpPool"("nodeId", "networkName");

-- CreateIndex
CREATE UNIQUE INDEX "IpAllocation_serverId_key" ON "IpAllocation"("serverId");

-- CreateIndex
CREATE INDEX "IpAllocation_serverId_idx" ON "IpAllocation"("serverId");

-- CreateIndex
CREATE INDEX "IpAllocation_poolId_releasedAt_idx" ON "IpAllocation"("poolId", "releasedAt");

-- CreateIndex
CREATE INDEX "IpAllocation_poolId_ip_idx" ON "IpAllocation"("poolId", "ip");

-- CreateIndex
CREATE UNIQUE INDEX "IpAllocation_poolId_ip_key" ON "IpAllocation"("poolId", "ip");

-- CreateIndex
CREATE INDEX "NodeAllocation_serverId_idx" ON "NodeAllocation"("serverId");

-- CreateIndex
CREATE INDEX "NodeAllocation_nodeId_serverId_idx" ON "NodeAllocation"("nodeId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "NodeAllocation_nodeId_ip_port_key" ON "NodeAllocation"("nodeId", "ip", "port");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentToken_token_key" ON "DeploymentToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "DeploymentToken_secret_key" ON "DeploymentToken"("secret");

-- CreateIndex
CREATE INDEX "DeploymentToken_nodeId_idx" ON "DeploymentToken"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Nest_name_key" ON "Nest"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ServerTemplate_name_key" ON "ServerTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Server_uuid_key" ON "Server"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Server_subdomain_key" ON "Server"("subdomain");

-- CreateIndex
CREATE INDEX "Server_status_idx" ON "Server"("status");

-- CreateIndex
CREATE INDEX "Server_nodeId_idx" ON "Server"("nodeId");

-- CreateIndex
CREATE INDEX "Server_ownerId_idx" ON "Server"("ownerId");

-- CreateIndex
CREATE INDEX "Server_locationId_idx" ON "Server"("locationId");

-- CreateIndex
CREATE INDEX "Server_templateId_idx" ON "Server"("templateId");

-- CreateIndex
CREATE INDEX "Server_status_nodeId_idx" ON "Server"("status", "nodeId");

-- CreateIndex
CREATE INDEX "InstalledMod_serverId_type_idx" ON "InstalledMod"("serverId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "InstalledMod_serverId_filename_key" ON "InstalledMod"("serverId", "filename");

-- CreateIndex
CREATE UNIQUE INDEX "DatabaseHost_name_key" ON "DatabaseHost"("name");

-- CreateIndex
CREATE INDEX "ServerDatabase_serverId_idx" ON "ServerDatabase"("serverId");

-- CreateIndex
CREATE UNIQUE INDEX "ServerDatabase_hostId_name_key" ON "ServerDatabase"("hostId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ServerDatabase_hostId_username_key" ON "ServerDatabase"("hostId", "username");

-- CreateIndex
CREATE INDEX "Backup_serverId_createdAt_idx" ON "Backup"("serverId", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledTask_serverId_enabled_idx" ON "ScheduledTask"("serverId", "enabled");

-- CreateIndex
CREATE INDEX "ScheduledTask_enabled_nextRunAt_idx" ON "ScheduledTask"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "ServerLog_serverId_timestamp_idx" ON "ServerLog"("serverId", "timestamp");

-- CreateIndex
CREATE INDEX "ServerLog_timestamp_idx" ON "ServerLog"("timestamp");

-- CreateIndex
CREATE INDEX "AuthLockout_email_idx" ON "AuthLockout"("email");

-- CreateIndex
CREATE INDEX "AuthLockout_lockedUntil_idx" ON "AuthLockout"("lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AuthLockout_email_ipAddress_key" ON "AuthLockout"("email", "ipAddress");

-- CreateIndex
CREATE INDEX "AuditLog_userId_timestamp_idx" ON "AuditLog"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_resourceId_timestamp_idx" ON "AuditLog"("resourceId", "timestamp");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");

-- CreateIndex
CREATE INDEX "SystemError_level_createdAt_idx" ON "SystemError"("level", "createdAt");

-- CreateIndex
CREATE INDEX "SystemError_component_createdAt_idx" ON "SystemError"("component", "createdAt");

-- CreateIndex
CREATE INDEX "SystemError_resolved_createdAt_idx" ON "SystemError"("resolved", "createdAt");

-- CreateIndex
CREATE INDEX "SystemError_createdAt_idx" ON "SystemError"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "ServerStat_serverId_createdAt_idx" ON "ServerStat"("serverId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ServerStat_createdAt_idx" ON "ServerStat"("createdAt");

-- CreateIndex
CREATE INDEX "ServerMetrics_serverId_timestamp_idx" ON "ServerMetrics"("serverId", "timestamp");

-- CreateIndex
CREATE INDEX "ServerMetrics_timestamp_idx" ON "ServerMetrics"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "ServerMetrics_serverId_timestamp_key" ON "ServerMetrics"("serverId", "timestamp");

-- CreateIndex
CREATE INDEX "NodeMetrics_nodeId_timestamp_idx" ON "NodeMetrics"("nodeId", "timestamp");

-- CreateIndex
CREATE INDEX "NodeMetrics_timestamp_idx" ON "NodeMetrics"("timestamp");

-- CreateIndex
CREATE INDEX "Alert_serverId_resolved_createdAt_idx" ON "Alert"("serverId", "resolved", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_nodeId_resolved_createdAt_idx" ON "Alert"("nodeId", "resolved", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_type_severity_resolved_idx" ON "Alert"("type", "severity", "resolved");

-- CreateIndex
CREATE INDEX "Alert_ruleId_createdAt_idx" ON "Alert"("ruleId", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_userId_resolved_createdAt_idx" ON "Alert"("userId", "resolved", "createdAt");

-- CreateIndex
CREATE INDEX "AlertRule_enabled_type_idx" ON "AlertRule"("enabled", "type");

-- CreateIndex
CREATE INDEX "AlertRule_target_targetId_idx" ON "AlertRule"("target", "targetId");

-- CreateIndex
CREATE INDEX "AlertRule_userId_createdAt_idx" ON "AlertRule"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertDelivery_alertId_status_idx" ON "AlertDelivery"("alertId", "status");

-- CreateIndex
CREATE INDEX "AlertDelivery_channel_status_idx" ON "AlertDelivery"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Plugin_name_key" ON "Plugin"("name");

-- CreateIndex
CREATE INDEX "Plugin_enabled_idx" ON "Plugin"("enabled");

-- CreateIndex
CREATE INDEX "Plugin_name_enabled_idx" ON "Plugin"("name", "enabled");

-- CreateIndex
CREATE INDEX "PluginStorage_pluginName_idx" ON "PluginStorage"("pluginName");

-- CreateIndex
CREATE UNIQUE INDEX "PluginStorage_pluginName_key_key" ON "PluginStorage"("pluginName", "key");

-- CreateIndex
CREATE INDEX "MigrationStep_jobId_phase_status_idx" ON "MigrationStep"("jobId", "phase", "status");

-- CreateIndex
CREATE INDEX "MigrationStep_jobId_status_idx" ON "MigrationStep"("jobId", "status");

-- CreateIndex
CREATE INDEX "PluginActionAudit_pluginName_createdAt_idx" ON "PluginActionAudit"("pluginName", "createdAt");

-- CreateIndex
CREATE INDEX "PluginActionAudit_action_createdAt_idx" ON "PluginActionAudit"("action", "createdAt");

-- CreateIndex
CREATE INDEX "PluginCollectionItem_pluginName_collectionName_idx" ON "PluginCollectionItem"("pluginName", "collectionName");

-- CreateIndex
CREATE INDEX "PluginCollectionItem_pluginName_collectionName_docId_idx" ON "PluginCollectionItem"("pluginName", "collectionName", "docId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginCollectionItem_pluginName_collectionName_docId_key" ON "PluginCollectionItem"("pluginName", "collectionName", "docId");

-- CreateIndex
CREATE INDEX "_RoleToUser_B_index" ON "_RoleToUser"("B");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apikey" ADD CONSTRAINT "apikey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerRole" ADD CONSTRAINT "ServerRole_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerRole" ADD CONSTRAINT "ServerRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerAccess" ADD CONSTRAINT "ServerAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerAccess" ADD CONSTRAINT "ServerAccess_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerAccessInvite" ADD CONSTRAINT "ServerAccessInvite_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerAccessInvite" ADD CONSTRAINT "ServerAccessInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeAssignment" ADD CONSTRAINT "NodeAssignment_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeAssignment" ADD CONSTRAINT "NodeAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeAssignment" ADD CONSTRAINT "NodeAssignment_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Node" ADD CONSTRAINT "Node_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpPool" ADD CONSTRAINT "IpPool_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAllocation" ADD CONSTRAINT "IpAllocation_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "IpPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IpAllocation" ADD CONSTRAINT "IpAllocation_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeAllocation" ADD CONSTRAINT "NodeAllocation_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeAllocation" ADD CONSTRAINT "NodeAllocation_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeploymentToken" ADD CONSTRAINT "DeploymentToken_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerTemplate" ADD CONSTRAINT "ServerTemplate_nestId_fkey" FOREIGN KEY ("nestId") REFERENCES "Nest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ServerTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Server" ADD CONSTRAINT "Server_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstalledMod" ADD CONSTRAINT "InstalledMod_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerDatabase" ADD CONSTRAINT "ServerDatabase_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerDatabase" ADD CONSTRAINT "ServerDatabase_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "DatabaseHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledTask" ADD CONSTRAINT "ScheduledTask_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerLog" ADD CONSTRAINT "ServerLog_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerStat" ADD CONSTRAINT "ServerStat_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerMetrics" ADD CONSTRAINT "ServerMetrics_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeMetrics" ADD CONSTRAINT "NodeMetrics_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AlertRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertRule" ADD CONSTRAINT "AlertRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertDelivery" ADD CONSTRAINT "AlertDelivery_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginStorage" ADD CONSTRAINT "PluginStorage_pluginName_fkey" FOREIGN KEY ("pluginName") REFERENCES "Plugin"("name") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MigrationStep" ADD CONSTRAINT "MigrationStep_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "MigrationJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoleToUser" ADD CONSTRAINT "_RoleToUser_A_fkey" FOREIGN KEY ("A") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoleToUser" ADD CONSTRAINT "_RoleToUser_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

