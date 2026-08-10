/** Ticketing plugin — shared TypeScript types */

export type TicketPriority = 'critical' | 'high' | 'medium' | 'low' | 'minimal';
export type TicketStatus = 'open' | 'in_progress' | 'pending' | 'resolved' | 'closed';

export interface UserRef {
  id: string;
  username: string;
  email: string;
  name?: string;
  image?: string | null;
}

export interface ServerRef {
  id: string;
  name: string;
  uuid?: string | null;
  status: string;
}

export interface TicketSLA {
  responseDeadline: string | null;
  resolutionDeadline: string | null;
  firstResponseAt: string | null;
  responseBreached?: boolean;
  resolutionBreached?: boolean;
  paused?: boolean;
  pausedAt?: string | null;
  totalPausedMs?: number;
  // legacy aliases tolerated
  isBreached?: boolean;
  isPaused?: boolean;
}

export interface Ticket {
  id: string;
  ticketNumber: string;
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  assigneeId: string | null;
  reporterId: string | null;
  serverId: string | null;
  tags: string[];
  escalationLevel: number;
  linkedTickets?: unknown[];
  customFields?: Record<string, unknown>;
  sla: TicketSLA;
  resolvedAt: string | null;
  closedAt?: string | null;
  isDeleted?: boolean;
  createdAt: string;
  updatedAt: string;
  assignee?: UserRef | null;
  reporter?: UserRef | null;
  server?: ServerRef | null;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  content: string;
  authorId: string | null;
  author?: UserRef | null;
  isInternal: boolean;
  statusChange?: { from: TicketStatus; to: TicketStatus } | null;
  attachments?: unknown[];
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
}

export interface TicketActivity {
  id: string;
  ticketId: string;
  type: string;
  userId: string | null;
  user?: UserRef | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

export interface TicketTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  priority: TicketPriority;
  titleTemplate: string;
  descriptionTemplate: string;
  tags: string[];
  isDefault: boolean;
  createdAt: string;
}

export interface TicketingSettings {
  autoAssignEnabled: boolean;
  autoCloseDays: number;
  defaultPriority: TicketPriority;
  defaultCategory: string;
  responseSlaHours: number;
  resolutionSlaHours: number;
  maxEscalationLevel: number;
}

export interface TicketStats {
  total: number;
  open: number;
  inProgress: number;
  pending: number;
  resolved: number;
  closed: number;
  critical: number;
  overdue: number;
  unassigned: number;
  slaBreached: number;
  createdToday: number;
  resolvedToday: number;
  myTickets: number;
  avgResolutionHours: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  byAssignee: Record<string, number>;
}

export interface TicketFilters {
  status?: TicketStatus | 'all';
  priority?: TicketPriority | 'all';
  category?: string | 'all';
  assigneeId?: string | 'unassigned' | 'all';
  reporterId?: string | 'all';
  serverId?: string | 'all';
  tags?: string;
  search?: string;
  escalationLevel?: number | string | 'all';
  isOverdue?: boolean;
  myTickets?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

export interface TicketSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CreateTicketPayload {
  title: string;
  description: string;
  priority?: TicketPriority;
  category?: string;
  assigneeId?: string;
  serverId?: string;
  tags?: string[];
  templateId?: string;
  customFields?: Record<string, unknown>;
}

export type UpdateTicketPayload = Partial<Omit<CreateTicketPayload, 'assigneeId'>> & {
  status?: TicketStatus;
  escalationLevel?: number;
  linkedTickets?: unknown[];
  /** Pass `null` to unassign. */
  assigneeId?: string | null;
};

export interface CreateCommentPayload {
  content: string;
  isInternal?: boolean;
  statusChange?: { from: TicketStatus; to: TicketStatus };
}

export interface BulkActionPayload {
  ticketIds: string[];
  action: 'status' | 'priority' | 'assignee' | 'category' | 'tags_add' | 'tags_remove' | 'delete';
  value: unknown;
}
