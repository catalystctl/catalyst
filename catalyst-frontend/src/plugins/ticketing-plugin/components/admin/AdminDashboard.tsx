// src/plugins/ticketing-plugin/components/admin/AdminDashboard.tsx
// Main admin view for the ticketing system — the heart of the plugin.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TicketSort, CreateTicketPayload } from '../../types';
import {
  Button,
  cn,
  TEXT_MUTED,
  SURFACE_1,
  SURFACE_2,
  BORDER_COLOR,
  FONT_DISPLAY,
  Plus,
  X,
  RefreshCw,
  ChevronDown,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
  ScrollArea,
} from '../../../plugin-ui';
import {
  LayoutList,
  LayoutGrid,
  Ticket,
  ChevronUp,
  AlertTriangle,
  Clock,
  CircleDot,
  Loader2 as Loader2Icon,
  UserX,
  ShieldAlert,
  Tag,
} from 'lucide-react';

import { useTicketingData } from '../../hooks/useTicketingData';
import { useTicketActions } from '../../hooks/useTicketActions';
import { usePluginWebSocket } from '../../../usePluginWebSocket';

import { FilterBar } from '../shared/FilterBar';
import { TicketRow } from '../shared/TicketRow';
import { LoadingSkeleton } from '../shared/LoadingSkeleton';
import { Pagination } from '../shared/Pagination';
import { EmptyState } from '../shared/EmptyState';
import { KeyboardShortcuts } from '../shared/KeyboardShortcuts';
import { TicketDetail } from '../TicketDetail';
import { BulkActions } from '../BulkActions';
import { CreateTicketModal } from '../modals/CreateTicketModal';
import { TagManagerModal } from '../modals/TagManagerModal';
import { TemplateManagerModal } from '../modals/TemplateManagerModal';

// ── Stat card config ──

interface StatCardDef {
  key: string;
  label: string;
  value: number | undefined;
  color: string;
  bg: string;
  icon: React.ComponentType<{ className?: string }>;
}

function getStatCards(stats: Record<string, number | undefined>): StatCardDef[] {
  return [
    { key: 'open', label: 'Open', value: stats.open, color: 'text-blue-400', bg: 'bg-blue-500/10', icon: CircleDot },
    { key: 'inProgress', label: 'In Progress', value: stats.inProgress, color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Loader2Icon },
    { key: 'pending', label: 'Pending', value: stats.pending, color: 'text-orange-400', bg: 'bg-orange-500/10', icon: Clock },
    { key: 'overdue', label: 'Overdue', value: stats.overdue, color: 'text-red-400', bg: 'bg-red-500/10', icon: AlertTriangle },
    { key: 'unassigned', label: 'Unassigned', value: stats.unassigned, color: 'text-zinc-400', bg: 'bg-zinc-500/10', icon: UserX },
    { key: 'slaBreached', label: 'SLA Breached', value: stats.slaBreached, color: 'text-red-400', bg: 'bg-red-500/10', icon: ShieldAlert },
  ];
}

// ── Sort indicator ──

function SortHeader({
  label,
  field,
  currentSort,
  onSort,
  className,
}: {
  label: string;
  field: string;
  currentSort: TicketSort;
  onSort: (field: string) => void;
  className?: string;
}) {
  const isActive = currentSort.field === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide transition-colors',
        isActive ? TEXT_MUTED : 'text-muted-foreground/60 hover:text-muted-foreground',
        className,
      )}
    >
      {label}
      {isActive && (
        currentSort.direction === 'desc' ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronUp className="h-3 w-3" />
        )
      )}
    </button>
  );
}

// ── Main component ──

export function AdminDashboard() {
  const data = useTicketingData();
  const actions = useTicketActions(data.loadTickets, data.refreshDetail);

  // Local state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');

  const searchRef = useRef<HTMLInputElement>(null);

  // ── WebSocket for real-time updates ──
  usePluginWebSocket(
    'ticketing-plugin',
    'ticket-updated',
    useCallback(() => {
      data.loadTickets();
      if (data.selectedTicket) data.refreshDetail();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if (e.key === 'Escape') {
        if (showCreateModal || showTagManager || showTemplateManager || showShortcuts) return;
        if (data.selectedTicket) {
          data.selectTicket(null);
          setSelectedIds(new Set());
        }
        return;
      }

      if (isInput) return;

      switch (e.key) {
        case 'n':
          e.preventDefault();
          setShowCreateModal(true);
          break;
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case '?':
          e.preventDefault();
          setShowShortcuts(true);
          break;
        case 'a':
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            setSelectedIds(new Set(data.tickets.map((t) => t.id)));
          }
          break;
        case 's':
          e.preventDefault();
          data.setFilters({ ...data.filters, myTickets: !data.filters.myTickets });
          break;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showCreateModal, showTagManager, showTemplateManager, showShortcuts, data]);

  // ── Selection ──
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    if (selectedIds.size === (data.tickets?.length ?? 0)) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.tickets.map((t) => t.id)));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // ── Sort ──
  function handleSort(field: string) {
    data.setSort({
      field: field as TicketSort['field'],
      direction:
        data.sort.field === field && data.sort.direction === 'desc' ? 'asc' : 'desc',
    });
  }

  // ── Bulk action handler ──
  async function handleBulkAction(action: string, value: unknown) {
    try {
      await actions.executeBulkAction({
        ticketIds: Array.from(selectedIds),
        action: action as 'status' | 'priority' | 'assignee' | 'category' | 'tags_add' | 'tags_remove' | 'delete',
        value,
      });
      clearSelection();
    } catch { /* error shown by hook */ }
  }

  // ── Create ticket handler ──
  async function handleCreateTicket(payload: CreateTicketPayload) {
    try {
      const ticket = await actions.createTicket(payload);
      setShowCreateModal(false);
      data.selectTicket(ticket.id);
    } catch { /* error shown by hook */ }
  }

  // ── Stat cards ──
  const statCards = useMemo(() => {
    if (!data.stats) return [];
    return getStatCards({
      open: data.stats.open,
      inProgress: data.stats.inProgress,
      pending: data.stats.pending,
      overdue: data.stats.overdue,
      unassigned: data.stats.unassigned,
      slaBreached: data.stats.slaBreached,
    });
  }, [data.stats]);

  // ── Categories from settings or defaults ──
  const categories = data.settings?.allowedCategories ?? [];

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden">
        {/* ── Header ── */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className={cn('text-xl font-bold text-foreground', FONT_DISPLAY)}>
              Tickets
            </h1>
            {data.stats && (
              <span className={cn('text-sm', TEXT_MUTED)}>
                {data.stats.total} total
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className={cn('flex rounded-lg border p-0.5', BORDER_COLOR, SURFACE_2)}>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn(
                  'rounded-md p-1.5 transition-colors',
                  viewMode === 'list' ? SURFACE_1 : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LayoutList className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('board')}
                className={cn(
                  'rounded-md p-1.5 transition-colors',
                  viewMode === 'board' ? SURFACE_1 : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            </div>

            {/* Tag manager */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => setShowTagManager(true)}>
                  <Tag className="mr-1.5 h-3.5 w-3.5" />
                  Tags
                </Button>
              </TooltipTrigger>
              <TooltipContent>Manage tags</TooltipContent>
            </Tooltip>

            {/* Template manager */}
            {data.settings?.enableTemplates !== false && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" onClick={() => setShowTemplateManager(true)}>
                    <LayoutList className="mr-1.5 h-3.5 w-3.5" />
                    Templates
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Manage templates</TooltipContent>
              </Tooltip>
            )}

            {/* Refresh */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    data.loadTickets();
                    data.refreshStats();
                  }}
                  disabled={data.isLoadingTickets}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', data.isLoadingTickets && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>

            {/* New ticket */}
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Ticket
            </Button>
          </div>
        </div>

        {/* ── Stats bar ── */}
        {statCards.length > 0 && (
          <div className="flex items-center gap-3 border-b border-border px-6 py-3 overflow-x-auto">
            {statCards.map((stat) => (
              <button
                key={stat.key}
                type="button"
                onClick={() => {
                  if (stat.key === 'open') data.setFilters({ ...data.filters, status: 'open' });
                  else if (stat.key === 'inProgress') data.setFilters({ ...data.filters, status: 'in_progress' });
                  else if (stat.key === 'pending') data.setFilters({ ...data.filters, status: 'pending' });
                  else if (stat.key === 'overdue') data.setFilters({ ...data.filters, isOverdue: true });
                  else if (stat.key === 'unassigned') data.setFilters({ ...data.filters, assigneeId: 'unassigned' });
                  else if (stat.key === 'slaBreached') data.setFilters({ ...data.filters, isOverdue: true });
                }}
                className={cn(
                  'flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                  BORDER_COLOR,
                  stat.bg,
                  'hover:bg-opacity-20',
                )}
              >
                <stat.icon className={cn('h-4 w-4', stat.color)} />
                <div className="flex flex-col">
                  <span className={cn('text-lg font-bold leading-none', stat.color)}>
                    {stat.value ?? 0}
                  </span>
                  <span className={cn('text-[10px] font-medium uppercase tracking-wide', TEXT_MUTED)}>
                    {stat.label}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* ── Main content: two-panel layout ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Left panel: ticket list ── */}
          <div
            className={cn(
              'flex flex-col border-r border-border transition-all duration-200',
              data.selectedTicket ? 'w-[58%]' : 'w-full',
            )}
          >
            {/* Filter bar */}
            <div className="px-4 pt-3">
              <FilterBar
                filters={data.filters}
                onChange={data.setFilters}
                categories={categories}
                users={data.users}
                tags={data.tags}
                servers={data.servers}
              />
            </div>

            {/* Column headers */}
            {!data.isLoadingTickets && (data.tickets?.length ?? 0) > 0 && (
              <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                {/* Select all checkbox */}
                <button
                  type="button"
                  onClick={selectAll}
                  className={cn(
                    'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border transition-colors',
                    selectedIds.size === (data.tickets?.length ?? 0) && (data.tickets?.length ?? 0) > 0
                      ? 'border-primary bg-primary text-primary-foreground'
                      : BORDER_COLOR,
                  )}
                >
                  {selectedIds.size === (data.tickets?.length ?? 0) && (data.tickets?.length ?? 0) > 0 && (
                    <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                <SortHeader label="Ticket" field="ticketNumber" currentSort={data.sort} onSort={handleSort} className="w-24" />
                <SortHeader label="Title" field="title" currentSort={data.sort} onSort={handleSort} className="flex-1" />
                <SortHeader label="Status" field="status" currentSort={data.sort} onSort={handleSort} />
                <SortHeader label="Priority" field="priority_weight" currentSort={data.sort} onSort={handleSort} className="w-20" />
                <span className="hidden w-24 flex-shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60 sm:block">Category</span>
                <SortHeader label="Assignee" field="assigneeId" currentSort={data.sort} onSort={handleSort} className="hidden w-28 md:block" />
                <span className="flex-shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/60">SLA</span>
                <SortHeader label="Updated" field="updatedAt" currentSort={data.sort} onSort={handleSort} className="w-16" />
              </div>
            )}

            {/* Ticket list */}
            <div className="flex-1 overflow-y-auto">
              {data.isLoadingTickets ? (
                <LoadingSkeleton rows={data.ticketPageSize} />
              ) : (data.tickets?.length ?? 0) === 0 ? (
                <EmptyState
                  icon={Ticket}
                  title="No tickets found"
                  description={
                    Object.keys(data.filters).length > 0
                      ? 'Try adjusting your filters or search query.'
                      : 'Create your first ticket to get started.'
                  }
                  action={
                    Object.keys(data.filters).length > 0
                      ? { label: 'Clear Filters', onClick: () => data.setFilters({}) }
                      : { label: 'Create Ticket', onClick: () => setShowCreateModal(true) }
                  }
                  className="m-4"
                />
              ) : (
                <AnimatePresence mode="popLayout">
                  {data.tickets.map((ticket) => (
                    <motion.div
                      key={ticket.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      <TicketRow
                        ticket={ticket}
                        isSelected={selectedIds.has(ticket.id)}
                        onSelect={() => toggleSelect(ticket.id)}
                        onClick={() => data.selectTicket(ticket.id)}
                        users={data.users}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* Pagination */}
            {data.ticketTotal > 0 && (
              <Pagination
                currentPage={data.ticketPage}
                totalPages={data.ticketTotalPages}
                pageSize={data.ticketPageSize}
                total={data.ticketTotal}
                onPageChange={data.setPage}
                onPageSizeChange={data.setPageSize}
              />
            )}
          </div>

          {/* ── Right panel: ticket detail ── */}
          {data.selectedTicket && (
            <div className="flex-shrink-0 overflow-hidden border-r border-border" style={{ width: '42%' }}>
              <ScrollArea className="h-full">
                <TicketDetail
                  ticket={data.selectedTicket}
                  comments={data.selectedTicketComments}
                  activities={data.selectedTicketActivities}
                  users={data.users}
                  servers={data.servers}
                  tags={data.tags}
                  onClose={() => data.selectTicket(null)}
                  onRefresh={() => {
                    data.refreshDetail();
                    data.loadTickets();
                  }}
                  actions={actions}
                  isLoading={data.isLoadingDetail}
                />
              </ScrollArea>
            </div>
          )}
        </div>

        {/* ── Bulk actions bar ── */}
        <AnimatePresence>
          {selectedIds.size > 0 && (
            <motion.div
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <BulkActions
                selectedIds={Array.from(selectedIds)}
                onAction={handleBulkAction}
                onClearSelection={clearSelection}
                users={data.users}
                tags={data.tags}
                isLoading={actions.isActionLoading}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Modals ── */}
        <CreateTicketModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateTicket}
          users={data.users}
          servers={data.servers}
          tags={data.tags}
          templates={data.templates}
          categories={categories}
          settings={data.settings}
          isLoading={actions.isActionLoading}
        />

        <TagManagerModal
          open={showTagManager}
          onClose={() => {
            setShowTagManager(false);
            data.refreshTags();
          }}
          tags={data.tags}
          onCreateTag={actions.createTag}
          onUpdateTag={actions.updateTag}
          onDeleteTag={actions.deleteTag}
        />

        <TemplateManagerModal
          open={showTemplateManager}
          onClose={() => {
            setShowTemplateManager(false);
            data.refreshTemplates();
          }}
          templates={data.templates}
          onCreateTemplate={actions.createTemplate}
          onUpdateTemplate={actions.updateTemplate}
          onDeleteTemplate={actions.deleteTemplate}
          categories={categories}
        />

        <KeyboardShortcuts open={showShortcuts} onClose={() => setShowShortcuts(false)} />

        {/* ── Error toast ── */}
        {data.error && (
          <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4" />
            {data.error}
            <button type="button" onClick={data.clearError}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {actions.actionError && (
          <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4" />
            {actions.actionError}
            <button type="button" onClick={actions.clearActionError}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
