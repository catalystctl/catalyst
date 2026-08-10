/**
 * Background jobs for the ticketing plugin (SLA checks, auto-close).
 * Registered from onEnable so they can freely import helpers.
 */

import {
  cfg,
  nowIso,
  createActivity,
  broadcast,
  updateTicketDoc,
} from './helpers.js';

export function registerJobs(context) {
  // SLA breach check every 5 minutes
  context.scheduleTask('*/5 * * * *', async () => {
    const tickets = context.db.collection('tickets');
    const now = new Date();
    const maxLevel = cfg(context, 'maxEscalationLevel', 3);

    try {
      const openTickets = await tickets.find({
        status: { $nin: ['resolved', 'closed'] },
        isDeleted: { $ne: true },
      });

      for (const ticket of openTickets || []) {
        const sla = { ...(ticket.sla || {}) };
        if (sla.paused) continue;

        let changed = false;
        let escalatedTo = null;

        if (
          !sla.firstResponseAt &&
          sla.responseDeadline &&
          now > new Date(sla.responseDeadline) &&
          !sla.responseBreached
        ) {
          sla.responseBreached = true;
          changed = true;
          await createActivity(context, ticket._id, 'sla_breached', null, {
            type: 'response',
          });
          context.emit('ticket:sla-breached', {
            ticketId: ticket._id,
            type: 'response',
          });
          broadcast(context, 'ticket:sla-breached', {
            ticketId: ticket._id,
            type: 'response',
          });
        }

        if (
          sla.resolutionDeadline &&
          now > new Date(sla.resolutionDeadline) &&
          !sla.resolutionBreached
        ) {
          sla.resolutionBreached = true;
          changed = true;
          await createActivity(context, ticket._id, 'sla_breached', null, {
            type: 'resolution',
          });
          context.emit('ticket:sla-breached', {
            ticketId: ticket._id,
            type: 'resolution',
          });
          broadcast(context, 'ticket:sla-breached', {
            ticketId: ticket._id,
            type: 'resolution',
          });

          const currentLevel = ticket.escalationLevel || 0;
          if (currentLevel < maxLevel) {
            escalatedTo = currentLevel + 1;
            await createActivity(context, ticket._id, 'escalated', null, {
              from: currentLevel,
              to: escalatedTo,
              reason: 'SLA resolution breached',
            });
            context.emit('ticket:escalated', {
              ticketId: ticket._id,
              level: escalatedTo,
            });
          }
        }

        if (changed) {
          const patch = { sla };
          if (escalatedTo !== null) patch.escalationLevel = escalatedTo;
          // Full $set of sla object — never dotted keys that leave nested fields stale
          await updateTicketDoc(context, ticket._id, patch);
        }
      }
    } catch (err) {
      context.logger.error({ err }, 'SLA breach check failed');
    }
  });
  context.logger.info('Scheduled SLA breach check (every 5 minutes)');

  // Auto-close resolved tickets daily at midnight
  context.scheduleTask('0 0 * * *', async () => {
    const autoCloseDays = cfg(context, 'autoCloseDays', 30);
    if (!autoCloseDays || autoCloseDays <= 0) return;

    try {
      const tickets = context.db.collection('tickets');
      const cutoff = new Date(Date.now() - autoCloseDays * 86400000);
      const resolved = await tickets.find({
        status: 'resolved',
        isDeleted: { $ne: true },
      });

      let closed = 0;
      for (const ticket of resolved || []) {
        const resolvedAt = ticket.resolvedAt ? new Date(ticket.resolvedAt) : null;
        if (resolvedAt && resolvedAt < cutoff) {
          await updateTicketDoc(context, ticket._id, {
            status: 'closed',
            closedAt: nowIso(),
          });
          await createActivity(context, ticket._id, 'status_changed', null, {
            from: 'resolved',
            to: 'closed',
            reason: `Auto-closed after ${autoCloseDays} days`,
          });
          closed++;
        }
      }

      if (closed > 0) {
        context.logger.info(`Auto-closed ${closed} resolved tickets`);
        broadcast(context, 'ticket:bulk-updated', {
          ticketIds: [],
          action: 'auto-close',
          count: closed,
        });
      }
    } catch (err) {
      context.logger.error({ err }, 'Auto-close failed');
    }
  });
  context.logger.info('Scheduled daily auto-close task');
}
