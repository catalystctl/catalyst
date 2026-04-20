import { useState } from 'react';
import type { TicketFilters, TicketPriority, TicketStatus, UserRef, Tag, ServerRef } from '../../types';
import { STATUS_CONFIG, PRIORITY_CONFIG } from '../../constants';
import {
  Button,
  Input,
  cn,
  TEXT_MUTED,
  SURFACE_2,
  Search,
  X,
  Filter,
} from '../../../plugin-ui';
import { ChevronDown, ChevronRight, Calendar, User } from 'lucide-react';

interface FilterBarProps {
  filters: TicketFilters;
  onChange: (filters: TicketFilters) => void;
  categories: string[];
  users: UserRef[];
  tags: Tag[];
  servers: ServerRef[];
  className?: string;
}

const STATUS_KEYS: TicketStatus[] = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
const PRIORITY_KEYS: TicketPriority[] = ['critical', 'high', 'medium', 'low', 'minimal'];

/** Generic chip for filter selection */
function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-border bg-transparent text-muted-foreground hover:bg-surface-2',
      )}
    >
      {label}
    </button>
  );
}

export function FilterBar({
  filters,
  onChange,
  categories,
  users,
  tags,
  servers: _servers,
  className,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);

  void _servers;
  const hasActiveFilters =
    filters.status !== undefined ||
    filters.priority !== undefined ||
    filters.category !== undefined ||
    filters.assigneeId !== undefined ||
    (filters.tags && filters.tags.length > 0) ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.myTickets;

  function update(patch: Partial<TicketFilters>) {
    onChange({ ...filters, ...patch });
  }

  function clearAll() {
    onChange({});
  }

  function toggleTag(tagId: string) {
    const current = filters.tags ?? [];
    const next = current.includes(tagId)
      ? current.filter((t) => t !== tagId)
      : [...current, tagId];
    update({ tags: next.length > 0 ? next : undefined });
  }

  const activeCount = [
    filters.status,
    filters.priority,
    filters.category,
    filters.assigneeId,
    filters.tags && filters.tags.length > 0 ? 1 : 0,
    filters.dateFrom || filters.dateTo ? 1 : 0,
  ].filter(Boolean).length;

  return (
    <div className={cn('rounded-lg border border-border', className)}>
      {/* Top row: search + controls */}
      <div className="flex items-center gap-2 p-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search tickets..."
            value={filters.search ?? ''}
            onChange={(e) => update({ search: e.target.value || undefined })}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* My tickets toggle */}
        <Button
          variant={filters.myTickets ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => update({ myTickets: !filters.myTickets })}
        >
          <User className="mr-1.5 h-3.5 w-3.5" />
          My Tickets
        </Button>

        {/* Expand toggle */}
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          <Filter className="mr-1.5 h-3.5 w-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="ml-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {activeCount}
            </span>
          )}
          {expanded ? <ChevronDown className="ml-1 h-3 w-3" /> : <ChevronRight className="ml-1 h-3 w-3" />}
        </Button>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={clearAll}
          >
            <X className="mr-1 h-3 w-3" />
            Clear all
          </Button>
        )}
      </div>

      {/* Expanded filter sections */}
      {expanded && (
        <div className={cn('space-y-3 border-t border-border p-3', SURFACE_2)}>
          {/* Status */}
          <div>
            <label className={cn('mb-1.5 block text-[11px] font-medium uppercase tracking-wide', TEXT_MUTED)}>
              Status
            </label>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                label="All"
                active={filters.status === undefined || filters.status === 'all'}
                onClick={() => update({ status: undefined })}
              />
              {STATUS_KEYS.map((s) => (
                <FilterChip
                  key={s}
                  label={STATUS_CONFIG[s].label}
                  active={filters.status === s}
                  onClick={() => update({ status: filters.status === s ? undefined : s })}
                />
              ))}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label className={cn('mb-1.5 block text-[11px] font-medium uppercase tracking-wide', TEXT_MUTED)}>
              Priority
            </label>
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                label="All"
                active={filters.priority === undefined || filters.priority === 'all'}
                onClick={() => update({ priority: undefined })}
              />
              {PRIORITY_KEYS.map((p) => (
                <FilterChip
                  key={p}
                  label={PRIORITY_CONFIG[p].label}
                  active={filters.priority === p}
                  onClick={() => update({ priority: filters.priority === p ? undefined : p })}
                />
              ))}
            </div>
          </div>

          {/* Category */}
          {categories.length > 0 && (
            <div>
              <label className={cn('mb-1.5 block text-[11px] font-medium uppercase tracking-wide', TEXT_MUTED)}>
                Category
              </label>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip
                  label="All"
                  active={filters.category === undefined || filters.category === 'all'}
                  onClick={() => update({ category: undefined })}
                />
                {categories.map((c) => (
                  <FilterChip
                    key={c}
                    label={c}
                    active={filters.category === c}
                    onClick={() => update({ category: filters.category === c ? undefined : c })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Assignee */}
          {users.length > 0 && (
            <div>
              <label className={cn('mb-1.5 block text-[11px] font-medium uppercase tracking-wide', TEXT_MUTED)}>
                Assignee
              </label>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip
                  label="All"
                  active={filters.assigneeId === undefined || filters.assigneeId === 'all'}
                  onClick={() => update({ assigneeId: undefined })}
                />
                <FilterChip
                  label="Unassigned"
                  active={filters.assigneeId === 'unassigned'}
                  onClick={() => update({ assigneeId: filters.assigneeId === 'unassigned' ? undefined : 'unassigned' })}
                />
                {users.map((u) => (
                  <FilterChip
                    key={u.id}
                    label={u.name ?? u.username}
                    active={filters.assigneeId === u.id}
                    onClick={() => update({ assigneeId: filters.assigneeId === u.id ? undefined : u.id })}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <label className={cn('mb-1.5 block text-[11px] font-medium uppercase tracking-wide', TEXT_MUTED)}>
                Tags
              </label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <FilterChip
                    key={t.id}
                    label={t.name}
                    active={filters.tags?.includes(t.id) ?? false}
                    onClick={() => toggleTag(t.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Date Range */}
          <div>
            <label className={cn('mb-1.5 block text-[11px] font-medium uppercase tracking-wide', TEXT_MUTED)}>
              <Calendar className="mr-1 inline h-3 w-3" />
              Date Range
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={filters.dateFrom ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ dateFrom: e.target.value || undefined })}
                className="h-8 w-36 text-xs"
              />
              <span className={cn('text-xs', TEXT_MUTED)}>to</span>
              <Input
                type="date"
                value={filters.dateTo ?? ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => update({ dateTo: e.target.value || undefined })}
                className="h-8 w-36 text-xs"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
