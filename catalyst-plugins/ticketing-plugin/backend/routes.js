/**
 * HTTP route registration for the ticketing plugin.
 */

import {
  STATUSES,
  STATUS_TRANSITIONS,
  PRIORITIES,
  CATEGORIES,
} from './constants.js';
import {
  cfg,
  getUserId,
  nowIso,
  normalizeId,
  normalizeIds,
  parsePagination,
  ok,
  fail,
  buildTicketFilter,
  buildSort,
  sortByPriority,
  initSla,
  csvEscape,
  generateTicketNumber,
  createActivity,
  broadcast,
  enrichTickets,
  enrichComments,
  enrichActivities,
  getSettings,
  autoAssign,
  updateTicketDoc,
} from './helpers.js';

function applyMyTicketsFilter(filter, userId, search) {
  if (!userId) return filter;
  const mine = [{ assigneeId: userId }, { reporterId: userId }];
  // Drop any prior $or (e.g. from search) so mine-filter owns it cleanly.
  const { $or: _drop, ...base } = filter;
  if (search) {
    const regex = { $regex: String(search), $options: 'i' };
    return {
      ...base,
      $and: [
        { $or: mine },
        { $or: [{ title: regex }, { description: regex }, { ticketNumber: regex }] },
      ],
    };
  }
  return { ...base, $or: mine };
}

export function registerRoutes(context) {
  // ── Tickets ──────────────────────────────────────────────────────────────

  context.registerRoute({
    method: 'GET',
    url: 'tickets',
    handler: async (request, reply) => {
      try {
        const tickets = context.db.collection('tickets');
        const { page, pageSize, skip } = parsePagination(request.query);
        let filter = buildTicketFilter(request.query);
        const sort = buildSort(request.query);
        const userId = getUserId(request);

        if (request.query.myTickets === 'true' || request.query.myTickets === true) {
          filter = applyMyTicketsFilter(filter, userId, request.query.search);
        }

        const wantOverdue =
          request.query.isOverdue === 'true' || request.query.isOverdue === true;

        // Overdue needs nested sla.resolutionBreached which matchFilter cannot
        // express — load a wider window then filter/paginate in process.
        let results;
        let total;
        if (wantOverdue) {
          const all = (await tickets.find(filter, { sort })) || [];
          const overdue = all.filter(
            (t) =>
              t.sla?.resolutionBreached &&
              !['resolved', 'closed'].includes(t.status),
          );
          total = overdue.length;
          results = overdue.slice(skip, skip + pageSize);
        } else {
          [results, total] = await Promise.all([
            tickets.find(filter, { sort, limit: pageSize, skip }),
            tickets.count(filter),
          ]);
        }

        let enriched = await enrichTickets(context, results || []);
        const sortField = request.query.sort || '';
        if (sortField === 'priority' || sortField === 'priority_weight') {
          enriched = sortByPriority(enriched, request.query.sortDir);
        }

        return reply.send({
          success: true,
          data: enriched,
          total: total || 0,
          page,
          pageSize,
          totalPages: Math.ceil((total || 0) / pageSize) || 1,
        });
      } catch (err) {
        context.logger.error({ err }, 'Failed to list tickets');
        return fail(reply, 'Failed to list tickets');
      }
    },
  });

  context.registerRoute({
    method: 'GET',
    url: 'tickets/:id',
    handler: async (request, reply) => {
      try {
        const ticket = await context.db.collection('tickets').findOne({
          _id: request.params.id,
        });
        if (!ticket || ticket.isDeleted) {
          return fail(reply, 'Ticket not found');
        }
        const [enriched] = await enrichTickets(context, [ticket]);
        return ok(reply, enriched);
      } catch (err) {
        context.logger.error({ err }, 'Failed to get ticket');
        return fail(reply, 'Failed to get ticket');
      }
    },
  });

  context.registerRoute({
    method: 'POST',
    url: 'tickets',
    handler: async (request, reply) => {
      try {
        const body = request.body || {};
        if (!body.title?.trim() || !body.description?.trim()) {
          return fail(reply, 'Title and description are required');
        }

        const settings = await getSettings(context);
        const ticketNumber = await generateTicketNumber(context);
        const assigneeId = body.assigneeId || (await autoAssign(context)) || null;
        const reporterId = getUserId(request);
        const sla = initSla(settings, context);

        const ticket = await context.db.collection('tickets').insert({
          ticketNumber,
          title: body.title.trim(),
          description: body.description.trim(),
          status: 'open',
          priority: body.priority || settings.defaultPriority || 'medium',
          category: body.category || settings.defaultCategory || 'Support',
          assigneeId,
          reporterId,
          serverId: body.serverId || null,
          tags: Array.isArray(body.tags) ? body.tags : [],
          escalationLevel: 0,
          linkedTickets: [],
          customFields: body.customFields || {},
          templateId: body.templateId || null,
          sla,
          resolvedAt: null,
          closedAt: null,
          isDeleted: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });

        const ticketId = ticket._id || ticket.id;
        await createActivity(context, ticketId, 'created', reporterId, {
          title: ticket.title,
          ticketNumber,
        });

        if (assigneeId) {
          await createActivity(context, ticketId, 'assigned', reporterId, {
            assigneeId,
          });
          context.emit('ticket:assigned', { ticketId, assigneeId });
        }

        broadcast(context, 'ticket:created', { ticketId, ticketNumber });
        context.emit('ticket:created', { ticketId, ticketNumber });

        const [enriched] = await enrichTickets(context, [ticket]);
        return ok(reply, enriched);
      } catch (err) {
        context.logger.error({ err }, 'Failed to create ticket');
        return fail(reply, 'Failed to create ticket');
      }
    },
  });

  context.registerRoute({
    method: 'PUT',
    url: 'tickets/:id',
    handler: async (request, reply) => {
      try {
        const tickets = context.db.collection('tickets');
        const existing = await tickets.findOne({ _id: request.params.id });
        if (!existing || existing.isDeleted) {
          return fail(reply, 'Ticket not found');
        }

        const body = request.body || {};
        const userId = getUserId(request);
        const changes = {};
        const patch = {};

        if (body.title !== undefined && body.title !== existing.title) {
          patch.title = String(body.title).trim();
          changes.title = { from: existing.title, to: patch.title };
        }
        if (body.description !== undefined && body.description !== existing.description) {
          patch.description = String(body.description).trim();
          changes.description = true;
        }
        if (body.priority && body.priority !== existing.priority) {
          if (!PRIORITIES.includes(body.priority)) {
            return fail(reply, `Invalid priority: ${body.priority}`);
          }
          patch.priority = body.priority;
          changes.priority = { from: existing.priority, to: body.priority };
        }
        if (body.category && body.category !== existing.category) {
          patch.category = body.category;
          changes.category = { from: existing.category, to: body.category };
        }
        if (body.tags !== undefined) {
          patch.tags = Array.isArray(body.tags) ? body.tags : [];
          changes.tags = true;
        }
        if (body.serverId !== undefined && body.serverId !== existing.serverId) {
          patch.serverId = body.serverId || null;
          changes.serverId = { from: existing.serverId, to: patch.serverId };
        }
        if (body.customFields !== undefined) {
          patch.customFields = body.customFields || {};
        }
        if (body.linkedTickets !== undefined) {
          patch.linkedTickets = Array.isArray(body.linkedTickets) ? body.linkedTickets : [];
        }
        if (
          body.escalationLevel !== undefined &&
          body.escalationLevel !== existing.escalationLevel
        ) {
          patch.escalationLevel = Number(body.escalationLevel) || 0;
          changes.escalation = {
            from: existing.escalationLevel,
            to: patch.escalationLevel,
          };
        }

        // Assignee — allow explicit null to unassign
        if (body.assigneeId !== undefined && body.assigneeId !== existing.assigneeId) {
          patch.assigneeId = body.assigneeId || null;
          changes.assignee = { from: existing.assigneeId, to: patch.assigneeId };
        }

        // Status transition
        if (body.status && body.status !== existing.status) {
          const allowed = STATUS_TRANSITIONS[existing.status] || [];
          if (!allowed.includes(body.status)) {
            return fail(
              reply,
              `Cannot transition from ${existing.status} to ${body.status}. Allowed: ${allowed.join(', ') || 'none'}`,
            );
          }
          patch.status = body.status;
          changes.status = { from: existing.status, to: body.status };

          if (body.status === 'resolved' && !existing.resolvedAt) {
            patch.resolvedAt = nowIso();
          }
          if (body.status === 'closed') {
            patch.closedAt = nowIso();
            if (!existing.resolvedAt && !patch.resolvedAt) patch.resolvedAt = nowIso();
          }
          if (body.status === 'open' && ['resolved', 'closed'].includes(existing.status)) {
            // Reopen — reset resolution SLA from now
            const settings = await getSettings(context);
            const hours = settings.resolutionSlaHours ?? cfg(context, 'resolutionSlaHours', 48);
            patch.sla = {
              ...(existing.sla || {}),
              resolutionDeadline: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
              resolutionBreached: false,
            };
            patch.resolvedAt = null;
            patch.closedAt = null;
          }
        }

        if (Object.keys(patch).length === 0) {
          const [enriched] = await enrichTickets(context, [existing]);
          return ok(reply, enriched);
        }

        const updated = await updateTicketDoc(context, request.params.id, patch);
        const ticketId = request.params.id;

        if (changes.status) {
          await createActivity(context, ticketId, 'status_changed', userId, changes.status);
          context.emit('ticket:status-changed', {
            ticketId,
            from: changes.status.from,
            to: changes.status.to,
          });
        }
        if (changes.priority) {
          await createActivity(context, ticketId, 'priority_changed', userId, changes.priority);
        }
        if (changes.category) {
          await createActivity(context, ticketId, 'category_changed', userId, changes.category);
        }
        if (changes.assignee) {
          const type = changes.assignee.to ? 'assigned' : 'unassigned';
          await createActivity(context, ticketId, type, userId, changes.assignee);
          if (changes.assignee.to) {
            context.emit('ticket:assigned', {
              ticketId,
              assigneeId: changes.assignee.to,
            });
          }
        }
        if (changes.escalation) {
          await createActivity(context, ticketId, 'escalated', userId, changes.escalation);
          context.emit('ticket:escalated', {
            ticketId,
            level: changes.escalation.to,
          });
        }
        if (Object.keys(changes).length > 0) {
          await createActivity(context, ticketId, 'updated', userId, changes);
          context.emit('ticket:updated', { ticketId, changes });
          broadcast(context, 'ticket:updated', { ticketId, changes });
        }

        const [enriched] = await enrichTickets(context, [updated || existing]);
        return ok(reply, enriched);
      } catch (err) {
        context.logger.error({ err }, 'Failed to update ticket');
        return fail(reply, 'Failed to update ticket');
      }
    },
  });

  context.registerRoute({
    method: 'DELETE',
    url: 'tickets/:id',
    handler: async (request, reply) => {
      try {
        const existing = await context.db.collection('tickets').findOne({
          _id: request.params.id,
        });
        if (!existing || existing.isDeleted) {
          return fail(reply, 'Ticket not found');
        }

        await updateTicketDoc(context, request.params.id, { isDeleted: true });
        const userId = getUserId(request);
        await createActivity(context, request.params.id, 'deleted', userId, {});
        broadcast(context, 'ticket:deleted', { ticketId: request.params.id });
        context.emit('ticket:deleted', { ticketId: request.params.id });
        return ok(reply, { id: request.params.id });
      } catch (err) {
        context.logger.error({ err }, 'Failed to delete ticket');
        return fail(reply, 'Failed to delete ticket');
      }
    },
  });

  // ── Bulk ─────────────────────────────────────────────────────────────────

  context.registerRoute({
    method: 'POST',
    url: 'tickets/bulk',
    handler: async (request, reply) => {
      try {
        const body = request.body || {};
        const ticketIds = Array.isArray(body.ticketIds) ? body.ticketIds : [];
        const action = body.action;
        const value = body.value;
        if (!ticketIds.length || !action) {
          return fail(reply, 'ticketIds and action are required');
        }

        const userId = getUserId(request);
        let updated = 0;

        for (const id of ticketIds) {
          const existing = await context.db.collection('tickets').findOne({ _id: id });
          if (!existing || existing.isDeleted) continue;

          const patch = {};
          if (action === 'status') {
            const allowed = STATUS_TRANSITIONS[existing.status] || [];
            if (!allowed.includes(value)) continue;
            patch.status = value;
            if (value === 'resolved') patch.resolvedAt = existing.resolvedAt || nowIso();
            if (value === 'closed') patch.closedAt = nowIso();
          } else if (action === 'priority') {
            if (!PRIORITIES.includes(value)) continue;
            patch.priority = value;
          } else if (action === 'assignee') {
            patch.assigneeId = value || null;
          } else if (action === 'category') {
            patch.category = value;
          } else if (action === 'tags_add') {
            const add = Array.isArray(value) ? value : [value];
            patch.tags = [...new Set([...(existing.tags || []), ...add.filter(Boolean)])];
          } else if (action === 'tags_remove') {
            const remove = new Set(Array.isArray(value) ? value : [value]);
            patch.tags = (existing.tags || []).filter((t) => !remove.has(t));
          } else if (action === 'delete') {
            patch.isDeleted = true;
          } else {
            continue;
          }

          await updateTicketDoc(context, id, patch);
          await createActivity(context, id, 'bulk_updated', userId, { action, value });
          updated++;
        }

        broadcast(context, 'ticket:bulk-updated', { ticketIds, action });
        context.emit('ticket:bulk-updated', { ticketIds, action });
        return ok(reply, { updated });
      } catch (err) {
        context.logger.error({ err }, 'Bulk action failed');
        return fail(reply, 'Bulk action failed');
      }
    },
  });

  // ── Comments ─────────────────────────────────────────────────────────────

  context.registerRoute({
    method: 'GET',
    url: 'tickets/:id/comments',
    handler: async (request, reply) => {
      try {
        const comments = await context.db.collection('comments').find(
          { ticketId: request.params.id, isDeleted: { $ne: true } },
          { sort: { createdAt: 1 } },
        );
        return ok(reply, await enrichComments(context, comments || []));
      } catch (err) {
        context.logger.error({ err }, 'Failed to fetch comments');
        return fail(reply, 'Failed to fetch comments');
      }
    },
  });

  context.registerRoute({
    method: 'POST',
    url: 'tickets/:id/comments',
    handler: async (request, reply) => {
      try {
        const ticket = await context.db.collection('tickets').findOne({
          _id: request.params.id,
        });
        if (!ticket || ticket.isDeleted) {
          return fail(reply, 'Ticket not found');
        }

        const body = request.body || {};
        if (!body.content?.trim()) {
          return fail(reply, 'Comment content is required');
        }

        const userId = getUserId(request);
        const comment = await context.db.collection('comments').insert({
          ticketId: request.params.id,
          content: body.content.trim(),
          authorId: userId,
          isInternal: Boolean(body.isInternal),
          statusChange: body.statusChange || null,
          attachments: Array.isArray(body.attachments) ? body.attachments : [],
          isDeleted: false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });

        // First response marks SLA response time
        const sla = { ...(ticket.sla || {}) };
        if (!sla.firstResponseAt && userId && userId !== ticket.reporterId) {
          sla.firstResponseAt = nowIso();
          await updateTicketDoc(context, request.params.id, { sla });
        }

        // Optional status change bundled with comment
        if (body.statusChange?.to && body.statusChange.to !== ticket.status) {
          const allowed = STATUS_TRANSITIONS[ticket.status] || [];
          if (allowed.includes(body.statusChange.to)) {
            const statusPatch = { status: body.statusChange.to };
            if (body.statusChange.to === 'resolved') statusPatch.resolvedAt = nowIso();
            if (body.statusChange.to === 'closed') statusPatch.closedAt = nowIso();
            await updateTicketDoc(context, request.params.id, statusPatch);
            await createActivity(context, request.params.id, 'status_changed', userId, {
              from: ticket.status,
              to: body.statusChange.to,
            });
          }
        }

        const commentId = comment._id || comment.id;
        await createActivity(context, request.params.id, 'comment_added', userId, {
          commentId,
        });
        broadcast(context, 'ticket:comment-added', {
          ticketId: request.params.id,
          commentId,
        });
        context.emit('ticket:comment-added', {
          ticketId: request.params.id,
          commentId,
        });

        const [enriched] = await enrichComments(context, [comment]);
        return ok(reply, enriched);
      } catch (err) {
        context.logger.error({ err }, 'Failed to add comment');
        return fail(reply, 'Failed to add comment');
      }
    },
  });

  context.registerRoute({
    method: 'PUT',
    url: 'tickets/:id/comments/:commentId',
    handler: async (request, reply) => {
      try {
        const comments = context.db.collection('comments');
        const existing = await comments.findOne({ _id: request.params.commentId });
        if (!existing || existing.ticketId !== request.params.id || existing.isDeleted) {
          return fail(reply, 'Comment not found');
        }

        const content = request.body?.content;
        if (!content?.trim()) return fail(reply, 'Content is required');

        const userId = getUserId(request);
        if (existing.authorId && userId && existing.authorId !== userId) {
          return fail(reply, 'Only the author can edit this comment');
        }

        await comments.update(
          { _id: request.params.commentId },
          {
            $set: {
              content: content.trim(),
              editedAt: nowIso(),
              updatedAt: nowIso(),
            },
          },
        );

        await createActivity(context, request.params.id, 'comment_edited', userId, {
          commentId: request.params.commentId,
        });

        const updated = await comments.findOne({ _id: request.params.commentId });
        const [enriched] = await enrichComments(context, [updated]);
        return ok(reply, enriched);
      } catch (err) {
        context.logger.error({ err }, 'Failed to edit comment');
        return fail(reply, 'Failed to edit comment');
      }
    },
  });

  context.registerRoute({
    method: 'DELETE',
    url: 'tickets/:id/comments/:commentId',
    handler: async (request, reply) => {
      try {
        const comments = context.db.collection('comments');
        const existing = await comments.findOne({ _id: request.params.commentId });
        if (!existing || existing.ticketId !== request.params.id || existing.isDeleted) {
          return fail(reply, 'Comment not found');
        }

        await comments.update(
          { _id: request.params.commentId },
          { $set: { isDeleted: true, updatedAt: nowIso() } },
        );
        await createActivity(
          context,
          request.params.id,
          'comment_deleted',
          getUserId(request),
          { commentId: request.params.commentId },
        );
        return ok(reply, { id: request.params.commentId });
      } catch (err) {
        context.logger.error({ err }, 'Failed to delete comment');
        return fail(reply, 'Failed to delete comment');
      }
    },
  });

  // ── Activities ───────────────────────────────────────────────────────────

  context.registerRoute({
    method: 'GET',
    url: 'tickets/:id/activities',
    handler: async (request, reply) => {
      try {
        const { page, pageSize, skip } = parsePagination(request.query);
        const activities = context.db.collection('activities');
        const filter = { ticketId: request.params.id };
        const [results, total] = await Promise.all([
          activities.find(filter, { sort: { createdAt: -1 }, limit: pageSize, skip }),
          activities.count(filter),
        ]);
        const enriched = await enrichActivities(context, results || []);
        return reply.send({
          success: true,
          data: enriched,
          total: total || 0,
          page,
          pageSize,
          totalPages: Math.ceil((total || 0) / pageSize) || 1,
        });
      } catch (err) {
        context.logger.error({ err }, 'Failed to fetch activities');
        return fail(reply, 'Failed to fetch activities');
      }
    },
  });

  // ── Tags ─────────────────────────────────────────────────────────────────

  context.registerRoute({
    method: 'GET',
    url: 'tags',
    handler: async (_request, reply) => {
      try {
        const tags = await context.db.collection('tags').find({}, { sort: { name: 1 } });
        return ok(reply, normalizeIds(tags || []));
      } catch (err) {
        context.logger.error({ err }, 'Failed to fetch tags');
        return fail(reply, 'Failed to fetch tags');
      }
    },
  });

  context.registerRoute({
    method: 'POST',
    url: 'tags',
    handler: async (request, reply) => {
      try {
        const name = request.body?.name?.trim();
        const color = request.body?.color || '#3b82f6';
        if (!name) return fail(reply, 'Tag name is required');

        const existing = await context.db.collection('tags').findOne({ name });
        if (existing) return fail(reply, 'Tag already exists');

        const tag = await context.db.collection('tags').insert({
          name,
          color,
          createdAt: nowIso(),
        });
        return ok(reply, normalizeId(tag));
      } catch (err) {
        context.logger.error({ err }, 'Failed to create tag');
        return fail(reply, 'Failed to create tag');
      }
    },
  });

  context.registerRoute({
    method: 'PUT',
    url: 'tags/:id',
    handler: async (request, reply) => {
      try {
        const tags = context.db.collection('tags');
        const existing = await tags.findOne({ _id: request.params.id });
        if (!existing) return fail(reply, 'Tag not found');

        const patch = {};
        if (request.body?.name?.trim()) patch.name = request.body.name.trim();
        if (request.body?.color) patch.color = request.body.color;
        if (Object.keys(patch).length === 0) return ok(reply, normalizeId(existing));

        await tags.update({ _id: request.params.id }, { $set: patch });
        const updated = await tags.findOne({ _id: request.params.id });
        return ok(reply, normalizeId(updated));
      } catch (err) {
        context.logger.error({ err }, 'Failed to update tag');
        return fail(reply, 'Failed to update tag');
      }
    },
  });

  context.registerRoute({
    method: 'DELETE',
    url: 'tags/:id',
    handler: async (request, reply) => {
      try {
        const count = await context.db.collection('tags').delete({ _id: request.params.id });
        if (!count) return fail(reply, 'Tag not found');
        return ok(reply, { id: request.params.id });
      } catch (err) {
        context.logger.error({ err }, 'Failed to delete tag');
        return fail(reply, 'Failed to delete tag');
      }
    },
  });

  // ── Templates ────────────────────────────────────────────────────────────

  context.registerRoute({
    method: 'GET',
    url: 'templates',
    handler: async (_request, reply) => {
      try {
        const templates = await context.db
          .collection('templates')
          .find({}, { sort: { name: 1 } });
        return ok(reply, normalizeIds(templates || []));
      } catch (err) {
        context.logger.error({ err }, 'Failed to fetch templates');
        return fail(reply, 'Failed to fetch templates');
      }
    },
  });

  context.registerRoute({
    method: 'POST',
    url: 'templates',
    handler: async (request, reply) => {
      try {
        const body = request.body || {};
        if (!body.name?.trim()) return fail(reply, 'Template name is required');

        const template = await context.db.collection('templates').insert({
          name: body.name.trim(),
          description: body.description || '',
          category: body.category || cfg(context, 'defaultCategory', 'Support'),
          priority: body.priority || cfg(context, 'defaultPriority', 'medium'),
          titleTemplate: body.titleTemplate || '',
          descriptionTemplate: body.descriptionTemplate || '',
          tags: Array.isArray(body.tags) ? body.tags : [],
          isDefault: Boolean(body.isDefault),
          createdAt: nowIso(),
        });
        return ok(reply, normalizeId(template));
      } catch (err) {
        context.logger.error({ err }, 'Failed to create template');
        return fail(reply, 'Failed to create template');
      }
    },
  });

  context.registerRoute({
    method: 'PUT',
    url: 'templates/:id',
    handler: async (request, reply) => {
      try {
        const templates = context.db.collection('templates');
        const existing = await templates.findOne({ _id: request.params.id });
        if (!existing) return fail(reply, 'Template not found');

        const body = request.body || {};
        const allowed = [
          'name',
          'description',
          'category',
          'priority',
          'titleTemplate',
          'descriptionTemplate',
          'tags',
          'isDefault',
        ];
        const patch = {};
        for (const key of allowed) {
          if (body[key] !== undefined) patch[key] = body[key];
        }
        if (patch.name) patch.name = String(patch.name).trim();

        await templates.update({ _id: request.params.id }, { $set: patch });
        const updated = await templates.findOne({ _id: request.params.id });
        return ok(reply, normalizeId(updated));
      } catch (err) {
        context.logger.error({ err }, 'Failed to update template');
        return fail(reply, 'Failed to update template');
      }
    },
  });

  context.registerRoute({
    method: 'DELETE',
    url: 'templates/:id',
    handler: async (request, reply) => {
      try {
        const count = await context.db
          .collection('templates')
          .delete({ _id: request.params.id });
        if (!count) return fail(reply, 'Template not found');
        return ok(reply, { id: request.params.id });
      } catch (err) {
        context.logger.error({ err }, 'Failed to delete template');
        return fail(reply, 'Failed to delete template');
      }
    },
  });

  // ── Settings / Stats / Meta ──────────────────────────────────────────────

  context.registerRoute({
    method: 'GET',
    url: 'settings',
    handler: async (_request, reply) => {
      try {
        return ok(reply, await getSettings(context));
      } catch (err) {
        context.logger.error({ err }, 'Failed to fetch settings');
        return fail(reply, 'Failed to fetch settings');
      }
    },
  });

  context.registerRoute({
    method: 'PUT',
    url: 'settings',
    handler: async (request, reply) => {
      try {
        const body = request.body || {};
        const allowed = [
          'autoAssignEnabled',
          'autoCloseDays',
          'defaultPriority',
          'defaultCategory',
          'responseSlaHours',
          'resolutionSlaHours',
          'maxEscalationLevel',
        ];
        const patch = { updatedAt: nowIso() };
        for (const key of allowed) {
          if (body[key] !== undefined) patch[key] = body[key];
        }

        const col = context.db.collection('plugin_settings');
        const existing = await col.findOne({ _type: 'ticketing_settings' });
        if (existing) {
          await col.update({ _type: 'ticketing_settings' }, { $set: patch });
        } else {
          await col.insert({ _type: 'ticketing_settings', ...patch });
        }
        return ok(reply, await getSettings(context));
      } catch (err) {
        context.logger.error({ err }, 'Failed to update settings');
        return fail(reply, 'Failed to update settings');
      }
    },
  });

  context.registerRoute({
    method: 'GET',
    url: 'stats',
    handler: async (request, reply) => {
      try {
        const filter = { isDeleted: { $ne: true } };
        if (request.query.assigneeId) {
          filter.$or = [
            { assigneeId: request.query.assigneeId },
            { reporterId: request.query.assigneeId },
          ];
        }
        if (request.query.serverId) {
          filter.serverId = request.query.serverId;
        }
        if (request.query.myTickets === 'true') {
          const uid = getUserId(request);
          if (uid) {
            filter.$or = [{ assigneeId: uid }, { reporterId: uid }];
          }
        }

        const list = (await context.db.collection('tickets').find(filter)) || [];
        const today = new Date().toISOString().slice(0, 10);
        const stats = {
          total: list.length,
          open: 0,
          inProgress: 0,
          pending: 0,
          resolved: 0,
          closed: 0,
          critical: 0,
          overdue: 0,
          unassigned: 0,
          slaBreached: 0,
          createdToday: 0,
          resolvedToday: 0,
          myTickets: 0,
          avgResolutionHours: 0,
          byStatus: Object.fromEntries(STATUSES.map((s) => [s, 0])),
          byPriority: Object.fromEntries(PRIORITIES.map((p) => [p, 0])),
          byCategory: {},
          byAssignee: {},
        };

        let totalResolutionMs = 0;
        let resolvedCount = 0;
        const uid = getUserId(request);

        for (const t of list) {
          stats.byStatus[t.status] = (stats.byStatus[t.status] || 0) + 1;
          if (t.status === 'open') stats.open++;
          else if (t.status === 'in_progress') stats.inProgress++;
          else if (t.status === 'pending') stats.pending++;
          else if (t.status === 'resolved') stats.resolved++;
          else if (t.status === 'closed') stats.closed++;

          stats.byPriority[t.priority] = (stats.byPriority[t.priority] || 0) + 1;
          if (t.priority === 'critical') stats.critical++;

          stats.byCategory[t.category] = (stats.byCategory[t.category] || 0) + 1;
          if (t.assigneeId) {
            stats.byAssignee[t.assigneeId] = (stats.byAssignee[t.assigneeId] || 0) + 1;
          } else {
            stats.unassigned++;
          }

          if (t.sla?.resolutionBreached && !['resolved', 'closed'].includes(t.status)) {
            stats.overdue++;
          }
          if (t.sla?.responseBreached || t.sla?.resolutionBreached) {
            stats.slaBreached++;
          }
          if (t.createdAt?.startsWith(today)) stats.createdToday++;
          if (t.resolvedAt?.startsWith(today)) stats.resolvedToday++;
          if (uid && (t.assigneeId === uid || t.reporterId === uid)) stats.myTickets++;

          if (t.resolvedAt && t.createdAt) {
            const ms = new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime();
            if (ms > 0) {
              totalResolutionMs += ms;
              resolvedCount++;
            }
          }
        }

        stats.avgResolutionHours =
          resolvedCount > 0
            ? Math.round(totalResolutionMs / resolvedCount / 3600000)
            : 0;

        return ok(reply, stats);
      } catch (err) {
        context.logger.error({ err }, 'Failed to get stats');
        return fail(reply, 'Failed to get stats');
      }
    },
  });

  context.registerRoute({
    method: 'GET',
    url: 'export',
    handler: async (request, reply) => {
      try {
        const filter = buildTicketFilter(request.query);
        const results =
          (await context.db
            .collection('tickets')
            .find(filter, { sort: { createdAt: -1 } })) || [];
        const enriched = await enrichTickets(context, results);

        if (request.query.format === 'csv') {
          const headers = [
            'Ticket Number',
            'Title',
            'Status',
            'Priority',
            'Category',
            'Assignee',
            'Reporter',
            'Server',
            'Tags',
            'Escalation Level',
            'SLA Response Breached',
            'SLA Resolution Breached',
            'Created At',
            'Updated At',
            'Resolved At',
          ];
          const rows = enriched.map((t) =>
            [
              t.ticketNumber,
              t.title,
              t.status,
              t.priority,
              t.category,
              t.assignee?.username || t.assigneeId || '',
              t.reporter?.username || t.reporterId || '',
              t.server?.name || t.serverId || '',
              (t.tags || []).join('; '),
              t.escalationLevel,
              t.sla?.responseBreached ? 'Yes' : 'No',
              t.sla?.resolutionBreached ? 'Yes' : 'No',
              t.createdAt,
              t.updatedAt,
              t.resolvedAt || '',
            ]
              .map(csvEscape)
              .join(','),
          );
          const csv = [headers.join(','), ...rows].join('\n');
          reply.header('Content-Type', 'text/csv');
          reply.header('Content-Disposition', 'attachment; filename="tickets-export.csv"');
          return reply.send(csv);
        }

        reply.header('Content-Type', 'application/json');
        reply.header('Content-Disposition', 'attachment; filename="tickets-export.json"');
        return reply.send({
          success: true,
          data: enriched,
          exportedAt: nowIso(),
        });
      } catch (err) {
        context.logger.error({ err }, 'Export failed');
        return fail(reply, 'Export failed');
      }
    },
  });

  context.registerRoute({
    method: 'GET',
    url: 'users',
    handler: async (_request, reply) => {
      try {
        const users = await context.db.users.findMany({
          select: {
            id: true,
            username: true,
            email: true,
            name: true,
            image: true,
          },
          orderBy: { username: 'asc' },
          take: 500,
        });
        return ok(
          reply,
          (users || []).map((u) => ({
            id: u.id,
            username: u.username,
            email: u.email,
            name: u.name || u.username,
            image: u.image || null,
          })),
        );
      } catch (err) {
        context.logger.error({ err }, 'Failed to fetch users');
        return fail(reply, 'Failed to fetch users');
      }
    },
  });

  context.registerRoute({
    method: 'GET',
    url: 'servers',
    handler: async (_request, reply) => {
      try {
        const servers = await context.db.servers.findMany({
          select: {
            id: true,
            name: true,
            uuid: true,
            status: true,
          },
          orderBy: { name: 'asc' },
          take: 500,
        });
        return ok(
          reply,
          (servers || []).map((s) => ({
            id: s.id,
            name: s.name || 'Unknown',
            uuid: s.uuid || null,
            status: s.status || 'unknown',
          })),
        );
      } catch (err) {
        context.logger.error({ err }, 'Failed to fetch servers');
        return fail(reply, 'Failed to fetch servers');
      }
    },
  });

  context.registerRoute({
    method: 'GET',
    url: 'categories',
    handler: async (_request, reply) => ok(reply, CATEGORIES),
  });

  context.registerRoute({
    method: 'GET',
    url: 'statuses',
    handler: async (_request, reply) => ok(reply, STATUS_TRANSITIONS),
  });

  context.registerRoute({
    method: 'GET',
    url: 'priorities',
    handler: async (_request, reply) => ok(reply, PRIORITIES),
  });
}
