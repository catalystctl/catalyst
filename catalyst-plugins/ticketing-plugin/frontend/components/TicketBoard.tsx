/**
 * Ticketing board — Precision Console master–detail.
 *
 * Layout thesis: operator queue on the left, inspector tray on the right.
 * Density 7 · variance 3 · motion 3. Theme tokens only.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Checkbox,
  StatsCard,
  cn,
  TEXT_MUTED,
  FONT_DISPLAY,
  FONT_MONO,
  Plus,
  RefreshCw,
  Search,
  Loader2,
} from '@/plugins/plugin-ui';
import {
  AlertTriangle,
  CircleDot,
  Clock,
  UserX,
  Download,
  Ticket as TicketIcon,
} from 'lucide-react';
import { TicketRow } from './shared/TicketRow';
import { EmptyState } from './shared/EmptyState';
import { TicketDetail } from './TicketDetail';
import { CreateTicketModal } from './CreateTicketModal';
import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  PRIORITIES,
  PRIORITY_CONFIG,
  STATUSES,
  STATUS_CONFIG,
  CATEGORIES,
} from '../constants';
import * as api from '../api';
import type {
  CreateTicketPayload,
  Ticket,
  TicketFilters,
  TicketSort,
  TicketStats,
  TicketTemplate,
  UserRef,
  ServerRef,
  TicketStatus,
  TicketPriority,
} from '../types';

export interface TicketBoardProps {
  title?: string;
  description?: string;
  lockedServerId?: string;
  myTicketsOnly?: boolean;
  compact?: boolean;
}

const INITIAL_SORT: TicketSort = { field: 'updatedAt', direction: 'desc' };

export function TicketBoard({
  title = 'Tickets',
  description,
  lockedServerId,
  myTicketsOnly = false,
  compact = false,
}: TicketBoardProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [totalPages, setTotalPages] = useState(1);
  const [filters, setFilters] = useState<TicketFilters>(() => ({
    ...(lockedServerId ? { serverId: lockedServerId } : {}),
    ...(myTicketsOnly ? { myTickets: true } : {}),
  }));
  const [sort] = useState<TicketSort>(INITIAL_SORT);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState<TicketStats | null>(null);
  const [users, setUsers] = useState<UserRef[]>([]);
  const [servers, setServers] = useState<ServerRef[]>([]);
  const [templates, setTemplates] = useState<TicketTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const loadList = useCallback(
    async (opts?: { soft?: boolean }) => {
      if (opts?.soft) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const effective: TicketFilters = {
          ...filters,
          search: search.trim() || undefined,
          ...(lockedServerId ? { serverId: lockedServerId } : {}),
          ...(myTicketsOnly ? { myTickets: true } : {}),
        };
        const res = await api.fetchTickets(effective, sort, page, pageSize);
        setTickets(res.data);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setSelectedId((prev) => {
          if (!prev) return prev;
          return res.data.some((t) => t.id === prev) ? prev : null;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tickets');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [filters, search, sort, page, pageSize, lockedServerId, myTicketsOnly],
  );

  const loadRef = useCallback(async () => {
    try {
      const statsExtra: Record<string, string> = {};
      if (lockedServerId) statsExtra.serverId = lockedServerId;
      if (myTicketsOnly) statsExtra.myTickets = 'true';

      const results = await Promise.allSettled([
        api.fetchStats(statsExtra),
        api.fetchUsers(),
        api.fetchServers(),
        api.fetchTemplates(),
      ]);

      if (results[0].status === 'fulfilled') setStats(results[0].value);
      if (results[1].status === 'fulfilled') setUsers(results[1].value);
      if (results[2].status === 'fulfilled') setServers(results[2].value);
      if (results[3].status === 'fulfilled') setTemplates(results[3].value);
    } catch {
      /* non-fatal */
    }
  }, [lockedServerId, myTicketsOnly]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    loadRef();
  }, [loadRef]);

  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 280);
    return () => clearTimeout(id);
  }, [searchInput]);

  const setFilter = <K extends keyof TicketFilters>(key: K, value: TicketFilters[K]) => {
    setPage(1);
    setFilters((prev) => {
      const next = { ...prev };
      if (value === undefined || value === null || value === '' || value === 'all') {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (tickets.length > 0 && selectedIds.size === tickets.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(tickets.map((t) => t.id)));
    }
  };

  const handleCreate = async (data: CreateTicketPayload) => {
    setCreating(true);
    try {
      const created = await api.createTicket({
        ...data,
        serverId: data.serverId || lockedServerId,
      });
      setCreateOpen(false);
      await loadList({ soft: true });
      await loadRef();
      setSelectedId(created.id);
    } finally {
      setCreating(false);
    }
  };

  const runBulk = async (
    action: 'status' | 'priority' | 'assignee' | 'delete',
    value?: unknown,
  ) => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      await api.executeBulkAction({
        ticketIds: [...selectedIds],
        action,
        value,
      });
      setSelectedIds(new Set());
      if (action === 'delete' && selectedId && selectedIds.has(selectedId)) {
        setSelectedId(null);
      }
      await loadList({ soft: true });
      await loadRef();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk action failed');
    } finally {
      setBulkBusy(false);
    }
  };

  const showingDetail = Boolean(selectedId);
  const allSelected = tickets.length > 0 && selectedIds.size === tickets.length;

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.status) n++;
    if (filters.priority) n++;
    if (filters.category) n++;
    if (filters.assigneeId) n++;
    if (filters.isOverdue) n++;
    if (filters.myTickets && !myTicketsOnly) n++;
    if (search) n++;
    return n;
  }, [filters, search, myTicketsOnly]);

  const clearFilters = () => {
    setFilters({
      ...(lockedServerId ? { serverId: lockedServerId } : {}),
      ...(myTicketsOnly ? { myTickets: true } : {}),
    });
    setSearchInput('');
    setSearch('');
    setPage(1);
  };

  return (
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[32rem] flex-col gap-3 overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex flex-shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <TicketIcon className="h-4 w-4" />
            </div>
            <h1
              className={cn(
                'text-xl font-semibold tracking-tight text-foreground',
                FONT_DISPLAY,
              )}
            >
              {title}
            </h1>
            <span
              className={cn(
                'rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground',
                FONT_MONO,
              )}
            >
              {total}
            </span>
          </div>
          {description && (
            <p className={cn('pl-[2.625rem] text-xs leading-relaxed', TEXT_MUTED)}>
              {description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => {
              loadList({ soft: true });
              loadRef();
            }}
            disabled={refreshing}
          >
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
          {!compact && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => window.open(api.exportUrl('csv', filters), '_blank')}
            >
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export
            </Button>
          )}
          <Button size="sm" className="h-8" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New ticket
          </Button>
        </div>
      </header>

      {/* ── Stat strip ─────────────────────────────────────────── */}
      {!compact && (
        <div className="grid flex-shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <StatsCard
            title="Open"
            value={stats?.open ?? 0}
            icon={<CircleDot className="h-3.5 w-3.5" />}
            variant="info"
            onClick={() =>
              setFilter('status', filters.status === 'open' ? undefined : 'open')
            }
            className={cn(filters.status === 'open' && 'border-primary/40 bg-primary/[0.04]')}
          />
          <StatsCard
            title="In Progress"
            value={stats?.inProgress ?? 0}
            icon={<Loader2 className="h-3.5 w-3.5" />}
            variant="warning"
            onClick={() =>
              setFilter(
                'status',
                filters.status === 'in_progress' ? undefined : 'in_progress',
              )
            }
            className={cn(
              filters.status === 'in_progress' && 'border-primary/40 bg-primary/[0.04]',
            )}
          />
          <StatsCard
            title="Pending"
            value={stats?.pending ?? 0}
            icon={<Clock className="h-3.5 w-3.5" />}
            variant="warning"
            onClick={() =>
              setFilter('status', filters.status === 'pending' ? undefined : 'pending')
            }
            className={cn(
              filters.status === 'pending' && 'border-primary/40 bg-primary/[0.04]',
            )}
          />
          <StatsCard
            title="Overdue"
            value={stats?.overdue ?? 0}
            icon={<AlertTriangle className="h-3.5 w-3.5" />}
            variant="danger"
            onClick={() => {
              setFilter('isOverdue', filters.isOverdue ? undefined : true);
              setFilter('status', undefined);
              setFilter('assigneeId', undefined);
            }}
            className={cn(filters.isOverdue && 'border-primary/40 bg-primary/[0.04]')}
          />
          <StatsCard
            title="Unassigned"
            value={stats?.unassigned ?? 0}
            icon={<UserX className="h-3.5 w-3.5" />}
            onClick={() => {
              setFilter(
                'assigneeId',
                filters.assigneeId === 'unassigned' ? undefined : 'unassigned',
              );
              setFilter('isOverdue', undefined);
            }}
            className={cn(
              filters.assigneeId === 'unassigned' && 'border-primary/40 bg-primary/[0.04]',
            )}
          />
        </div>
      )}

      {/* ── Filter bar ─────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search number, title, description…"
            className="h-8 bg-card pl-8 text-sm"
          />
        </div>

        <Select
          value={(filters.status as string) || 'all'}
          onValueChange={(v) => setFilter('status', v === 'all' ? undefined : (v as TicketStatus))}
        >
          <SelectTrigger className="h-8 w-[8.5rem] bg-card text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_CONFIG[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={(filters.priority as string) || 'all'}
          onValueChange={(v) =>
            setFilter('priority', v === 'all' ? undefined : (v as TicketPriority))
          }
        >
          <SelectTrigger className="h-8 w-[8rem] bg-card text-xs">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_CONFIG[p].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.category || 'all'}
          onValueChange={(v) => setFilter('category', v === 'all' ? undefined : v)}
        >
          <SelectTrigger className="h-8 w-[9rem] bg-card text-xs">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {!myTicketsOnly && (
          <Button
            variant={filters.myTickets ? 'secondary' : 'outline'}
            size="sm"
            className="h-8"
            onClick={() => setFilter('myTickets', filters.myTickets ? undefined : true)}
          >
            Mine
          </Button>
        )}

        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
            Clear ({activeFilterCount})
          </Button>
        )}
      </div>

      {/* ── Bulk bar ───────────────────────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 shadow-panel">
          <span className={cn('text-xs tabular-nums', TEXT_MUTED)}>
            <span className="font-semibold text-foreground">{selectedIds.size}</span> selected
          </span>
          <div className="h-4 w-px bg-border" />
          <Select onValueChange={(v) => runBulk('status', v)} disabled={bulkBusy}>
            <SelectTrigger className="h-7 w-[7.5rem] text-xs">
              <SelectValue placeholder="Set status" />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_CONFIG[s].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select onValueChange={(v) => runBulk('priority', v)} disabled={bulkBusy}>
            <SelectTrigger className="h-7 w-[7.5rem] text-xs">
              <SelectValue placeholder="Set priority" />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {PRIORITY_CONFIG[p].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="destructive"
            size="sm"
            className="h-7"
            disabled={bulkBusy}
            onClick={() => {
              if (window.confirm(`Delete ${selectedIds.size} ticket(s)?`)) runBulk('delete');
            }}
          >
            Delete
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear
          </Button>
        </div>
      )}

      {error && (
        <div className="flex flex-shrink-0 items-start gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Workspace ──────────────────────────────────────────── */}
      <div
        className={cn(
          'grid min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card shadow-panel',
          showingDetail
            ? 'lg:grid-cols-[minmax(0,1fr)_minmax(22rem,26rem)]'
            : 'grid-cols-1',
        )}
      >
        {/* List */}
        <section
          className={cn(
            'flex min-h-0 min-w-0 flex-col overflow-hidden',
            showingDetail && 'hidden lg:flex',
          )}
        >
          {/* Column headers */}
          <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-border bg-surface-2/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
            <div className="flex w-4 flex-shrink-0 items-center justify-center">
              <Checkbox
                checked={allSelected}
                onCheckedChange={() => toggleSelectAll()}
                className="h-3.5 w-3.5"
                aria-label="Select all"
              />
            </div>
            <span className="w-[5.5rem] flex-shrink-0 sm:w-28">Number</span>
            <span className="min-w-0 flex-1">Title</span>
            <span className="hidden w-[5.75rem] flex-shrink-0 sm:block">Status</span>
            <span className="hidden w-[4.5rem] flex-shrink-0 sm:block">Priority</span>
            <span className="hidden w-24 flex-shrink-0 md:block">Category</span>
            <span className="hidden w-28 flex-shrink-0 lg:block">Assignee</span>
            <span className="hidden w-14 flex-shrink-0 text-right xl:block">SLA</span>
            <span className="w-12 flex-shrink-0 text-right sm:w-14">Updated</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-0 divide-y divide-border/50 p-0">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-3 py-2.5">
                    <Skeleton className="h-3.5 w-3.5 rounded" />
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-3 flex-1" />
                    <Skeleton className="hidden h-5 w-16 sm:block" />
                    <Skeleton className="hidden h-3 w-12 sm:block" />
                  </div>
                ))}
              </div>
            ) : tickets.length === 0 ? (
              <EmptyState
                title={activeFilterCount ? 'No matching tickets' : 'Queue is empty'}
                description={
                  activeFilterCount
                    ? 'Clear filters or broaden your search.'
                    : 'Open a ticket when something needs attention.'
                }
                action={
                  activeFilterCount ? (
                    <Button variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      New ticket
                    </Button>
                  )
                }
              />
            ) : (
              tickets.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  users={users}
                  isSelected={selectedIds.has(t.id)}
                  isActive={selectedId === t.id}
                  onSelect={() => toggleSelect(t.id)}
                  onClick={() => setSelectedId(t.id)}
                />
              ))
            )}
          </div>

          {/* Pagination footer */}
          <footer className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-border bg-surface-2/30 px-3 py-1.5">
            <span className={cn('text-[11px] tabular-nums', TEXT_MUTED)}>
              {total === 0
                ? 'No results'
                : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}
            </span>
            <div className="flex items-center gap-1.5">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-7 w-[5.5rem] text-[11px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} / page
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Prev
              </Button>
              <span className="min-w-[2.75rem] text-center text-[11px] tabular-nums text-muted-foreground">
                {page}/{Math.max(totalPages, 1)}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </footer>
        </section>

        {/* Detail inspector */}
        {showingDetail && selectedId && (
          <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-border bg-background/40 lg:border-l">
            <TicketDetail
              ticketId={selectedId}
              users={users}
              onClose={() => setSelectedId(null)}
              onChanged={() => {
                loadList({ soft: true });
                loadRef();
              }}
            />
          </aside>
        )}
      </div>

      <CreateTicketModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        users={users}
        servers={servers}
        templates={templates}
        defaultServerId={lockedServerId}
        loading={creating}
      />
    </div>
  );
}
