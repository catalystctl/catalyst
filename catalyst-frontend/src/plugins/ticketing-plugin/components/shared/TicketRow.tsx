import type { Ticket, UserRef } from '../../types';
import { Checkbox, Avatar, AvatarFallback, AvatarImage, cn, TEXT_MUTED } from '../../../plugin-ui';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { TimeAgo } from './TimeAgo';
import { SLATimer } from './SLATimer';

interface TicketRowProps {
  ticket: Ticket;
  isSelected: boolean;
  onSelect: () => void;
  onClick: () => void;
  users: UserRef[];
  className?: string;
}

function getUserName(userId: string | null, users: UserRef[]): string | null {
  if (!userId) return null;
  return users.find((u) => u.id === userId)?.name ?? users.find((u) => u.id === userId)?.username ?? null;
}

function getUserImage(userId: string | null, users: UserRef[]): string | undefined {
  if (!userId) return undefined;
  return users.find((u) => u.id === userId)?.image;
}

function getUserInitials(userId: string | null, users: UserRef[]): string {
  const user = users.find((u) => u.id === userId);
  if (!user) return '?';
  const name = user.name ?? user.username;
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function TicketRow({ ticket, isSelected, onSelect, onClick, users, className }: TicketRowProps) {
  const assigneeName = getUserName(ticket.assigneeId, users);
  const assigneeImage = getUserImage(ticket.assigneeId, users);
  const assigneeInitials = getUserInitials(ticket.assigneeId, users);

  return (
    <div
      className={cn(
        'group flex cursor-pointer items-center gap-3 border-b border-border px-4 py-2.5 transition-colors',
        isSelected && 'bg-primary/5',
        !isSelected && 'hover:bg-surface-2',
        className,
      )}
      onClick={onClick}
    >
      {/* Checkbox */}
      <div
        className="flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onSelect()}
          className="h-4 w-4"
        />
      </div>

      {/* Ticket number */}
      <span className="w-24 flex-shrink-0 text-xs font-mono text-muted-foreground">
        {ticket.ticketNumber}
      </span>

      {/* Title */}
      <span
        className="flex-1 truncate text-left text-sm font-medium text-foreground"
        title={ticket.title}
      >
        {ticket.title}
      </span>

      {/* Status */}
      <div className="flex-shrink-0">
        <StatusBadge status={ticket.status} />
      </div>

      {/* Priority */}
      <div className="w-20 flex-shrink-0">
        <PriorityBadge priority={ticket.priority} />
      </div>

      {/* Category */}
      <span className="hidden w-24 flex-shrink-0 truncate text-xs text-muted-foreground sm:block">
        {ticket.category}
      </span>

      {/* Assignee */}
      <div className="hidden w-28 flex-shrink-0 items-center gap-1.5 md:flex">
        <Avatar className="h-5 w-5">
          {assigneeImage && <AvatarImage src={assigneeImage} alt={assigneeName ?? ''} />}
          <AvatarFallback className="text-[9px]">{assigneeInitials}</AvatarFallback>
        </Avatar>
        <span className="truncate text-xs text-muted-foreground" title={assigneeName ?? 'Unassigned'}>
          {assigneeName ?? 'Unassigned'}
        </span>
      </div>

      {/* SLA indicator */}
      <div className="flex-shrink-0">
        <SLATimer sla={ticket.sla} />
      </div>

      {/* Time ago */}
      <span className={cn('w-16 flex-shrink-0 text-right text-xs', TEXT_MUTED)}>
        <TimeAgo date={ticket.updatedAt} />
      </span>
    </div>
  );
}
