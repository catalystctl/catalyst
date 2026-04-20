import React, { useState, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ArrowLeft,
  MessageSquare,
  Clock,
  User,
  Server,
  ExternalLink,
  Trash2,
  Send,
  Loader2,
  Pin,
  PinOff,
  Pencil,
  Reply,
  Paperclip,
  Upload,
  Link2,
  X,
  Download,
  Image as ImageIcon,
  FileText,
  AlertTriangle,
  ChevronUp,
  Printer,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { itemVariants } from '../constants';
import {
  timeAgo,
  formatDate,
  formatFileSize,
  isImageFile,
  getUserDisplayName,
  getUserInitial,
  CATEGORY_ICONS,
  LINK_TYPE_CONFIG,
  ESCALATION_CONFIG,
  ACTIVITY_CONFIG,
} from '../constants';
import type {
  Ticket,
  Comment,
  Activity,
  Attachment,
  LinkedTicket,
  Category,
  TicketUser,
  Server as ServerType,
  Status,
  Tag,
  LinkType,
} from '../types';
import { FieldLabel } from './shared/FieldLabel';
import { IconBox } from './shared/IconBox';
import { StatusBadge } from './shared/StatusBadge';
import { PriorityDot } from './shared/PriorityDot';
import { SLATimer, SLAProgressBar } from './shared/SLATimer';
import { MarkdownRenderer, MarkdownEditor } from './shared/MarkdownRenderer';
import { TagBadge } from './shared/TagBadge';
import { PRIORITY_CONFIG } from '../constants';

interface TicketDetailProps {
  ticket: Ticket;
  comments: Comment[];
  activities: Activity[];
  attachments: Attachment[];
  linkedTickets: LinkedTicket[];
  categories: Category[];
  users: TicketUser[];
  servers: ServerType[];
  statuses: Status[];
  tags: Tag[];
  transitions: Record<string, string[]>;
  onBack: () => void;
  onUpdate: (id: string, data: any) => Promise<void>;
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
  onOpenLinkModal?: () => void;
}

export function TicketDetail({
  ticket,
  comments,
  activities,
  attachments,
  linkedTickets,
  categories,
  users,
  servers,
  statuses,
  tags,
  transitions,
  onBack,
  onUpdate,
  onDelete,
  onAddComment,
  onDeleteComment,
  onEditComment,
  onPinComment,
  onUploadAttachment,
  onDeleteAttachment,
  onLinkTicket,
  onUnlinkTicket,
  onUpdateTags,
  isAdmin = false,
  onOpenLinkModal,
}: TicketDetailProps) {
  const [newComment, setNewComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [statusChange, setStatusChange] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const commentDropRef = useRef<HTMLDivElement>(null);

  const creator = users.find((u) => u.id === ticket.createdBy);
  const assignee = users.find((u) => u.id === ticket.assignedTo);
  const availableTransitions = transitions[ticket.status] || [];
  const CatIcon = CATEGORY_ICONS[ticket.category] || FileText;
  const escConfig = ESCALATION_CONFIG[ticket.escalationLevel || 0] || ESCALATION_CONFIG[0];

  // Separate pinned comments
  const pinnedComments = comments.filter((c) => c.pinned);
  const regularComments = comments.filter((c) => !c.pinned);

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      let content = newComment.trim();
      if (replyTo) {
        content = `> ${replyTo.content.split('\n')[0]}\n\n${content}`;
      }
      await onAddComment(ticket.id, content, isInternal && !!isAdmin, statusChange || undefined);
      setNewComment('');
      setIsInternal(false);
      setStatusChange('');
      setReplyTo(null);
    } catch (err) {
      console.error('Failed to add comment:', err);
    }
    setSubmitting(false);
  };

  const handleEditSave = async (commentId: string) => {
    if (!editContent.trim()) return;
    await onEditComment(ticket.id, commentId, editContent.trim());
    setEditingComment(null);
    setEditContent('');
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      await onUploadAttachment(ticket.id, file);
    }
    setUploading(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileUpload(e.dataTransfer.files);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const toggleTag = async (tagId: string) => {
    const currentTags = ticket.tags || [];
    const newTags = currentTags.includes(tagId)
      ? currentTags.filter((t) => t !== tagId)
      : [...currentTags, tagId];
    await onUpdateTags(ticket.id, newTags);
  };

  const renderComment = (comment: Comment) => {
    const author = comment.user;
    const isEditing = editingComment === comment.id;

    return (
      <div key={comment.id} className={cn(
        'group relative rounded-lg border p-4',
        comment.pinned
          ? 'border-primary/30 bg-primary/5'
          : 'border-border/50 bg-surface-2/50'
      )}>
        {/* Badges */}
        <div className="absolute -top-2 right-3 flex gap-1">
          {comment.pinned && (
            <Badge variant="default" className="text-[10px] gap-1">
              <Pin className="h-2.5 w-2.5" />
              Pinned
            </Badge>
          )}
          {comment.isInternal && (
            <Badge variant="warning" className="text-[10px]">
              Internal
            </Badge>
          )}
        </div>

        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-3 text-xs font-bold text-foreground">
            {getUserInitial(author)}
          </div>
          <span className="text-sm font-semibold text-foreground">
            {getUserDisplayName(author)}
          </span>
          <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</span>
          {comment.editedAt && (
            <span className="text-[10px] text-muted-foreground italic">(edited)</span>
          )}
          {isAdmin && (
            <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onPinComment(ticket.id, comment.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                    >
                      {comment.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{comment.pinned ? 'Unpin' : 'Pin'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        setEditingComment(comment.id);
                        setEditContent(comment.content);
                      }}
                      className="rounded p-1 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Edit</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setReplyTo(comment)}
                      className="rounded p-1 text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                    >
                      <Reply className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Reply</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onDeleteComment(ticket.id, comment.id)}
                      className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
        </div>

        {/* Reply reference */}
        {comment.replyToId && (
          <div className="mt-2 rounded border-l-2 border-primary/30 bg-primary/5 px-3 py-1.5 text-xs text-muted-foreground">
            Replying to {comment.replyTo?.user ? getUserDisplayName(comment.replyTo.user) : 'a comment'}
          </div>
        )}

        {/* Content */}
        <div className="mt-2">
          {isEditing ? (
            <div className="space-y-2">
              <MarkdownEditor
                value={editContent}
                onChange={setEditContent}
                rows={3}
                showToolbar={false}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleEditSave(comment.id)} className="h-7 gap-1 text-xs">
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingComment(null)} className="h-7 text-xs">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <MarkdownRenderer content={comment.content} />
          )}
        </div>

        {/* Comment attachments */}
        {comment.attachments && comment.attachments.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {comment.attachments.map((att) => (
              <a
                key={att.id}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md border border-border/50 bg-surface-3/50 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {isImageFile(att.mimetype) ? (
                  <ImageIcon className="h-3 w-3" />
                ) : (
                  <FileText className="h-3 w-3" />
                )}
                {att.originalName || att.filename}
                <span className="text-[10px]">({formatFileSize(att.size)})</span>
              </a>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="font-display text-xl font-bold text-foreground truncate">{ticket.subject}</h2>
            <StatusBadge status={ticket.status} />
            {ticket.escalationLevel && ticket.escalationLevel > 0 && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="destructive" className="gap-1 text-xs">
                      <AlertTriangle className="h-3 w-3" />
                      Escalated L{ticket.escalationLevel}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{escConfig.label}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            #{ticket.id.slice(0, 8)} · Opened {timeAgo(ticket.createdAt)}
            {ticket.mergedFrom && ticket.mergedFrom.length > 0 && (
              <> · Merged from {ticket.mergedFrom.length} ticket{ticket.mergedFrom.length !== 1 ? 's' : ''}</>
            )}
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => window.print()}>
                    <Printer className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export as PDF</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-danger hover:text-danger hover:bg-danger/10"
              onClick={() => onDelete(ticket.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Main content */}
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
                <MarkdownRenderer content={ticket.description} />
              ) : (
                <p className="text-sm italic text-muted-foreground">No description provided.</p>
              )}

              {/* Tags */}
              <div className="mt-4 flex flex-wrap items-center gap-1.5">
                {ticket.tags?.map((tagId) => {
                  const tag = tags.find((t) => t.id === tagId);
                  if (!tag) return null;
                  return (
                    <TagBadge
                      key={tag.id}
                      tag={tag}
                      onRemove={isAdmin ? (id) => onUpdateTags(ticket.id, (ticket.tags || []).filter((t) => t !== id)) : undefined}
                    />
                  );
                })}
                {isAdmin && tags.length > 0 && (
                  <div className="relative group">
                    <button className="flex h-5 w-5 items-center justify-center rounded-full border border-dashed border-border text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                      +
                    </button>
                    <div className="absolute left-0 top-full z-10 mt-1 hidden group-hover:block w-40 rounded-lg border border-border bg-card p-1 shadow-lg">
                      {tags
                        .filter((t) => !(ticket.tags || []).includes(t.id))
                        .map((tag) => (
                          <button
                            key={tag.id}
                            onClick={() => toggleTag(tag.id)}
                            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-foreground hover:bg-surface-2"
                          >
                            {tag.name}
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Ticket attachments */}
              {attachments.length > 0 && (
                <div className="mt-4">
                  <Separator className="mb-3" />
                  <div className="flex flex-wrap gap-2">
                    {attachments.map((att) => (
                      <div
                        key={att.id}
                        className="group/att relative rounded-lg border border-border/50 bg-surface-2/50 p-2"
                      >
                        {isImageFile(att.mimetype) && att.thumbnailUrl ? (
                          <a href={att.url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={att.thumbnailUrl}
                              alt={att.originalName}
                              className="h-20 w-20 rounded object-cover"
                            />
                          </a>
                        ) : (
                          <div className="flex items-center gap-2 px-1">
                            {isImageFile(att.mimetype) ? (
                              <ImageIcon className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <FileText className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div>
                              <p className="text-xs font-medium text-foreground truncate max-w-[120px]">
                                {att.originalName || att.filename}
                              </p>
                              <p className="text-[10px] text-muted-foreground">{formatFileSize(att.size)}</p>
                            </div>
                          </div>
                        )}
                        <div className="absolute -right-1 -top-1 hidden group-hover/att:flex gap-0.5">
                          <a
                            href={att.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border shadow-sm text-muted-foreground hover:text-foreground"
                          >
                            <Download className="h-3 w-3" />
                          </a>
                          {isAdmin && (
                            <button
                              onClick={() => onDeleteAttachment(ticket.id, att.id)}
                              className="flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border shadow-sm text-muted-foreground hover:text-danger"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Linked tickets */}
          {linkedTickets.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconBox color="info">
                    <Link2 className="h-4 w-4 text-info" />
                  </IconBox>
                  Linked Tickets
                  {isAdmin && onOpenLinkModal && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 gap-1 text-xs"
                      onClick={onOpenLinkModal}
                    >
                      <Link2 className="h-3 w-3" />
                      Link
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {linkedTickets.map((link) => {
                  const cfg = LINK_TYPE_CONFIG[link.type] || LINK_TYPE_CONFIG.related;
                  const Icon = cfg.icon;
                  return (
                    <div key={link.ticketId} className="flex items-center gap-2 rounded-lg border border-border/50 bg-surface-2/50 px-3 py-2">
                      <Icon className={cn('h-3.5 w-3.5 shrink-0', cfg.color)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {link.subject || `#${link.ticketId.slice(0, 8)}`}
                        </p>
                        <p className="text-xs text-muted-foreground">{cfg.label} · #{link.ticketId.slice(0, 8)}</p>
                      </div>
                      {link.status && <StatusBadge status={link.status} />}
                      {isAdmin && (
                        <button
                          onClick={() => onUnlinkTicket(ticket.id, link.ticketId)}
                          className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

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
              {comments.length === 0 && !replyTo && (
                <div className="py-6 text-center">
                  <MessageSquare className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-2 text-sm text-muted-foreground">No comments yet</p>
                </div>
              )}

              {/* Pinned comments */}
              {pinnedComments.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Pin className="h-3 w-3" />
                    Pinned
                  </p>
                  {pinnedComments.map(renderComment)}
                </div>
              )}

              {/* Regular comments */}
              {regularComments.length > 0 && pinnedComments.length > 0 && (
                <Separator />
              )}
              {regularComments.map(renderComment)}

              {/* Reply indicator */}
              {replyTo && (
                <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  <Reply className="h-3 w-3" />
                  Replying to {getUserDisplayName(replyTo.user)}
                  <button
                    onClick={() => setReplyTo(null)}
                    className="ml-auto rounded p-0.5 hover:bg-surface-3"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* New comment */}
              <div
                ref={commentDropRef}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                className="rounded-lg border border-border p-4"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFileUpload(e.target.files)}
                />
                <MarkdownEditor
                  value={newComment}
                  onChange={setNewComment}
                  placeholder="Write a comment... (supports markdown)"
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
                          <option key={t} value={t}>{PRIORITY_CONFIG[t]?.label || t}</option>
                        ))}
                      </select>
                    )}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 text-xs text-muted-foreground"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                          >
                            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
                            Attach
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Attach files or drag and drop</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
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

        {/* Sidebar */}
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
                    {statuses.map((s) => (
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
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <FieldLabel>Category</FieldLabel>
                  <span className="flex items-center gap-1.5 text-sm text-foreground">
                    <CatIcon className="h-3.5 w-3.5 text-muted-foreground" />
                    {categories.find((c) => c.id === ticket.category)?.name || ticket.category}
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
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>{getUserDisplayName(u)}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Escalation */}
              {ticket.escalationLevel && ticket.escalationLevel > 0 && (
                <div className="flex items-center justify-between">
                  <FieldLabel>Escalation</FieldLabel>
                  <Badge variant="destructive" className="text-xs gap-1">
                    <ChevronUp className="h-3 w-3" />
                    Level {ticket.escalationLevel}
                  </Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {/* SLA */}
          {ticket.sla && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  SLA
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <SLAProgressBar sla={ticket.sla} />
              </CardContent>
            </Card>
          )}

          {/* Activity timeline */}
          {activities.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Activity
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="max-h-80">
                  <div className="relative space-y-4">
                    <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />
                    {activities.slice(0, 20).map((activity, i) => (
                      <ActivityEntry key={activity.id || i} activity={activity} users={users} />
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

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
                  {getUserInitial(creator)}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Created by</p>
                  <p className="text-sm font-medium text-foreground">{getUserDisplayName(creator)}</p>
                </div>
              </div>
              {assignee && (
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-foreground">
                    {getUserInitial(assignee)}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Assigned to</p>
                    <p className="text-sm font-medium text-foreground">{getUserDisplayName(assignee)}</p>
                  </div>
                </div>
              )}
              {ticket.serverId && (() => {
                const linkedServer = servers.find((s) => s.id === ticket.serverId);
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
                          {linkedServer?.name || linkedServer?.label || 'View Server'}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </Button>
                    </div>
                  </div>
                );
              })()}
              <Separator />
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Created {formatDate(ticket.createdAt)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Updated {formatDate(ticket.updatedAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ─── Activity Entry ──────────────────────────────────────────

function ActivityEntry({ activity, users }: { activity: Activity; users: TicketUser[] }) {
  const cfg = ACTIVITY_CONFIG[activity.type];
  const actor = activity.actor || users.find((u) => u.id === activity.actorId);
  const Icon = cfg?.icon || Clock;

  if (!cfg) return null;

  return (
    <div className="relative flex items-start gap-3 pl-0">
      <div className={cn(
        'relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
        cfg.bgColor
      )}>
        <Icon className={cn('h-3 w-3', cfg.color)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground">
          <span className="font-semibold">{getUserDisplayName(actor)}</span>{' '}
          <span className="text-muted-foreground">{activity.description}</span>
        </p>
        <p className="text-[10px] text-muted-foreground">{timeAgo(activity.createdAt)}</p>
      </div>
    </div>
  );
}
