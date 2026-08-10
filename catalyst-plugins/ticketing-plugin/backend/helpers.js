/**
 * Pure helpers + collection helpers for the ticketing plugin.
 * Kept free of route registration so onEnable jobs can reuse them.
 */

import { randomBytes } from 'crypto';
import {
  PRIORITY_WEIGHT,
  TICKET_NUMBER_CHARS,
} from './constants.js';

/** Resolve a plugin config value, unwrapping schema objects `{ default: … }`. */
export function cfg(context, key, fallback) {
  try {
    const val = context.getConfig(key);
    if (val === undefined || val === null) return fallback;
    if (typeof val === 'object' && !Array.isArray(val) && 'default' in val) {
      return val.default ?? fallback;
    }
    return val;
  } catch {
    return fallback;
  }
}

/** Host auth sets `request.user.userId` (not `.id`). */
export function getUserId(request) {
  return request?.user?.userId || request?.user?.id || null;
}

export function generateId() {
  return Date.now().toString(36) + randomBytes(4).toString('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

/** Normalize collection docs so the frontend always sees `id`. */
export function normalizeId(doc) {
  if (!doc) return doc;
  const { _id, _createdAt, _updatedAt, ...rest } = doc;
  return {
    ...rest,
    id: _id || doc.id,
    createdAt: rest.createdAt || _createdAt,
    updatedAt: rest.updatedAt || _updatedAt,
  };
}

export function normalizeIds(docs) {
  if (!Array.isArray(docs)) return [];
  return docs.map(normalizeId);
}

export function parsePagination(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize, 10) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export function ok(reply, data, extra = {}) {
  return reply.send({ success: true, data, ...extra });
}

export function fail(reply, error, status = 200) {
  if (status !== 200) reply.status(status);
  return reply.send({ success: false, error });
}

export function buildTicketFilter(query = {}) {
  const filter = { isDeleted: { $ne: true } };

  if (query.status && query.status !== 'all') filter.status = query.status;
  if (query.priority && query.priority !== 'all') filter.priority = query.priority;
  if (query.category && query.category !== 'all') filter.category = query.category;
  if (query.assigneeId === 'unassigned') filter.assigneeId = null;
  else if (query.assigneeId && query.assigneeId !== 'all') filter.assigneeId = query.assigneeId;
  if (query.reporterId && query.reporterId !== 'all') filter.reporterId = query.reporterId;
  if (query.serverId && query.serverId !== 'all') filter.serverId = query.serverId;

  if (query.escalationLevel !== undefined && query.escalationLevel !== '' && query.escalationLevel !== 'all') {
    filter.escalationLevel = parseInt(query.escalationLevel, 10);
  }

  // Note: collection matchFilter does not support dotted nested keys
  // (e.g. sla.resolutionBreached). Overdue is applied client-side in routes.
  if (query.isOverdue === 'true' || query.isOverdue === true) {
    filter.status = { $nin: ['resolved', 'closed'] };
  }

  if (query.tags) {
    const tagArr = String(query.tags).split(',').map((t) => t.trim()).filter(Boolean);
    if (tagArr.length > 0) filter.tags = { $in: tagArr };
  }

  if (query.dateFrom || query.dateTo) {
    filter.createdAt = {};
    if (query.dateFrom) filter.createdAt.$gte = query.dateFrom;
    if (query.dateTo) filter.createdAt.$lte = query.dateTo;
  }

  if (query.search) {
    const regex = { $regex: String(query.search), $options: 'i' };
    filter.$or = [
      { title: regex },
      { description: regex },
      { ticketNumber: regex },
    ];
  }

  return filter;
}

export function buildSort(query = {}) {
  const field = query.sort || 'updatedAt';
  const dir = query.sortDir === 'asc' ? 1 : -1;
  // Priority is sorted client-side (computed weight).
  if (field === 'priority' || field === 'priority_weight') {
    return { createdAt: dir };
  }
  return { [field]: dir };
}

export function sortByPriority(tickets, sortDir = 'desc') {
  return [...tickets].sort((a, b) => {
    const wa = PRIORITY_WEIGHT[a.priority] || 0;
    const wb = PRIORITY_WEIGHT[b.priority] || 0;
    // desc → highest priority first; asc → lowest first
    return sortDir === 'asc' ? wa - wb : wb - wa;
  });
}

export function initSla(settings, context) {
  const now = Date.now();
  const responseHours = settings?.responseSlaHours ?? cfg(context, 'responseSlaHours', 4);
  const resolutionHours = settings?.resolutionSlaHours ?? cfg(context, 'resolutionSlaHours', 48);
  return {
    responseDeadline: new Date(now + responseHours * 3600 * 1000).toISOString(),
    resolutionDeadline: new Date(now + resolutionHours * 3600 * 1000).toISOString(),
    firstResponseAt: null,
    responseBreached: false,
    resolutionBreached: false,
    paused: false,
    pausedAt: null,
    totalPausedMs: 0,
  };
}

export function csvEscape(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// ── Collection-backed domain helpers ────────────────────────────────────────

export async function generateTicketNumber(context) {
  const tickets = context.db.collection('tickets');
  for (let attempt = 0; attempt < 12; attempt++) {
    let code = 'TKT-';
    for (let i = 0; i < 6; i++) {
      code += TICKET_NUMBER_CHARS[Math.floor(Math.random() * TICKET_NUMBER_CHARS.length)];
    }
    const existing = await tickets.findOne({ ticketNumber: code, isDeleted: { $ne: true } });
    if (!existing) return code;
  }
  return `TKT-${randomBytes(4).toString('hex').toUpperCase()}`;
}

export async function createActivity(context, ticketId, type, userId, data = {}) {
  try {
    await context.db.collection('activities').insert({
      ticketId,
      type,
      userId: userId || null,
      data,
      createdAt: nowIso(),
    });
  } catch (err) {
    context.logger.error({ err, ticketId, type }, 'Failed to create activity');
  }
}

export function broadcast(context, event, data) {
  try {
    context.sendWebSocketMessage('*', {
      type: `plugin:ticketing-plugin:${event}`,
      data,
    });
  } catch (err) {
    context.logger.debug({ err, event }, 'WS broadcast failed');
  }
}

/** Fields that exist on the host Prisma models and are safe for plugins. */
export const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  name: true,
  image: true,
};

export const SERVER_SELECT = {
  id: true,
  name: true,
  uuid: true,
  status: true,
};

export async function loadUserMap(context, ids) {
  const map = {};
  const unique = [...new Set([...ids].filter(Boolean))];
  if (unique.length === 0) return map;
  try {
    const users = await context.db.users.findMany({
      where: { id: { in: unique } },
      select: USER_SELECT,
    });
    for (const u of users || []) {
      map[u.id] = {
        id: u.id,
        username: u.username,
        email: u.email,
        name: u.name || u.username,
        image: u.image || null,
      };
    }
  } catch (err) {
    context.logger.debug({ err }, 'Failed to load users for enrichment');
  }
  return map;
}

export async function loadServerMap(context, ids) {
  const map = {};
  const unique = [...new Set([...ids].filter(Boolean))];
  if (unique.length === 0) return map;
  try {
    const servers = await context.db.servers.findMany({
      where: { id: { in: unique } },
      select: SERVER_SELECT,
    });
    for (const s of servers || []) {
      map[s.id] = {
        id: s.id,
        name: s.name || 'Unknown',
        uuid: s.uuid || null,
        status: s.status || 'unknown',
      };
    }
  } catch (err) {
    context.logger.debug({ err }, 'Failed to load servers for enrichment');
  }
  return map;
}

export async function enrichTickets(context, tickets) {
  if (!tickets?.length) return [];
  const userIds = new Set();
  const serverIds = new Set();
  for (const t of tickets) {
    if (t.assigneeId) userIds.add(t.assigneeId);
    if (t.reporterId) userIds.add(t.reporterId);
    if (t.serverId) serverIds.add(t.serverId);
  }
  const [userMap, serverMap] = await Promise.all([
    loadUserMap(context, userIds),
    loadServerMap(context, serverIds),
  ]);
  return normalizeIds(tickets).map((t) => ({
    ...t,
    assignee: t.assigneeId ? userMap[t.assigneeId] || null : null,
    reporter: t.reporterId ? userMap[t.reporterId] || null : null,
    server: t.serverId ? serverMap[t.serverId] || null : null,
  }));
}

export async function enrichComments(context, comments) {
  if (!comments?.length) return [];
  const userMap = await loadUserMap(
    context,
    comments.map((c) => c.authorId),
  );
  return normalizeIds(comments).map((c) => ({
    ...c,
    author: c.authorId ? userMap[c.authorId] || null : null,
  }));
}

export async function enrichActivities(context, activities) {
  if (!activities?.length) return [];
  const userMap = await loadUserMap(
    context,
    activities.map((a) => a.userId),
  );
  return normalizeIds(activities).map((a) => ({
    ...a,
    user: a.userId ? userMap[a.userId] || null : null,
  }));
}

export async function getSettings(context) {
  const col = context.db.collection('plugin_settings');
  let doc = await col.findOne({ _type: 'ticketing_settings' });
  if (!doc) {
    const defaults = {
      _type: 'ticketing_settings',
      autoAssignEnabled: cfg(context, 'autoAssignEnabled', false),
      autoCloseDays: cfg(context, 'autoCloseDays', 30),
      defaultPriority: cfg(context, 'defaultPriority', 'medium'),
      defaultCategory: cfg(context, 'defaultCategory', 'Support'),
      responseSlaHours: cfg(context, 'responseSlaHours', 4),
      resolutionSlaHours: cfg(context, 'resolutionSlaHours', 48),
      maxEscalationLevel: cfg(context, 'maxEscalationLevel', 3),
      updatedAt: nowIso(),
    };
    doc = await col.insert(defaults);
  }
  return normalizeId(doc);
}

/** Least-loaded open-ticket assignee, or null when disabled / unavailable. */
export async function autoAssign(context) {
  if (!cfg(context, 'autoAssignEnabled', false)) return null;
  try {
    const users = await context.db.users.findMany({ select: USER_SELECT });
    if (!users?.length) return null;

    const openTickets = await context.db.collection('tickets').find({
      status: { $in: ['open', 'in_progress'] },
      isDeleted: { $ne: true },
    });

    const countMap = Object.fromEntries(users.map((u) => [u.id, 0]));
    for (const t of openTickets || []) {
      if (t.assigneeId && countMap[t.assigneeId] !== undefined) {
        countMap[t.assigneeId]++;
      }
    }

    let bestUser = null;
    let minCount = Infinity;
    for (const [userId, count] of Object.entries(countMap)) {
      if (count < minCount) {
        minCount = count;
        bestUser = userId;
      }
    }
    return bestUser;
  } catch (err) {
    context.logger.debug({ err }, 'autoAssign failed');
    return null;
  }
}

/**
 * Apply a partial update to a ticket document using `$set` so nested fields
 * (like `sla`) are replaced correctly rather than partially merged as dotted keys.
 */
export async function updateTicketDoc(context, ticketId, patch) {
  const tickets = context.db.collection('tickets');
  const set = { ...patch, updatedAt: nowIso() };
  await tickets.update({ _id: ticketId }, { $set: set });
  return tickets.findOne({ _id: ticketId });
}
