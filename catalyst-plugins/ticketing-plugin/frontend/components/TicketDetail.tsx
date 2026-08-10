import {
  useEffect,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import {
  Button,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  cn,
  TEXT_MUTED,
  FONT_MONO,
  FONT_DISPLAY,
  Loader2,
  X,
  Trash2,
} from '@/plugins/plugin-ui';
import { MessageSquare, Activity, Shield, Server } from 'lucide-react';
import { StatusBadge } from './shared/StatusBadge';
import { PriorityBadge } from './shared/PriorityBadge';
import { TimeAgo } from './shared/TimeAgo';
import { SLATimer } from './shared/SLATimer';
import {
  PRIORITIES,
  PRIORITY_CONFIG,
  STATUSES,
  STATUS_CONFIG,
  CATEGORIES,
} from '../constants';
import * as api from '../api';
import type {
  Ticket,
  TicketComment,
  TicketActivity,
  TicketPriority,
  TicketStatus,
  UpdateTicketPayload,
  UserRef,
} from '../types';

interface Props {
  ticketId: string;
  users: UserRef[];
  onClose: () => void;
  onChanged: () => void;
}

export function TicketDetail({ ticketId, users, onClose, onChanged }: Props) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [activities, setActivities] = useState<TicketActivity[]>([]);
  const [tab, setTab] = useState<'comments' | 'activity'>('comments');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [comment, setComment] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, c, a] = await Promise.all([
        api.fetchTicket(ticketId),
        api.fetchComments(ticketId),
        api.fetchActivities(ticketId),
      ]);
      setTicket(t);
      setComments(c);
      setActivities(a.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticket');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setComment('');
    setInternal(false);
    setTab('comments');
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const patch = async (data: UpdateTicketPayload) => {
    if (!ticket) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateTicket(ticket.id, data);
      setTicket(updated);
      onChanged();
      const acts = await api.fetchActivities(ticket.id);
      setActivities(acts.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  const submitComment = async () => {
    if (!ticket || !comment.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.addComment(ticket.id, {
        content: comment.trim(),
        isInternal: internal,
      });
      setComment('');
      setInternal(false);
      const [c, a, t] = await Promise.all([
        api.fetchComments(ticket.id),
        api.fetchActivities(ticket.id),
        api.fetchTicket(ticket.id),
      ]);
      setComments(c);
      setActivities(a.data);
      setTicket(t);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add comment');
    } finally {
      setSaving(false);
    }
  };

  const onCommentKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submitComment();
    }
  };

  const handleDelete = async () => {
    if (!ticket) return;
    if (!window.confirm(`Delete ticket ${ticket.ticketNumber}?`)) return;
    setSaving(true);
    try {
      await api.deleteTicket(ticket.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        <p className="text-sm text-muted-foreground">{error || 'Ticket not found'}</p>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Inspector header */}
      <div className="flex-shrink-0 space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn('text-[11px] tabular-nums text-muted-foreground', FONT_MONO)}>
                {ticket.ticketNumber}
              </span>
              <StatusBadge status={ticket.status} compact />
              <PriorityBadge priority={ticket.priority} />
              <SLATimer sla={ticket.sla} />
            </div>
            <h2
              className={cn(
                'text-[15px] font-semibold leading-snug tracking-tight text-foreground',
                FONT_DISPLAY,
              )}
            >
              {ticket.title}
            </h2>
            <p className={cn('text-[11px] leading-relaxed', TEXT_MUTED)}>
              Updated <TimeAgo date={ticket.updatedAt} />
              {ticket.reporter && (
                <> · {ticket.reporter.name || ticket.reporter.username}</>
              )}
              {ticket.server && (
                <span className="ml-1 inline-flex items-center gap-1">
                  · <Server className="h-3 w-3" />
                  {ticket.server.name}
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-shrink-0 items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              disabled={saving}
              title="Delete ticket"
              className="h-8 w-8 text-muted-foreground hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              title="Close (Esc)"
              className="h-8 w-8"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Property grid — tray of controls */}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Status">
            <Select
              value={ticket.status}
              onValueChange={(v) => patch({ status: v as TicketStatus })}
              disabled={saving}
            >
              <SelectTrigger className="h-8 bg-card text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_CONFIG[s].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Priority">
            <Select
              value={ticket.priority}
              onValueChange={(v) => patch({ priority: v as TicketPriority })}
              disabled={saving}
            >
              <SelectTrigger className="h-8 bg-card text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_CONFIG[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Category">
            <Select
              value={ticket.category}
              onValueChange={(v) => patch({ category: v })}
              disabled={saving}
            >
              <SelectTrigger className="h-8 bg-card text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Assignee">
            <Select
              value={ticket.assigneeId || '__unassigned__'}
              onValueChange={(v) =>
                patch({
                  assigneeId: v === '__unassigned__' ? null : v,
                })
              }
              disabled={saving}
            >
              <SelectTrigger className="h-8 bg-card text-xs">
                <SelectValue placeholder="Unassigned" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unassigned__">Unassigned</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name || u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>

      {error && (
        <div className="flex-shrink-0 border-b border-danger/25 bg-danger/10 px-4 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Scroll body */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          <section>
            <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
              Description
            </h3>
            <p className="whitespace-pre-wrap rounded-lg border border-border/70 bg-surface-2/40 px-3 py-2.5 text-[13px] leading-relaxed text-foreground/90">
              {ticket.description || (
                <span className="italic text-muted-foreground">No description</span>
              )}
            </p>
          </section>

          {ticket.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ticket.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <Separator className="bg-border/70" />

          {/* Segmented tabs */}
          <div className="inline-flex rounded-lg border border-border bg-surface-2/50 p-0.5">
            <button
              type="button"
              onClick={() => setTab('comments')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors duration-200',
                tab === 'comments'
                  ? 'bg-card text-foreground shadow-panel'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <MessageSquare className="h-3 w-3" />
              Comments
              <span className="tabular-nums text-muted-foreground">({comments.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('activity')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors duration-200',
                tab === 'activity'
                  ? 'bg-card text-foreground shadow-panel'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Activity className="h-3 w-3" />
              Activity
            </button>
          </div>

          {tab === 'comments' ? (
            <div className="space-y-2">
              {comments.length === 0 && (
                <p className="py-6 text-center text-[11px] text-muted-foreground">
                  No comments yet — leave the first response below.
                </p>
              )}
              {comments.map((c) => (
                <article
                  key={c.id}
                  className={cn(
                    'rounded-lg border px-3 py-2.5',
                    c.isInternal
                      ? 'border-warning/25 bg-warning/[0.06]'
                      : 'border-border/70 bg-card',
                  )}
                >
                  <header className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-medium text-foreground">
                      {c.author?.name || c.author?.username || 'Unknown'}
                      {c.isInternal && (
                        <span className="ml-2 inline-flex items-center gap-1 text-warning">
                          <Shield className="h-3 w-3" />
                          Internal
                        </span>
                      )}
                    </span>
                    <TimeAgo date={c.createdAt} className="text-[10px] text-muted-foreground" />
                  </header>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                    {c.content}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <ol className="space-y-0">
              {activities.length === 0 && (
                <p className="py-6 text-center text-[11px] text-muted-foreground">No activity yet.</p>
              )}
              {activities.map((a, i) => (
                <li key={a.id} className="relative flex gap-3 pb-3 last:pb-0">
                  {/* Timeline rail */}
                  <div className="flex w-3 flex-col items-center">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted-foreground/50" />
                    {i < activities.length - 1 && (
                      <span className="mt-1 w-px flex-1 bg-border" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <p className="text-[11px] leading-snug">
                      <span className="font-medium text-foreground">
                        {a.user?.name || a.user?.username || 'System'}
                      </span>{' '}
                      <span className="text-muted-foreground">{a.type.replace(/_/g, ' ')}</span>
                    </p>
                    <TimeAgo date={a.createdAt} className="text-[10px] text-muted-foreground/80" />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Sticky composer */}
      <div className="flex-shrink-0 border-t border-border bg-card p-3">
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={onCommentKey}
          placeholder="Write a comment… ⌘/Ctrl+Enter to send"
          rows={2}
          className="mb-2 min-h-[3.5rem] resize-none bg-background text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
              className="rounded border-border"
            />
            Internal note
          </label>
          <Button size="sm" className="h-8" onClick={submitComment} disabled={saving || !comment.trim()}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Comment'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
        {label}
      </div>
      {children}
    </div>
  );
}
