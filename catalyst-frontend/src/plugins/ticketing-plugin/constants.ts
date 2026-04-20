// ─────────────────────────────────────────────────────────────────────────────
// Ticketing Plugin — Constants
// ─────────────────────────────────────────────────────────────────────────────

import type { TicketPriority, TicketStatus, EscalationLevel, TicketLinkType } from './types';

/** Status display configuration */
export const STATUS_CONFIG: Record<TicketStatus, { label: string; color: string; bg: string; icon: string }> = {
  open:        { label: 'Open',        color: 'text-blue-400',    bg: 'bg-blue-500/15 border-blue-500/30',       icon: 'CircleDot' },
  in_progress: { label: 'In Progress', color: 'text-amber-400',   bg: 'bg-amber-500/15 border-amber-500/30',     icon: 'Loader2' },
  pending:     { label: 'Pending',     color: 'text-orange-400',  bg: 'bg-orange-500/15 border-orange-500/30',   icon: 'Clock' },
  resolved:    { label: 'Resolved',    color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/30', icon: 'CheckCircle2' },
  closed:      { label: 'Closed',      color: 'text-zinc-400',    bg: 'bg-zinc-500/15 border-zinc-500/30',       icon: 'XCircle' },
};

/** Priority display configuration */
export const PRIORITY_CONFIG: Record<TicketPriority, { label: string; color: string; dot: string; weight: number }> = {
  critical: { label: 'Critical', color: 'text-red-400',    dot: 'bg-red-500',     weight: 5 },
  high:     { label: 'High',     color: 'text-orange-400', dot: 'bg-orange-500',  weight: 4 },
  medium:   { label: 'Medium',   color: 'text-amber-400',  dot: 'bg-amber-500',   weight: 3 },
  low:      { label: 'Low',      color: 'text-sky-400',    dot: 'bg-sky-500',     weight: 2 },
  minimal:  { label: 'Minimal',  color: 'text-zinc-400',   dot: 'bg-zinc-500',    weight: 1 },
};

/** Escalation level labels */
export const ESCALATION_LABELS: Record<EscalationLevel, { label: string; color: string }> = {
  0: { label: 'None',       color: 'text-zinc-400' },
  1: { label: 'Level 1',    color: 'text-yellow-400' },
  2: { label: 'Level 2',    color: 'text-orange-400' },
  3: { label: 'Critical',   color: 'text-red-400' },
};

/** Link type labels */
export const LINK_TYPE_LABELS: Record<TicketLinkType, { label: string; inverse: TicketLinkType; color: string }> = {
  blocks:            { label: 'Blocks',            inverse: 'is_blocked_by',  color: 'text-red-400' },
  is_blocked_by:     { label: 'Is Blocked By',     inverse: 'blocks',          color: 'text-red-400' },
  duplicates:        { label: 'Duplicates',         inverse: 'is_duplicated_by', color: 'text-purple-400' },
  is_duplicated_by:  { label: 'Is Duplicated By',  inverse: 'duplicates',      color: 'text-purple-400' },
  relates_to:        { label: 'Relates To',         inverse: 'relates_to',      color: 'text-blue-400' },
  causes:            { label: 'Causes',             inverse: 'is_caused_by',    color: 'text-orange-400' },
  is_caused_by:      { label: 'Is Caused By',       inverse: 'causes',          color: 'text-orange-400' },
};

/** Default pagination */
export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Default categories */
export const DEFAULT_CATEGORIES = [
  'Bug Report',
  'Feature Request',
  'Support',
  'Billing',
  'Infrastructure',
  'Security',
  'Documentation',
  'Other',
];

/** Default SLA thresholds (hours) */
export const DEFAULT_RESPONSE_SLA_HOURS = 4;
export const DEFAULT_RESOLUTION_SLA_HOURS = 48;

/** Preset tag colors */
export const TAG_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6',
  '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#78716c',
];

/** Keyboard shortcut definitions */
export const KEYBOARD_SHORTCUTS = [
  { key: 'n',       label: 'New Ticket',           description: 'Create a new ticket' },
  { key: '/',       label: 'Search',                description: 'Focus the search bar' },
  { key: 'f',       label: 'Filter',                description: 'Open filter panel' },
  { key: 'Escape',  label: 'Close / Deselect',      description: 'Close modal or clear selection' },
  { key: 'a',       label: 'Select All',            description: 'Select all visible tickets' },
  { key: 's',       label: 'Toggle My Tickets',     description: 'Show only tickets assigned to me' },
  { key: '1-5',     label: 'Filter by Priority',    description: '1=Critical, 2=High, 3=Medium, 4=Low, 5=Minimal' },
  { key: 'Enter',   label: 'Open Selected',         description: 'Open the first selected ticket' },
] as const;

/** Default plugin settings */
export const DEFAULT_SETTINGS = {
  autoAssignEnabled: false,
  autoCloseDays: 30,
  defaultPriority: 'medium' as const,
  defaultCategory: 'Support',
  allowedCategories: DEFAULT_CATEGORIES,
  responseSlaHours: DEFAULT_RESPONSE_SLA_HOURS,
  resolutionSlaHours: DEFAULT_RESOLUTION_SLA_HOURS,
  maxEscalationLevel: 3,
  enableLinkedTickets: true,
  enableAttachments: true,
  enableInternalComments: true,
  enableTemplates: true,
  enableTags: true,
  enableExport: true,
  customFields: [],
};
