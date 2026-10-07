/**
 * Route-contract suite fixtures — real dev-DB personas + one shared Tier-1
 * resource chain (test-plan.md §4, P-B pattern from power-access-rbac.test.ts).
 *
 * Personas are real User+Role rows so DB-resolution gates (roles.ts
 * checkPermission, hasNodeAccess, resolveServerPermissions) see the same truth
 * as the injected request.user.permissions. The fixture server is owned by a
 * separate `contract-owner` persona so no assertion persona is an owner.
 */
import { prisma } from '../db.js';
import { nanoid } from 'nanoid';

export interface PersonaInfo {
  userId: string;
  roleId: string;
  perms: string[];
}

export interface ContractFixtures {
  star: PersonaInfo;
  ar: PersonaInfo;
  aw: PersonaInfo;
  pu: PersonaInfo;
  owner: PersonaInfo;
  locationId: string;
  nodeId: string;
  templateId: string;
  serverId: string;
  alertRuleId: string;
  alertId: string;
  taskId: string;
}

const suffix = () => nanoid(8);

async function createPersona(rolePerms: string[], label: string): Promise<PersonaInfo> {
  const role = await prisma.role.create({
    data: { name: `contract-${label}-${suffix()}`, permissions: rolePerms },
  });
  const user = await prisma.user.create({
    data: {
      email: `contract-${label}-${suffix()}@example.com`,
      username: `contract-${label}${nanoid(4)}`,
      name: `contract-${label}`,
      emailVerified: true,
      roles: { connect: { id: role.id } },
    },
  });
  return { userId: user.id, roleId: role.id, perms: rolePerms };
}

export async function provisionContractFixtures(): Promise<ContractFixtures> {
  const star = await createPersona(['*'], 'star');
  const ar = await createPersona(['admin.read'], 'ar');
  const aw = await createPersona(['admin.write'], 'aw');
  const pu = await createPersona([], 'pu');
  const owner = await createPersona([], 'owner');

  const location = await prisma.location.create({
    data: { name: `contract-loc-${suffix()}` },
  });
  const node = await prisma.node.create({
    data: {
      name: `contract-node-${suffix()}`,
      locationId: location.id,
      hostname: 'contract.example.com',
      publicAddress: '10.0.0.9',
      secret: `secret-${nanoid(16)}`,
      maxMemoryMb: 8192,
      maxCpuCores: 4,
      isOnline: true,
    },
  });
  const template = await prisma.serverTemplate.create({
    data: {
      name: `contract-template-${suffix()}`,
      author: 'Contract',
      version: '1.0.0',
      image: 'alpine:latest',
      startup: 'echo contract',
      stopCommand: 'stop',
      supportedPorts: [],
      variables: [],
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
    },
  });
  const server = await prisma.server.create({
    data: {
      uuid: `contract-${nanoid(12)}`,
      name: `contract-server-${suffix()}`,
      templateId: template.id,
      nodeId: node.id,
      locationId: location.id,
      ownerId: owner.userId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      primaryPort: 25580,
      status: 'stopped',
    },
  });

  // Id-scoped subresource fixtures so deny-side personas hit the GATE, not a
  // resource-first 404 (alert rule/alert/task rows).
  const alertRule = await prisma.alertRule.create({
    data: {
      name: `contract-rule-${suffix()}`,
      type: 'resource_threshold',
      target: 'server',
      targetId: server.id,
      userId: owner.userId,
      conditions: { cpuPercent: 90 },
      actions: { webhooks: [] },
    },
  });
  const alert = await prisma.alert.create({
    data: {
      ruleId: alertRule.id,
      serverId: server.id,
      type: 'resource_threshold',
      severity: 'warning',
      title: 'contract alert',
      message: 'contract probe alert',
    },
  });
  const task = await prisma.scheduledTask.create({
    data: {
      serverId: server.id,
      name: 'contract-task',
      action: 'restart',
      schedule: '0 3 * * *',
      enabled: false,
    },
  });

  return {
    star,
    ar,
    aw,
    pu,
    owner,
    locationId: location.id,
    nodeId: node.id,
    templateId: template.id,
    serverId: server.id,
    alertRuleId: alertRule.id,
    alertId: alert.id,
    taskId: task.id,
  };
}

/** Reverse-order teardown (AGENTS.md DB cleanup rules). */
export async function teardownContractFixtures(fx: ContractFixtures): Promise<void> {
  if (fx.alertId) await prisma.alert.delete({ where: { id: fx.alertId } }).catch(() => {});
  if (fx.alertRuleId) {
    await prisma.alert.deleteMany({ where: { ruleId: fx.alertRuleId } }).catch(() => {});
    await prisma.alertRule.delete({ where: { id: fx.alertRuleId } }).catch(() => {});
  }
  if (fx.taskId) await prisma.scheduledTask.delete({ where: { id: fx.taskId } }).catch(() => {});
  if (fx.serverId) {
    await prisma.scheduledTask.deleteMany({ where: { serverId: fx.serverId } }).catch(() => {});
    await prisma.alert.deleteMany({ where: { serverId: fx.serverId } }).catch(() => {});
    await prisma.serverAccess.deleteMany({ where: { serverId: fx.serverId } }).catch(() => {});
    await prisma.server.delete({ where: { id: fx.serverId } }).catch(() => {});
  }
  if (fx.templateId) {
    await prisma.serverTemplate.delete({ where: { id: fx.templateId } }).catch(() => {});
  }
  if (fx.nodeId) {
    await prisma.nodeAssignment.deleteMany({ where: { nodeId: fx.nodeId } }).catch(() => {});
    await prisma.node.delete({ where: { id: fx.nodeId } }).catch(() => {});
  }
  for (const p of [fx.star, fx.ar, fx.aw, fx.pu, fx.owner]) {
    if (p?.userId) await prisma.user.delete({ where: { id: p.userId } }).catch(() => {});
    if (p?.roleId) await prisma.role.delete({ where: { id: p.roleId } }).catch(() => {});
  }
  if (fx.locationId) {
    await prisma.location.delete({ where: { id: fx.locationId } }).catch(() => {});
  }
}

/**
 * Per-row fixture reset: recreate the primary server row (same id) in its
 * baseline state, plus the id-scoped subresource fixtures (alert rule, alert,
 * task) with stable ids. Write-row allow sides legitimately mutate or delete
 * them, and every row must start from the same truth — cascade-order bugs
 * would otherwise masquerade as permission drift.
 */
export async function resetFixtureServer(fx: ContractFixtures): Promise<void> {
  await prisma.scheduledTask.deleteMany({ where: { serverId: fx.serverId } }).catch(() => {});
  await prisma.alert.deleteMany({ where: { serverId: fx.serverId } }).catch(() => {});
  await prisma.alertRule.deleteMany({ where: { targetId: fx.serverId } }).catch(() => {});
  await prisma.serverAccess.deleteMany({ where: { serverId: fx.serverId } }).catch(() => {});
  await prisma.server.delete({ where: { id: fx.serverId } }).catch(() => {});
  await prisma.server.create({
    data: {
      id: fx.serverId,
      uuid: `contract-reset-${nanoid(12)}`,
      name: `contract-server-${suffix()}`,
      templateId: fx.templateId,
      nodeId: fx.nodeId,
      locationId: fx.locationId,
      ownerId: fx.owner.userId,
      allocatedMemoryMb: 512,
      allocatedCpuCores: 1,
      allocatedDiskMb: 1024,
      backupAllocationMb: 512,
      databaseAllocation: 1024,
      primaryPort: 25580,
      status: 'stopped',
    },
  });
  await prisma.alertRule.create({
    data: {
      id: fx.alertRuleId,
      name: 'contract-rule',
      type: 'resource_threshold',
      target: 'server',
      targetId: fx.serverId,
      userId: fx.owner.userId,
      conditions: { cpuPercent: 90 },
      actions: { webhooks: [] },
    },
  }).catch(() => {});
  await prisma.alert.create({
    data: {
      id: fx.alertId,
      ruleId: fx.alertRuleId,
      serverId: fx.serverId,
      type: 'resource_threshold',
      severity: 'warning',
      title: 'contract alert',
      message: 'contract probe alert',
    },
  }).catch(() => {});
  await prisma.scheduledTask.create({
    data: {
      id: fx.taskId,
      serverId: fx.serverId,
      name: 'contract-task',
      action: 'restart',
      schedule: '0 3 * * *',
      enabled: false,
    },
  }).catch(() => {});
}
