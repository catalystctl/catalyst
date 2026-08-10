import type { Ticket, UserRef } from '../../types';
import {
  Checkbox,
  Avatar,
  AvatarFallback,
  AvatarImage,
  cn,
  TEXT_MUTED,
  FONT_MONO,
} from '@/plugins/plugin-ui';
import { StatusBadge } from './StatusBadge';
import { PriorityBadge } from './PriorityBadge';
import { TimeAgo } from './TimeAgo';
import { SLATimer } from './SLATimer';
import { STATUS_CONFIG } from '../../constants';

function resolveUser(userId: string | null, users: UserRef[], embedded?: UserRef | null) {
  if (embedded) return embedded;
  if (!userId) return null;
  return users.find((u) => u.id === userId) ?? null;
}

function initials(user: UserRef | null): string {
  if (!user) return '?';
  const name = user.name || user.username || '?';
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function TicketRow({
  ticket,
  isSelected,
  isActive,
  onSelect,
  onClick,
  users,
  className,
}: {
  ticket: Ticket;
  isSelected: boolean;
  /** Currently open in the detail pane */
  isActive?: boolean;
  onSelect: () => void;
  onClick: () => void;
  users: UserRef[];
  className?: string;
}) {
  const assignee = resolveUser(ticket.assigneeId, users, ticket.assignee);
  const statusRail = (STATUS_CONFIG[ticket.status] ?? STATUS_CONFIG.open).rail;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-current={isActive ? 'true' : undefined}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2.5 border-b border-border/60 px-3 py-2 transition-colors duration-200 ease-standard',
        isActive
          ? 'bg-primary/[0.06]'
          : isSelected
            ? 'bg-surface-2/80'
            : 'hover:bg-surface-2/60',
        className,
      )}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Active / status rail */}
      <span
        className={cn(
          'absolute inset-y-0 left-0 w-0.5 transition-colors duration-200',
          isActive ? 'bg-primary' : statusRail,
          !isActive && 'opacity-0 group-hover:opacity-40',
          isActive && 'opacity-100',
        )}
        aria-hidden
      />

      <div
        className="flex w-4 flex-shrink-0 items-center justify-center"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onSelect()}
          className="h-3.5 w-3.5"
          aria-label={`Select ${ticket.ticketNumber}`}
        />
      </div>

      <span
        className={cn(
          'w-[5.5rem] flex-shrink-0 text-[11px] tabular-nums text-muted-foreground sm:w-28',
          FONT_MONO,
        )}
      >
        {ticket.ticketNumber}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-left text-[13px] font-medium leading-snug text-foreground"
            title={ticket.title}
          >
            {ticket.title}
          </span>
          {(ticket.escalationLevel ?? 0) > 0 && (
            <span className="hidden flex-shrink-0 rounded bg-danger/12 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-danger sm:inline">
              E{ticket.escalationLevel}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 sm:hidden">
          <StatusBadge status={ticket.status} compact />
          <PriorityBadge priority={ticket.priority} showLabel={false} />
        </div>
      </div>

      <div className="hidden w-[5.75rem] flex-shrink-0 sm:block">
        <StatusBadge status={ticket.status} compact />
      </div>

      <div className="hidden w-[4.5rem] flex-shrink-0 sm:block">
        <PriorityBadge priority={ticket.priority} />
      </div>

      <span className="hidden w-24 flex-shrink-0 truncate text-[11px] text-muted-foreground md:block">
        {ticket.category}
      </span>

      <div className="hidden w-28 flex-shrink-0 items-center gap-1.5 lg:flex">
        <Avatar className="h-5 w-5 border border-border/60">
          {assignee?.image && (
            <AvatarImage src={assignee.image} alt={assignee.name || assignee.username} />
          )}
          <AvatarFallback className="bg-surface-2 text-[9px] text-muted-foreground">
            {initials(assignee)}
          </AvatarFallback>
        </Avatar>
        <span className={cn('truncate text-[11px]', TEXT_MUTED)}>
          {assignee?.name || assignee?.username || 'Unassigned'}
        </span>
      </div>

      <div className="hidden w-14 flex-shrink-0 justify-end xl:flex">
        <SLATimer sla={ticket.sla} />
      </div>

      <span className={cn('w-12 flex-shrink-0 text-right text-[11px] sm:w-14', TEXT_MUTED)}>
        <TimeAgo date={ticket.updatedAt} />
      </span>
    </div>
  );
}
