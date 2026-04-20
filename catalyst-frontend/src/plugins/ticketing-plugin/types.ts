// ─────────────────────────────────────────────────────────────────────────────
// Ticketing Plugin — Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Ticket priority levels */
export type TicketPriority = 'critical' | 'high' | 'medium' | 'low' | 'minimal';

/** Ticket statuses */
export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'pending'
  | 'resolved'
  | 'closed';

/** Valid status transitions: from → to[] */
export const STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  open: ['in_progress', 'pending', 'closed'],
  in_progress: ['pending', 'resolved', 'open'],
  pending: ['in_progress', 'resolved', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

/** Escalation levels */
export type EscalationLevel = 0 | 1 | 2 | 3;

/** Link relation types between tickets */
export type TicketLinkType = 'blocks' | 'is_blocked_by' | 'duplicates' | 'is_duplicated_by' | 'relates_to' | 'causes' | 'is_caused_by';

/** Comment visibility */
export type CommentVisibility = 'public' | 'internal';

/** Activity types for the audit log */
export type ActivityType =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'category_changed'
  | 'assignee_changed'
  | 'title_changed'
  | 'description_changed'
  | 'comment_added'
  | 'comment_edited'
  | 'comment_deleted'
  | 'attachment_added'
  | 'attachment_removed'
  | 'tag_added'
  | 'tag_removed'
  | 'linked'
  | 'unlinked'
  | 'merged'
  | 'escalated'
  | 'sla_breached'
  | 'template_applied'
  | 'bulk_updated'
  | 'sla_paused'
  | 'sla_resumed'
  | 'assigned_to_me'
  | 'unassigned'
  | 'server_linked'
  | 'server_unlinked'
  | 'custom_field_updated'
  | 'ticket_split'
  | 'resolved_note_added';

/** User reference (lightweight, from scoped DB) */
export interface UserRef {
  id: string;
  username: string;
  email: string;
  name?: string;
  image?: string;
}

/** Server reference (lightweight, from scoped DB) */
export interface ServerRef {
  id: string;
  name: string;
  uuid?: string;
  status: string;
}

/** SLA configuration */
export interface SLAConfig {
  responseHours: number;
  resolutionHours: number;
  escalationLevel: EscalationLevel;
}

/** SLA state on a ticket */
export interface TicketSLA {
  responseDeadline: string | null;   // ISO date
  resolutionDeadline: string | null; // ISO date
  firstResponseAt: string | null;
  pausedAt: string | null;
  isBreached: boolean;
  isPaused: boolean;
}

/** A ticket link to another ticket */
export interface TicketLink {
  type: TicketLinkType;
  ticketId: string;
}

/** An attachment on a comment or ticket */
export interface Attachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  uploadedBy: string;
  uploadedAt: string;
}

/** A comment on a ticket */
export interface TicketComment {
  id: string;
  ticketId: string;
  content: string;
  authorId: string;
  author?: UserRef;
  isInternal: boolean;
  statusChange?: { from: TicketStatus; to: TicketStatus };
  attachments: Attachment[];
  createdAt: string;
  updatedAt: string;
  editedAt?: string;
}

/** An activity log entry */
export interface TicketActivity {
  id: string;
  ticketId: string;
  type: ActivityType;
  userId: string;
  user?: UserRef;
  data: Record<string, unknown>;
  createdAt: string;
}

/** The main Ticket entity */
export interface Ticket {
  id: string;
  ticketNumber: string; // e.g. TKT-ABC123
  title: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: string;
  assigneeId: string | null;
  reporterId: string;
  serverId: string | null;
  tags: string[];
  linkedTickets: TicketLink[];
  escalationLevel: EscalationLevel;
  sla: TicketSLA;
  mergedInto: string | null;
  mergedFrom: string[];
  templateId: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  resolvedAt: string | null;

  // Enriched (joined at read time, not stored)
  assignee?: UserRef;
  reporter?: UserRef;
  server?: ServerRef;
  commentCount?: number;
  attachmentCount?: number;
}

/** A tag definition */
export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

/** A ticket template */
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

/** Plugin settings */
export interface TicketingSettings {
  autoAssignEnabled: boolean;
  autoCloseDays: number;
  defaultPriority: TicketPriority;
  defaultCategory: string;
  allowedCategories: string[];
  responseSlaHours: number;
  resolutionSlaHours: number;
  maxEscalationLevel: number;
  enableLinkedTickets: boolean;
  enableAttachments: boolean;
  enableInternalComments: boolean;
  enableTemplates: boolean;
  enableTags: boolean;
  enableExport: boolean;
  customFields: CustomFieldDef[];
}

/** Custom field definition */
export interface CustomFieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'date';
  required: boolean;
  options?: string[]; // for select type
  defaultValue?: unknown;
}

/** Dashboard stats */
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
  myTickets: number;
  avgResolutionHours: number;
  slaBreached: number;
  createdToday: number;
  resolvedToday: number;
  byCategory: Record<string, number>;
  byPriority: Record<TicketPriority, number>;
  byAssignee: Record<string, number>;
}

/** Filter state for the ticket list */
export interface TicketFilters {
  status?: TicketStatus | 'all';
  priority?: TicketPriority | 'all';
  category?: string | 'all';
  assigneeId?: string | 'unassigned' | 'all';
  reporterId?: string | 'all';
  serverId?: string | 'all';
  tags?: string[];
  search?: string;
  escalationLevel?: EscalationLevel | 'all';
  isOverdue?: boolean;
  myTickets?: boolean;
  dateFrom?: string;
  dateTo?: string;
}

/** Sort configuration */
export interface TicketSort {
  field: keyof Ticket | 'priority_weight' | 'sla_status';
  direction: 'asc' | 'desc';
}

/** Paginated response */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Bulk action payload */
export interface BulkActionPayload {
  ticketIds: string[];
  action: 'status' | 'priority' | 'assignee' | 'category' | 'tags_add' | 'tags_remove' | 'delete';
  value: unknown;
}

/** Create ticket payload */
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

/** Update ticket payload (partial) */
export type UpdateTicketPayload = Partial<CreateTicketPayload> & {
  status?: TicketStatus;
  escalationLevel?: EscalationLevel;
};

/** Create comment payload */
export interface CreateCommentPayload {
  content: string;
  isInternal?: boolean;
  attachments?: { name: string; data: string; mimeType: string }[];
}

/** Export options */
export interface ExportOptions {
  format: 'json' | 'csv';
  filters?: TicketFilters;
  fields?: string[];
}
