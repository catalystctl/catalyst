/**
 * Ticketing Plugin Backend
 *
 * Full-featured ticketing system with:
 * - Tickets with server/user linking, categories, priorities, statuses
 * - Comments on tickets with rich text
 * - Category and priority management
 * - Assignment workflow (assign to staff members)
 * - Status workflow (open → in_progress → resolved → closed)
 * - Filtering, sorting, searching
 * - Dashboard statistics
 * - WebSocket notifications for real-time updates
 * - Auto-close resolved tickets (cron job)
 * - Persistent storage via PluginStorage API
 */

let context;

// ── Default Categories ──
const DEFAULT_CATEGORIES = [
  { id: 'general', name: 'General', description: 'General inquiries and questions', color: '#6B7280', icon: '💬' },
  { id: 'billing', name: 'Billing', description: 'Billing, payments, and invoices', color: '#F59E0B', icon: '💳' },
  { id: 'technical', name: 'Technical Support', description: 'Technical issues and troubleshooting', color: '#3B82F6', icon: '🔧' },
  { id: 'server', name: 'Server Issues', description: 'Server performance, crashes, and errors', color: '#EF4444', icon: '🖥️' },
  { id: 'feature', name: 'Feature Request', description: 'Suggestions for new features and improvements', color: '#8B5CF6', icon: '✨' },
  { id: 'bug', name: 'Bug Report', description: 'Report bugs and unexpected behavior', color: '#DC2626', icon: '🐛' },
];

const DEFAULT_STATUSES = [
  { id: 'open', label: 'Open', color: '#3B82F6', order: 0 },
  { id: 'in_progress', label: 'In Progress', color: '#F59E0B', order: 1 },
  { id: 'pending', label: 'Pending', color: '#8B5CF6', order: 2 },
  { id: 'resolved', label: 'Resolved', color: '#10B981', order: 3 },
  { id: 'closed', label: 'Closed', color: '#6B7280', order: 4 },
];

const VALID_STATUS_TRANSITIONS = {
  open: ['in_progress', 'closed'],
  in_progress: ['open', 'pending', 'resolved'],
  pending: ['open', 'in_progress', 'closed'],
  resolved: ['open', 'in_progress', 'closed'],
  closed: ['open'],
};

// ── Helper: Generate unique ID ──
function generateId() {
  return `TKT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

function generateCommentId() {
  return `CMT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

// ── Helper: Storage keys ──
const KEYS = {
  TICKETS: 'tickets',
  COMMENTS: 'comments',
  CATEGORIES: 'categories',
  STATUSES: 'statuses',
  SETTINGS: 'settings',
  COUNTERS: 'counters',
  INITIALIZED: 'initialized',
};

// ── Helper: Get all tickets from storage ──
async function getTickets() {
  return (await context.getStorage(KEYS.TICKETS)) || [];
}

async function saveTickets(tickets) {
  await context.setStorage(KEYS.TICKETS, tickets);
}

async function getComments() {
  return (await context.getStorage(KEYS.COMMENTS)) || [];
}

async function saveComments(comments) {
  await context.setStorage(KEYS.COMMENTS, comments);
}

async function getCategories() {
  return (await context.getStorage(KEYS.CATEGORIES)) || DEFAULT_CATEGORIES;
}

async function getSettings() {
  return (await context.getStorage(KEYS.SETTINGS)) || { customFields: [], autoAssignEnabled: false };
}

async function getCounters() {
  return (await context.getStorage(KEYS.COUNTERS)) || { total: 0 };
}

async function incrementCounter() {
  const counters = await getCounters();
  counters.total++;
  await context.setStorage(KEYS.COUNTERS, counters);
  return counters.total;
}

// ── Helper: Get user from DB ──
async function getUserById(userId) {
  if (!userId) return null;
  return context.db.users.findUnique({
    where: { id: userId },
    select: { id: true, name: true, username: true, email: true, image: true },
  });
}

// ── Helper: Get server from DB ──
async function getServerById(serverId) {
  if (!serverId) return null;
  return context.db.servers.findUnique({
    where: { id: serverId },
    select: { id: true, name: true, uuid: true, status: true },
  });
}

// ── Helper: Get all users for assignment dropdown ──
async function getUsersForAssignment() {
  return context.db.users.findMany({
    where: { banned: false },
    select: { id: true, name: true, username: true, email: true, image: true },
    orderBy: { name: 'asc' },
  });
}

// ── Helper: Broadcast ticket update via WebSocket ──
function broadcastTicketUpdate(event, data) {
  try {
    context.emit(`ticketing:${event}`, data);
  } catch (err) {
    // WebSocket might not be available
  }
}

// ── Helper: Get config value (handles both raw values and {type,default,description} schema objects) ──
function cfg(key, fallback) {
 const raw = context.getConfig(key);
 if (raw == null) return fallback;
 if (typeof raw === 'object' && raw.default !== undefined) return raw.default;
 return raw;
}

// ── Helper: Validate priority ──
function validatePriority(priority) {
  const allowed = (cfg('allowedPriorities', 'low,medium,high,critical')).split(',');
  return allowed.includes(priority) ? priority : cfg('defaultPriority', 'medium');
}

// ── Helper: Validate status transition ──
function validateStatusTransition(from, to) {
  if (from === to) return true;
  const allowed = VALID_STATUS_TRANSITIONS[from];
  return allowed ? allowed.includes(to) : false;
}

// ── Helper: Apply filters ──
function applyFilters(tickets, query) {
  let result = [...tickets];

  if (query.status) {
    const statuses = String(query.status).split(',');
    result = result.filter((t) => statuses.includes(t.status));
  }
  if (query.priority) {
    const priorities = String(query.priority).split(',');
    result = result.filter((t) => priorities.includes(t.priority));
  }
  if (query.category) {
    const categories = String(query.category).split(',');
    result = result.filter((t) => categories.includes(t.category));
  }
  if (query.assignedTo) {
    result = result.filter((t) => t.assignedTo === query.assignedTo);
  }
  if (query.createdBy) {
    result = result.filter((t) => t.createdBy === query.createdBy);
  }
  if (query.serverId) {
    result = result.filter((t) => t.serverId === query.serverId);
  }
  if (query.userId) {
    result = result.filter((t) => t.userId === query.userId);
  }

  // Search in subject, description, and ticket ID
  if (query.search) {
    const term = String(query.search).toLowerCase();
    result = result.filter(
      (t) =>
        t.id.toLowerCase().includes(term) ||
        t.subject.toLowerCase().includes(term) ||
        t.description.toLowerCase().includes(term)
    );
  }

  // Sorting
  const sort = query.sort || 'newest';
  switch (sort) {
    case 'newest':
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      break;
    case 'oldest':
      result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      break;
    case 'priority':
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      result.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));
      break;
    case 'updated':
      result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      break;
  }

  return result;
}

// ── Helper: Enrich ticket with user/server info ──
async function enrichTickets(tickets) {
  const userIds = [...new Set(tickets.map((t) => t.createdBy).filter(Boolean))];
  const assigneeIds = [...new Set(tickets.map((t) => t.assignedTo).filter(Boolean))];
  const serverIds = [...new Set(tickets.map((t) => t.serverId).filter(Boolean))];

  const [users, assignees, servers] = await Promise.all([
    userIds.length > 0
      ? context.db.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, username: true, email: true, image: true },
        })
      : [],
    assigneeIds.length > 0
      ? context.db.users.findMany({
          where: { id: { in: assigneeIds } },
          select: { id: true, name: true, username: true, email: true, image: true },
        })
      : [],
    serverIds.length > 0
      ? context.db.servers.findMany({
          where: { id: { in: serverIds } },
          select: { id: true, name: true, uuid: true, status: true },
        })
      : [],
  ]);

  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  const assigneeMap = Object.fromEntries(assignees.map((u) => [u.id, u]));
  const serverMap = Object.fromEntries(servers.map((s) => [s.id, s]));

  return tickets.map((t) => ({
    ...t,
    creator: userMap[t.createdBy] || null,
    assignee: assigneeMap[t.assignedTo] || null,
    server: serverMap[t.serverId] || null,
  }));
}

// ── Helper: Enrich comments with user info ──
async function enrichComments(comments) {
  const userIds = [...new Set(comments.map((c) => c.userId).filter(Boolean))];
  const users =
    userIds.length > 0
      ? await context.db.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, username: true, email: true, image: true },
        })
      : [];
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));
  return comments.map((c) => ({ ...c, user: userMap[c.userId] || null }));
}

// ═══════════════════════════════════════════════════════════════
//  PLUGIN DEFINITION
// ═══════════════════════════════════════════════════════════════

const plugin = {
  async onLoad(ctx) {
    context = ctx;
    ctx.logger.info('Ticketing plugin loaded');

    // Initialize storage
    const initialized = await ctx.getStorage(KEYS.INITIALIZED);
    if (!initialized) {
      await ctx.setStorage(KEYS.INITIALIZED, true);
      await ctx.setStorage(KEYS.CATEGORIES, DEFAULT_CATEGORIES);
      await ctx.setStorage(KEYS.STATUSES, DEFAULT_STATUSES);
      await ctx.setStorage(KEYS.TICKETS, []);
      await ctx.setStorage(KEYS.COMMENTS, []);
      await ctx.setStorage(KEYS.COUNTERS, { total: 0 });
      await ctx.setStorage(KEYS.SETTINGS, { customFields: [], autoAssignEnabled: false });
      await ctx.setStorage('installDate', new Date().toISOString());
      ctx.logger.info('Ticketing plugin initialized for the first time');
    }

    // ── TICKETS ROUTES ──

    // List tickets (with filters)
    ctx.registerRoute({
      method: 'GET',
      url: '/tickets',
      handler: async (request) => {
        const query = request.query || {};
        const tickets = await getTickets();
        const filtered = applyFilters(tickets, query);

        // Pagination
        const page = parseInt(query.page) || 1;
        const limit = parseInt(query.limit) || 25;
        const offset = (page - 1) * limit;
        const paginated = filtered.slice(offset, offset + limit);

        const enriched = await enrichTickets(paginated);

        return {
          success: true,
          data: enriched,
          pagination: {
            page,
            limit,
            total: filtered.length,
            totalPages: Math.ceil(filtered.length / limit),
          },
        };
      },
    });

    // Get single ticket
    ctx.registerRoute({
      method: 'GET',
      url: '/tickets/:id',
      handler: async (request) => {
        const { id } = request.params;
        const tickets = await getTickets();
        const ticket = tickets.find((t) => t.id === id);

        if (!ticket) {
          return { success: false, error: 'Ticket not found' };
        }

        const comments = await getComments();
        const ticketComments = comments
          .filter((c) => c.ticketId === id)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        const [enrichedTickets, enrichedComments] = await Promise.all([
          enrichTickets([ticket]),
          enrichComments(ticketComments),
        ]);

        return {
          success: true,
          data: {
            ...enrichedTickets[0],
            comments: enrichedComments,
          },
        };
      },
    });

    // Create ticket
    ctx.registerRoute({
      method: 'POST',
      url: '/tickets',
      handler: async (request) => {
        const body = request.body || {};
        const {
          subject,
          description,
          category,
          priority,
          serverId,
          userId,
          createdBy,
          tags,
          customFields,
        } = body;

        if (!subject || !description) {
          return { success: false, error: 'Subject and description are required' };
        }

        if (subject.length > 200) {
          return { success: false, error: 'Subject must be 200 characters or less' };
        }

        if (description.length > 10000) {
          return { success: false, error: 'Description must be 10,000 characters or less' };
        }

        // Validate server exists if provided
        if (serverId) {
          const server = await getServerById(serverId);
          if (!server) {
            return { success: false, error: 'Linked server not found' };
          }
        }

        // Validate user exists if provided
        const linkedUserId = userId || createdBy;
        if (linkedUserId) {
          const user = await getUserById(linkedUserId);
          if (!user) {
            return { success: false, error: 'Linked user not found' };
          }
        }

        // Check max open tickets
        const maxOpen = parseInt(cfg('maxOpenTicketsPerUser', 20)) || 0;
        if (maxOpen > 0 && linkedUserId) {
          const tickets = await getTickets();
          const openCount = tickets.filter(
            (t) => t.createdBy === linkedUserId && !['closed', 'resolved'].includes(t.status)
          ).length;
          if (openCount >= maxOpen) {
            return {
              success: false,
              error: `Maximum of ${maxOpen} open tickets reached`,
            };
          }
        }

        const count = await incrementCounter();
        const ticketId = generateId();
        const now = new Date().toISOString();

        const ticket = {
          id: ticketId,
          ticketNumber: count,
          subject: subject.trim(),
          description: description.trim(),
          category: category || 'general',
          priority: validatePriority(priority),
          status: 'open',
          serverId: serverId || null,
          userId: linkedUserId || null,
          createdBy: linkedUserId || null,
          assignedTo: null,
          tags: tags || [],
          customFields: customFields || {},
          createdAt: now,
          updatedAt: now,
          resolvedAt: null,
          closedAt: null,
          lastCommentAt: null,
          lastCommentBy: null,
        };

        const tickets = await getTickets();
        tickets.push(ticket);
        await saveTickets(tickets);

        const [enriched] = await enrichTickets([ticket]);

        broadcastTicketUpdate('ticket:created', { ticket: enriched });

        return { success: true, data: enriched };
      },
    });

    // Update ticket (status, priority, assignment, etc.)
    ctx.registerRoute({
      method: 'PUT',
      url: '/tickets/:id',
      handler: async (request) => {
        const { id } = request.params;
        const body = request.body || {};
        const tickets = await getTickets();
        const idx = tickets.findIndex((t) => t.id === id);

        if (idx === -1) {
          return { success: false, error: 'Ticket not found' };
        }

        const ticket = { ...tickets[idx] };
        const changes = [];
        const now = new Date().toISOString();

        // Status transition
        if (body.status && body.status !== ticket.status) {
          if (!validateStatusTransition(ticket.status, body.status)) {
            return {
              success: false,
              error: `Cannot transition from '${ticket.status}' to '${body.status}'. Allowed: ${VALID_STATUS_TRANSITIONS[ticket.status].join(', ')}`,
            };
          }
          changes.push({ field: 'status', from: ticket.status, to: body.status });
          ticket.status = body.status;
          ticket.updatedAt = now;

          if (body.status === 'resolved') {
            ticket.resolvedAt = now;
          } else {
            ticket.resolvedAt = null;
          }
          if (body.status === 'closed') {
            ticket.closedAt = now;
          } else {
            ticket.closedAt = null;
          }
        }

        // Priority
        if (body.priority && body.priority !== ticket.priority) {
          changes.push({ field: 'priority', from: ticket.priority, to: body.priority });
          ticket.priority = validatePriority(body.priority);
          ticket.updatedAt = now;
        }

        // Assignment
        if (body.assignedTo !== undefined && body.assignedTo !== ticket.assignedTo) {
          if (body.assignedTo) {
            const assignee = await getUserById(body.assignedTo);
            if (!assignee) {
              return { success: false, error: 'Assigned user not found' };
            }
          }
          changes.push({ field: 'assignedTo', from: ticket.assignedTo, to: body.assignedTo });
          ticket.assignedTo = body.assignedTo || null;
          ticket.updatedAt = now;
        }

        // Subject
        if (body.subject && body.subject !== ticket.subject) {
          changes.push({ field: 'subject', from: ticket.subject, to: body.subject });
          ticket.subject = body.subject.trim().substring(0, 200);
          ticket.updatedAt = now;
        }

        // Description
        if (body.description && body.description !== ticket.description) {
          ticket.description = body.description.trim().substring(0, 10000);
          ticket.updatedAt = now;
        }

        // Category
        if (body.category && body.category !== ticket.category) {
          const categories = await getCategories();
          if (!categories.find((c) => c.id === body.category)) {
            return { success: false, error: 'Invalid category' };
          }
          changes.push({ field: 'category', from: ticket.category, to: body.category });
          ticket.category = body.category;
          ticket.updatedAt = now;
        }

        // Server link
        if (body.serverId !== undefined && body.serverId !== ticket.serverId) {
          if (body.serverId) {
            const server = await getServerById(body.serverId);
            if (!server) {
              return { success: false, error: 'Linked server not found' };
            }
          }
          ticket.serverId = body.serverId || null;
          ticket.updatedAt = now;
        }

        // User link
        if (body.userId !== undefined && body.userId !== ticket.userId) {
          if (body.userId) {
            const user = await getUserById(body.userId);
            if (!user) {
              return { success: false, error: 'Linked user not found' };
            }
          }
          ticket.userId = body.userId || null;
          ticket.updatedAt = now;
        }

        // Tags
        if (body.tags !== undefined) {
          ticket.tags = Array.isArray(body.tags) ? body.tags : [];
          ticket.updatedAt = now;
        }

        // Custom fields
        if (body.customFields !== undefined) {
          ticket.customFields = body.customFields || {};
          ticket.updatedAt = now;
        }

        tickets[idx] = ticket;
        await saveTickets(tickets);

        const [enriched] = await enrichTickets([ticket]);

        broadcastTicketUpdate('ticket:updated', { ticket: enriched, changes });

        // Specific notifications
        if (changes.find((c) => c.field === 'status')) {
          broadcastTicketUpdate('ticket:status-changed', {
            ticketId: id,
            status: ticket.status,
            previousStatus: changes.find((c) => c.field === 'status')?.from,
          });
        }
        if (changes.find((c) => c.field === 'assignedTo') && cfg('notifyOnAssignment', true)) {
          broadcastTicketUpdate('ticket:assigned', {
            ticketId: id,
            assignedTo: ticket.assignedTo,
          });
        }

        return { success: true, data: enriched };
      },
    });

    // Delete ticket
    ctx.registerRoute({
      method: 'DELETE',
      url: '/tickets/:id',
      handler: async (request) => {
        const { id } = request.params;
        let tickets = await getTickets();
        const idx = tickets.findIndex((t) => t.id === id);

        if (idx === -1) {
          return { success: false, error: 'Ticket not found' };
        }

        tickets = tickets.filter((t) => t.id !== id);
        await saveTickets(tickets);

        // Also delete associated comments
        let comments = await getComments();
        comments = comments.filter((c) => c.ticketId !== id);
        await saveComments(comments);

        broadcastTicketUpdate('ticket:deleted', { ticketId: id });

        return { success: true, message: 'Ticket deleted' };
      },
    });

    // Bulk update tickets
    ctx.registerRoute({
      method: 'POST',
      url: '/tickets/bulk',
      handler: async (request) => {
        const { ticketIds, updates } = request.body || {};

        if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
          return { success: false, error: 'ticketIds array is required' };
        }
        if (!updates || typeof updates !== 'object') {
          return { success: false, error: 'updates object is required' };
        }
        if (ticketIds.length > 100) {
          return { success: false, error: 'Cannot update more than 100 tickets at once' };
        }

        const tickets = await getTickets();
        const now = new Date().toISOString();
        let updated = 0;

        for (const id of ticketIds) {
          const idx = tickets.findIndex((t) => t.id === id);
          if (idx === -1) continue;

          if (updates.status) {
            if (validateStatusTransition(tickets[idx].status, updates.status)) {
              tickets[idx].status = updates.status;
              tickets[idx].updatedAt = now;
              if (updates.status === 'resolved') tickets[idx].resolvedAt = now;
              if (updates.status === 'closed') tickets[idx].closedAt = now;
            }
          }
          if (updates.priority) {
            tickets[idx].priority = validatePriority(updates.priority);
            tickets[idx].updatedAt = now;
          }
          if (updates.assignedTo !== undefined) {
            tickets[idx].assignedTo = updates.assignedTo || null;
            tickets[idx].updatedAt = now;
          }
          if (updates.category) {
            tickets[idx].category = updates.category;
            tickets[idx].updatedAt = now;
          }
          updated++;
        }

        await saveTickets(tickets);

        broadcastTicketUpdate('ticket:bulk-updated', {
          ticketIds,
          updates,
          count: updated,
        });

        return { success: true, data: { updated } };
      },
    });

    // ── COMMENTS ROUTES ──

    // Get comments for a ticket
    ctx.registerRoute({
      method: 'GET',
      url: '/tickets/:id/comments',
      handler: async (request) => {
        const { id } = request.params;
        const tickets = await getTickets();
        const ticket = tickets.find((t) => t.id === id);

        if (!ticket) {
          return { success: false, error: 'Ticket not found' };
        }

        const comments = await getComments();
        const ticketComments = comments
          .filter((c) => c.ticketId === id)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        const enriched = await enrichComments(ticketComments);

        return { success: true, data: enriched };
      },
    });

    // Add comment to a ticket
    ctx.registerRoute({
      method: 'POST',
      url: '/tickets/:id/comments',
      handler: async (request) => {
        const { id } = request.params;
        const { content, isInternal, statusChange } = request.body || {};

        if (!content || content.trim().length === 0) {
          return { success: false, error: 'Comment content is required' };
        }

        if (content.length > 5000) {
          return { success: false, error: 'Comment must be 5,000 characters or less' };
        }

        const tickets = await getTickets();
        const idx = tickets.findIndex((t) => t.id === id);

        if (idx === -1) {
          return { success: false, error: 'Ticket not found' };
        }

        if (['closed'].includes(tickets[idx].status)) {
          return { success: false, error: 'Cannot add comments to a closed ticket' };
        }

        const now = new Date().toISOString();
        const comment = {
          id: generateCommentId(),
          ticketId: id,
          content: content.trim(),
          userId: request.user?.userId || request.body?.userId || null,
          isInternal: isInternal || false,
          editedAt: null,
          createdAt: now,
        };

        const comments = await getComments();
        comments.push(comment);
        await saveComments(comments);

        // Update ticket
        tickets[idx].lastCommentAt = now;
        tickets[idx].lastCommentBy = comment.userId;
        tickets[idx].updatedAt = now;

        // Handle status change via comment
        if (statusChange && validateStatusTransition(tickets[idx].status, statusChange)) {
          tickets[idx].status = statusChange;
          if (statusChange === 'resolved') tickets[idx].resolvedAt = now;
          if (statusChange === 'closed') tickets[idx].closedAt = now;
        }

        await saveTickets(tickets);

        const [enriched] = await enrichComments([comment]);
        const [enrichedTicket] = await enrichTickets([tickets[idx]]);

        broadcastTicketUpdate('ticket:comment-added', {
          ticketId: id,
          comment: enriched,
        });

        if (statusChange) {
          broadcastTicketUpdate('ticket:status-changed', {
            ticketId: id,
            status: statusChange,
          });
        }

        return { success: true, data: enriched };
      },
    });

    // Update comment
    ctx.registerRoute({
      method: 'PUT',
      url: '/tickets/:id/comments/:commentId',
      handler: async (request) => {
        const { commentId } = request.params;
        const { content } = request.body || {};

        if (!content || content.trim().length === 0) {
          return { success: false, error: 'Comment content is required' };
        }

        const comments = await getComments();
        const idx = comments.findIndex((c) => c.id === commentId);

        if (idx === -1) {
          return { success: false, error: 'Comment not found' };
        }

        comments[idx].content = content.trim();
        comments[idx].editedAt = new Date().toISOString();
        await saveComments(comments);

        const [enriched] = await enrichComments([comments[idx]]);

        return { success: true, data: enriched };
      },
    });

    // Delete comment
    ctx.registerRoute({
      method: 'DELETE',
      url: '/tickets/:id/comments/:commentId',
      handler: async (request) => {
        const { commentId } = request.params;
        let comments = await getComments();
        const idx = comments.findIndex((c) => c.id === commentId);

        if (idx === -1) {
          return { success: false, error: 'Comment not found' };
        }

        const ticketId = comments[idx].ticketId;
        comments = comments.filter((c) => c.id !== commentId);
        await saveComments(comments);

        broadcastTicketUpdate('ticket:comment-deleted', {
          ticketId,
          commentId,
        });

        return { success: true, message: 'Comment deleted' };
      },
    });

    // ── CATEGORIES ROUTES ──

    // List categories
    ctx.registerRoute({
      method: 'GET',
      url: '/categories',
      handler: async () => {
        const categories = await getCategories();
        return { success: true, data: categories };
      },
    });

    // Create category
    ctx.registerRoute({
      method: 'POST',
      url: '/categories',
      handler: async (request) => {
        const { id, name, description, color, icon } = request.body || {};

        if (!id || !name) {
          return { success: false, error: 'Category ID and name are required' };
        }

        const categories = await getCategories();
        if (categories.find((c) => c.id === id)) {
          return { success: false, error: 'Category ID already exists' };
        }

        const category = {
          id,
          name,
          description: description || '',
          color: color || '#6B7280',
          icon: icon || '📌',
        };

        categories.push(category);
        await ctx.setStorage(KEYS.CATEGORIES, categories);

        return { success: true, data: category };
      },
    });

    // Update category
    ctx.registerRoute({
      method: 'PUT',
      url: '/categories/:id',
      handler: async (request) => {
        const { id } = request.params;
        const { name, description, color, icon } = request.body || {};

        const categories = await getCategories();
        const idx = categories.findIndex((c) => c.id === id);

        if (idx === -1) {
          return { success: false, error: 'Category not found' };
        }

        if (name) categories[idx].name = name;
        if (description !== undefined) categories[idx].description = description;
        if (color) categories[idx].color = color;
        if (icon) categories[idx].icon = icon;

        await ctx.setStorage(KEYS.CATEGORIES, categories);

        return { success: true, data: categories[idx] };
      },
    });

    // Delete category
    ctx.registerRoute({
      method: 'DELETE',
      url: '/categories/:id',
      handler: async (request) => {
        const { id } = request.params;
        let categories = await getCategories();
        const idx = categories.findIndex((c) => c.id === id);

        if (idx === -1) {
          return { success: false, error: 'Category not found' };
        }

        // Don't allow deleting default categories that are in use
        const tickets = await getTickets();
        const inUse = tickets.some((t) => t.category === id);
        if (inUse) {
          return {
            success: false,
            error: 'Cannot delete category that is in use by tickets. Reassign those tickets first.',
          };
        }

        categories = categories.filter((c) => c.id !== id);
        await ctx.setStorage(KEYS.CATEGORIES, categories);

        return { success: true, message: 'Category deleted' };
      },
    });

    // ── STATUSES ROUTES ──

    ctx.registerRoute({
      method: 'GET',
      url: '/statuses',
      handler: async () => {
        const statuses = (await ctx.getStorage(KEYS.STATUSES)) || DEFAULT_STATUSES;
        return { success: true, data: statuses };
      },
    });

    ctx.registerRoute({
      method: 'GET',
      url: '/transitions',
      handler: async () => {
        return { success: true, data: VALID_STATUS_TRANSITIONS };
      },
    });

    // ── USERS (for assignment dropdown) ──

    ctx.registerRoute({
      method: 'GET',
      url: '/users',
      handler: async () => {
        const users = await getUsersForAssignment();
        return { success: true, data: users };
      },
    });

    // ── SERVERS (for linking dropdown) ──

    ctx.registerRoute({
      method: 'GET',
      url: '/servers',
      handler: async () => {
        const servers = await context.db.servers.findMany({
          select: { id: true, name: true, uuid: true, status: true },
          orderBy: { name: 'asc' },
        });
        return { success: true, data: servers };
      },
    });

    // ── DASHBOARD / STATS ──

    ctx.registerRoute({
      method: 'GET',
      url: '/stats',
      handler: async (request) => {
        const tickets = await getTickets();
        const comments = await getComments();
        const now = new Date();
        const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);

        const open = tickets.filter((t) => t.status === 'open').length;
        const inProgress = tickets.filter((t) => t.status === 'in_progress').length;
        const pending = tickets.filter((t) => t.status === 'pending').length;
        const resolved = tickets.filter((t) => t.status === 'resolved').length;
        const closed = tickets.filter((t) => t.status === 'closed').length;
        const total = tickets.length;

        const unassigned = tickets.filter(
          (t) => !t.assignedTo && !['closed', 'resolved'].includes(t.status)
        ).length;

        const critical = tickets.filter(
          (t) => t.priority === 'critical' && !['closed', 'resolved'].includes(t.status)
        ).length;

        const high = tickets.filter(
          (t) => t.priority === 'high' && !['closed', 'resolved'].includes(t.status)
        ).length;

        // Average resolution time (in hours)
        const resolvedTickets = tickets.filter((t) => t.resolvedAt && t.createdAt);
        let avgResolutionHours = null;
        if (resolvedTickets.length > 0) {
          const totalHours = resolvedTickets.reduce((sum, t) => {
            return sum + (new Date(t.resolvedAt) - new Date(t.createdAt)) / (1000 * 60 * 60);
          }, 0);
          avgResolutionHours = Math.round((totalHours / resolvedTickets.length) * 10) / 10;
        }

        // Average first response time
        let avgFirstResponseHours = null;
        const ticketsWithComments = tickets.filter((t) => {
          const tComments = comments.filter((c) => c.ticketId === t.id && !c.isInternal);
          return tComments.length > 0;
        });
        if (ticketsWithComments.length > 0) {
          let totalFirstResponse = 0;
          for (const t of ticketsWithComments) {
            const tComments = comments
              .filter((c) => c.ticketId === t.id && !c.isInternal)
              .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
            if (tComments[0]) {
              totalFirstResponse +=
                (new Date(tComments[0].createdAt) - new Date(t.createdAt)) / (1000 * 60 * 60);
            }
          }
          avgFirstResponseHours =
            Math.round((totalFirstResponse / ticketsWithComments.length) * 10) / 10;
        }

        // Tickets created in last 30 days
        const recentTickets = tickets.filter((t) => new Date(t.createdAt) >= thirtyDaysAgo);

        // Category breakdown
        const categories = await getCategories();
        const categoryBreakdown = categories.map((cat) => ({
          ...cat,
          count: tickets.filter((t) => t.category === cat.id).length,
          openCount: tickets.filter(
            (t) => t.category === cat.id && !['closed', 'resolved'].includes(t.status)
          ).length,
        }));

        // Priority breakdown
        const priorityBreakdown = ['critical', 'high', 'medium', 'low'].map((p) => ({
          priority: p,
          total: tickets.filter((t) => t.priority === p).length,
          open: tickets.filter(
            (t) => t.priority === p && !['closed', 'resolved'].includes(t.status)
          ).length,
        }));

        // Recent activity (last 10 events)
        const recentActivity = tickets
          .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
          .slice(0, 10)
          .map((t) => ({
            ticketId: t.id,
            subject: t.subject,
            status: t.status,
            updatedAt: t.updatedAt,
          }));

        return {
          success: true,
          data: {
            summary: { open, inProgress, pending, resolved, closed, total, unassigned, critical, high },
            metrics: {
              avgResolutionHours,
              avgFirstResponseHours,
              ticketsLast30Days: recentTickets.length,
              totalComments: comments.length,
            },
            categoryBreakdown,
            priorityBreakdown,
            recentActivity,
          },
        };
      },
    });

    // ── SETTINGS ──

    ctx.registerRoute({
      method: 'GET',
      url: '/settings',
      handler: async () => {
        const settings = await getSettings();
        const config = {
          autoCloseDays: cfg('autoCloseDays', 30),
          maxOpenTicketsPerUser: cfg('maxOpenTicketsPerUser', 20),
          defaultPriority: cfg('defaultPriority', 'medium'),
          allowedPriorities: cfg('allowedPriorities', 'low,medium,high,critical'),
          notifyOnAssignment: cfg('notifyOnAssignment', true),
          notifyOnComment: cfg('notifyOnComment', true),
          notifyOnStatusChange: cfg('notifyOnStatusChange', true),
        };
        return { success: true, data: { ...settings, config } };
      },
    });

    ctx.registerRoute({
      method: 'PUT',
      url: '/settings',
      handler: async (request) => {
        const body = request.body || {};

        if (body.customFields !== undefined) {
          await context.setStorage(KEYS.SETTINGS, {
            ...(await getSettings()),
            customFields: body.customFields,
          });
        }
        if (body.autoAssignEnabled !== undefined) {
          await context.setStorage(KEYS.SETTINGS, {
            ...(await getSettings()),
            autoAssignEnabled: body.autoAssignEnabled,
          });
        }

        return { success: true, message: 'Settings updated' };
      },
    });

    // ── EXPORT ──

    ctx.registerRoute({
      method: 'GET',
      url: '/export',
      handler: async (request) => {
        const query = request.query || {};
        const tickets = await getTickets();
        const comments = await getComments();
        const enriched = await enrichTickets(tickets);
        const enrichedComments = await enrichComments(comments);

        // Filter if requested
        let filteredTickets = enriched;
        if (query.status) {
          const statuses = String(query.status).split(',');
          filteredTickets = filteredTickets.filter((t) => statuses.includes(t.status));
        }
        if (query.category) {
          const categories = String(query.category).split(',');
          filteredTickets = filteredTickets.filter((t) => categories.includes(t.category));
        }
        if (query.serverId) {
          filteredTickets = filteredTickets.filter((t) => t.serverId === query.serverId);
        }

        return {
          success: true,
          data: {
            exportedAt: new Date().toISOString(),
            totalTickets: filteredTickets.length,
            totalComments: enrichedComments.length,
            tickets: filteredTickets,
            comments: enrichedComments,
          },
        };
      },
    });
  },

  async onEnable(ctx) {
    context = ctx;
    ctx.logger.info('Ticketing plugin enabled');

    // Register WebSocket handler for ticketing events
    ctx.onWebSocketMessage('ticketing_subscribe', async (data, clientId) => {
      ctx.logger.info({ clientId, data }, 'Client subscribed to ticketing events');
    });

    // Auto-close cron: runs daily at midnight
    const autoCloseDays = parseInt(cfg('autoCloseDays', 30)) || 0;
    if (autoCloseDays > 0) {
      ctx.scheduleTask('0 0 * * *', async () => {
        try {
          const tickets = await getTickets();
          const cutoff = new Date(Date.now() - autoCloseDays * 24 * 60 * 60 * 1000);
          let closedCount = 0;

          for (let i = 0; i < tickets.length; i++) {
            if (
              tickets[i].status === 'resolved' &&
              tickets[i].resolvedAt &&
              new Date(tickets[i].resolvedAt) < cutoff
            ) {
              tickets[i].status = 'closed';
              tickets[i].closedAt = new Date().toISOString();
              tickets[i].updatedAt = new Date().toISOString();
              closedCount++;
            }
          }

          if (closedCount > 0) {
            await saveTickets(tickets);
            ctx.logger.info({ closedCount }, 'Auto-closed resolved tickets');
            broadcastTicketUpdate('ticket:auto-closed', { count: closedCount });
          }
        } catch (error) {
          ctx.logger.error({ error }, 'Auto-close task failed');
        }
      });
    }

    // Listen to server events for context
    ctx.on('server:started', async (data) => {
      ctx.logger.debug({ serverId: data.serverId }, 'Server started (ticketing plugin aware)');
    });
  },

  async onDisable(ctx) {
    ctx.logger.info('Ticketing plugin disabled');
  },

  async onUnload(ctx) {
    ctx.logger.info('Ticketing plugin unloaded');
  },
};

export default plugin;
