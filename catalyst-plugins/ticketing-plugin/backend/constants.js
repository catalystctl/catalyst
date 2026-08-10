/** Shared domain constants for the ticketing plugin. */

export const STATUSES = ['open', 'in_progress', 'pending', 'resolved', 'closed'];

export const STATUS_TRANSITIONS = {
  open: ['in_progress', 'pending', 'closed'],
  in_progress: ['pending', 'resolved', 'open'],
  pending: ['in_progress', 'resolved', 'open'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};

export const PRIORITIES = ['critical', 'high', 'medium', 'low', 'minimal'];

export const PRIORITY_WEIGHT = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  minimal: 1,
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
];

export const TICKET_NUMBER_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
