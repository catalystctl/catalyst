import type { ApiResponse } from './types';
import type { FilterState, PaginationState } from './types';

const API = '/api/plugins/ticketing-plugin';

async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const res = await fetch(`${API}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      return { success: false, error: `HTTP ${res.status}: ${text}` };
    }
    return await res.json();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

// ═══════════════════════════════════════════════════════════════
//  REFERENCE DATA
// ═══════════════════════════════════════════════════════════════

export async function fetchCategories() {
  return apiFetch('/categories');
}

export async function fetchUsers() {
  return apiFetch('/users');
}

export async function fetchServers() {
  return apiFetch('/servers');
}

export async function fetchStatuses() {
  return apiFetch('/statuses');
}

export async function fetchTransitions() {
  return apiFetch('/transitions');
}

export async function fetchStats() {
  return apiFetch('/stats');
}

// ═══════════════════════════════════════════════════════════════
//  TICKETS
// ═══════════════════════════════════════════════════════════════

export interface TicketListParams {
  filters?: Partial<FilterState>;
  sort?: string;
  pagination?: Partial<PaginationState>;
}

export function buildTicketQuery(params: TicketListParams): string {
  const searchParams = new URLSearchParams();
  const { filters, sort, pagination } = params;

  if (filters?.search) searchParams.set('search', filters.search);
  if (filters?.status) searchParams.set('status', filters.status);
  if (filters?.priority) searchParams.set('priority', filters.priority);
  if (filters?.category) searchParams.set('category', filters.category);
  if (filters?.assignedTo) searchParams.set('assignedTo', filters.assignedTo);
  if (filters?.createdBy) searchParams.set('createdBy', filters.createdBy);
  if (filters?.dateFrom) searchParams.set('dateFrom', filters.dateFrom);
  if (filters?.dateTo) searchParams.set('dateTo', filters.dateTo);
  if (filters?.tags?.length) searchParams.set('tags', filters.tags.join(','));
  if (filters?.serverId) searchParams.set('serverId', filters.serverId);
  if (sort) searchParams.set('sort', sort);

  const page = pagination?.page || 1;
  const pageSize = pagination?.pageSize || 25;
  searchParams.set('page', String(page));
  searchParams.set('pageSize', String(pageSize));

  return searchParams.toString();
}

export async function fetchTickets(params: TicketListParams) {
  const query = buildTicketQuery(params);
  return apiFetch(`/tickets?${query}`);
}

export async function fetchTicket(id: string) {
  return apiFetch(`/tickets/${id}`);
}

export async function createTicket(data: Record<string, any>) {
  return apiFetch('/tickets', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateTicket(id: string, data: Record<string, any>) {
  return apiFetch(`/tickets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export async function deleteTicket(id: string) {
  return apiFetch(`/tickets/${id}`, { method: 'DELETE' });
}

export async function mergeTickets(primaryTicketId: string, sourceTicketIds: string[]) {
  return apiFetch(`/tickets/${primaryTicketId}/merge`, {
    method: 'POST',
    body: JSON.stringify({ sourceTicketIds }),
  });
}

// ═══════════════════════════════════════════════════════════════
//  COMMENTS
// ═══════════════════════════════════════════════════════════════

export async function addComment(ticketId: string, data: { content: string; isInternal?: boolean; statusChange?: string }) {
  return apiFetch(`/tickets/${ticketId}/comments`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteComment(ticketId: string, commentId: string) {
  return apiFetch(`/tickets/${ticketId}/comments/${commentId}`, { method: 'DELETE' });
}

export async function editComment(ticketId: string, commentId: string, content: string) {
  return apiFetch(`/tickets/${ticketId}/comments/${commentId}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function pinComment(ticketId: string, commentId: string) {
  return apiFetch(`/tickets/${ticketId}/comments/${commentId}/pin`, { method: 'POST' });
}

// ═══════════════════════════════════════════════════════════════
//  ACTIVITIES
// ═══════════════════════════════════════════════════════════════

export async function fetchActivities(ticketId: string) {
  return apiFetch(`/tickets/${ticketId}/activities`);
}

// ═══════════════════════════════════════════════════════════════
//  ATTACHMENTS
// ═══════════════════════════════════════════════════════════════

export async function fetchAttachments(ticketId: string) {
  return apiFetch(`/tickets/${ticketId}/attachments`);
}

export async function uploadAttachment(ticketId: string, file: File): Promise<ApiResponse> {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`${API}/tickets/${ticketId}/attachments`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      return { success: false, error: `HTTP ${res.status}: ${text}` };
    }
    return await res.json();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' };
  }
}

export async function deleteAttachment(ticketId: string, attachmentId: string) {
  return apiFetch(`/tickets/${ticketId}/attachments/${attachmentId}`, { method: 'DELETE' });
}

// ═══════════════════════════════════════════════════════════════
//  LINKED TICKETS
// ═══════════════════════════════════════════════════════════════

export async function linkTicket(ticketId: string, targetTicketId: string, type: string) {
  return apiFetch(`/tickets/${ticketId}/links`, {
    method: 'POST',
    body: JSON.stringify({ targetTicketId, type }),
  });
}

export async function unlinkTicket(ticketId: string, targetTicketId: string) {
  return apiFetch(`/tickets/${ticketId}/links/${targetTicketId}`, { method: 'DELETE' });
}

// ═══════════════════════════════════════════════════════════════
//  TEMPLATES
// ═══════════════════════════════════════════════════════════════

export async function fetchTemplates() {
  return apiFetch('/templates');
}

export async function createTemplate(data: Record<string, any>) {
  return apiFetch('/templates', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteTemplate(id: string) {
  return apiFetch(`/templates/${id}`, { method: 'DELETE' });
}

// ═══════════════════════════════════════════════════════════════
//  TAGS
// ═══════════════════════════════════════════════════════════════

export async function fetchTags() {
  return apiFetch('/tags');
}

export async function createTag(data: { name: string; color: string }) {
  return apiFetch('/tags', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deleteTag(id: string) {
  return apiFetch(`/tags/${id}`, { method: 'DELETE' });
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT
// ═══════════════════════════════════════════════════════════════

export function exportCsvUrl(params: TicketListParams): string {
  const query = buildTicketQuery(params);
  return `${API}/export?${query}`;
}

export function triggerCsvExport(params: TicketListParams) {
  const url = exportCsvUrl(params);
  const a = document.createElement('a');
  a.href = url;
  a.download = `tickets-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function triggerPrintExport() {
  window.print();
}
