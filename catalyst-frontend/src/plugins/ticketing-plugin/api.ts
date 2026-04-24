// src/plugins/ticketing-plugin/api.ts
// API client for the ticketing plugin using the shared plugin-api infrastructure.

import { createPluginApiClient } from '../plugin-api';
import { reportSystemError } from '../../services/api/systemErrors';
import type {
  Ticket,
  TicketComment,
  TicketActivity,
  TicketStats,
  TicketFilters,
  TicketSort,
  Tag,
  TicketTemplate,
  TicketingSettings,
  CreateTicketPayload,
  UpdateTicketPayload,
  CreateCommentPayload,
  BulkActionPayload,
  UserRef,
  ServerRef,
  PaginatedResponse,
} from './types';

const api = createPluginApiClient('ticketing-plugin');

// ── Tickets ──

export async function fetchTickets(
  filters?: TicketFilters,
  sort?: TicketSort,
  page = 1,
  pageSize = 25,
): Promise<PaginatedResponse<Ticket>> {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  if (sort) {
    params.set('sort', String(sort.field === 'priority_weight' ? 'priority' : sort.field));
    params.set('sortDir', sort.direction);
  }
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
  }
  const res = await api.get<PaginatedResponse<Ticket>>(`tickets?${params.toString()}`);
  if (!res.success) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch tickets', metadata: { context: 'fetchTickets' } });
    throw new Error(res.error ?? 'Failed to fetch tickets');
  }
  // With pass-through, res IS the backend response: { success, data, total, page, ... }
  // We need the whole object (not just res.data) for pagination metadata
  const { success: _s, error: _e, ...paginated } = res as any;
  return paginated as PaginatedResponse<Ticket>;
}

export async function fetchTicket(id: string): Promise<Ticket> {
  const res = await api.get<Ticket>(`tickets/${id}`);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch ticket', metadata: { context: 'fetchTicket' } });
    throw new Error(res.error ?? 'Failed to fetch ticket');
  }
  return res.data;
}

export async function createTicket(data: CreateTicketPayload): Promise<Ticket> {
  const res = await api.post<Ticket>('tickets', data);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to create ticket', metadata: { context: 'createTicket' } });
    throw new Error(res.error ?? 'Failed to create ticket');
  }
  return res.data;
}

export async function updateTicket(id: string, data: UpdateTicketPayload): Promise<Ticket> {
  const res = await api.put<Ticket>(`tickets/${id}`, data);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to update ticket', metadata: { context: 'updateTicket' } });
    throw new Error(res.error ?? 'Failed to update ticket');
  }
  return res.data;
}

export async function deleteTicket(id: string): Promise<void> {
  const res = await api.delete<void>(`tickets/${id}`);
  if (!res.success) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to delete ticket', metadata: { context: 'deleteTicket' } });
    throw new Error(res.error ?? 'Failed to delete ticket');
  }
}

// ── Comments ──

export async function fetchComments(ticketId: string): Promise<TicketComment[]> {
  const res = await api.get<TicketComment[]>(`tickets/${ticketId}/comments`);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch comments', metadata: { context: 'fetchComments' } });
    throw new Error(res.error ?? 'Failed to fetch comments');
  }
  return res.data;
}

export async function addComment(ticketId: string, data: CreateCommentPayload & { statusChange?: { from: string; to: string } }): Promise<TicketComment> {
  const res = await api.post<TicketComment>(`tickets/${ticketId}/comments`, data);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to add comment', metadata: { context: 'addComment' } });
    throw new Error(res.error ?? 'Failed to add comment');
  }
  return res.data;
}

export async function editComment(ticketId: string, commentId: string, content: string): Promise<TicketComment> {
  const res = await api.put<TicketComment>(`tickets/${ticketId}/comments/${commentId}`, { content });
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to edit comment', metadata: { context: 'editComment' } });
    throw new Error(res.error ?? 'Failed to edit comment');
  }
  return res.data;
}

export async function deleteComment(ticketId: string, commentId: string): Promise<void> {
  const res = await api.delete<void>(`tickets/${ticketId}/comments/${commentId}`);
  if (!res.success) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to delete comment', metadata: { context: 'deleteComment' } });
    throw new Error(res.error ?? 'Failed to delete comment');
  }
}

// ── Activity ──

export async function fetchActivities(ticketId: string, page?: number): Promise<PaginatedResponse<TicketActivity>> {
  const query = page ? `?page=${page}` : '';
  const res = await api.get<PaginatedResponse<TicketActivity>>(`tickets/${ticketId}/activities${query}`);
  if (!res.success) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch activity', metadata: { context: 'fetchActivities' } });
    throw new Error(res.error ?? 'Failed to fetch activity');
  }
  const { success: _s, error: _e, ...paginated } = res as any;
  return paginated as PaginatedResponse<TicketActivity>;
}

// ── Stats ──

export async function fetchStats(params?: { assigneeId?: string }): Promise<TicketStats> {
  const query = params?.assigneeId ? `?assigneeId=${encodeURIComponent(params.assigneeId)}` : '';
  const res = await api.get<TicketStats>(`stats${query}`);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch stats', metadata: { context: 'fetchStats' } });
    throw new Error(res.error ?? 'Failed to fetch stats');
  }
  return res.data;
}

// ── Bulk Actions ──

export async function executeBulkAction(data: BulkActionPayload): Promise<void> {
  const res = await api.post<void>('tickets/bulk', data);
  if (!res.success) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to execute bulk action', metadata: { context: 'executeBulkAction' } });
    throw new Error(res.error ?? 'Failed to execute bulk action');
  }
}

// ── Tags ──

export async function fetchTags(): Promise<Tag[]> {
  const res = await api.get<Tag[]>('tags');
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch tags', metadata: { context: 'fetchTags' } });
    throw new Error(res.error ?? 'Failed to fetch tags');
  }
  return res.data;
}

export async function createTag(data: { name: string; color: string }): Promise<Tag> {
  const res = await api.post<Tag>('tags', data);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to create tag', metadata: { context: 'createTag' } });
    throw new Error(res.error ?? 'Failed to create tag');
  }
  return res.data;
}

export async function updateTag(id: string, data: { name?: string; color?: string }): Promise<Tag> {
  const res = await api.put<Tag>(`tags/${id}`, data);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to update tag', metadata: { context: 'updateTag' } });
    throw new Error(res.error ?? 'Failed to update tag');
  }
  return res.data;
}

export async function deleteTag(id: string): Promise<void> {
  const res = await api.delete<void>(`tags/${id}`);
  if (!res.success) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to delete tag', metadata: { context: 'deleteTag' } });
    throw new Error(res.error ?? 'Failed to delete tag');
  }
}

// ── Templates ──

export async function fetchTemplates(): Promise<TicketTemplate[]> {
  const res = await api.get<TicketTemplate[]>('templates');
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch templates', metadata: { context: 'fetchTemplates' } });
    throw new Error(res.error ?? 'Failed to fetch templates');
  }
  return res.data;
}

export async function createTemplate(data: Omit<TicketTemplate, 'id' | 'createdAt'>): Promise<TicketTemplate> {
  const res = await api.post<TicketTemplate>('templates', data);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to create template', metadata: { context: 'createTemplate' } });
    throw new Error(res.error ?? 'Failed to create template');
  }
  return res.data;
}

export async function updateTemplate(id: string, data: Partial<Omit<TicketTemplate, 'id' | 'createdAt'>>): Promise<TicketTemplate> {
  const res = await api.put<TicketTemplate>(`templates/${id}`, data);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to update template', metadata: { context: 'updateTemplate' } });
    throw new Error(res.error ?? 'Failed to update template');
  }
  return res.data;
}

export async function deleteTemplate(id: string): Promise<void> {
  const res = await api.delete<void>(`templates/${id}`);
  if (!res.success) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to delete template', metadata: { context: 'deleteTemplate' } });
    throw new Error(res.error ?? 'Failed to delete template');
  }
}

// ── Settings ──

export async function fetchSettings(): Promise<TicketingSettings> {
  const res = await api.get<TicketingSettings>('settings');
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch settings', metadata: { context: 'fetchSettings' } });
    throw new Error(res.error ?? 'Failed to fetch settings');
  }
  return res.data;
}

export async function updateSettings(data: Partial<TicketingSettings>): Promise<TicketingSettings> {
  const res = await api.put<TicketingSettings>('settings', data);
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to update settings', metadata: { context: 'updateSettings' } });
    throw new Error(res.error ?? 'Failed to update settings');
  }
  return res.data;
}

// ── Users & Servers (references) ──

export async function fetchUsers(): Promise<UserRef[]> {
  const res = await api.get<UserRef[]>('users');
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch users', metadata: { context: 'fetchUsers' } });
    throw new Error(res.error ?? 'Failed to fetch users');
  }
  return res.data;
}

export async function fetchServers(): Promise<ServerRef[]> {
  const res = await api.get<ServerRef[]>('servers');
  if (!res.success || !res.data) {
    reportSystemError({ level: 'error', component: 'TicketingPluginApi', message: res.error ?? 'Failed to fetch servers', metadata: { context: 'fetchServers' } });
    throw new Error(res.error ?? 'Failed to fetch servers');
  }
  return res.data;
}
