import React from 'react';

// ═══════════════════════════════════════════════════════════════
//  TICKET
// ═══════════════════════════════════════════════════════════════

export interface Ticket {
  id: string;
  subject: string;
  description: string;
  descriptionHtml?: string;
  status: string;
  priority: string;
  category: string;
  serverId?: string;
  assignedTo?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  comments?: Comment[];
  attachments?: Attachment[];
  linkedTickets?: LinkedTicket[];
  unreadCount?: number;
  lastViewedAt?: string;
  escalationLevel?: number;
  mergedFrom?: string[];
  mergedInto?: string;
  sla?: SLA;
  templateId?: string;
}

// ═══════════════════════════════════════════════════════════════
//  COMMENT
// ═══════════════════════════════════════════════════════════════

export interface Comment {
  id: string;
  content: string;
  authorId: string;
  user?: { id: string; username?: string; email?: string; avatar?: string };
  isInternal: boolean;
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
  pinned?: boolean;
  replyToId?: string;
  replyTo?: Comment;
  attachments?: Attachment[];
}

// ═══════════════════════════════════════════════════════════════
//  ATTACHMENT
// ═══════════════════════════════════════════════════════════════

export interface Attachment {
  id: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  url: string;
  thumbnailUrl?: string;
  uploadedBy: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  ACTIVITY / AUDIT LOG
// ═══════════════════════════════════════════════════════════════

export type ActivityType =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'assignment_changed'
  | 'category_changed'
  | 'comment_added'
  | 'comment_edited'
  | 'comment_deleted'
  | 'comment_pinned'
  | 'internal_note'
  | 'attachment_added'
  | 'attachment_removed'
  | 'ticket_merged'
  | 'ticket_linked'
  | 'ticket_unlinked'
  | 'sla_breach'
  | 'escalation';

export interface Activity {
  id: string;
  ticketId: string;
  type: ActivityType;
  actorId: string;
  actor?: { id: string; username?: string; email?: string };
  description: string;
  metadata?: Record<string, any>;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  SLA
// ═══════════════════════════════════════════════════════════════

export interface SLA {
  firstResponseAt?: string;
  firstResponseTarget: number; // minutes
  resolutionTarget?: number; // minutes
  resolutionAt?: string;
  breached?: boolean;
  paused?: boolean;
  pausedAt?: string;
  totalPausedMinutes?: number;
}

// ═══════════════════════════════════════════════════════════════
//  TAG
// ═══════════════════════════════════════════════════════════════

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  TEMPLATE
// ═══════════════════════════════════════════════════════════════

export interface TicketTemplate {
  id: string;
  name: string;
  description: string;
  subject: string;
  body: string;
  category: string;
  priority: string;
  tags?: string[];
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  LINKED TICKETS
// ═══════════════════════════════════════════════════════════════

export type LinkType = 'related' | 'dependent' | 'duplicate';

export interface LinkedTicket {
  ticketId: string;
  type: LinkType;
  subject?: string;
  status?: string;
  priority?: string;
}

// ═══════════════════════════════════════════════════════════════
//  FILTER & PAGINATION
// ═══════════════════════════════════════════════════════════════

export interface FilterState {
  search: string;
  status: string;
  priority: string;
  category: string;
  assignedTo: string;
  createdBy: string;
  dateFrom: string;
  dateTo: string;
  tags: string[];
  serverId?: string;
  myTickets?: boolean;
  unassigned?: boolean;
}

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
}

export interface SavedView {
  id: string;
  name: string;
  filters: FilterState;
  isDefault?: boolean;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  STATS
// ═══════════════════════════════════════════════════════════════

export interface TicketStats {
  open?: number;
  in_progress?: number;
  pending?: number;
  resolved?: number;
  closed?: number;
  critical?: number;
  total?: number;
  createdThisWeek?: number;
  avgResolutionTime?: number;
  slaCompliance?: number;
  byCategory?: Record<string, number>;
  byPriority?: Record<string, number>;
  recentActivity?: Activity[];
  volumeTrend?: number[];
}

// ═══════════════════════════════════════════════════════════════
//  REFERENCE DATA
// ═══════════════════════════════════════════════════════════════

export interface Category {
  id: string;
  name: string;
}

export interface Status {
  id: string;
  label: string;
}

export interface TicketUser {
  id: string;
  username?: string;
  email?: string;
  avatar?: string;
}

export interface Server {
  id: string;
  label?: string;
  name?: string;
}

// ═══════════════════════════════════════════════════════════════
//  API RESPONSE
// ═══════════════════════════════════════════════════════════════

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  total?: number;
  page?: number;
  pageSize?: number;
}

// ═══════════════════════════════════════════════════════════════
//  COMPONENT PROPS
// ═══════════════════════════════════════════════════════════════

export interface TicketRowProps {
  ticket: Ticket;
  onSelect: (id: string) => void;
  users: TicketUser[];
  selected?: boolean;
  onToggleSelect?: (id: string) => void;
  isSelected?: boolean;
}

export interface CreateTicketModalProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  users: TicketUser[];
  servers: Server[];
  defaultServerId?: string;
  defaultUserId?: string;
  onCreated: (ticket: Ticket) => void;
  templates?: TicketTemplate[];
  tags?: Tag[];
}

export interface MergeTicketModalProps {
  open: boolean;
  onClose: () => void;
  tickets: Ticket[];
  onMerged: () => void;
}

export interface TicketDetailProps {
  ticket: Ticket;
  comments: Comment[];
  activities: Activity[];
  attachments: Attachment[];
  linkedTickets: LinkedTicket[];
  categories: Category[];
  users: TicketUser[];
  servers: Server[];
  statuses: Status[];
  tags: Tag[];
  transitions: Record<string, string[]>;
  onBack: () => void;
  onUpdate: (id: string, data: Partial<Ticket>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddComment: (ticketId: string, content: string, isInternal: boolean, statusChange?: string) => Promise<void>;
  onDeleteComment: (ticketId: string, commentId: string) => Promise<void>;
  onEditComment: (ticketId: string, commentId: string, content: string) => Promise<void>;
  onPinComment: (ticketId: string, commentId: string) => Promise<void>;
  onUploadAttachment: (ticketId: string, file: File) => Promise<void>;
  onDeleteAttachment: (ticketId: string, attachmentId: string) => Promise<void>;
  onLinkTicket: (ticketId: string, targetTicketId: string, type: LinkType) => Promise<void>;
  onUnlinkTicket: (ticketId: string, targetTicketId: string) => Promise<void>;
  onUpdateTags: (ticketId: string, tags: string[]) => Promise<void>;
  isAdmin?: boolean;
}

export interface BulkAction {
  type: 'status' | 'priority' | 'assignment' | 'delete';
  label: string;
  icon: React.ElementType;
  options?: { value: string; label: string }[];
}
