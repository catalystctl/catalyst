// src/plugins/ticketing-plugin/hooks/useTicketActions.ts
// Mutation actions for the ticketing plugin.
// All mutations refresh the ticket list and detail view automatically.

import { useState, useCallback } from 'react';
import type {
  CreateTicketPayload,
  UpdateTicketPayload,
  CreateCommentPayload,
  BulkActionPayload,
  Ticket,
  TicketComment,
  Tag,
  TicketTemplate,
} from '../types';
import * as api from '../api';
import { reportSystemError } from '../../../services/api/systemErrors';

export interface TicketActions {
  // Ticket CRUD
  createTicket: (data: CreateTicketPayload) => Promise<Ticket>;
  updateTicket: (id: string, data: UpdateTicketPayload) => Promise<Ticket>;
  deleteTicket: (id: string) => Promise<void>;

  // Comments
  addComment: (ticketId: string, data: CreateCommentPayload & { statusChange?: { from: string; to: string } }) => Promise<TicketComment>;
  editComment: (ticketId: string, commentId: string, content: string) => Promise<TicketComment>;
  deleteComment: (ticketId: string, commentId: string) => Promise<void>;

  // Bulk actions
  executeBulkAction: (data: BulkActionPayload) => Promise<void>;

  // Tags
  createTag: (data: { name: string; color: string }) => Promise<Tag>;
  updateTag: (id: string, data: { name?: string; color?: string }) => Promise<Tag>;
  deleteTag: (id: string) => Promise<void>;

  // Templates
  createTemplate: (data: Omit<TicketTemplate, 'id' | 'createdAt'>) => Promise<TicketTemplate>;
  updateTemplate: (id: string, data: Partial<Omit<TicketTemplate, 'id' | 'createdAt'>>) => Promise<TicketTemplate>;
  deleteTemplate: (id: string) => Promise<void>;

  // State
  isActionLoading: boolean;
  actionError: string | null;
  clearActionError: () => void;
}

export function useTicketActions(
  onRefresh?: () => void,
  onDetailRefresh?: () => void,
): TicketActions {
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const wrap = useCallback(
    async <T>(fn: () => Promise<T>, refreshList = true, refreshDetail = false): Promise<T> => {
      setIsActionLoading(true);
      setActionError(null);
      try {
        const result = await fn();
        if (refreshList && onRefresh) onRefresh();
        if (refreshDetail && onDetailRefresh) onDetailRefresh();
        return result;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Action failed';
        setActionError(msg);
        reportSystemError({ level: 'error', component: 'useTicketActions', message: err instanceof Error ? err.message : 'Action failed', metadata: { context: 'wrap mutation' } });
        throw err;
      } finally {
        setIsActionLoading(false);
      }
    },
    [onRefresh, onDetailRefresh],
  );

  const clearActionError = useCallback(() => setActionError(null), []);

  return {
    createTicket: (data) => wrap(() => api.createTicket(data)),
    updateTicket: (id, data) => wrap(() => api.updateTicket(id, data), true, true),
    deleteTicket: (id) => wrap(() => api.deleteTicket(id)),
    addComment: (ticketId, data) => wrap(() => api.addComment(ticketId, data), true, true),
    editComment: (ticketId, commentId, content) => wrap(() => api.editComment(ticketId, commentId, content), false, true),
    deleteComment: (ticketId, commentId) => wrap(() => api.deleteComment(ticketId, commentId), false, true),
    executeBulkAction: (data) => wrap(() => api.executeBulkAction(data)),
    createTag: (data) => wrap(() => api.createTag(data), false, false),
    updateTag: (id, data) => wrap(() => api.updateTag(id, data), false, false),
    deleteTag: (id) => wrap(() => api.deleteTag(id), false, false),
    createTemplate: (data) => wrap(() => api.createTemplate(data), false, false),
    updateTemplate: (id, data) => wrap(() => api.updateTemplate(id, data), false, false),
    deleteTemplate: (id) => wrap(() => api.deleteTemplate(id), false, false),
    isActionLoading,
    actionError,
    clearActionError,
  };
}
