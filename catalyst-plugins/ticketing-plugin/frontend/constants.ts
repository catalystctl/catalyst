import type { TicketPriority, TicketStatus } from './types';

/**
 * Status / priority visuals use Catalyst semantic tokens only
 * (info / warning / success / danger / muted) — never raw palette hex.
 */
export const STATUS_CONFIG: Record<
  TicketStatus,
  {
    label: string;
    /** Text + icon color */
    color: string;
    /** Soft fill + optional border */
    bg: string;
    /** Left-rail accent for active rows */
    rail: string;
  }
> = {
  open: {
    label: 'Open',
    color: 'text-info',
    bg: 'bg-info/12 text-info border-info/20',
    rail: 'bg-info',
  },
  in_progress: {
    label: 'In Progress',
    color: 'text-warning',
    bg: 'bg-warning/12 text-warning border-warning/20',
    rail: 'bg-warning',
  },
  pending: {
    label: 'Pending',
    color: 'text-warning',
    bg: 'bg-warning/10 text-warning border-warning/15',
    rail: 'bg-warning/70',
  },
  resolved: {
    label: 'Resolved',
    color: 'text-success',
    bg: 'bg-success/12 text-success border-success/20',
    rail: 'bg-success',
  },
  closed: {
    label: 'Closed',
    color: 'text-muted-foreground',
    bg: 'bg-surface-2 text-muted-foreground border-border',
    rail: 'bg-muted-foreground/40',
  },
};

export const PRIORITY_CONFIG: Record<
  TicketPriority,
  { label: string; color: string; dot: string; weight: number }
> = {
  critical: {
    label: 'Critical',
    color: 'text-danger',
    dot: 'bg-danger',
    weight: 5,
  },
  high: {
    label: 'High',
    color: 'text-warning',
    dot: 'bg-warning',
    weight: 4,
  },
  medium: {
    label: 'Medium',
    color: 'text-foreground/80',
    dot: 'bg-muted-foreground',
    weight: 3,
  },
  low: {
    label: 'Low',
    color: 'text-info',
    dot: 'bg-info',
    weight: 2,
  },
  minimal: {
    label: 'Minimal',
    color: 'text-muted-foreground',
    dot: 'bg-muted-foreground/50',
    weight: 1,
  },
};

export const CATEGORIES = [
  'Bug Report',
  'Feature Request',
  'Support',
  'Billing',
  'Infrastructure',
  'Security',
  'Documentation',
  'Other',
] as const;

export const STATUSES: TicketStatus[] = [
  'open',
  'in_progress',
  'pending',
  'resolved',
  'closed',
];

export const PRIORITIES: TicketPriority[] = [
  'critical',
  'high',
  'medium',
  'low',
  'minimal',
];

export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Soft tag chips — keep as CSS vars via Tailwind, not hex. */
export const TAG_COLORS = [
  'bg-danger/15 text-danger',
  'bg-warning/15 text-warning',
  'bg-success/15 text-success',
  'bg-info/15 text-info',
  'bg-primary/15 text-primary',
  'bg-surface-2 text-muted-foreground',
];
