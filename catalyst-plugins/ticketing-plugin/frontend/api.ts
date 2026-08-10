/**
 * Ticketing — typed API client via the host plugin SDK.
 */

import { createPluginApi } from '@/plugins/plugin-definition';
import { reportSystemError } from '@/services/api/systemErrors';
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

const api = createPluginApi('ticketing-plugin');

function report(context: string, error?: string) {
  reportSystemError({
    level: 'error',
    component: 'TicketingPluginApi',
    message: error ?? context,
    metadata: { context },
  });
}

async function unwrap<T>(
  promise: Promise<{ success: boolean; data?: T; error?: string } & Record<string, unknown>>,
  context: string,
): Promise<T> {
  const res = await promise;
  if (!res.success || res.data === undefined) {
    report(context, res.error);
    throw new Error(res.error ?? context);
  }
  return res.data;
}

/** List endpoints return pagination fields alongside success/data. */
async function unwrapPage<T>(
  promise: Promise<
    {
      success: boolean;
      data?: T[];
      error?: string;
      total?: number;
      page?: number;
      pageSize?: number;
      totalPages?: number;
    }
  >,
  context: string,
): Promise<PaginatedResponse<T>> {
  const res = await promise;
  if (!res.success) {
    report(context, res.error);
    throw new Error(res.error ?? context);
  }
  return {
    data: (res.data as T[]) ?? [],
    total: res.total ?? 0,
    page: res.page ?? 1,
    pageSize: res.pageSize ?? 25,
    totalPages: res.totalPages ?? 1,
  };
}

function buildQuery(
  filters?: TicketFilters,
  sort?: TicketSort,
  page = 1,
  pageSize = 25,
): string {
  const params = new URLSearchParams();
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  if (sort) {
    params.set('sort', sort.field === 'priority_weight' ? 'priority' : sort.field);
    params.set('sortDir', sort.direction);
  }
  if (filters) {
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '' || value === 'all') continue;
      if (typeof value === 'boolean') {
        if (value) params.set(key, 'true');
        continue;
      }
      params.set(key, String(value));
    }
  }
  return params.toString();
}

export async function fetchTickets(
  filters?: TicketFilters,
  sort?: TicketSort,
  page = 1,
  pageSize = 25,
): Promise<PaginatedResponse<Ticket>> {
  return unwrapPage<Ticket>(
    api.get(`tickets?${buildQuery(filters, sort, page, pageSize)}`) as any,
    'Failed to fetch tickets',
  );
}

export async function fetchTicket(id: string): Promise<Ticket> {
  return unwrap(api.get<Ticket>(`tickets/${id}`), 'Failed to fetch ticket');
}

export async function createTicket(data: CreateTicketPayload): Promise<Ticket> {
  return unwrap(api.post<Ticket>('tickets', data), 'Failed to create ticket');
}

export async function updateTicket(id: string, data: UpdateTicketPayload): Promise<Ticket> {
  return unwrap(api.put<Ticket>(`tickets/${id}`, data), 'Failed to update ticket');
}

export async function deleteTicket(id: string): Promise<void> {
  await unwrap(api.delete<unknown>(`tickets/${id}`), 'Failed to delete ticket');
}

export async function fetchComments(ticketId: string): Promise<TicketComment[]> {
  return unwrap(api.get<TicketComment[]>(`tickets/${ticketId}/comments`), 'Failed to fetch comments');
}

export async function addComment(
  ticketId: string,
  data: CreateCommentPayload,
): Promise<TicketComment> {
  return unwrap(
    api.post<TicketComment>(`tickets/${ticketId}/comments`, data),
    'Failed to add comment',
  );
}

export async function editComment(
  ticketId: string,
  commentId: string,
  content: string,
): Promise<TicketComment> {
  return unwrap(
    api.put<TicketComment>(`tickets/${ticketId}/comments/${commentId}`, { content }),
    'Failed to edit comment',
  );
}

export async function deleteComment(ticketId: string, commentId: string): Promise<void> {
  await unwrap(
    api.delete<unknown>(`tickets/${ticketId}/comments/${commentId}`),
    'Failed to delete comment',
  );
}

export async function fetchActivities(
  ticketId: string,
  page = 1,
  pageSize = 50,
): Promise<PaginatedResponse<TicketActivity>> {
  return unwrapPage<TicketActivity>(
    api.get(`tickets/${ticketId}/activities?page=${page}&pageSize=${pageSize}`) as any,
    'Failed to fetch activities',
  );
}

export async function fetchStats(extra?: Record<string, string>): Promise<TicketStats> {
  const sp = new URLSearchParams(extra);
  return unwrap(api.get<TicketStats>(`stats?${sp.toString()}`), 'Failed to fetch stats');
}

export async function executeBulkAction(data: BulkActionPayload): Promise<{ updated: number }> {
  return unwrap(api.post<{ updated: number }>('tickets/bulk', data), 'Failed to execute bulk action');
}

export async function fetchTags(): Promise<Tag[]> {
  return unwrap(api.get<Tag[]>('tags'), 'Failed to fetch tags');
}

export async function createTag(data: { name: string; color: string }): Promise<Tag> {
  return unwrap(api.post<Tag>('tags', data), 'Failed to create tag');
}

export async function updateTag(
  id: string,
  data: { name?: string; color?: string },
): Promise<Tag> {
  return unwrap(api.put<Tag>(`tags/${id}`, data), 'Failed to update tag');
}

export async function deleteTag(id: string): Promise<void> {
  await unwrap(api.delete<unknown>(`tags/${id}`), 'Failed to delete tag');
}

export async function fetchTemplates(): Promise<TicketTemplate[]> {
  return unwrap(api.get<TicketTemplate[]>('templates'), 'Failed to fetch templates');
}

export async function createTemplate(
  data: Omit<TicketTemplate, 'id' | 'createdAt'>,
): Promise<TicketTemplate> {
  return unwrap(api.post<TicketTemplate>('templates', data), 'Failed to create template');
}

export async function updateTemplate(
  id: string,
  data: Partial<Omit<TicketTemplate, 'id' | 'createdAt'>>,
): Promise<TicketTemplate> {
  return unwrap(api.put<TicketTemplate>(`templates/${id}`, data), 'Failed to update template');
}

export async function deleteTemplate(id: string): Promise<void> {
  await unwrap(api.delete<unknown>(`templates/${id}`), 'Failed to delete template');
}

export async function fetchSettings(): Promise<TicketingSettings> {
  return unwrap(api.get<TicketingSettings>('settings'), 'Failed to fetch settings');
}

export async function updateSettings(
  data: Partial<TicketingSettings>,
): Promise<TicketingSettings> {
  return unwrap(api.put<TicketingSettings>('settings', data), 'Failed to update settings');
}

export async function fetchUsers(): Promise<UserRef[]> {
  return unwrap(api.get<UserRef[]>('users'), 'Failed to fetch users');
}

export async function fetchServers(): Promise<ServerRef[]> {
  return unwrap(api.get<ServerRef[]>('servers'), 'Failed to fetch servers');
}

export async function fetchCategories(): Promise<string[]> {
  return unwrap(api.get<string[]>('categories'), 'Failed to fetch categories');
}

export function exportUrl(format: 'csv' | 'json', filters?: TicketFilters): string {
  const base = import.meta.env.VITE_API_URL ?? '';
  const params = new URLSearchParams({ format });
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== '' && v !== 'all') params.set(k, String(v));
    }
  }
  return `${base}/api/plugins/ticketing-plugin/export?${params.toString()}`;
}
