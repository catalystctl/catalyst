// ─────────────────────────────────────────────────────────────────────────────
// Catalyst Ticketing Plugin — Backend v2.0.0
// ─────────────────────────────────────────────────────────────────────────────

import { createHash, randomBytes } from 'crypto';

// ── Constants ────────────────────────────────────────────────────────────────

const STATUSES = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
const STATUS_TRANSITIONS = {
  open: ['in_progress', 'pending', 'closed'],
  in_progress: ['pending', 'resolved', 'open'],
  pending: ['in_progress', 'resolved', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};
const PRIORITIES = ['critical', 'high', 'medium', 'low', 'minimal'];
const PRIORITY_WEIGHT = { critical: 5, high: 4, medium: 3, low: 2, minimal: 1 };
const CATEGORIES = [
  'Bug Report', 'Feature Request', 'Support', 'Billing',
  'Infrastructure', 'Security', 'Documentation', 'Other',
];
const ACTIVITY_TYPES = [
  'created', 'updated', 'deleted', 'status_changed', 'assigned',
  'unassigned', 'comment_added', 'comment_edited', 'comment_deleted',
  'priority_changed', 'category_changed', 'tag_added', 'tag_removed',
  'escalated', 'deescalated', 'sla_breached', 'merged', 'bulk_updated',
];

// ── Plugin Exports ───────────────────────────────────────────────────────────

export default {
  async onLoad(context) {
    // ── Helper: read config (unwrap schema objects) ──
    const cfg = (key, fallback) => {
      try {
        const val = context.getConfig(key);
        if (val === undefined || val === null) return fallback;
        if (typeof val === 'object' && val.default !== undefined) return val.default;
        return val;
      } catch { return fallback; }
    };

    // ── Helper: generate ID ──
    const generateId = () => Date.now().toString(36) + randomBytes(4).toString('hex');

    // ── Helper: generate ticket number ──
    const generateTicketNumber = async () => {
      const tickets = context.db.collection('tickets');
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      for (let attempt = 0; attempt < 10; attempt++) {
        let code = '';
        for (let i = 0; i < 6; i++) {
          code += chars[Math.floor(Math.random() * chars.length)];
        }
        const existing = await tickets.findOne({ ticketNumber: code, isDeleted: { $ne: true } });
        if (!existing) return code;
      }
      // Fallback
      return randomBytes(4).toString('hex').toUpperCase();
    };

    // ── Helper: enrich tickets with user/server data ──
    const enrichTickets = async (tickets) => {
      if (!tickets || tickets.length === 0) return tickets;
      const ids = new Set();
      tickets.forEach(t => {
        if (t.assigneeId) ids.add(t.assigneeId);
        if (t.reporterId) ids.add(t.reporterId);
        if (t.serverId) ids.add(t.serverId);
      });
      const userMap = {};
      const serverMap = {};
      try {
        const users = await context.db.users.findMany({ where: { id: { in: [...ids] } } });
        users.forEach(u => { userMap[u.id] = u; });
      } catch { /* read-only may not support findMany with where */ }
      try {
        const servers = await context.db.servers.findMany({ where: { id: { in: [...ids] } } });
        servers.forEach(s => { serverMap[s.id] = s; });
      } catch {}
      return tickets.map(t => ({
        ...t,
        assignee: t.assigneeId ? userMap[t.assigneeId] || null : null,
        reporter: t.reporterId ? userMap[t.reporterId] || null : null,
        server: t.serverId ? serverMap[t.serverId] || null : null,
      }));
    };

    // ── Helper: enrich comments ──
    const enrichComments = async (comments) => {
      if (!comments || comments.length === 0) return comments;
      const ids = new Set(comments.map(c => c.authorId).filter(Boolean));
      const userMap = {};
      try {
        const users = await context.db.users.findMany({ where: { id: { in: [...ids] } } });
        users.forEach(u => { userMap[u.id] = u; });
      } catch {}
      return comments.map(c => ({
        ...c,
        author: c.authorId ? userMap[c.authorId] || null : null,
      }));
    };

    // ── Helper: enrich activities ──
    const enrichActivities = async (activities) => {
      if (!activities || activities.length === 0) return activities;
      const ids = new Set(activities.map(a => a.userId).filter(Boolean));
      const userMap = {};
      try {
        const users = await context.db.users.findMany({ where: { id: { in: [...ids] } } });
        users.forEach(u => { userMap[u.id] = u; });
      } catch {}
      return activities.map(a => ({
        ...a,
        user: a.userId ? userMap[a.userId] || null : null,
      }));
    };

    // ── Helper: create activity ──
    const createActivity = async (ticketId, type, userId, data = {}) => {
      const activities = context.db.collection('activities');
      try {
        await activities.insert({
          ticketId,
          type,
          userId,
          data,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        context.logger.error({ err }, 'Failed to create activity');
      }
    };

    // ── Helper: init SLA ──
    const initSla = (settings) => {
      const now = new Date();
      const responseHours = settings?.responseSlaHours ?? cfg('responseSlaHours', 4);
      const resolutionHours = settings?.resolutionSlaHours ?? cfg('resolutionSlaHours', 48);
      const responseDeadline = new Date(now.getTime() + responseHours * 3600 * 1000);
      const resolutionDeadline = new Date(now.getTime() + resolutionHours * 3600 * 1000);
      return {
        responseDeadline: responseDeadline.toISOString(),
        resolutionDeadline: resolutionDeadline.toISOString(),
        firstResponseAt: null,
        responseBreached: false,
        resolutionBreached: false,
        paused: false,
        pausedAt: null,
        totalPausedMs: 0,
      };
    };

    // ── Helper: broadcast WebSocket ──
    const broadcast = (event, data) => {
      try {
        context.sendWebSocketMessage('*', {
          type: `plugin:ticketing-plugin:${event}`,
          data,
        });
      } catch {}
    };

    // ── Helper: parse pagination ──
    const parsePagination = (query) => {
      const page = Math.max(1, parseInt(query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize) || 25));
      return { page, pageSize, skip: (page - 1) * pageSize };
    };

    // ── Helper: build ticket filter ──
    const buildTicketFilter = (query) => {
      const filter = {};
      if (filter.isDeleted === undefined) filter.isDeleted = { $ne: true };

      if (query.status && query.status !== 'all') filter.status = query.status;
      if (query.priority && query.priority !== 'all') filter.priority = query.priority;
      if (query.category && query.category !== 'all') filter.category = query.category;
      if (query.assigneeId) filter.assigneeId = query.assigneeId;
      if (query.reporterId) filter.reporterId = query.reporterId;
      if (query.serverId) filter.serverId = query.serverId;
      if (query.escalationLevel !== undefined && query.escalationLevel !== '') {
        filter.escalationLevel = parseInt(query.escalationLevel);
      }
      if (query.isOverdue === 'true') {
        filter['sla.resolutionBreached'] = true;
        filter.status = { $nin: ['resolved', 'closed'] };
      }
      if (query.search) {
        const regex = { $regex: query.search, $options: 'i' };
        filter.$or = [{ title: regex }, { description: regex }, { ticketNumber: { $regex: query.search, $options: 'i' } }];
      }
      if (query.dateFrom) {
        filter.createdAt = { ...filter.createdAt, $gte: query.dateFrom };
      }
      if (query.dateTo) {
        filter.createdAt = { ...filter.createdAt, $lte: query.dateTo };
      }
      if (query.tags) {
        const tagArr = query.tags.split(',').filter(Boolean);
        if (tagArr.length > 0) {
          filter.tags = { $in: tagArr };
        }
      }
      return filter;
    };

    // ── Helper: build sort options ──
    const buildSort = (query) => {
      const field = query.sort || 'createdAt';
      const dir = query.sortDir === 'asc' ? 1 : -1;
      if (field === 'priority') {
        // Sort by priority weight — collection API doesn't support computed fields
        // We'll sort client-side for priority
        return { createdAt: dir };
      }
      if (field === 'ticketNumber') {
        return { ticketNumber: dir };
      }
      return { [field]: dir };
    };

    // ── Helper: normalize _id → id for frontend ──
    const normalizeId = (doc) => {
      if (!doc) return doc;
      const { _id, _createdAt, _updatedAt, ...rest } = doc;
      return {
        ...rest,
        id: _id || doc.id,
        // Ensure createdAt/updatedAt exist (prefer body fields over collection metadata)
        createdAt: rest.createdAt || _createdAt,
        updatedAt: rest.updatedAt || _updatedAt,
      };
    };

    const normalizeIds = (docs) => {
      if (!docs || !Array.isArray(docs)) return docs;
      return docs.map(normalizeId);
    };

    // ── Helper: auto-assign ──
    const autoAssign = async () => {
      if (!cfg('autoAssignEnabled', false)) return null;
      try {
        const users = await context.db.users.findMany({});
        if (!users || users.length === 0) return null;

        const tickets = context.db.collection('tickets');
        const openTickets = await tickets.find({
          status: { $in: ['open', 'in_progress'] },
          isDeleted: { $ne: true },
        });

        // Count tickets per user
        const countMap = {};
        users.forEach(u => { countMap[u.id] = 0; });
        (openTickets || []).forEach(t => {
          if (t.assigneeId && countMap[t.assigneeId] !== undefined) {
            countMap[t.assigneeId]++;
          }
        });

        // Find user with fewest tickets
        let minCount = Infinity;
        let bestUser = null;
        for (const [userId, count] of Object.entries(countMap)) {
          if (count < minCount) {
            minCount = count;
            bestUser = userId;
          }
        }
        return bestUser;
      } catch {
        return null;
      }
    };

    // ── Helper: get or init settings ──
    const getSettings = async () => {
      const settings = context.db.collection('plugin_settings');
      let doc = await settings.findOne({ _type: 'ticketing_settings' });
      if (!doc) {
        const defaults = {
          _type: 'ticketing_settings',
          autoAssignEnabled: cfg('autoAssignEnabled', false),
          autoCloseDays: cfg('autoCloseDays', 30),
          defaultPriority: cfg('defaultPriority', 'medium'),
          defaultCategory: cfg('defaultCategory', 'Support'),
          responseSlaHours: cfg('responseSlaHours', 4),
          resolutionSlaHours: cfg('resolutionSlaHours', 48),
          maxEscalationLevel: cfg('maxEscalationLevel', 3),
        };
        await settings.insert(defaults);
        return defaults;
      }
      return doc;
    };

    // ── Helper: CSV escape ──
    const csvEscape = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ROUTES
    // ═══════════════════════════════════════════════════════════════════════════

    // ── GET /tickets ──
    context.registerRoute({
      method: 'GET',
      url: 'tickets',
      handler: async (request, reply) => {
        try {
          const tickets = context.db.collection('tickets');
          const { page, pageSize, skip } = parsePagination(request.query);
          const filter = buildTicketFilter(request.query);
          const sort = buildSort(request.query);

          // "My tickets" filter
          if (request.query.myTickets === 'true' && request.user?.id) {
            filter.$or = [
              { assigneeId: request.user.id },
              { reporterId: request.user.id },
            ];
            if (request.query.search) {
              // Keep search too
              const regex = { $regex: request.query.search, $options: 'i' };
              filter.$and = [
                { $or: [{ assigneeId: request.user.id }, { reporterId: request.user.id }] },
                { $or: [{ title: regex }, { description: regex }] },
              ];
              delete filter.$or;
            }
          }

          const [results, countResult] = await Promise.all([
            tickets.find(filter, { sort, limit: pageSize, skip }),
            tickets.count(filter),
          ]);

          let enriched = normalizeIds(await enrichTickets(results || []));

          // Client-side priority sort if needed
          if ((request.query.sort || '') === 'priority') {
            const dir = request.query.sortDir === 'asc' ? 1 : -1;
            enriched.sort((a, b) => ((PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0)) * dir);
          }

          const total = countResult || 0;
          return reply.send({
            success: true,
            data: enriched,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
          });
        } catch (err) {
          context.logger.error({ err }, 'Failed to list tickets');
          return reply.send({ success: false, error: 'Failed to list tickets' });
        }
      },
    });

    // ── GET /tickets/:id ──
    context.registerRoute({
      method: 'GET',
      url: 'tickets/:id',
      handler: async (request, reply) => {
        try {
          const tickets = context.db.collection('tickets');
          const ticket = await tickets.findOne({ _id: request.params.id });
          if (!ticket) {
            return reply.send({ success: false, error: 'Ticket not found' });
          }
          const enriched = await enrichTickets([ticket]);
          return reply.send({ success: true, data: enriched[0] });
        } catch (err) {
          context.logger.error({ err }, 'Failed to get ticket');
          return reply.send({ success: false, error: 'Failed to get ticket' });
        }
      },
    });

    // ── POST /tickets ──
    context.registerRoute({
      method: 'POST',
      url: 'tickets',
      handler: async (request, reply) => {
        try {
          const body = request.body || {};
          if (!body.title || !body.description) {
            return reply.send({ success: false, error: 'Title and description are required' });
          }

          const settings = await getSettings();
          const ticketNumber = await generateTicketNumber();
          const assigneeId = body.assigneeId || (await autoAssign()) || null;

          const sla = initSla(settings);

          const tickets = context.db.collection('tickets');
          const ticket = await tickets.insert({
            ticketNumber,
            title: body.title.trim(),
            description: body.description.trim(),
            status: 'open',
            priority: body.priority || settings.defaultPriority || 'medium',
            category: body.category || settings.defaultCategory || 'Support',
            assigneeId,
            reporterId: request.user?.id || null,
            serverId: body.serverId || null,
            tags: body.tags || [],
            escalationLevel: 0,
            linkedTickets: [],
            customFields: body.customFields || {},
            sla,
            resolvedAt: null,
            isDeleted: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          await createActivity(ticket._id || ticket.id, 'created', request.user?.id, {
            title: ticket.title,
            ticketNumber,
          });

          broadcast('ticket:created', { ticketId: ticket._id || ticket.id, ticketNumber });

          const enriched = normalizeIds(await enrichTickets([ticket]));
          return reply.send({ success: true, data: enriched[0] });
        } catch (err) {
          context.logger.error({ err }, 'Failed to create ticket');
          return reply.send({ success: false, error: 'Failed to create ticket' });
        }
      },
    });

    // ── PUT /tickets/:id ──
    context.registerRoute({
      method: 'PUT',
      url: 'tickets/:id',
      handler: async (request, reply) => {
        try {
          const tickets = context.db.collection('tickets');
          const existing = await tickets.findOne({ _id: request.params.id });
          if (!existing) {
            return reply.send({ success: false, error: 'Ticket not found' });
          }

          const body = request.body || {};
          const changes = {};
          const userId = request.user?.id;

          // Status transition validation
          if (body.status && body.status !== existing.status) {
            const allowed = STATUS_TRANSITIONS[existing.status] || [];
            if (!allowed.includes(body.status)) {
              return reply.send({
                success: false,
                error: `Cannot transition from ${existing.status} to ${body.status}. Allowed: ${allowed.join(', ')}`,
              });
            }
            changes.status = { from: existing.status, to: body.status };

            // Update SLA on status change
            if (body.status === 'resolved' && !existing.resolvedAt) {
              body.resolvedAt = new Date().toISOString();
            }
            if (body.status === 'open' && existing.status === 'resolved') {
              // Reopen — reset resolution deadline
              const settings = await getSettings();
              const remaining = existing.sla?.resolutionDeadline
                ? Math.max(0, new Date(existing.sla.resolutionDeadline).getTime() - new Date(existing.resolvedAt || existing._updatedAt || existing._createdAt).getTime())
                : cfg('resolutionSlaHours', 48) * 3600 * 1000;
              body.sla = {
                ...existing.sla,
                resolutionDeadline: new Date(Date.now() + remaining).toISOString(),
                resolutionBreached: false,
              };
              body.resolvedAt = null;
            }
          }

          // Track other changes
          if (body.priority && body.priority !== existing.priority) {
            changes.priority = { from: existing.priority, to: body.priority };
          }
          if (body.category && body.category !== existing.category) {
            changes.category = { from: existing.category, to: body.category };
          }
          if (body.assigneeId !== undefined && body.assigneeId !== existing.assigneeId) {
            changes.assigned = { from: existing.assigneeId, to: body.assigneeId };
          }
          if (body.serverId !== undefined && body.serverId !== existing.serverId) {
            changes.server = { from: existing.serverId, to: body.serverId };
          }
          if (body.escalationLevel !== undefined && body.escalationLevel !== existing.escalationLevel) {
            changes.escalation = { from: existing.escalationLevel, to: body.escalationLevel };
          }

          // Tags
          if (body.tags) {
            const added = body.tags.filter(t => !(existing.tags || []).includes(t));
            const removed = (existing.tags || []).filter(t => !body.tags.includes(t));
            if (added.length > 0) changes.tagsAdded = added;
            if (removed.length > 0) changes.tagsRemoved = removed;
          }

          // Build update
          const update = { ...body, updatedAt: new Date().toISOString() };
          delete update._id; // Don't overwrite ID

          await tickets.update({ _id: request.params.id }, update);

          // Record activities
          if (changes.status) {
            await createActivity(request.params.id, 'status_changed', userId, changes.status);
          }
          if (changes.priority) {
            await createActivity(request.params.id, 'priority_changed', userId, changes.priority);
          }
          if (changes.category) {
            await createActivity(request.params.id, 'category_changed', userId, changes.category);
          }
          if (changes.assigned) {
            await createActivity(request.params.id, changes.assigned.to ? 'assigned' : 'unassigned', userId, changes.assigned);
          }
          if (changes.escalation) {
            await createActivity(request.params.id, changes.escalation.to > changes.escalation.from ? 'escalated' : 'deescalated', userId, changes.escalation);
          }
          if (changes.tagsAdded) {
            for (const tag of changes.tagsAdded) {
              await createActivity(request.params.id, 'tag_added', userId, { tag });
            }
          }
          if (changes.tagsRemoved) {
            for (const tag of changes.tagsRemoved) {
              await createActivity(request.params.id, 'tag_removed', userId, { tag });
            }
          }
          if (Object.keys(changes).length > 0) {
            await createActivity(request.params.id, 'updated', userId, changes);
          }

          broadcast('ticket:updated', { ticketId: request.params.id, changes });

          const updated = await tickets.findOne({ _id: request.params.id });
          const enriched = normalizeIds(await enrichTickets([updated]));
          return reply.send({ success: true, data: enriched[0] });
        } catch (err) {
          context.logger.error({ err }, 'Failed to update ticket');
          return reply.send({ success: false, error: 'Failed to update ticket' });
        }
      },
    });

    // ── DELETE /tickets/:id ──
    context.registerRoute({
      method: 'DELETE',
      url: 'tickets/:id',
      handler: async (request, reply) => {
        try {
          const tickets = context.db.collection('tickets');
          const existing = await tickets.findOne({ _id: request.params.id });
          if (!existing) {
            return reply.send({ success: false, error: 'Ticket not found' });
          }

          await tickets.update(
            { _id: request.params.id },
            { status: 'closed', isDeleted: true, updatedAt: new Date().toISOString() },
          );

          await createActivity(request.params.id, 'deleted', request.user?.id, {
            title: existing.title,
            ticketNumber: existing.ticketNumber,
          });

          broadcast('ticket:deleted', { ticketId: request.params.id });
          return reply.send({ success: true });
        } catch (err) {
          context.logger.error({ err }, 'Failed to delete ticket');
          return reply.send({ success: false, error: 'Failed to delete ticket' });
        }
      },
    });

    // ── POST /tickets/bulk ──
    context.registerRoute({
      method: 'POST',
      url: 'tickets/bulk',
      handler: async (request, reply) => {
        try {
          const { ticketIds, action, value } = request.body || {};
          if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
            return reply.send({ success: false, error: 'ticketIds array is required' });
          }
          if (!action) {
            return reply.send({ success: false, error: 'action is required' });
          }

          const tickets = context.db.collection('tickets');
          let updated = 0;
          const userId = request.user?.id;

          for (const id of ticketIds) {
            const existing = await tickets.findOne({ _id: id });
            if (!existing || existing.isDeleted) continue;

            const update = { updatedAt: new Date().toISOString() };

            switch (action) {
              case 'status':
                if (STATUS_TRANSITIONS[existing.status]?.includes(value)) {
                  update.status = value;
                  if (value === 'resolved' && !existing.resolvedAt) {
                    update.resolvedAt = new Date().toISOString();
                  }
                  if (value === 'open' && existing.status === 'resolved') {
                    update.resolvedAt = null;
                  }
                  await createActivity(id, 'status_changed', userId, { from: existing.status, to: value });
                }
                break;
              case 'priority':
                update.priority = value;
                await createActivity(id, 'priority_changed', userId, { from: existing.priority, to: value });
                break;
              case 'assignee':
                update.assigneeId = value || null;
                await createActivity(id, value ? 'assigned' : 'unassigned', userId, { from: existing.assigneeId, to: value });
                break;
              case 'category':
                update.category = value;
                await createActivity(id, 'category_changed', userId, { from: existing.category, to: value });
                break;
              case 'tags_add':
                update.tags = [...new Set([...(existing.tags || []), ...(value || [])])];
                for (const tag of (value || [])) {
                  await createActivity(id, 'tag_added', userId, { tag });
                }
                break;
              case 'tags_remove':
                update.tags = (existing.tags || []).filter(t => !(value || []).includes(t));
                for (const tag of (value || [])) {
                  await createActivity(id, 'tag_removed', userId, { tag });
                }
                break;
              case 'delete':
                update.status = 'closed';
                update.isDeleted = true;
                await createActivity(id, 'deleted', userId, { title: existing.title });
                break;
              default:
                return reply.send({ success: false, error: `Unknown bulk action: ${action}` });
            }

            await tickets.update({ _id: id }, update);
            updated++;
          }

          await createActivity('__bulk__', 'bulk_updated', userId, {
            action,
            ticketIds,
            count: updated,
          });

          broadcast('ticket:bulk-updated', { ticketIds, action, count: updated });
          return reply.send({ success: true, data: { updated } });
        } catch (err) {
          context.logger.error({ err }, 'Bulk action failed');
          return reply.send({ success: false, error: 'Bulk action failed' });
        }
      },
    });

    // ── GET /tickets/:id/comments ──
    context.registerRoute({
      method: 'GET',
      url: 'tickets/:id/comments',
      handler: async (request, reply) => {
        try {
          const comments = context.db.collection('comments');
          const results = await comments.find(
            { ticketId: request.params.id },
            { sort: { createdAt: 1 } },
          );
          const enriched = await enrichComments(results || []);
          return reply.send({ success: true, data: enriched });
        } catch (err) {
          context.logger.error({ err }, 'Failed to fetch comments');
          return reply.send({ success: false, error: 'Failed to fetch comments' });
        }
      },
    });

    // ── POST /tickets/:id/comments ──
    context.registerRoute({
      method: 'POST',
      url: 'tickets/:id/comments',
      handler: async (request, reply) => {
        try {
          const body = request.body || {};
          if (!body.content || !body.content.trim()) {
            return reply.send({ success: false, error: 'Comment content is required' });
          }

          const comments = context.db.collection('comments');
          const comment = await comments.insert({
            ticketId: request.params.id,
            authorId: request.user?.id || null,
            content: body.content.trim(),
            isInternal: body.isInternal || false,
            editedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Update SLA: first response
          const tickets = context.db.collection('tickets');
          const ticket = await tickets.findOne({ _id: request.params.id });
          if (ticket && !ticket.sla?.firstResponseAt && !body.isInternal) {
            await tickets.update(
              { _id: request.params.id },
              { 'sla.firstResponseAt': new Date().toISOString(), updatedAt: new Date().toISOString() },
            );
          }

          // Status change via comment
          if (body.statusChange?.to) {
            const allowed = STATUS_TRANSITIONS[ticket?.status] || [];
            if (allowed.includes(body.statusChange.to)) {
              await tickets.update(
                { _id: request.params.id },
                {
                  status: body.statusChange.to,
                  updatedAt: new Date().toISOString(),
                  ...(body.statusChange.to === 'resolved' ? { resolvedAt: new Date().toISOString() } : {}),
                },
              );
              await createActivity(request.params.id, 'status_changed', request.user?.id, {
                from: ticket?.status,
                to: body.statusChange.to,
              });
            }
          }

          await createActivity(request.params.id, 'comment_added', request.user?.id, {
            commentId: comment._id || comment.id,
            isInternal: body.isInternal,
          });

          broadcast('ticket:comment-added', { ticketId: request.params.id, commentId: comment._id || comment.id });

          const enriched = await enrichComments([comment]);
          return reply.send({ success: true, data: enriched[0] });
        } catch (err) {
          context.logger.error({ err }, 'Failed to add comment');
          return reply.send({ success: false, error: 'Failed to add comment' });
        }
      },
    });

    // ── PUT /tickets/:id/comments/:commentId ──
    context.registerRoute({
      method: 'PUT',
      url: 'tickets/:id/comments/:commentId',
      handler: async (request, reply) => {
        try {
          const body = request.body || {};
          if (!body.content || !body.content.trim()) {
            return reply.send({ success: false, error: 'Comment content is required' });
          }

          const comments = context.db.collection('comments');
          await comments.update(
            { _id: request.params.commentId, ticketId: request.params.id },
            { content: body.content.trim(), editedAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          );

          await createActivity(request.params.id, 'comment_edited', request.user?.id, {
            commentId: request.params.commentId,
          });

          const updated = await comments.findOne({ _id: request.params.commentId });
          const enriched = normalizeIds(await enrichComments([updated]));
          return reply.send({ success: true, data: enriched[0] });
        } catch (err) {
          context.logger.error({ err }, 'Failed to edit comment');
          return reply.send({ success: false, error: 'Failed to edit comment' });
        }
      },
    });

    // ── DELETE /tickets/:id/comments/:commentId ──
    context.registerRoute({
      method: 'DELETE',
      url: 'tickets/:id/comments/:commentId',
      handler: async (request, reply) => {
        try {
          const comments = context.db.collection('comments');
          await comments.delete({ _id: request.params.commentId, ticketId: request.params.id });

          await createActivity(request.params.id, 'comment_deleted', request.user?.id, {
            commentId: request.params.commentId,
          });

          broadcast('ticket:comment-added', { ticketId: request.params.id, commentId: request.params.commentId, deleted: true });
          return reply.send({ success: true });
        } catch (err) {
          context.logger.error({ err }, 'Failed to delete comment');
          return reply.send({ success: false, error: 'Failed to delete comment' });
        }
      },
    });

    // ── GET /tickets/:id/activities ──
    context.registerRoute({
      method: 'GET',
      url: 'tickets/:id/activities',
      handler: async (request, reply) => {
        try {
          const activities = context.db.collection('activities');
          const { page, pageSize, skip } = parsePagination(request.query);
          const filter = { ticketId: request.params.id };

          const [results, countResult] = await Promise.all([
            activities.find(filter, { sort: { createdAt: -1 }, limit: pageSize, skip }),
            activities.count(filter),
          ]);

          const enriched = normalizeIds(await enrichActivities(results || []));
          const total = countResult || 0;

          return reply.send({
            success: true,
            data: enriched,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
          });
        } catch (err) {
          context.logger.error({ err }, 'Failed to fetch activities');
          return reply.send({ success: false, error: 'Failed to fetch activities' });
        }
      },
    });

    // ── GET /tags ──
    context.registerRoute({
      method: 'GET',
      url: 'tags',
      handler: async (request, reply) => {
        try {
          const tags = context.db.collection('tags');
          const results = await tags.find({}, { sort: { name: 1 } });
          return reply.send({ success: true, data: normalizeIds(results || []) });
        } catch (err) {
          context.logger.error({ err }, 'Failed to fetch tags');
          return reply.send({ success: false, error: 'Failed to fetch tags' });
        }
      },
    });

    // ── POST /tags ──
    context.registerRoute({
      method: 'POST',
      url: 'tags',
      handler: async (request, reply) => {
        try {
          const body = request.body || {};
          if (!body.name || !body.color) {
            return reply.send({ success: false, error: 'Name and color are required' });
          }

          const tags = context.db.collection('tags');
          const existing = await tags.findOne({ name: body.name.trim().toLowerCase() });
          if (existing) {
            return reply.send({ success: false, error: 'Tag with this name already exists' });
          }

          const tag = await tags.insert({
            name: body.name.trim(),
            color: body.color,
            createdAt: new Date().toISOString(),
          });

          return reply.send({ success: true, data: normalizeId(tag) });
        } catch (err) {
          context.logger.error({ err }, 'Failed to create tag');
          return reply.send({ success: false, error: 'Failed to create tag' });
        }
      },
    });

    // ── PUT /tags/:id ──
    context.registerRoute({
      method: 'PUT',
      url: 'tags/:id',
      handler: async (request, reply) => {
        try {
          const body = request.body || {};
          const tags = context.db.collection('tags');
          await tags.update(
            { _id: request.params.id },
            {
              ...(body.name ? { name: body.name.trim() } : {}),
              ...(body.color ? { color: body.color } : {}),
              updatedAt: new Date().toISOString(),
            },
          );
          const updated = await tags.findOne({ _id: request.params.id });
          return reply.send({ success: true, data: normalizeId(updated) });
        } catch (err) {
          context.logger.error({ err }, 'Failed to update tag');
          return reply.send({ success: false, error: 'Failed to update tag' });
        }
      },
    });

    // ── DELETE /tags/:id ──
    context.registerRoute({
      method: 'DELETE',
      url: 'tags/:id',
      handler: async (request, reply) => {
        try {
          const tags = context.db.collection('tags');
          const tag = await tags.findOne({ _id: request.params.id });
          if (!tag) {
            return reply.send({ success: false, error: 'Tag not found' });
          }

          // Remove tag from all tickets
          const tickets = context.db.collection('tickets');
          const allTickets = await tickets.find({ tags: tag.name });
          for (const ticket of (allTickets || [])) {
            await tickets.update(
              { _id: ticket._id },
              { tags: (ticket.tags || []).filter(t => t !== tag.name) },
            );
          }

          await tags.delete({ _id: request.params.id });
          return reply.send({ success: true });
        } catch (err) {
          context.logger.error({ err }, 'Failed to delete tag');
          return reply.send({ success: false, error: 'Failed to delete tag' });
        }
      },
    });

    // ── GET /templates ──
    context.registerRoute({
      method: 'GET',
      url: 'templates',
      handler: async (request, reply) => {
        try {
          const templates = context.db.collection('templates');
          const results = await templates.find({}, { sort: { name: 1 } });
          return reply.send({ success: true, data: normalizeIds(results || []) });
        } catch (err) {
          context.logger.error({ err }, 'Failed to fetch templates');
          return reply.send({ success: false, error: 'Failed to fetch templates' });
        }
      },
    });

    // ── POST /templates ──
    context.registerRoute({
      method: 'POST',
      url: 'templates',
      handler: async (request, reply) => {
        try {
          const body = request.body || {};
          if (!body.name) {
            return reply.send({ success: false, error: 'Template name is required' });
          }

          const templates = context.db.collection('templates');
          const template = await templates.insert({
            name: body.name.trim(),
            description: body.description || '',
            title: body.title || '',
            content: body.content || '',
            priority: body.priority || 'medium',
            category: body.category || 'Support',
            tags: body.tags || [],
            isDefault: body.isDefault || false,
            createdAt: new Date().toISOString(),
          });

          // If this is the default, unset others
          if (body.isDefault) {
            const allTemplates = await templates.find({ _id: { $ne: template._id || template.id } });
            for (const t of (allTemplates || [])) {
              if (t.isDefault) {
                await templates.update({ _id: t._id }, { isDefault: false });
              }
            }
          }

          return reply.send({ success: true, data: normalizeId(template) });
        } catch (err) {
          context.logger.error({ err }, 'Failed to create template');
          return reply.send({ success: false, error: 'Failed to create template' });
        }
      },
    });

    // ── PUT /templates/:id ──
    context.registerRoute({
      method: 'PUT',
      url: 'templates/:id',
      handler: async (request, reply) => {
        try {
          const body = request.body || {};
          const templates = context.db.collection('templates');

          // If setting as default, unset others
          if (body.isDefault) {
            const allTemplates = await templates.find({ _id: { $ne: request.params.id } });
            for (const t of (allTemplates || [])) {
              if (t.isDefault) {
                await templates.update({ _id: t._id }, { isDefault: false });
              }
            }
          }

          const update = { updatedAt: new Date().toISOString() };
          if (body.name !== undefined) update.name = body.name.trim();
          if (body.description !== undefined) update.description = body.description;
          if (body.title !== undefined) update.title = body.title;
          if (body.content !== undefined) update.content = body.content;
          if (body.priority !== undefined) update.priority = body.priority;
          if (body.category !== undefined) update.category = body.category;
          if (body.tags !== undefined) update.tags = body.tags;
          if (body.isDefault !== undefined) update.isDefault = body.isDefault;

          await templates.update({ _id: request.params.id }, update);
          const updated = await templates.findOne({ _id: request.params.id });
          return reply.send({ success: true, data: normalizeId(updated) });
        } catch (err) {
          context.logger.error({ err }, 'Failed to update template');
          return reply.send({ success: false, error: 'Failed to update template' });
        }
      },
    });

    // ── DELETE /templates/:id ──
    context.registerRoute({
      method: 'DELETE',
      url: 'templates/:id',
      handler: async (request, reply) => {
        try {
          const templates = context.db.collection('templates');
          await templates.delete({ _id: request.params.id });
          return reply.send({ success: true });
        } catch (err) {
          context.logger.error({ err }, 'Failed to delete template');
          return reply.send({ success: false, error: 'Failed to delete template' });
        }
      },
    });

    // ── GET /settings ──
    context.registerRoute({
      method: 'GET',
      url: 'settings',
      handler: async (request, reply) => {
        try {
          const settings = await getSettings();
          return reply.send({ success: true, data: normalizeId(settings) });
        } catch (err) {
          context.logger.error({ err }, 'Failed to get settings');
          return reply.send({ success: false, error: 'Failed to get settings' });
        }
      },
    });

    // ── PUT /settings ──
    context.registerRoute({
      method: 'PUT',
      url: 'settings',
      handler: async (request, reply) => {
        try {
          const body = request.body || {};
          const settings = context.db.collection('plugin_settings');
          const allowed = [
            'autoAssignEnabled', 'autoCloseDays', 'defaultPriority',
            'defaultCategory', 'responseSlaHours', 'resolutionSlaHours',
            'maxEscalationLevel',
          ];
          const update = { updatedAt: new Date().toISOString() };
          for (const key of allowed) {
            if (body[key] !== undefined) update[key] = body[key];
          }

          await settings.update({ _type: 'ticketing_settings' }, update);
          const updated = await settings.findOne({ _type: 'ticketing_settings' });
          return reply.send({ success: true, data: normalizeId(updated) });
        } catch (err) {
          context.logger.error({ err }, 'Failed to update settings');
          return reply.send({ success: false, error: 'Failed to update settings' });
        }
      },
    });

    // ── GET /stats ──
    context.registerRoute({
      method: 'GET',
      url: 'stats',
      handler: async (request, reply) => {
        try {
          const tickets = context.db.collection('tickets');
          const baseFilter = { isDeleted: { $ne: true } };

          // Filter by assignee if requested
          if (request.query.assigneeId) {
            baseFilter.$or = [
              { assigneeId: request.query.assigneeId },
              { reporterId: request.query.assigneeId },
            ];
          }

          const allTickets = await tickets.find(baseFilter);
          const list = allTickets || [];
          const now = new Date();
          const today = now.toISOString().split('T')[0];

          const stats = {
            total: list.length,
            byStatus: {},
            byPriority: {},
            byCategory: {},
            open: 0,
            inProgress: 0,
            pending: 0,
            resolved: 0,
            closed: 0,
            overdue: 0,
            unassigned: 0,
            slaBreached: 0,
            createdToday: 0,
            resolvedToday: 0,
            avgResolutionTimeHours: null,
          };

          STATUSES.forEach(s => { stats.byStatus[s] = 0; });
          PRIORITIES.forEach(p => { stats.byPriority[p] = 0; });

          let totalResolutionMs = 0;
          let resolvedCount = 0;

          for (const t of list) {
            // By status
            stats.byStatus[t.status] = (stats.byStatus[t.status] || 0) + 1;

            // Count by status field
            if (t.status === 'open') stats.open++;
            else if (t.status === 'in_progress') stats.inProgress++;
            else if (t.status === 'pending') stats.pending++;
            else if (t.status === 'resolved') stats.resolved++;
            else if (t.status === 'closed') stats.closed++;

            // By priority
            stats.byPriority[t.priority] = (stats.byPriority[t.priority] || 0) + 1;

            // By category
            stats.byCategory[t.category] = (stats.byCategory[t.category] || 0) + 1;

            // Unassigned
            if (!t.assigneeId) stats.unassigned++;

            // Overdue
            if (t.sla?.resolutionBreached && !['resolved', 'closed'].includes(t.status)) {
              stats.overdue++;
            }

            // SLA breached
            if (t.sla?.responseBreached || t.sla?.resolutionBreached) {
              stats.slaBreached++;
            }

            // Created today
            if (t.createdAt && t.createdAt.startsWith(today)) {
              stats.createdToday++;
            }

            // Resolved today
            if (t.resolvedAt && t.resolvedAt.startsWith(today)) {
              stats.resolvedToday++;
            }

            // Resolution time
            if (t.resolvedAt && t.createdAt) {
              const ms = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime();
              if (ms > 0) {
                totalResolutionMs += ms;
                resolvedCount++;
              }
            }
          }

          stats.avgResolutionTimeHours = resolvedCount > 0
            ? Math.round((totalResolutionMs / resolvedCount) / 3600000)
            : null;

          return reply.send({ success: true, data: stats });
        } catch (err) {
          context.logger.error({ err }, 'Failed to get stats');
          return reply.send({ success: false, error: 'Failed to get stats' });
        }
      },
    });

    // ── GET /export ──
    context.registerRoute({
      method: 'GET',
      url: 'export',
      handler: async (request, reply) => {
        try {
          const tickets = context.db.collection('tickets');
          const filter = buildTicketFilter(request.query);
          const allResults = await tickets.find(filter, { sort: { createdAt: -1 } });
          const enriched = normalizeIds(await enrichTickets(allResults || []));

          if (request.query.format === 'csv') {
            const headers = [
              'Ticket Number', 'Title', 'Status', 'Priority', 'Category',
              'Assignee', 'Reporter', 'Server', 'Tags', 'Escalation Level',
              'SLA Response Breached', 'SLA Resolution Breached',
              'Created At', 'Updated At', 'Resolved At',
            ];

            const rows = enriched.map(t => [
              csvEscape(t.ticketNumber),
              csvEscape(t.title),
              csvEscape(t.status),
              csvEscape(t.priority),
              csvEscape(t.category),
              csvEscape(t.assignee?.username || t.assigneeId || ''),
              csvEscape(t.reporter?.username || t.reporterId || ''),
              csvEscape(t.server?.name || t.serverId || ''),
              csvEscape((t.tags || []).join(', ')),
              csvEscape(t.escalationLevel),
              csvEscape(t.sla?.responseBreached ? 'Yes' : 'No'),
              csvEscape(t.sla?.resolutionBreached ? 'Yes' : 'No'),
              csvEscape(t.createdAt),
              csvEscape(t.updatedAt),
              csvEscape(t.resolvedAt || ''),
            ]);

            const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            reply.header('Content-Type', 'text/csv');
            reply.header('Content-Disposition', 'attachment; filename="tickets-export.csv"');
            return reply.send(csv);
          }

          // JSON export
          reply.header('Content-Type', 'application/json');
          reply.header('Content-Disposition', 'attachment; filename="tickets-export.json"');
          return reply.send({ success: true, data: enriched, exportedAt: new Date().toISOString() });
        } catch (err) {
          context.logger.error({ err }, 'Export failed');
          return reply.send({ success: false, error: 'Export failed' });
        }
      },
    });

    // ── GET /users ──
    context.registerRoute({
      method: 'GET',
      url: 'users',
      handler: async (request, reply) => {
        try {
          const users = await context.db.users.findMany({});
          return reply.send({
            success: true,
            data: (users || []).map(u => ({
              id: u.id,
              username: u.username,
              email: u.email,
              name: u.name || u.username,
              image: u.image || null,
            })),
          });
        } catch (err) {
          context.logger.error({ err }, 'Failed to fetch users');
          return reply.send({ success: false, error: 'Failed to fetch users' });
        }
      },
    });

    // ── GET /servers ──
    context.registerRoute({
      method: 'GET',
      url: 'servers',
      handler: async (request, reply) => {
        try {
          const servers = await context.db.servers.findMany({});
          return reply.send({
            success: true,
            data: (servers || []).map(s => ({
              id: s.id,
              name: s.name || s.hostname || 'Unknown',
              uuid: s.uuid || null,
              status: s.status || 'unknown',
            })),
          });
        } catch (err) {
          context.logger.error({ err }, 'Failed to fetch servers');
          return reply.send({ success: false, error: 'Failed to fetch servers' });
        }
      },
    });

    // ── GET /categories ──
    context.registerRoute({
      method: 'GET',
      url: 'categories',
      handler: async (request, reply) => {
        return reply.send({ success: true, data: CATEGORIES });
      },
    });

    // ── GET /statuses ──
    context.registerRoute({
      method: 'GET',
      url: 'statuses',
      handler: async (request, reply) => {
        return reply.send({ success: true, data: STATUS_TRANSITIONS });
      },
    });

    // ── GET /priorities ──
    context.registerRoute({
      method: 'GET',
      url: 'priorities',
      handler: async (request, reply) => {
        return reply.send({ success: true, data: PRIORITIES });
      },
    });
  },

  async onEnable(context) {
    // ── Cron: SLA breach check every 5 minutes ──
    try {
      await context.scheduleTask('*/5 * * * *', async () => {
        const tickets = context.db.collection('tickets');
        const now = new Date();

        try {
          const openTickets = await tickets.find({
            status: { $nin: ['resolved', 'closed'] },
            isDeleted: { $ne: true },
          });

          for (const ticket of (openTickets || [])) {
            const sla = ticket.sla || {};
            let changed = false;
            const updates = {};

            // Check response SLA
            if (!sla.firstResponseAt && sla.responseDeadline) {
              if (now > new Date(sla.responseDeadline) && !sla.responseBreached) {
                updates['sla.responseBreached'] = true;
                changed = true;
                await createActivity(ticket._id, 'sla_breached', null, { type: 'response' });
              }
            }

            // Check resolution SLA
            if (sla.resolutionDeadline) {
              if (now > new Date(sla.resolutionDeadline) && !sla.resolutionBreached) {
                updates['sla.resolutionBreached'] = true;
                changed = true;
                await createActivity(ticket._id, 'sla_breached', null, { type: 'resolution' });

                // Auto-escalate
                const maxLevel = cfg('maxEscalationLevel', 3);
                if (ticket.escalationLevel < maxLevel) {
                  updates.escalationLevel = ticket.escalationLevel + 1;
                  await createActivity(ticket._id, 'escalated', null, {
                    from: ticket.escalationLevel,
                    to: ticket.escalationLevel + 1,
                    reason: 'SLA resolution breached',
                  });
                }
              }
            }

            if (changed) {
              updates.updatedAt = new Date().toISOString();
              await tickets.update({ _id: ticket._id }, updates);
            }
          }
        } catch (err) {
          context.logger.error({ err }, 'SLA breach check failed');
        }
      });
      context.logger.info('Scheduled SLA breach check (every 5 minutes)');
    } catch (err) {
      context.logger.warn({ err }, 'Failed to schedule SLA breach check');
    }

    // ── Cron: Auto-close resolved tickets daily ──
    try {
      await context.scheduleTask('0 0 * * *', async () => {
        const autoCloseDays = cfg('autoCloseDays', 30);
        if (autoCloseDays <= 0) return;

        const tickets = context.db.collection('tickets');
        const cutoff = new Date(Date.now() - autoCloseDays * 86400000);

        try {
          const resolvedTickets = await tickets.find({
            status: 'resolved',
            isDeleted: { $ne: true },
          });

          let closed = 0;
          for (const ticket of (resolvedTickets || [])) {
            const resolvedAt = ticket.resolvedAt ? new Date(ticket.resolvedAt) : null;
            if (resolvedAt && resolvedAt < cutoff) {
              await tickets.update(
                { _id: ticket._id },
                { status: 'closed', updatedAt: new Date().toISOString() },
              );
              await createActivity(ticket._id, 'status_changed', null, {
                from: 'resolved',
                to: 'closed',
                reason: `Auto-closed after ${autoCloseDays} days`,
              });
              closed++;
            }
          }

          if (closed > 0) {
            context.logger.info(`Auto-closed ${closed} resolved tickets`);
          }
        } catch (err) {
          context.logger.error({ err }, 'Auto-close failed');
        }
      });
      context.logger.info('Scheduled daily auto-close task');
    } catch (err) {
      context.logger.warn({ err }, 'Failed to schedule auto-close task');
    }

    // ── WebSocket subscriptions ──
    context.onWebSocketMessage('plugin:ticketing-plugin:subscribe', (msg, client) => {
      context.logger.debug({ clientId: client?.id }, 'Ticketing WS subscribe');
    });

    context.onWebSocketMessage('plugin:ticketing-plugin:unsubscribe', (msg, client) => {
      context.logger.debug({ clientId: client?.id }, 'Ticketing WS unsubscribe');
    });

    context.logger.info('Ticketing plugin enabled');
  },
};
