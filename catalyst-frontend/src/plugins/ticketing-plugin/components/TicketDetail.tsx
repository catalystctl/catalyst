// src/plugins/ticketing-plugin/components/TicketDetail.tsx
// Full ticket detail view shown in the right panel of AdminDashboard.

import { useState, useMemo } from 'react';
import type {
  Ticket,
  TicketComment,
  TicketActivity,
  TicketStatus,
  UserRef,
  ServerRef,
  Tag,
} from '../types';
import { STATUS_TRANSITIONS } from '../types';
import { STATUS_CONFIG, LINK_TYPE_LABELS } from '../constants';
import {
  Button,
  cn,
  TEXT_MUTED,
  SURFACE_2,
  SURFACE_3,
  FONT_DISPLAY,
  BORDER_COLOR,
  X,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Badge,
  Input,
  Textarea,
  Label,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  ScrollArea,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
  Skeleton,
  Plus,
  ExternalLink,
  Loader2,
} from '../../plugin-ui';
import {
  Send,
  Edit3,
  Link2,
  MessageSquare,
  History,
  Paperclip,
} from 'lucide-react';

import type { useTicketActions } from '../hooks/useTicketActions';
import { StatusBadge } from './shared/StatusBadge';
import { PriorityBadge } from './shared/PriorityBadge';
import { TagBadge } from './shared/TagBadge';
import { SLATimer } from './shared/SLATimer';
import { TimeAgo } from './shared/TimeAgo';
import { MarkdownRenderer } from './shared/MarkdownRenderer';

// ── Types ──

type TicketActionsType = ReturnType<typeof useTicketActions>;

interface TicketDetailProps {
  ticket: Ticket;
  comments: TicketComment[];
  activities: TicketActivity[];
  users: UserRef[];
  servers: ServerRef[];
  tags: Tag[];
  onClose: () => void;
  onRefresh: () => void;
  actions: TicketActionsType;
  isLoading: boolean;
}

// ── Helpers ──

function getUserById(id: string, users: UserRef[]): UserRef | undefined {
  return users.find((u) => u.id === id);
}

function getUserName(id: string, users: UserRef[]): string {
  const user = getUserById(id, users);
  return user?.name ?? user?.username ?? 'Unknown';
}

function getUserInitials(id: string, users: UserRef[]): string {
  const user = getUserById(id, users);
  if (!user) return '??';
  const name = user.name ?? user.username;
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

function formatFullDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getActivityDescription(activity: TicketActivity): string {
  const d = activity.data;
  switch (activity.type) {
    case 'created':
      return 'Ticket created';
    case 'status_changed':
      return `Status changed from ${d.from ?? '?'} to ${d.to ?? '?'}`;
    case 'priority_changed':
      return `Priority changed from ${d.from ?? '?'} to ${d.to ?? '?'}`;
    case 'category_changed':
      return `Category changed from ${d.from ?? '?'} to ${d.to ?? '?'}`;
    case 'assignee_changed':
      return `Assigned to ${d.toName ?? d.to ?? 'Unassigned'}`;
    case 'unassigned':
      return 'Ticket unassigned';
    case 'title_changed':
      return 'Title changed';
    case 'description_changed':
      return 'Description updated';
    case 'comment_added':
      return 'Comment added';
    case 'comment_edited':
      return 'Comment edited';
    case 'comment_deleted':
      return 'Comment deleted';
    case 'attachment_added':
      return `Attachment "${d.name ?? 'file'}" added`;
    case 'attachment_removed':
      return `Attachment "${d.name ?? 'file'}" removed`;
    case 'tag_added':
      return `Tag "${d.name ?? '?'}" added`;
    case 'tag_removed':
      return `Tag "${d.name ?? '?'}" removed`;
    case 'linked':
      return `Linked to ${d.ticketNumber ?? d.ticketId ?? '?'}`;
    case 'unlinked':
      return `Unlinked from ${d.ticketNumber ?? d.ticketId ?? '?'}`;
    case 'merged':
      return `Merged into ${d.ticketNumber ?? '?'}`;
    case 'escalated':
      return `Escalated to level ${d.level ?? '?'}`;
    case 'sla_breached':
      return 'SLA breached';
    case 'template_applied':
      return `Template "${d.name ?? '?'}" applied`;
    case 'bulk_updated':
      return 'Bulk updated';
    case 'sla_paused':
      return 'SLA paused';
    case 'sla_resumed':
      return 'SLA resumed';
    case 'assigned_to_me':
      return 'Assigned to self';
    case 'server_linked':
      return `Linked to server ${d.serverName ?? '?'}`;
    case 'server_unlinked':
      return `Unlinked from server ${d.serverName ?? '?'}`;
    case 'custom_field_updated':
      return `Custom field "${d.key ?? '?'}" updated`;
    case 'ticket_split':
      return 'Ticket split';
    case 'resolved_note_added':
      return 'Resolution note added';
    default:
      return 'Activity recorded';
  }
}

// ── Component ──

export function TicketDetail({
  ticket,
  comments,
  activities,
  users,
  servers,
  tags,
  onClose,
  onRefresh,
  actions,
  isLoading,
}: TicketDetailProps) {
  // onRefresh is available for future use (e.g., manual refresh button)
  void onRefresh;

  // Comment form state
  const [commentContent, setCommentContent] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);
  const [statusChange, setStatusChange] = useState<string>('none');
  const [isSubmittingComment, setIsSubmittingComment] = useState(false);

  // Edit title state
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState(ticket.title);

  // ── Submit comment ──
  async function handleSubmitComment() {
    if (!commentContent.trim()) return;

    setIsSubmittingComment(true);
    try {
      const payload: Parameters<TicketActionsType['addComment']>[1] = {
        content: commentContent,
        isInternal: commentInternal,
      };

      if (statusChange !== 'none') {
        payload.statusChange = {
          from: ticket.status,
          to: statusChange as TicketStatus,
        };
      }

      await actions.addComment(ticket.id, payload);
      setCommentContent('');
      setCommentInternal(false);
      setStatusChange('none');
    } catch {
      // Error handled by hook
    } finally {
      setIsSubmittingComment(false);
    }
  }

  // ── Save title ──
  async function handleSaveTitle() {
    if (!editTitleValue.trim() || editTitleValue === ticket.title) {
      setIsEditingTitle(false);
      return;
    }
    try {
      await actions.updateTicket(ticket.id, { title: editTitleValue });
      setIsEditingTitle(false);
    } catch {
      // Error handled by hook
    }
  }

  // ── Change assignee ──
  async function handleChangeAssignee(userId: string) {
    try {
      await actions.updateTicket(ticket.id, { assigneeId: userId || undefined });
    } catch {
      // Error handled by hook
    }
  }

  // ── Change category ──
  async function handleChangeCategory(category: string) {
    try {
      await actions.updateTicket(ticket.id, { category });
    } catch {
      // Error handled by hook
    }
  }

  // ── Change server ──
  async function handleChangeServer(serverId: string) {
    try {
      await actions.updateTicket(ticket.id, { serverId: serverId || undefined });
    } catch {
      // Error handled by hook
    }
  }

  // ── Remove tag ──
  async function handleRemoveTag(tagId: string) {
    try {
      await actions.updateTicket(ticket.id, {
        tags: ticket.tags.filter((t) => t !== tagId),
      });
    } catch {
      // Error handled by hook
    }
  }

  // ── Add tag ──
  async function handleAddTag(tagId: string) {
    if (ticket.tags.includes(tagId)) return;
    try {
      await actions.updateTicket(ticket.id, {
        tags: [...ticket.tags, tagId],
      });
    } catch {
      // Error handled by hook
    }
  }

  // ── Valid status transitions ──
  const validTransitions = useMemo(
    () => STATUS_TRANSITIONS[ticket.status] ?? [],
    [ticket.status],
  );

  // ── Tag lookup ──
  const ticketTagObjects = useMemo(
    () => ticket.tags.map((tagId) => tags.find((t) => t.id === tagId)).filter((t): t is Tag => !!t),
    [ticket.tags, tags],
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col">
        {/* ── Header ── */}
        <div className="flex items-start justify-between border-b border-border px-6 py-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-muted-foreground">
                {ticket.ticketNumber}
              </span>
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              <SLATimer sla={ticket.sla} />
            </div>

            {/* Title */}
            {isEditingTitle ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editTitleValue}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditTitleValue(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                    if (e.key === 'Enter') handleSaveTitle();
                    if (e.key === 'Escape') {
                      setIsEditingTitle(false);
                      setEditTitleValue(ticket.title);
                    }
                  }}
                  className="text-lg font-semibold"
                  autoFocus
                />
                <Button size="sm" onClick={handleSaveTitle}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => {
                  setIsEditingTitle(false);
                  setEditTitleValue(ticket.title);
                }}>Cancel</Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditTitleValue(ticket.title);
                  setIsEditingTitle(true);
                }}
                className="group text-left"
              >
                <h2 className={cn('text-lg font-semibold text-foreground group-hover:text-primary transition-colors', FONT_DISPLAY)}>
                  {ticket.title}
                  <Edit3 className="ml-2 inline h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                </h2>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex-shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Meta bar ── */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-b border-border px-6 py-3">
          {/* Reporter */}
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-medium w-16', TEXT_MUTED)}>Reporter</span>
            <div className="flex items-center gap-1.5">
              <Avatar className="h-5 w-5">
                {ticket.reporter?.image && <AvatarImage src={ticket.reporter.image} alt="" />}
                <AvatarFallback className="text-[9px]">
                  {getUserInitials(ticket.reporterId, users)}
                </AvatarFallback>
              </Avatar>
              <span className="text-xs text-foreground">
                {getUserName(ticket.reporterId, users)}
              </span>
            </div>
          </div>

          {/* Assignee */}
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-medium w-16', TEXT_MUTED)}>Assignee</span>
            <Select
              value={ticket.assigneeId ?? 'unassigned'}
              onValueChange={handleChangeAssignee}
            >
              <SelectTrigger className="h-7 w-full text-xs">
                <div className="flex items-center gap-1.5">
                  {ticket.assigneeId && (
                    <Avatar className="h-4 w-4">
                      {ticket.assignee?.image && <AvatarImage src={ticket.assignee.image} alt="" />}
                      <AvatarFallback className="text-[8px]">
                        {getUserInitials(ticket.assigneeId, users)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  <SelectValue placeholder="Unassigned" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned" className="text-xs">
                  Unassigned
                </SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id} className="text-xs">
                    {u.name ?? u.username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category */}
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-medium w-16', TEXT_MUTED)}>Category</span>
            <Select
              value={ticket.category}
              onValueChange={handleChangeCategory}
            >
              <SelectTrigger className="h-7 w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ticket.category} className="text-xs">
                  {ticket.category}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Server */}
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-medium w-16', TEXT_MUTED)}>Server</span>
            <Select
              value={ticket.serverId ?? 'none'}
              onValueChange={handleChangeServer}
            >
              <SelectTrigger className="h-7 w-full text-xs">
                <SelectValue placeholder="No server" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">
                  No server
                </SelectItem>
                {servers.map((s) => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Created */}
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-medium w-16', TEXT_MUTED)}>Created</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-foreground">
                  <TimeAgo date={ticket.createdAt} />
                </span>
              </TooltipTrigger>
              <TooltipContent>{formatFullDate(ticket.createdAt)}</TooltipContent>
            </Tooltip>
          </div>

          {/* Updated */}
          <div className="flex items-center gap-2">
            <span className={cn('text-xs font-medium w-16', TEXT_MUTED)}>Updated</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-foreground">
                  <TimeAgo date={ticket.updatedAt} />
                </span>
              </TooltipTrigger>
              <TooltipContent>{formatFullDate(ticket.updatedAt)}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ── Tags ── */}
        {tags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap border-b border-border px-6 py-2.5">
            {ticketTagObjects.map((tag) => (
              <TagBadge
                key={tag.id}
                name={tag.name}
                color={tag.color}
                onRemove={() => handleRemoveTag(tag.id)}
              />
            ))}
            {/* Add tag dropdown */}
            <Select onValueChange={handleAddTag}>
              <SelectTrigger className="h-6 w-6 border-dashed p-0 text-muted-foreground">
                <Plus className="h-3 w-3 mx-auto" />
              </SelectTrigger>
              <SelectContent>
                {tags
                  .filter((t) => !ticket.tags.includes(t.id))
                  .map((t) => (
                    <SelectItem key={t.id} value={t.id} className="text-xs">
                      {t.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* ── Description ── */}
        {ticket.description && (
          <div className="border-b border-border px-6 py-4">
            <MarkdownRenderer content={ticket.description} />
          </div>
        )}

        {/* ── Tabs: Comments | Activity | Linked ── */}
        <Tabs defaultValue="comments" className="flex-1">
          <div className="border-b border-border px-6">
            <TabsList className="h-9 bg-transparent p-0">
              <TabsTrigger value="comments" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-3 text-xs">
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
                Comments ({comments.length})
              </TabsTrigger>
              <TabsTrigger value="activity" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-3 text-xs">
                <History className="mr-1.5 h-3.5 w-3.5" />
                Activity ({activities.length})
              </TabsTrigger>
              <TabsTrigger value="linked" className="data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:shadow-none rounded-none px-3 text-xs">
                <Link2 className="mr-1.5 h-3.5 w-3.5" />
                Linked ({ticket.linkedTickets.length})
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Comments tab ── */}
          <TabsContent value="comments" className="m-0 flex flex-col">
            <ScrollArea className="flex-1 max-h-[400px]">
              <div className="px-6 py-3 space-y-4">
                {comments.length === 0 && (
                  <div className={cn('text-center py-8 text-xs', TEXT_MUTED)}>
                    No comments yet. Be the first to respond!
                  </div>
                )}

                {comments.map((comment) => (
                  <CommentItem
                    key={comment.id}
                    comment={comment}
                    users={users}
                  />
                ))}
              </div>
            </ScrollArea>

            {/* ── Add comment form ── */}
            <div className={cn('border-t border-border px-6 py-3', SURFACE_2)}>
              <div className="space-y-2">
                {/* Status change + internal toggle row */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={statusChange} onValueChange={(v: string) => setStatusChange(v)}>
                      <SelectTrigger className="h-7 w-32 text-xs">
                        <SelectValue placeholder="No change" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="text-xs">
                          No change
                        </SelectItem>
                        {validTransitions.map((s) => (
                          <SelectItem key={s} value={s} className="text-xs">
                            {STATUS_CONFIG[s].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <Label className="text-xs text-muted-foreground">Internal</Label>
                    <Switch
                      checked={commentInternal}
                      onCheckedChange={setCommentInternal}
                      className="scale-75"
                    />
                  </div>
                </div>

                {/* Comment textarea */}
                <Textarea
                  placeholder="Write a comment... (Markdown supported)"
                  value={commentContent}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setCommentContent(e.target.value)}
                  onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleSubmitComment();
                    }
                  }}
                  className="min-h-[80px] text-sm resize-none"
                />

                {/* Submit */}
                <div className="flex items-center justify-between">
                  <span className={cn('text-[10px]', TEXT_MUTED)}>
                    Ctrl+Enter to submit
                  </span>
                  <Button
                    size="sm"
                    onClick={handleSubmitComment}
                    disabled={!commentContent.trim() || isSubmittingComment}
                  >
                    {isSubmittingComment ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Comment
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* ── Activity tab ── */}
          <TabsContent value="activity" className="m-0">
            <ScrollArea className="max-h-[500px]">
              <div className="px-6 py-3">
                {activities.length === 0 ? (
                  <div className={cn('text-center py-8 text-xs', TEXT_MUTED)}>
                    No activity recorded.
                  </div>
                ) : (
                  <div className="relative space-y-0">
                    {/* Timeline line */}
                    <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

                    {activities.map((activity) => (
                      <div key={activity.id} className="relative flex gap-3 pb-4">
                        {/* Timeline dot */}
                        <div className={cn(
                          'relative z-10 mt-1 flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center rounded-full border',
                          BORDER_COLOR,
                          SURFACE_2,
                        )}>
                          <div className={cn(
                            'h-2 w-2 rounded-full',
                            activity.type === 'created' ? 'bg-blue-500' :
                            activity.type === 'sla_breached' || activity.type === 'escalated' ? 'bg-red-500' :
                            activity.type.startsWith('comment') ? 'bg-emerald-500' :
                            'bg-zinc-400',
                          )} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-foreground">
                              {getUserName(activity.userId, users)}
                            </span>
                            <span className={cn('text-xs', TEXT_MUTED)}>
                              {getActivityDescription(activity)}
                            </span>
                          </div>
                          <span className={cn('text-[10px]', TEXT_MUTED)}>
                            <TimeAgo date={activity.createdAt} />
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Linked tickets tab ── */}
          <TabsContent value="linked" className="m-0">
            <ScrollArea className="max-h-[500px]">
              <div className="px-6 py-3">
                {ticket.linkedTickets.length === 0 ? (
                  <div className={cn('text-center py-8 text-xs', TEXT_MUTED)}>
                    No linked tickets.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {ticket.linkedTickets.map((link, index) => {
                      const config = LINK_TYPE_LABELS[link.type];
                      return (
                        <div
                          key={`${link.type}-${link.ticketId}-${index}`}
                          className={cn(
                            'flex items-center justify-between rounded-lg border px-3 py-2',
                            BORDER_COLOR,
                            SURFACE_2,
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className={cn('text-xs font-medium', config?.color ?? 'text-foreground')}>
                              {config?.label ?? link.type}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {link.ticketId}
                            </span>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Open ticket</TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

// ── Comment item sub-component ──

interface CommentItemProps {
  comment: TicketComment;
  users: UserRef[];
}

function CommentItem({ comment, users }: CommentItemProps) {
  const authorName = getUserName(comment.authorId, users);
  const authorInitials = getUserInitials(comment.authorId, users);
  const author = getUserById(comment.authorId, users);

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        comment.isInternal
          ? 'border-amber-500/20 bg-amber-500/5'
          : `${BORDER_COLOR} ${SURFACE_2}`,
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Avatar className="h-6 w-6">
          {author?.image && <AvatarImage src={author.image} alt="" />}
          <AvatarFallback className="text-[9px]">{authorInitials}</AvatarFallback>
        </Avatar>
        <span className="text-xs font-medium text-foreground">{authorName}</span>
        {comment.isInternal && (
          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 px-1.5 py-0 text-[10px]">
            Internal
          </Badge>
        )}
        {comment.statusChange && (
          <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-400 px-1.5 py-0 text-[10px]">
            {STATUS_CONFIG[comment.statusChange.from as TicketStatus]?.label} → {STATUS_CONFIG[comment.statusChange.to as TicketStatus]?.label}
          </Badge>
        )}
        <span className={cn('ml-auto text-[10px]', TEXT_MUTED)}>
          <TimeAgo date={comment.createdAt} />
        </span>
      </div>

      {/* Content */}
      <MarkdownRenderer content={comment.content} className="text-sm" />

      {/* Attachments */}
      {comment.attachments.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          {comment.attachments.map((attachment) => (
            <a
              key={attachment.id}
              href={attachment.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors hover:bg-surface-3',
                BORDER_COLOR,
                SURFACE_3,
              )}
            >
              <Paperclip className="h-3 w-3" />
              {attachment.name}
            </a>
          ))}
        </div>
      )}

      {/* Edited indicator */}
      {comment.editedAt && (
        <div className={cn('mt-1 text-[10px]', TEXT_MUTED)}>
          Edited <TimeAgo date={comment.editedAt} />
        </div>
      )}
    </div>
  );
}
