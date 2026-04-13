import React from 'react';
import { useAuthStore } from '../../stores/authStore';
import { motion, type Variants } from 'framer-motion';
import {
  Ticket,
  Plus,
  Search,
  Filter,
  ArrowLeft,
  MessageSquare,
  Clock,
  User,
  Server,
  Tag,
  AlertCircle,
  CheckCircle2,
  CircleDot,
  HourglassIcon,
  XCircle,
  ChevronRight,
  Loader2,
  Send,
  Trash2,
  Edit3,
  BarChart3,
  TrendingUp,
  ArrowUpRight,
  Shield,
  FileText,
  MoreHorizontal,
  ExternalLink,
  Copy,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { StatsCard } from '@/components/ui/stats-card';
import { cn } from '@/lib/utils';

// ═══════════════════════════════════════════════════════════════
//  CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════════════════

const API = '/api/plugins/ticketing-plugin';

const STATUS_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; badge: 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline' }> = {
  open: { label: 'Open', icon: CircleDot, color: 'text-info', badge: 'default' },
  in_progress: { label: 'In Progress', icon: HourglassIcon, color: 'text-warning', badge: 'warning' },
  pending: { label: 'Pending', icon: Clock, color: 'text-primary', badge: 'default' },
  resolved: { label: 'Resolved', icon: CheckCircle2, color: 'text-success', badge: 'success' },
  closed: { label: 'Closed', icon: XCircle, color: 'text-muted-foreground', badge: 'secondary' },
};

const PRIORITY_CONFIG: Record<string, { label: string; dot: string; weight: number; color: string }> = {
  critical: { label: 'Critical', dot: 'bg-red-500', weight: 0, color: 'text-red-400' },
  high: { label: 'High', dot: 'bg-orange-500', weight: 1, color: 'text-orange-400' },
  medium: { label: 'Medium', dot: 'bg-yellow-500', weight: 2, color: 'text-yellow-400' },
  low: { label: 'Low', dot: 'bg-green-500', weight: 3, color: 'text-green-400' },
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  general: MessageSquare,
  bug: AlertCircle,
  feature: TrendingUp,
  support: Shield,
  other: FileText,
};

function timeAgo(date: string): string {
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

function formatDate(date: string): string {
  return new Date(date).toLocaleString();
}

function apiFetch(path: string, options?: RequestInit) {
  return fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }).then((r) => r.json());
}

// ═══════════════════════════════════════════════════════════════
//  ANIMATION VARIANTS
// ═══════════════════════════════════════════════════════════════

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.1 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

const scaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 200, damping: 20 },
  },
};

// ═══════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════

interface Ticket {
  id: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  category: string;
  serverId?: string;
  assignedTo?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  comments?: any[];
}

interface Comment {
  id: string;
  content: string;
  authorId: string;
  authorName?: string;
  isInternal: boolean;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════════
//  SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.open;
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.badge} className="gap-1.5">
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span className={cn('h-2 w-2 rounded-full', cfg.dot)} />
      <span className={cfg.color}>{cfg.label}</span>
    </span>
  );
}

function IconBox({ children, color = 'primary' }: { children: React.ReactNode; color?: string }) {
  const gradients: Record<string, string> = {
    primary: 'from-primary-50 to-primary-100 dark:from-primary-950/50 dark:to-primary-900/30',
    success: 'from-emerald-50 to-emerald-100 dark:from-emerald-950/50 dark:to-emerald-900/30',
    warning: 'from-amber-50 to-amber-100 dark:from-amber-950/50 dark:to-amber-900/30',
    danger: 'from-red-50 to-red-100 dark:from-red-950/50 dark:to-red-900/30',
    info: 'from-sky-50 to-sky-100 dark:from-sky-950/50 dark:to-sky-900/30',
    violet: 'from-violet-50 to-violet-100 dark:from-violet-950/50 dark:to-violet-900/30',
  };
  return (
    <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br shadow-sm">
      <div className={cn('absolute inset-0 rounded-lg bg-gradient-to-br', gradients[color] || gradients.primary)} />
      <div className={cn(
        'absolute inset-0 rounded-lg ring-1 ring-inset',
        color === 'primary' ? 'ring-primary-200/50 dark:ring-primary-800/50' :
        color === 'success' ? 'ring-emerald-200/50 dark:ring-emerald-800/50' :
        color === 'warning' ? 'ring-amber-200/50 dark:ring-amber-800/50' :
        color === 'danger' ? 'ring-red-200/50 dark:ring-red-800/50' :
        color === 'info' ? 'ring-sky-200/50 dark:ring-sky-800/50' :
        'ring-violet-200/50 dark:ring-violet-800/50'
      )} />
      <span className="relative">{children}</span>
    </div>
  );
}

function IconCircle({ children, color = 'primary', size = 'md' }: { children: React.ReactNode; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const gradients: Record<string, string> = {
    primary: 'from-primary-50 to-primary-100 dark:from-primary-950/30 dark:to-primary-900/20',
    success: 'from-emerald-50 to-emerald-100 dark:from-emerald-950/30 dark:to-emerald-900/20',
    warning: 'from-amber-50 to-amber-100 dark:from-amber-950/30 dark:to-amber-900/20',
    danger: 'from-red-50 to-red-100 dark:from-red-950/30 dark:to-red-900/20',
    info: 'from-sky-50 to-sky-100 dark:from-sky-950/30 dark:to-sky-900/20',
    violet: 'from-violet-50 to-violet-100 dark:from-violet-950/30 dark:to-violet-900/20',
  };
  const sizes = { sm: 'h-8 w-8', md: 'h-11 w-11', lg: 'h-14 w-14' };
  return (
    <div className="relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm">
      <div className={cn('absolute inset-0 rounded-full bg-gradient-to-br', gradients[color] || gradients.primary)} />
      <div className={cn('absolute inset-0 rounded-full ring-1 ring-inset', 'ring-black/5 dark:ring-white/5')} />
      <span className={cn('relative', sizes[size])}>{children}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-12" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border border-border p-4">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </label>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TICKET ROW COMPONENT
// ═══════════════════════════════════════════════════════════════

function TicketRow({ ticket, onSelect, users }: { ticket: Ticket; onSelect: (id: string) => void; users: any[] }) {
  const creator = users.find((u) => u.id === ticket.createdBy);
  const assignee = users.find((u) => u.id === ticket.assignedTo);
  const CatIcon = CATEGORY_ICONS[ticket.category] || FileText;
  const commentCount = ticket.comments?.length || 0;

  return (
    <motion.div
      variants={itemVariants}
      onClick={() => onSelect(ticket.id)}
      className={cn(
        'group flex items-center gap-4 rounded-xl border border-border/80 bg-card px-5 py-4 cursor-pointer',
        'transition-all duration-200 hover:shadow-elevated dark:hover:shadow-elevated-dark',
        'hover:border-primary/30 dark:hover:border-primary/20'
      )}
    >
      {/* Category icon */}
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-100 to-zinc-50 shadow-sm dark:from-zinc-800 dark:to-zinc-900">
        <CatIcon className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Main content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
            {ticket.subject}
          </span>
          {ticket.tags?.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="hidden shrink-0 text-[10px] sm:inline-flex">
              {tag}
            </Badge>
          ))}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {creator?.username || creator?.email || 'Unknown'}
          </span>
          {assignee && (
            <span className="flex items-center gap-1">
              <ArrowUpRight className="h-3 w-3" />
              {assignee.username || assignee.email}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo(ticket.updatedAt)}
          </span>
        </div>
      </div>

      {/* Right side */}
      <div className="flex shrink-0 items-center gap-3">
        {commentCount > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
            <MessageSquare className="h-3 w-3" />
            {commentCount}
          </span>
        )}
        <StatusBadge status={ticket.status} />
        <PriorityDot priority={ticket.priority} />
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  CREATE TICKET MODAL
// ═══════════════════════════════════════════════════════════════

function CreateTicketModal({
  open,
  onClose,
  categories,
  users,
  servers,
  defaultServerId,
  defaultUserId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  categories: any[];
  users: any[];
  servers: any[];
  defaultServerId?: string;
  defaultUserId?: string;
  onCreated: (ticket: any) => void;
}) {
  const [subject, setSubject] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState('general');
  const [priority, setPriority] = React.useState('medium');
  const [serverId, setServerId] = React.useState(defaultServerId || '');
  const [userId, setUserId] = React.useState(defaultUserId || '');
  const [tags, setTags] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const handleSubmit = async () => {
    if (!subject.trim()) { setError('Subject is required'); return; }
    setSaving(true);
    setError('');
    try {
      const body: any = { subject: subject.trim(), description: description.trim(), category, priority };
      if (serverId) body.serverId = serverId;
      if (userId) body.createdBy = userId;
      if (tags.trim()) body.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
      const res = await apiFetch('/tickets', { method: 'POST', body: JSON.stringify(body) });
      if (res.success) {
        resetForm();
        onCreated(res.data);
        onClose();
      } else {
        setError(res.error || 'Failed to create ticket');
      }
    } catch {
      setError('Network error');
    }
    setSaving(false);
  };

  const resetForm = () => {
    setSubject('');
    setDescription('');
    setCategory('general');
    setPriority('medium');
    setServerId(defaultServerId || '');
    setUserId(defaultUserId || '');
    setTags('');
    setError('');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-elevated dark:shadow-elevated-dark"
      >
        <div className="mb-6 flex items-center gap-3">
          <IconBox color="primary">
            <Plus className="h-4 w-4 text-primary" />
          </IconBox>
          <div>
            <h2 className="font-display text-lg font-semibold text-foreground">Create Ticket</h2>
            <p className="text-xs text-muted-foreground">Describe your issue or request</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <FieldLabel>Subject *</FieldLabel>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Brief summary of the issue"
              className="mt-1.5"
            />
          </div>

          <div>
            <FieldLabel>Description</FieldLabel>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed description, steps to reproduce, expected behavior..."
              rows={5}
              className="mt-1.5"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Category</FieldLabel>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>Priority</FieldLabel>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel>Link to Server</FieldLabel>
              <select
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
                className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <option value="">None</option>
                {servers.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>On behalf of</FieldLabel>
              <select
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <option value="">Myself</option>
                {users.map((u: any) => (
                  <option key={u.id} value={u.id}>{u.username || u.email}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <FieldLabel>Tags</FieldLabel>
            <Input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Comma-separated tags (e.g. crash, login, pvp)"
              className="mt-1.5"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Ticket
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  TICKET DETAIL VIEW
// ═══════════════════════════════════════════════════════════════

function TicketDetail({
  ticket,
  comments,
  categories,
  users,
  servers,
  statuses,
  transitions,
  onBack,
  onUpdate,
  onDelete,
  onAddComment,
  onDeleteComment,
  isAdmin,
}: {
  ticket: Ticket;
  comments: Comment[];
  categories: any[];
  users: any[];
  servers: any[];
  statuses: any[];
  transitions: Record<string, string[]>;
  onBack: () => void;
  onUpdate: (id: string, data: any) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddComment: (ticketId: string, content: string, isInternal: boolean, statusChange?: string) => Promise<void>;
  onDeleteComment: (ticketId: string, commentId: string) => Promise<void>;
  isAdmin?: boolean;
}) {
  const [newComment, setNewComment] = React.useState('');
  const [isInternal, setIsInternal] = React.useState(false);
  const [statusChange, setStatusChange] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const creator = users.find((u) => u.id === ticket.createdBy);
  const assignee = users.find((u) => u.id === ticket.assignedTo);
  const availableTransitions = transitions[ticket.status] || [];
  const CatIcon = CATEGORY_ICONS[ticket.category] || FileText;

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      await onAddComment(ticket.id, newComment.trim(), isInternal && !!isAdmin, statusChange || undefined);
      setNewComment('');
      setIsInternal(false);
      setStatusChange('');
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-xl font-bold text-foreground truncate">{ticket.subject}</h2>
            <StatusBadge status={ticket.status} />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            #{ticket.id.slice(0, 8)} · Opened {timeAgo(ticket.createdAt)}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-danger hover:text-danger hover:bg-danger/10" onClick={() => onDelete(ticket.id)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Main content — 2 cols */}
        <div className="lg:col-span-2 space-y-4">
          {/* Description */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <IconBox color="info">
                  <FileText className="h-4 w-4 text-info" />
                </IconBox>
                Description
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ticket.description ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                  {ticket.description}
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">No description provided.</p>
              )}
              {ticket.tags?.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {ticket.tags.map((tag) => (
                    <Badge key={tag} variant="secondary" className="gap-1">
                      <Tag className="h-3 w-3" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Comments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                  <IconBox color="violet">
                    <MessageSquare className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                  </IconBox>
                  Comments
                  <Badge variant="secondary" className="ml-1">{comments.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Existing comments */}
              {comments.length === 0 && (
                <div className="py-6 text-center">
                  <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-2 text-sm text-muted-foreground">No comments yet</p>
                </div>
              )}
              {comments.map((comment) => {
                const author = comment.user;
                return (
                  <div key={comment.id} className="group relative rounded-lg border border-border/50 bg-surface-2/50 p-4">
                    {comment.isInternal && (
                      <Badge variant="warning" className="absolute -top-2 right-3 text-[10px]">
                        Internal
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-foreground">
                        {(author?.username || author?.email || '?')[0].toUpperCase()}
                      </div>
                      <span className="text-sm font-semibold text-foreground">
                        {author?.username || author?.email || 'Unknown'}
                      </span>
                      <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</span>
                      {isAdmin && (
                        <button
                          onClick={() => onDeleteComment(ticket.id, comment.id)}
                          className="ml-auto rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                      {comment.content}
                    </p>
                  </div>
                );
              })}

              {/* New comment */}
              <div className="rounded-lg border border-border p-4">
                <Textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Write a comment..."
                  rows={3}
                />
                <div className="mt-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isAdmin && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isInternal}
                          onChange={(e) => setIsInternal(e.target.checked)}
                          className="rounded border-border"
                        />
                        Internal note
                      </label>
                    )}
                    {availableTransitions.length > 0 && (
                      <select
                        value={statusChange}
                        onChange={(e) => setStatusChange(e.target.value)}
                        className="h-7 rounded-md border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        <option value="">Change status...</option>
                        {availableTransitions.map((t) => (
                          <option key={t} value={t}>{STATUS_CONFIG[t]?.label || t}</option>
                        ))}
                      </select>
                    )}
                  </div>
                  <Button size="sm" onClick={handleSubmitComment} disabled={submitting || !newComment.trim()}>
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Reply
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar — 1 col */}
        <div className="space-y-4">
          {/* Properties */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Properties
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status */}
              {isAdmin && availableTransitions.length > 0 ? (
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <select
                    value={ticket.status}
                    onChange={(e) => onUpdate(ticket.id, { status: e.target.value })}
                    className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {statuses.map((s: any) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <FieldLabel>Status</FieldLabel>
                  <StatusBadge status={ticket.status} />
                </div>
              )}

              {/* Priority */}
              {isAdmin ? (
                <div>
                  <FieldLabel>Priority</FieldLabel>
                  <select
                    value={ticket.priority}
                    onChange={(e) => onUpdate(ticket.id, { priority: e.target.value })}
                    className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <FieldLabel>Priority</FieldLabel>
                  <PriorityDot priority={ticket.priority} />
                </div>
              )}

              {/* Category */}
              {isAdmin ? (
                <div>
                  <FieldLabel>Category</FieldLabel>
                  <select
                    value={ticket.category}
                    onChange={(e) => onUpdate(ticket.id, { category: e.target.value })}
                    className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {categories.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <FieldLabel>Category</FieldLabel>
                  <span className="flex items-center gap-1.5 text-sm text-foreground">
                    <CatIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    {categories.find((c: any) => c.id === ticket.category)?.name || ticket.category}
                  </span>
                </div>
              )}

              {/* Assignment */}
              {isAdmin && (
                <div>
                  <FieldLabel>Assigned To</FieldLabel>
                  <select
                    value={ticket.assignedTo || ''}
                    onChange={(e) => onUpdate(ticket.id, { assignedTo: e.target.value || null })}
                    className="mt-1.5 flex h-9 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <option value="">Unassigned</option>
                    {users.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.username || u.email}</option>
                    ))}
                  </select>
                </div>
              )}
            </CardContent>
          </Card>

          {/* People & Server */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-foreground">
                  {(creator?.username || creator?.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Created by</p>
                  <p className="text-sm font-medium text-foreground">{creator?.username || creator?.email || 'Unknown'}</p>
                </div>
              </div>
              {assignee && (
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-foreground">
                    {(assignee.username || assignee.email)[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Assigned to</p>
                    <p className="text-sm font-medium text-foreground">{assignee.username || assignee.email}</p>
                  </div>
                </div>
              )}
              {ticket.serverId && (() => {
                const linkedServer = servers.find((s: any) => s.id === ticket.serverId);
                return (
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2">
                      <Server className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Server</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-2 h-6 gap-1 px-2 text-xs text-primary hover:text-primary"
                        asChild
                      >
                        <a href={`/servers/${ticket.serverId}`}>
                          <Server className="h-3 w-3" />
                          {linkedServer?.name || 'View Server'}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </Button>
                    </div>
                  </div>
                );
              })()}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Created {formatDate(ticket.createdAt)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Updated {formatDate(ticket.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  ADMIN TAB
// ═══════════════════════════════════════════════════════════════

export function AdminTab() {
  const [tickets, setTickets] = React.useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = React.useState<Ticket | null>(null);
  const [ticketComments, setTicketComments] = React.useState<Comment[]>([]);
  const [categories, setCategories] = React.useState<any[]>([]);
  const [users, setUsers] = React.useState<any[]>([]);
  const [servers, setServers] = React.useState<any[]>([]);
  const [statuses, setStatuses] = React.useState<any[]>([]);
  const [transitions, setTransitions] = React.useState<Record<string, string[]>>({});
  const [stats, setStats] = React.useState<any>({});
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);

  // Filters
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');
  const [priorityFilter, setPriorityFilter] = React.useState('');
  const [categoryFilter, setCategoryFilter] = React.useState('');
  const [sortBy, setSortBy] = React.useState('newest');

  const loadInitial = async () => {
    try {
      const [catRes, usersRes, serversRes, statusesRes, transitionsRes, statsRes] = await Promise.all([
        apiFetch('/categories'),
        apiFetch('/users'),
        apiFetch('/servers'),
        apiFetch('/statuses'),
        apiFetch('/transitions'),
        apiFetch('/stats'),
      ]);
      setCategories(catRes.data || []);
      setUsers(usersRes.data || []);
      setServers(serversRes.data || []);
      setStatuses(statusesRes.data || []);
      setTransitions(transitionsRes.data || {});
      setStats(statsRes.data || {});
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  };

  const loadTickets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);
      if (priorityFilter) params.set('priority', priorityFilter);
      if (categoryFilter) params.set('category', categoryFilter);
      params.set('sort', sortBy);
      params.set('limit', '100');

      const res = await apiFetch(`/tickets?${params}`);
      setTickets(res.data || []);
    } catch (err) {
      console.error('Failed to load tickets:', err);
    }
    setLoading(false);
  };

  React.useEffect(() => { loadInitial(); }, []);
  React.useEffect(() => { loadTickets(); }, [search, statusFilter, priorityFilter, categoryFilter, sortBy]);

  const loadTicketDetail = async (id: string) => {
    try {
      const res = await apiFetch(`/tickets/${id}`);
      if (res.success) {
        setSelectedTicket(res.data);
        setTicketComments(res.data.comments || []);
      }
    } catch (err) {
      console.error('Failed to load ticket:', err);
    }
  };

  const handleUpdateTicket = async (id: string, data: any) => {
    try {
      await apiFetch(`/tickets/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      loadTicketDetail(id);
      loadTickets();
    } catch (err) {
      console.error('Failed to update ticket:', err);
    }
  };

  const handleDeleteTicket = async (id: string) => {
    if (!confirm('Delete this ticket? This cannot be undone.')) return;
    try {
      await apiFetch(`/tickets/${id}`, { method: 'DELETE' });
      setSelectedTicket(null);
      loadTickets();
    } catch (err) {
      console.error('Failed to delete ticket:', err);
    }
  };

  const handleAddComment = async (ticketId: string, content: string, isInternal: boolean, statusChange?: string) => {
    try {
      await apiFetch(`/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, isInternal, statusChange }),
      });
      loadTicketDetail(ticketId);
      loadTickets();
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  };

  const handleDeleteComment = async (ticketId: string, commentId: string) => {
    try {
      await apiFetch(`/tickets/${ticketId}/comments/${commentId}`, { method: 'DELETE' });
      loadTicketDetail(ticketId);
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  const handleCreated = (ticket: Ticket) => {
    loadTickets();
    loadTicketDetail(ticket.id);
  };

  const hasActiveFilters = search || statusFilter || priorityFilter || categoryFilter;

  if (loading && !tickets.length) return <LoadingSkeleton />;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      {selectedTicket ? (
        <TicketDetail
          ticket={selectedTicket}
          comments={ticketComments}
          categories={categories}
          users={users}
          servers={servers}
          statuses={statuses}
          transitions={transitions}
          onBack={() => setSelectedTicket(null)}
          onUpdate={handleUpdateTicket}
          onDelete={handleDeleteTicket}
          onAddComment={handleAddComment}
          onDeleteComment={handleDeleteComment}
          isAdmin
        />
      ) : (
        <>
          {/* Header */}
          <motion.div variants={itemVariants} className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-primary to-cyan-500 opacity-20 blur-sm" />
                  <Ticket className="relative h-7 w-7 text-primary" />
                </div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
                  Ticket Manager
                </h1>
              </div>
              <p className="ml-10 text-sm text-muted-foreground">
                Track and resolve support requests across your platform
              </p>
            </div>
            <Button onClick={() => setShowCreate(true)} className="gap-2 shadow-sm">
              <Plus className="h-4 w-4" />
              New Ticket
            </Button>
          </motion.div>

          {/* Stats Grid */}
          <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatsCard
              title="Open"
              value={stats.open ?? 0}
              subtitle="Needs attention"
              icon={<CircleDot className="h-4 w-4" />}
              variant="info"
            />
            <StatsCard
              title="In Progress"
              value={stats.in_progress ?? 0}
              subtitle="Being worked on"
              icon={<HourglassIcon className="h-4 w-4" />}
              variant="warning"
            />
            <StatsCard
              title="Resolved"
              value={stats.resolved ?? 0}
              subtitle="Awaiting closure"
              icon={<CheckCircle2 className="h-4 w-4" />}
              variant="success"
            />
            <StatsCard
              title="Critical"
              value={stats.critical ?? 0}
              subtitle={stats.critical > 0 ? 'Requires immediate action' : 'No critical issues'}
              icon={<AlertCircle className="h-4 w-4" />}
              variant={stats.critical > 0 ? 'danger' : 'default'}
            />
          </motion.div>

          {/* Filters Bar */}
          <motion.div variants={itemVariants}>
            <Card className="overflow-hidden">
              <CardContent className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search tickets..."
                      className="pl-8 h-8"
                    />
                  </div>

                  {/* Status filter */}
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <option value="">All Statuses</option>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>

                  {/* Priority filter */}
                  <select
                    value={priorityFilter}
                    onChange={(e) => setPriorityFilter(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <option value="">All Priorities</option>
                    {Object.entries(PRIORITY_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>

                  {/* Category filter */}
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <option value="">All Categories</option>
                    {categories.map((c: any) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>

                  {/* Sort */}
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="priority">Priority</option>
                    <option value="updated">Recently Updated</option>
                  </select>

                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => { setSearch(''); setStatusFilter(''); setPriorityFilter(''); setCategoryFilter(''); }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Ticket List */}
          <motion.div variants={itemVariants} className="space-y-2">
            {tickets.length === 0 ? (
              <Card className="py-16">
                <CardContent className="flex flex-col items-center justify-center text-center">
                  <div className="relative inline-flex">
                    <div className="absolute inset-0 -m-2 rounded-full bg-gradient-to-br from-zinc-100 to-zinc-200 blur-xl dark:from-zinc-800 dark:to-zinc-700" />
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-zinc-50 to-zinc-100 shadow-sm dark:from-zinc-900 dark:to-zinc-800">
                      <Ticket className="h-7 w-7 text-muted-foreground" />
                    </div>
                  </div>
                  <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                    {hasActiveFilters ? 'No matching tickets' : 'No tickets yet'}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {hasActiveFilters
                      ? 'Try adjusting your filters'
                      : 'Create your first ticket to get started'}
                  </p>
                  {!hasActiveFilters && (
                    <Button className="mt-4 gap-2" onClick={() => setShowCreate(true)}>
                      <Plus className="h-4 w-4" />
                      Create Ticket
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {tickets.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    onSelect={loadTicketDetail}
                    users={users}
                  />
                ))}
              </>
            )}
          </motion.div>
        </>
      )}

      <CreateTicketModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        categories={categories}
        users={users}
        servers={servers}
        onCreated={handleCreated}
      />
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  SERVER TAB
// ═══════════════════════════════════════════════════════════════

export function ServerTab({ serverId }: { serverId: string }) {
  const [tickets, setTickets] = React.useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = React.useState<Ticket | null>(null);
  const [ticketComments, setTicketComments] = React.useState<Comment[]>([]);
  const [categories, setCategories] = React.useState<any[]>([]);
  const [users, setUsers] = React.useState<any[]>([]);
  const [servers, setServers] = React.useState<any[]>([]);
  const [statuses, setStatuses] = React.useState<any[]>([]);
  const [transitions, setTransitions] = React.useState<Record<string, string[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('');

  const loadInitial = async () => {
    try {
      const [catRes, usersRes, serversRes, statusesRes, transitionsRes] = await Promise.all([
        apiFetch('/categories'),
        apiFetch('/users'),
        apiFetch('/servers'),
        apiFetch('/statuses'),
        apiFetch('/transitions'),
      ]);
      setCategories(catRes.data || []);
      setUsers(usersRes.data || []);
      setServers(serversRes.data || []);
      setStatuses(statusesRes.data || []);
      setTransitions(transitionsRes.data || {});
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  };

  const loadTickets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('serverId', serverId);
      params.set('sort', 'newest');
      params.set('limit', '100');
      if (search) params.set('search', search);
      if (statusFilter) params.set('status', statusFilter);

      const res = await apiFetch(`/tickets?${params}`);
      setTickets(res.data || []);
    } catch (err) {
      console.error('Failed to load tickets:', err);
    }
    setLoading(false);
  };

  React.useEffect(() => { loadInitial(); }, []);
  React.useEffect(() => { loadTickets(); }, [serverId, search, statusFilter]);

  const loadTicketDetail = async (id: string) => {
    try {
      const res = await apiFetch(`/tickets/${id}`);
      if (res.success) {
        setSelectedTicket(res.data);
        setTicketComments(res.data.comments || []);
      }
    } catch (err) {
      console.error('Failed to load ticket:', err);
    }
  };

  const handleAddComment = async (ticketId: string, content: string, isInternal: boolean, statusChange?: string) => {
    try {
      await apiFetch(`/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, isInternal, statusChange }),
      });
      loadTicketDetail(ticketId);
      loadTickets();
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  };

  const handleUpdateTicket = async (id: string, data: any) => {
    try {
      await apiFetch(`/tickets/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      loadTicketDetail(id);
      loadTickets();
    } catch (err) {
      console.error('Failed to update ticket:', err);
    }
  };

  const handleDeleteTicket = async (id: string) => {
    if (!confirm('Delete this ticket? This cannot be undone.')) return;
    try {
      await apiFetch(`/tickets/${id}`, { method: 'DELETE' });
      setSelectedTicket(null);
      loadTickets();
    } catch (err) {
      console.error('Failed to delete ticket:', err);
    }
  };

  const handleDeleteComment = async (ticketId: string, commentId: string) => {
    try {
      await apiFetch(`/tickets/${ticketId}/comments/${commentId}`, { method: 'DELETE' });
      loadTicketDetail(ticketId);
    } catch (err) {
      console.error('Failed to delete comment:', err);
    }
  };

  if (selectedTicket) {
    return (
      <div className="space-y-4">
        <TicketDetail
          ticket={selectedTicket}
          comments={ticketComments}
          categories={categories}
          users={users}
          servers={servers}
          statuses={statuses}
          transitions={transitions}
          onBack={() => setSelectedTicket(null)}
          onUpdate={handleUpdateTicket}
          onDelete={handleDeleteTicket}
          onAddComment={handleAddComment}
          onDeleteComment={handleDeleteComment}
          isAdmin
        />
      </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <IconBox color="primary">
              <Ticket className="h-4 w-4 text-primary" />
            </IconBox>
            <h2 className="font-display text-xl font-bold text-foreground">Server Tickets</h2>
          </div>
          <p className="ml-11 text-xs text-muted-foreground">
            Support requests linked to this server
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Ticket
        </Button>
      </motion.div>

      {/* Filters */}
      <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-8 h-8 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <option value="">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">{tickets.length} ticket{tickets.length !== 1 ? 's' : ''}</span>
      </motion.div>

      {/* List */}
      <motion.div variants={itemVariants} className="space-y-2">
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 rounded-xl border border-border p-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : tickets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card px-6 py-12 text-center">
            <Ticket className="mx-auto h-8 w-8 text-muted-foreground/40" />
            <h3 className="mt-3 font-display text-base font-semibold text-foreground">No tickets for this server</h3>
            <p className="mt-1 text-sm text-muted-foreground">Create one to track an issue or request</p>
          </div>
        ) : (
          tickets.map((ticket) => (
            <TicketRow key={ticket.id} ticket={ticket} onSelect={loadTicketDetail} users={users} />
          ))
        )}
      </motion.div>

      <CreateTicketModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        categories={categories}
        users={users}
        servers={servers}
        defaultServerId={serverId}
        onCreated={(ticket) => {
          loadTickets();
          loadTicketDetail(ticket.id);
        }}
      />
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  USER PAGE
// ═══════════════════════════════════════════════════════════════

export function UserPage() {
  // Get current user from the app's auth store
  const currentUserId = useAuthStore.getState().user?.id || null;

  const [tickets, setTickets] = React.useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = React.useState<Ticket | null>(null);
  const [ticketComments, setTicketComments] = React.useState<Comment[]>([]);
  const [categories, setCategories] = React.useState<any[]>([]);
  const [users, setUsers] = React.useState<any[]>([]);
  const [servers, setServers] = React.useState<any[]>([]);
  const [statuses, setStatuses] = React.useState<any[]>([]);
  const [transitions, setTransitions] = React.useState<Record<string, string[]>>({});
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState('');
  const [search, setSearch] = React.useState('');

  const loadInitial = async () => {
    try {
      const [catRes, usersRes, serversRes, statusesRes, transitionsRes] = await Promise.all([
        apiFetch('/categories'),
        apiFetch('/users'),
        apiFetch('/servers'),
        apiFetch('/statuses'),
        apiFetch('/transitions'),
      ]);
      setCategories(catRes.data || []);
      setUsers(usersRes.data || []);
      setServers(serversRes.data || []);
      setStatuses(statusesRes.data || []);
      setTransitions(transitionsRes.data || {});
    } catch (err) {
      console.error('Failed to load initial data:', err);
    }
  };

  const loadTickets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('sort', 'newest');
      params.set('limit', '50');
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      if (currentUserId) params.set('createdBy', currentUserId);

      const res = await apiFetch(`/tickets?${params}`);
      setTickets(res.data || []);
    } catch (err) {
      console.error('Failed to load tickets:', err);
    }
    setLoading(false);
  };

  React.useEffect(() => { loadInitial(); }, []);
  React.useEffect(() => { loadTickets(); }, [statusFilter, search, currentUserId]);

  const loadTicketDetail = async (id: string) => {
    try {
      const res = await apiFetch(`/tickets/${id}`);
      if (res.success) {
        setSelectedTicket(res.data);
        setTicketComments(res.data.comments || []);
      }
    } catch (err) {
      console.error('Failed to load ticket:', err);
    }
  };

  const handleAddComment = async (ticketId: string, content: string, isInternal: boolean, statusChange?: string) => {
    try {
      await apiFetch(`/tickets/${ticketId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ content, isInternal: false, statusChange }),
      });
      loadTicketDetail(ticketId);
      loadTickets();
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
  };

  const handleDeleteComment = async (_ticketId: string, _commentId: string) => {
    // Users can't delete comments
  };

  const handleUpdateTicket = async (_id: string, _data: any) => {
    // Users can't update ticket properties directly
  };

  const handleDeleteTicket = async (_id: string) => {
    // Users can't delete tickets
  };

  const handleCreated = (ticket: Ticket) => {
    loadTickets();
    loadTicketDetail(ticket.id);
  };

  // If viewing a single ticket, show the detail
  if (selectedTicket) {
    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-4"
      >
        <TicketDetail
          ticket={selectedTicket}
          comments={ticketComments}
          categories={categories}
          users={users}
          servers={servers}
          statuses={statuses}
          transitions={transitions}
          onBack={() => setSelectedTicket(null)}
          onUpdate={handleUpdateTicket}
          onDelete={handleDeleteTicket}
          onAddComment={handleAddComment}
          onDeleteComment={handleDeleteComment}
          isAdmin={false}
        />
      </motion.div>
    );
  }

  // Count tickets by status for user summary
  const openCount = tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length;
  const resolvedCount = tickets.filter((t) => t.status === 'resolved').length;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-gradient-to-br from-primary/10 to-cyan-500/10 blur-3xl dark:from-primary/20 dark:to-cyan-500/20" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-gradient-to-tr from-sky-500/10 to-violet-500/10 blur-3xl dark:from-sky-500/20 dark:to-violet-500/20" />
      </div>

      <div className="relative z-10 space-y-6">
        {/* Header */}
        <motion.div variants={itemVariants}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-primary to-cyan-500 opacity-20 blur-sm" />
                  <Ticket className="relative h-7 w-7 text-primary" />
                </div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
                  My Tickets
                </h1>
              </div>
              <p className="ml-10 text-sm text-muted-foreground">
                Submit and track your support requests
              </p>
            </div>
            <Button onClick={() => setShowCreate(true)} className="gap-2 shadow-sm">
              <Plus className="h-4 w-4" />
              New Ticket
            </Button>
          </div>
        </motion.div>

        {/* User summary cards */}
        <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatsCard
            title="Total"
            value={tickets.length}
            subtitle="All your tickets"
            icon={<Ticket className="h-4 w-4" />}
          />
          <StatsCard
            title="Active"
            value={openCount}
            subtitle="Awaiting response"
            icon={<CircleDot className="h-4 w-4" />}
            variant="info"
          />
          <StatsCard
            title="Resolved"
            value={resolvedCount}
            subtitle="Ready to close"
            icon={<CheckCircle2 className="h-4 w-4" />}
            variant="success"
          />
          <StatsCard
            title="Response Time"
            value="—"
            subtitle="Avg. first reply"
            icon={<Clock className="h-4 w-4" />}
            variant="default"
          />
        </motion.div>

        {/* Filters */}
        <motion.div variants={itemVariants}>
          <Card className="overflow-hidden">
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search your tickets..."
                    className="pl-8 h-8"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setSelectedTicket(null); }}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <option value="">All Statuses</option>
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
                {(search || statusFilter) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => { setSearch(''); setStatusFilter(''); }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Ticket List */}
        <motion.div variants={itemVariants} className="space-y-2">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-4 rounded-xl border border-border p-4">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              ))}
            </div>
          ) : tickets.length === 0 ? (
            <Card className="py-16">
              <CardContent className="flex flex-col items-center justify-center text-center">
                <div className="relative inline-flex">
                  <div className="absolute inset-0 -m-2 rounded-full bg-gradient-to-br from-primary-100 to-cyan-100 blur-xl dark:from-primary-900/50 dark:to-cyan-900/50" />
                  <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary-50 to-cyan-50 shadow-sm dark:from-primary-950/50 dark:to-cyan-950/50">
                    <Ticket className="h-7 w-7 text-primary" />
                  </div>
                </div>
                <h3 className="mt-4 font-display text-lg font-semibold text-foreground">
                  {search || statusFilter ? 'No matching tickets' : 'No tickets yet'}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {search || statusFilter
                    ? 'Try adjusting your filters'
                    : "You haven't submitted any tickets yet"}
                </p>
                {!search && !statusFilter && (
                  <Button className="mt-4 gap-2" onClick={() => setShowCreate(true)}>
                    <Plus className="h-4 w-4" />
                    Submit a Ticket
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {tickets.length} ticket{tickets.length !== 1 ? 's' : ''}
                </span>
              </div>
              {tickets.map((ticket) => (
                <TicketRow key={ticket.id} ticket={ticket} onSelect={loadTicketDetail} users={users} />
              ))}
            </>
          )}
        </motion.div>
      </div>

      <CreateTicketModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        categories={categories}
        users={users}
        servers={servers}
        defaultUserId={currentUserId || undefined}
        onCreated={handleCreated}
      />
    </motion.div>
  );
}
