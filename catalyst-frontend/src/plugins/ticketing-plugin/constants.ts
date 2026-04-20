import React from 'react';
import {
  CircleDot,
  HourglassIcon,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  MessageSquare,
  TrendingUp,
  Shield,
  FileText,
} from 'lucide-react';
import { motion, type Variants } from 'framer-motion';
import type { BadgeVariant } from '@/components/ui/badge';

// ═══════════════════════════════════════════════════════════════
//  STATUS CONFIG
// ═══════════════════════════════════════════════════════════════

export interface StatusConfig {
  label: string;
  icon: React.ElementType;
  color: string;
  badge: BadgeVariant;
}

export const STATUS_CONFIG: Record<string, StatusConfig> = {
  open: { label: 'Open', icon: CircleDot, color: 'text-info', badge: 'default' },
  in_progress: { label: 'In Progress', icon: HourglassIcon, color: 'text-warning', badge: 'warning' },
  pending: { label: 'Pending', icon: Clock, color: 'text-primary', badge: 'default' },
  resolved: { label: 'Resolved', icon: CheckCircle2, color: 'text-success', badge: 'success' },
  closed: { label: 'Closed', icon: XCircle, color: 'text-muted-foreground', badge: 'secondary' },
};

// ═══════════════════════════════════════════════════════════════
//  PRIORITY CONFIG
// ═══════════════════════════════════════════════════════════════

export interface PriorityConfig {
  label: string;
  dot: string;
  weight: number;
  color: string;
  bg: string;
}

export const PRIORITY_CONFIG: Record<string, PriorityConfig> = {
  critical: { label: 'Critical', dot: 'bg-red-500', weight: 0, color: 'text-red-400', bg: 'bg-red-500/10' },
  high: { label: 'High', dot: 'bg-orange-500', weight: 1, color: 'text-orange-400', bg: 'bg-orange-500/10' },
  medium: { label: 'Medium', dot: 'bg-yellow-500', weight: 2, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  low: { label: 'Low', dot: 'bg-green-500', weight: 3, color: 'text-green-400', bg: 'bg-green-500/10' },
};

// ═══════════════════════════════════════════════════════════════
//  CATEGORY ICONS
// ═══════════════════════════════════════════════════════════════

export const CATEGORY_ICONS: Record<string, React.ElementType> = {
  general: MessageSquare,
  bug: AlertCircle,
  feature: TrendingUp,
  support: Shield,
  other: FileText,
};

// ═══════════════════════════════════════════════════════════════
//  ACTIVITY CONFIG
// ═══════════════════════════════════════════════════════════════

export interface ActivityConfig {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  label: string;
}

import {
  Plus,
  ArrowRightLeft,
  Tag as TagIcon,
  Paperclip,
  GitMerge,
  Link2,
  Unlink,
  AlertTriangle,
  ChevronUp,
  Pencil,
  Trash2,
  Pin,
  Eye,
} from 'lucide-react';

export const ACTIVITY_CONFIG: Record<string, ActivityConfig> = {
  created: { icon: Plus, color: 'text-info', bgColor: 'bg-info/10', label: 'Created' },
  status_changed: { icon: ArrowRightLeft, color: 'text-primary', bgColor: 'bg-primary/10', label: 'Status Changed' },
  priority_changed: { icon: ChevronUp, color: 'text-warning', bgColor: 'bg-warning/10', label: 'Priority Changed' },
  assignment_changed: { icon: ArrowRightLeft, color: 'text-violet-500', bgColor: 'bg-violet-500/10', label: 'Assignment Changed' },
  category_changed: { icon: TagIcon, color: 'text-cyan-500', bgColor: 'bg-cyan-500/10', label: 'Category Changed' },
  comment_added: { icon: MessageSquare, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10', label: 'Comment Added' },
  comment_edited: { icon: Pencil, color: 'text-amber-500', bgColor: 'bg-amber-500/10', label: 'Comment Edited' },
  comment_deleted: { icon: Trash2, color: 'text-red-500', bgColor: 'bg-red-500/10', label: 'Comment Deleted' },
  comment_pinned: { icon: Pin, color: 'text-pink-500', bgColor: 'bg-pink-500/10', label: 'Comment Pinned' },
  internal_note: { icon: Eye, color: 'text-violet-500', bgColor: 'bg-violet-500/10', label: 'Internal Note' },
  attachment_added: { icon: Paperclip, color: 'text-sky-500', bgColor: 'bg-sky-500/10', label: 'Attachment Added' },
  attachment_removed: { icon: Paperclip, color: 'text-red-500', bgColor: 'bg-red-500/10', label: 'Attachment Removed' },
  ticket_merged: { icon: GitMerge, color: 'text-orange-500', bgColor: 'bg-orange-500/10', label: 'Ticket Merged' },
  ticket_linked: { icon: Link2, color: 'text-cyan-500', bgColor: 'bg-cyan-500/10', label: 'Ticket Linked' },
  ticket_unlinked: { icon: Unlink, color: 'text-muted-foreground', bgColor: 'bg-muted-foreground/10', label: 'Ticket Unlinked' },
  sla_breach: { icon: AlertTriangle, color: 'text-red-500', bgColor: 'bg-red-500/10', label: 'SLA Breach' },
  escalation: { icon: ChevronUp, color: 'text-red-500', bgColor: 'bg-red-500/10', label: 'Escalated' },
};

// ═══════════════════════════════════════════════════════════════
//  ESCALATION LEVELS
// ═══════════════════════════════════════════════════════════════

export const ESCALATION_CONFIG = [
  { level: 0, label: 'None', color: 'text-muted-foreground', bg: 'bg-muted-foreground/10' },
  { level: 1, label: 'Level 1', color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
  { level: 2, label: 'Level 2', color: 'text-orange-500', bg: 'bg-orange-500/10' },
  { level: 3, label: 'Level 3', color: 'text-red-500', bg: 'bg-red-500/10' },
];

// ═══════════════════════════════════════════════════════════════
//  TAG PRESET COLORS
// ═══════════════════════════════════════════════════════════════

export const TAG_COLORS = [
  { name: 'Red', value: 'bg-red-500/15 text-red-400 border-red-500/30', dot: 'bg-red-500' },
  { name: 'Orange', value: 'bg-orange-500/15 text-orange-400 border-orange-500/30', dot: 'bg-orange-500' },
  { name: 'Yellow', value: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-500' },
  { name: 'Green', value: 'bg-green-500/15 text-green-400 border-green-500/30', dot: 'bg-green-500' },
  { name: 'Cyan', value: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30', dot: 'bg-cyan-500' },
  { name: 'Blue', value: 'bg-blue-500/15 text-blue-400 border-blue-500/30', dot: 'bg-blue-500' },
  { name: 'Violet', value: 'bg-violet-500/15 text-violet-400 border-violet-500/30', dot: 'bg-violet-500' },
  { name: 'Pink', value: 'bg-pink-500/15 text-pink-400 border-pink-500/30', dot: 'bg-pink-500' },
  { name: 'Gray', value: 'bg-gray-500/15 text-gray-400 border-gray-500/30', dot: 'bg-gray-500' },
];

// ═══════════════════════════════════════════════════════════════
//  SLA DEFAULTS (minutes)
// ═══════════════════════════════════════════════════════════════

export const SLA_DEFAULTS = {
  firstResponse: 60, // 1 hour
  resolution: 1440, // 24 hours
  warningThreshold: 0.75, // 75% of time elapsed = yellow
};

// ═══════════════════════════════════════════════════════════════
//  PAGE SIZES
// ═══════════════════════════════════════════════════════════════

export const PAGE_SIZES = [10, 25, 50, 100];

// ═══════════════════════════════════════════════════════════════
//  DEFAULT FILTERS
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_FILTERS = {
  search: '',
  status: '',
  priority: '',
  category: '',
  assignedTo: '',
  createdBy: '',
  dateFrom: '',
  dateTo: '',
  tags: [],
};

// ═══════════════════════════════════════════════════════════════
//  SORT OPTIONS
// ═══════════════════════════════════════════════════════════════

export const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest First' },
  { value: 'oldest', label: 'Oldest First' },
  { value: 'priority', label: 'Priority' },
  { value: 'updated', label: 'Recently Updated' },
];

// ═══════════════════════════════════════════════════════════════
//  LINK TYPE CONFIG
// ═══════════════════════════════════════════════════════════════

export const LINK_TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  related: { label: 'Related', icon: Link2, color: 'text-cyan-500' },
  dependent: { label: 'Dependent', icon: ArrowRightLeft, color: 'text-amber-500' },
  duplicate: { label: 'Duplicate', icon: GitMerge, color: 'text-violet-500' },
};

// ═══════════════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

export function timeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(date).toLocaleDateString();
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleString();
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isImageFile(mimetype: string): boolean {
  return mimetype.startsWith('image/');
}

export function getUserDisplayName(user?: { username?: string; email?: string }): string {
  return user?.username || user?.email || 'Unknown';
}

export function getUserInitial(user?: { username?: string; email?: string }): string {
  const name = getUserDisplayName(user);
  return name[0].toUpperCase();
}

// ═══════════════════════════════════════════════════════════════
//  ANIMATION VARIANTS
// ═══════════════════════════════════════════════════════════════

export const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.1 },
  },
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

export const scaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 200, damping: 20 },
  },
};

export const modalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.95, y: 10 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 30 },
  },
  exit: { opacity: 0, scale: 0.95, y: 10 },
};

export const fadeInVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export const slideInVariants: Variants = {
  hidden: { opacity: 0, x: -10 },
  visible: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 25 } },
};

// ═══════════════════════════════════════════════════════════════
//  MARKDOWN RENDERING
// ═══════════════════════════════════════════════════════════════

export function renderMarkdown(text: string): string {
  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (```...```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_m, _lang, code) =>
      `<pre class="overflow-x-auto rounded-lg bg-surface-3 p-3 text-sm"><code>${code.trim()}</code></pre>`
    )
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="rounded bg-surface-3 px-1.5 py-0.5 text-sm font-mono">$1</code>')
    // Headings
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-semibold mt-3 mb-1">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-semibold mt-4 mb-2">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-4 mb-2">$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del class="line-through opacity-60">$1</del>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline underline-offset-2 hover:text-primary/80" target="_blank" rel="noopener noreferrer">$1</a>')
    // Unordered lists
    .replace(/^[-*] (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li class="ml-4 list-decimal">$1</li>')
    // Blockquotes
    .replace(/^&gt; (.+)$/gm, '<blockquote class="border-l-2 border-primary/30 pl-3 italic text-muted-foreground">$1</blockquote>')
    // Horizontal rules
    .replace(/^---$/gm, '<hr class="my-3 border-border" />')
    // Paragraphs - double newlines
    .replace(/\n\n/g, '</p><p class="mb-2">')
    // Single newlines to br
    .replace(/\n/g, '<br />');

  return `<p class="mb-2">${html}</p>`;
}
