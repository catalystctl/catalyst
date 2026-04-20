// src/plugins/ticketing-plugin/components/admin/UserPage.tsx
// Simplified "My Tickets" view. Filters to tickets where the current user is assignee or reporter.
// Stripped-down version without admin features (no bulk delete, no tag/template management).

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TicketSort } from '../../types';
import {
  Button,
  cn,
  TEXT_MUTED,
  BORDER_COLOR,
  FONT_DISPLAY,
  Plus,
  X,
  RefreshCw,
  ChevronDown,
  AlertTriangle,
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
  ScrollArea,
} from '../../../plugin-ui';
import { Ticket, ChevronUp } from 'lucide-react';

import { useTicketingData } from '../../hooks/useTicketingData';
import { useTicketActions } from '../../hooks/useTicketActions';

import { FilterBar } from '../shared/FilterBar';
import { TicketRow } from '../shared/TicketRow';
import { LoadingSkeleton } from '../shared/LoadingSkeleton';
import { Pagination } from '../shared/Pagination';
import { EmptyState } from '../shared/EmptyState';
import { TicketDetail } from '../TicketDetail';
import { BulkActions } from '../BulkActions';
import { CreateTicketModal } from '../modals/CreateTicketModal';

// ── Sort header ──

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

// ── Component ──

export function UserPage() {
  const data = useTicketingData();
  const actions = useTicketActions(data.loadTickets, data.refreshDetail);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Force "My Tickets" filter on mount
  useEffect(() => {
    if (!data.filters.myTickets) {
      data.setFilters({ ...data.filters, myTickets: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (selectedIds.size === data.tickets.length) {
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
      direction: data.sort.field === field && data.sort.direction === 'desc' ? 'asc' : 'desc',
    });
  }

  // ── Bulk action (limited for user view — no delete) ──
  async function handleBulkAction(action: string, value: unknown) {
    if (action === 'delete') return; // Users cannot bulk-delete
    try {
      await actions.executeBulkAction({
        ticketIds: Array.from(selectedIds),
        action: action as 'status' | 'priority' | 'assignee' | 'category' | 'tags_add' | 'tags_remove',
        value,
      });
      clearSelection();
    } catch { /* error shown by hook */ }
  }

  // ── Create ticket ──
  async function handleCreateTicket(payload: Parameters<typeof actions.createTicket>[0]) {
    try {
      const ticket = await actions.createTicket(payload);
      setShowCreateModal(false);
      data.selectTicket(ticket.id);
    } catch { /* error shown by hook */ }
  }

  const categories = data.settings?.allowedCategories ?? [];

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className={cn('text-xl font-bold text-foreground', FONT_DISPLAY)}>
              My Tickets
            </h1>
            {data.stats && (
              <span className={cn('text-sm', TEXT_MUTED)}>
                {data.stats.myTickets} ticket{data.stats.myTickets !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => data.loadTickets()}
                  disabled={data.isLoadingTickets}
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', data.isLoadingTickets && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
            <Button size="sm" onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Ticket
            </Button>
          </div>
        </div>

        {/* Main content: two-panel layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel: ticket list */}
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
            {!data.isLoadingTickets && data.tickets.length > 0 && (
              <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                <button
                  type="button"
                  onClick={selectAll}
                  className={cn(
                    'flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm border transition-colors',
                    selectedIds.size === data.tickets.length && data.tickets.length > 0
                      ? 'border-primary bg-primary text-primary-foreground'
                      : BORDER_COLOR,
                  )}
                >
                  {selectedIds.size === data.tickets.length && data.tickets.length > 0 && (
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
              ) : data.tickets.length === 0 ? (
                <EmptyState
                  icon={Ticket}
                  title="No tickets assigned to you"
                  description="You don't have any open tickets. Nice work!"
                  action={{ label: 'Create Ticket', onClick: () => setShowCreateModal(true) }}
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

          {/* Right panel: ticket detail */}
          <AnimatePresence>
            {data.selectedTicket && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: '42%', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
                className="flex-shrink-0 overflow-hidden border-r border-border"
              >
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bulk actions bar */}
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

        {/* Modals */}
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

        {/* Error toast */}
        {data.error && (
          <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertTriangle className="h-4 w-4" />
            {data.error}
            <button type="button" onClick={data.clearError}><X className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
