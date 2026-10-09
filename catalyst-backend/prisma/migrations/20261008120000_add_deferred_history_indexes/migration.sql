-- Additive indexes for deferred history/pagination query paths:
-- scheduled-task and alert-delivery history ordering, alert duplicate checks,
-- and failed-delivery retry selection. Keep these indexes until production
-- query plans and write overhead have been checked on representative data.

-- CreateIndex
CREATE INDEX "ScheduledTask_serverId_createdAt_idx"
  ON "ScheduledTask"("serverId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Alert_serverId_type_resolved_createdAt_idx"
  ON "Alert"("serverId", "type", "resolved", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_nodeId_type_resolved_createdAt_idx"
  ON "Alert"("nodeId", "type", "resolved", "createdAt");

-- CreateIndex
CREATE INDEX "AlertDelivery_alertId_createdAt_idx"
  ON "AlertDelivery"("alertId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AlertDelivery_status_attempts_lastAttemptAt_id_idx"
  ON "AlertDelivery"("status", "attempts", "lastAttemptAt", "id");
