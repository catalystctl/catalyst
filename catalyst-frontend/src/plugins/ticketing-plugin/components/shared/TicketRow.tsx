import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { motion } from 'framer-motion';
import {
  MessageSquare,
  Clock,
  User,
  ChevronRight,
  Paperclip,
  AlertTriangle,
  Pin,
} from 'lucide-react';
import { itemVariants } from '../../constants';
import { timeAgo, getUserDisplayName, CATEGORY_ICONS } from '../../constants';
import type { Ticket, TicketUser } from '../../types';
import { StatusBadge } from './StatusBadge';
import { PriorityDot } from './PriorityDot';
import { SLATimer } from './SLATimer';
import { FileText } from 'lucide-react';

interface TicketRowProps {
  ticket: Ticket;
  onSelect: (id: string) => void;
  users: TicketUser[];
  selected?: boolean;
  showCheckbox?: boolean;
  isChecked?: boolean;
  onToggleCheck?: (id: string) => void;
}

export function TicketRow({
  ticket,
  onSelect,
  users,
  selected = false,
  showCheckbox = false,
  isChecked = false,
  onToggleCheck,
}: TicketRowProps) {
  const creator = users.find((u) => u.id === ticket.createdBy);
  const assignee = users.find((u) => u.id === ticket.assignedTo);
  const CatIcon = CATEGORY_ICONS[ticket.category] || FileText;
  const commentCount = ticket.comments?.length || 0;
  const attachmentCount = ticket.attachments?.length || 0;
  const hasUnread = (ticket.unreadCount || 0) > 0;

  return (
    <motion.div
      variants={itemVariants}
      layout
      className={cn(
        'group flex items-center gap-3 rounded-xl border px-4 py-3.5 cursor-pointer transition-all duration-200',
        'hover:shadow-elevated dark:hover:shadow-elevated-dark',
        selected
          ? 'border-primary/40 bg-primary/5'
          : 'border-border/80 bg-card hover:border-primary/30 dark:hover:border-primary/20',
        hasUnread && 'border-l-2 border-l-primary',
        ticket.escalationLevel && ticket.escalationLevel > 0 && 'border-l-2 border-l-red-500'
      )}
    >
      {/* Checkbox */}
      {showCheckbox && onToggleCheck && (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isChecked}
            onCheckedChange={() => onToggleCheck(ticket.id)}
            className="shrink-0"
          />
        </div>
      )}

      {/* Category icon */}
      <div
        onClick={() => onSelect(ticket.id)}
        className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-100 to-zinc-50 shadow-sm dark:from-zinc-800 dark:to-zinc-900"
      >
        <CatIcon className="h-4 w-4 text-muted-foreground" />
      </div>

      {/* Main content */}
      <div onClick={() => onSelect(ticket.id)} className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            'truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors',
            hasUnread && 'font-bold'
          )}>
            {ticket.subject}
          </span>
          {ticket.tags?.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="secondary" className="hidden shrink-0 text-[10px] sm:inline-flex">
              {tag}
            </Badge>
          ))}
          {ticket.escalationLevel && ticket.escalationLevel > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 text-[10px] font-medium text-red-500">
                    <AlertTriangle className="h-3 w-3" />
                    L{ticket.escalationLevel}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Escalation Level {ticket.escalationLevel}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {getUserDisplayName(creator)}
          </span>
          {assignee && (
            <span className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3" />
              {getUserDisplayName(assignee)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {timeAgo(ticket.updatedAt)}
          </span>
        </div>
      </div>

      {/* Right side */}
      <div className="flex shrink-0 items-center gap-2.5" onClick={() => onSelect(ticket.id)}>
        {/* SLA Timer */}
        <SLATimer sla={ticket.sla} compact />

        {/* Attachment count */}
        {attachmentCount > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted-foreground">
                  <Paperclip className="h-3 w-3" />
                  {attachmentCount}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{attachmentCount} attachment{attachmentCount !== 1 ? 's' : ''}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}

        {/* Comment count */}
        {commentCount > 0 && (
          <span className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
            hasUnread
              ? 'bg-primary/15 text-primary'
              : 'bg-surface-2 text-muted-foreground'
          )}>
            <MessageSquare className="h-3 w-3" />
            {commentCount}
            {hasUnread && (
              <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                {ticket.unreadCount}
              </span>
            )}
          </span>
        )}

        <StatusBadge status={ticket.status} />
        <PriorityDot priority={ticket.priority} />
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
    </motion.div>
  );
}
