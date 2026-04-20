import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { motion } from 'framer-motion';
import {
  Ticket,
  Plus,
  Search,
  FileDown,
  FileText,
  Tag,
  MoreHorizontal,
  Printer,
  Keyboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────
import type { Ticket as TicketType, FilterState, PaginationState } from './types';

// ─── Constants ──────────────────────────────────────────────
import { containerVariants, itemVariants } from './constants';

// ─── API ────────────────────────────────────────────────────
import * as apiClient from './api';

// ─── Hooks ──────────────────────────────────────────────────
import { useTicketingData } from './hooks/useTicketingData';
import { useTicketActions } from './hooks/useTicketActions';

// ─── Components ─────────────────────────────────────────────
import { TicketDetail } from './components/TicketDetail';
import { AdminDashboard } from './components/admin/AdminDashboard';
import { TicketRow } from './components/shared/TicketRow';
import { FilterBar } from './components/shared/FilterBar';
import { Pagination } from './components/shared/Pagination';
import { EmptyState } from './components/shared/EmptyState';
import { LoadingSkeleton, ListSkeleton, DetailSkeleton } from './components/shared/LoadingSkeleton';
import { KeyboardShortcuts, ShortcutHint } from './components/shared/KeyboardShortcuts';
import { BulkActions } from './components/BulkActions';
import { CreateTicketModal } from './components/modals/CreateTicketModal';
import { MergeTicketModal } from './components/modals/MergeTicketModal';
import { TagManagerModal } from './components/modals/TagManagerModal';
import { TemplateManagerModal } from './components/modals/TemplateManagerModal';
import { LinkTicketModal } from './components/modals/LinkTicketModal';
import { StatsCard } from '@/components/ui/stats-card';
import { CircleDot, HourglassIcon, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
//  ADMIN TAB
// ═══════════════════════════════════════════════════════════════

export function AdminTab() {
  const data = useTicketingData(true);
  const actions = useTicketActions();
  const searchRef = useRef<HTMLInputElement>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showMerge, setShowMerge] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Load tickets when filters/sort/pagination change
  useEffect(() => {
    actions.loadTickets();
  }, [
    actions.filters.search,
    actions.filters.status,
    actions.filters.priority,
    actions.filters.category,
    actions.filters.assignedTo,
    actions.filters.createdBy,
    actions.filters.dateFrom,
    actions.filters.dateTo,
    JSON.stringify(actions.filters.tags),
    actions.sortBy,
    actions.pagination.page,
    actions.pagination.pageSize,
  ]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(actions.tickets.map((t) => t.id));
  }, [actions.tickets]);

  const deselectAll = useCallback(() => {
    setSelectedIds([]);
  }, []);

  const handleBulkStatusChange = useCallback(async (status: string) => {
    for (const id of selectedIds) {
      await actions.updateTicketProp(id, { status });
    }
    setSelectedIds([]);
  }, [selectedIds, actions.updateTicketProp]);

  const handleBulkPriorityChange = useCallback(async (priority: string) => {
    for (const id of selectedIds) {
      await actions.updateTicketProp(id, { priority });
    }
    setSelectedIds([]);
  }, [selectedIds, actions.updateTicketProp]);

  const handleBulkAssign = useCallback(async (userId: string) => {
    for (const id of selectedIds) {
      await actions.updateTicketProp(id, { assignedTo: userId || null });
    }
    setSelectedIds([]);
  }, [selectedIds, actions.updateTicketProp]);

  const handleBulkDelete = useCallback(async () => {
    if (!confirm(`Delete ${selectedIds.length} tickets? This cannot be undone.`)) return;
    for (const id of selectedIds) {
      await actions.removeTicket(id);
    }
    setSelectedIds([]);
  }, [selectedIds, actions.removeTicket]);

  const handleMerge = useCallback(async (primaryId: string, sourceIds: string[]) => {
    await actions.mergeTickets(primaryId, sourceIds);
    setShowMerge(false);
    setSelectedIds([]);
  }, [actions.mergeTickets]);

  const handleTagCreated = useCallback(async (name: string, color: string) => {
    await apiClient.createTag({ name, color });
    data.refresh();
  }, [data]);

  const handleTagDeleted = useCallback(async (id: string) => {
    await apiClient.deleteTag(id);
    data.refresh();
  }, [data]);

  const handleTemplateCreated = useCallback(async (templateData: Record<string, any>) => {
    await apiClient.createTemplate(templateData);
    data.refresh();
  }, [data]);

  const handleTemplateDeleted = useCallback(async (id: string) => {
    await apiClient.deleteTemplate(id);
    data.refresh();
  }, [data]);

  if (data.loading) return <LoadingSkeleton />;

  // Detail view
  if (actions.selectedTicket) {
    return (
      <div className="space-y-4">
        <KeyboardShortcuts
          onClose={actions.clearSelection}
          enabled={!showCreate && !showLinkModal}
        />
        {actions.loading ? (
          <DetailSkeleton />
        ) : (
          <TicketDetail
            ticket={actions.selectedTicket}
            comments={actions.ticketComments}
            activities={actions.ticketActivities}
            attachments={actions.ticketAttachments}
            linkedTickets={actions.ticketLinkedTickets}
            categories={data.categories}
            users={data.users}
            servers={data.servers}
            statuses={data.statuses}
            tags={data.tags}
            transitions={data.transitions}
            onBack={actions.clearSelection}
            onUpdate={actions.updateTicketProp}
            onDelete={actions.removeTicket}
            onAddComment={actions.addNewComment}
            onDeleteComment={actions.removeComment}
            onEditComment={actions.editComment}
            onPinComment={actions.togglePinComment}
            onUploadAttachment={actions.uploadNewAttachment}
            onDeleteAttachment={actions.removeAttachment}
            onLinkTicket={actions.linkNewTicket}
            onUnlinkTicket={actions.unlinkTicket}
            onUpdateTags={actions.updateTicketProp}
            isAdmin
            onOpenLinkModal={() => setShowLinkModal(true)}
          />
        )}

        <LinkTicketModal
          open={showLinkModal}
          onClose={() => setShowLinkModal(false)}
          currentTicketId={actions.selectedTicket.id}
          onLinked={() => actions.loadTicketDetail(actions.selectedTicket.id)}
        />
      </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <KeyboardShortcuts
        onNewTicket={() => setShowCreate(true)}
        onClose={() => {}}
        onFocusSearch={() => searchRef.current?.focus()}
        enabled={!showCreate && !showMerge && !showTagManager && !showTemplateManager && !showLinkModal}
      />

      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-primary to-cyan-500 opacity-20 blur-sm" />
              <Ticket className="relative h-7 w-7 text-primary" />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
              Ticket Manager
            </h1>
          </div>
          <p className="ml-10 text-sm text-muted-foreground">
            Track and resolve support requests across your platform
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowShortcuts(!showShortcuts)}
            title="Keyboard shortcuts"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={actions.exportCsv}>
            <FileDown className="h-3.5 w-3.5" />
            Export CSV
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => setShowTagManager(true)}>
            <Tag className="h-3.5 w-3.5" />
            Tags
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => setShowTemplateManager(true)}>
            <FileText className="h-3.5 w-3.5" />
            Templates
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2 shadow-sm">
            <Plus className="h-4 w-4" />
            New Ticket
          </Button>
        </div>
      </motion.div>

      {/* Keyboard shortcuts hint */}
      {showShortcuts && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap gap-4 rounded-lg border border-border bg-surface-2/50 px-4 py-3">
            <ShortcutHint keys={['N']} description="New ticket" />
            <ShortcutHint keys={['/']} description="Focus search" />
            <ShortcutHint keys={['Esc']} description="Close / Go back" />
          </div>
        </motion.div>
      )}

      {/* Dashboard stats */}
      <AdminDashboard
        stats={data.stats}
        users={data.users}
        categories={data.categories}
      />

      {/* Filters */}
      <motion.div variants={itemVariants}>
        <FilterBar
          filters={actions.filters}
          sortBy={actions.sortBy}
          categories={data.categories}
          users={data.users}
          tags={data.tags}
          showCategoryFilter
          showAssigneeFilter
          showCreatorFilter
          showDateFilter
          showTagFilter
          onFilterChange={actions.updateFilter}
          onSortChange={actions.setSortBy}
          onClearFilters={actions.clearFilters}
          hasActiveFilters={actions.hasActiveFilters}
        />
      </motion.div>

      {/* Bulk actions & ticket count */}
      <motion.div variants={itemVariants} className="flex items-center justify-between">
        <BulkActions
          selectedIds={selectedIds}
          totalCount={actions.pagination.total}
          users={data.users}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
          onBulkStatusChange={handleBulkStatusChange}
          onBulkPriorityChange={handleBulkPriorityChange}
          onBulkAssign={handleBulkAssign}
          onBulkDelete={handleBulkDelete}
          onMerge={() => setShowMerge(true)}
        />
        <span className="text-xs font-medium text-muted-foreground">
          {actions.pagination.total} ticket{actions.pagination.total !== 1 ? 's' : ''}
        </span>
      </motion.div>

      {/* Ticket List */}
      <motion.div variants={itemVariants} className="space-y-2">
        {actions.loading ? (
          <ListSkeleton count={5} />
        ) : actions.tickets.length === 0 ? (
          <EmptyState
            type={actions.hasActiveFilters ? 'no-results' : 'no-tickets'}
            onAction={() => setShowCreate(true)}
          />
        ) : (
          actions.tickets.map((ticket) => (
            <TicketRow
              key={ticket.id}
              ticket={ticket}
              onSelect={actions.loadTicketDetail}
              users={data.users}
              showCheckbox
              isChecked={selectedIds.includes(ticket.id)}
              onToggleCheck={toggleSelect}
            />
          ))
        )}
      </motion.div>

      {/* Pagination */}
      <Pagination
        pagination={actions.pagination}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setPageSize}
      />

      {/* Modals */}
      <CreateTicketModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        categories={data.categories}
        users={data.users}
        servers={data.servers}
        onCreated={(ticket) => {
          actions.loadTickets();
          actions.loadTicketDetail(ticket.id);
        }}
        templates={data.templates}
        tags={data.tags}
      />

      <MergeTicketModal
        open={showMerge}
        onClose={() => setShowMerge(false)}
        tickets={actions.tickets.filter((t) => selectedIds.includes(t.id))}
        onMerged={handleMerge}
      />

      <TagManagerModal
        open={showTagManager}
        onClose={() => setShowTagManager(false)}
        tags={data.tags}
        onCreated={handleTagCreated}
        onDeleted={handleTagDeleted}
      />

      <TemplateManagerModal
        open={showTemplateManager}
        onClose={() => setShowTemplateManager(false)}
        templates={data.templates}
        categories={data.categories}
        onCreated={handleTemplateCreated}
        onDeleted={handleTemplateDeleted}
      />
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  SERVER TAB
// ═══════════════════════════════════════════════════════════════

export function ServerTab({ serverId }: { serverId: string }) {
  const data = useTicketingData(false);
  const actions = useTicketActions();
  const searchRef = useRef<HTMLInputElement>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);

  // Override filters to always filter by serverId
  useEffect(() => {
    actions.setFilters((prev) => ({ ...prev, serverId }));
  }, [serverId]);

  // Load tickets when filters change
  useEffect(() => {
    actions.loadTickets();
  }, [
    actions.filters.search,
    actions.filters.status,
    actions.filters.priority,
    actions.filters.category,
    actions.sortBy,
    actions.pagination.page,
    actions.pagination.pageSize,
  ]);

  // Detail view
  if (actions.selectedTicket) {
    return (
      <div className="space-y-4">
        <KeyboardShortcuts
          onClose={actions.clearSelection}
          enabled={!showCreate && !showLinkModal}
        />
        {actions.loading ? (
          <DetailSkeleton />
        ) : (
          <TicketDetail
            ticket={actions.selectedTicket}
            comments={actions.ticketComments}
            activities={actions.ticketActivities}
            attachments={actions.ticketAttachments}
            linkedTickets={actions.ticketLinkedTickets}
            categories={data.categories}
            users={data.users}
            servers={data.servers}
            statuses={data.statuses}
            tags={data.tags}
            transitions={data.transitions}
            onBack={actions.clearSelection}
            onUpdate={actions.updateTicketProp}
            onDelete={actions.removeTicket}
            onAddComment={actions.addNewComment}
            onDeleteComment={actions.removeComment}
            onEditComment={actions.editComment}
            onPinComment={actions.togglePinComment}
            onUploadAttachment={actions.uploadNewAttachment}
            onDeleteAttachment={actions.removeAttachment}
            onLinkTicket={actions.linkNewTicket}
            onUnlinkTicket={actions.unlinkTicket}
            onUpdateTags={actions.updateTicketProp}
            isAdmin
            onOpenLinkModal={() => setShowLinkModal(true)}
          />
        )}

        <LinkTicketModal
          open={showLinkModal}
          onClose={() => setShowLinkModal(false)}
          currentTicketId={actions.selectedTicket.id}
          onLinked={() => actions.loadTicketDetail(actions.selectedTicket.id)}
        />
      </div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-4"
    >
      <KeyboardShortcuts
        onNewTicket={() => setShowCreate(true)}
        onClose={() => {}}
        onFocusSearch={() => searchRef.current?.focus()}
        enabled={!showCreate}
      />

      {/* Header */}
      <motion.div variants={itemVariants} className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary-50 to-primary-100 dark:from-primary-950/50 dark:to-primary-900/30 shadow-sm">
              <Ticket className="h-4 w-4 text-primary" />
            </div>
            <h2 className="font-display text-xl font-bold text-foreground">Server Tickets</h2>
          </div>
          <p className="ml-10 text-xs text-muted-foreground">
            Support requests linked to this server
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Ticket
        </Button>
      </motion.div>

      {/* Filters */}
      <motion.div variants={itemVariants}>
        <FilterBar
          filters={actions.filters}
          sortBy={actions.sortBy}
          categories={data.categories}
          users={data.users}
          tags={data.tags}
          showCategoryFilter={false}
          showAssigneeFilter={false}
          onFilterChange={actions.updateFilter}
          onSortChange={actions.setSortBy}
          onClearFilters={actions.clearFilters}
          hasActiveFilters={actions.hasActiveFilters}
          compact
        />
      </motion.div>

      {/* List */}
      <motion.div variants={itemVariants} className="space-y-2">
        {actions.loading ? (
          <ListSkeleton count={3} />
        ) : actions.tickets.length === 0 ? (
          <EmptyState
            type={actions.hasActiveFilters ? 'no-results' : 'no-tickets'}
            title={actions.hasActiveFilters ? 'No matching tickets' : 'No tickets for this server'}
            description={actions.hasActiveFilters ? 'Try adjusting your filters' : 'Create one to track an issue or request'}
            actionLabel="Create Ticket"
            onAction={() => setShowCreate(true)}
          />
        ) : (
          <>
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-medium text-muted-foreground">
                {actions.pagination.total} ticket{actions.pagination.total !== 1 ? 's' : ''}
              </span>
            </div>
            {actions.tickets.map((ticket) => (
              <TicketRow
                key={ticket.id}
                ticket={ticket}
                onSelect={actions.loadTicketDetail}
                users={data.users}
              />
            ))}
          </>
        )}
      </motion.div>

      {/* Pagination */}
      <Pagination
        pagination={actions.pagination}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setPageSize}
      />

      {/* Modals */}
      <CreateTicketModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        categories={data.categories}
        users={data.users}
        servers={data.servers}
        defaultServerId={serverId}
        onCreated={(ticket) => {
          actions.loadTickets();
          actions.loadTicketDetail(ticket.id);
        }}
        templates={data.templates}
        tags={data.tags}
      />
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  USER PAGE
// ═══════════════════════════════════════════════════════════════

export function UserPage() {
  const currentUserId = useAuthStore.getState().user?.id || null;

  const data = useTicketingData(false);
  const actions = useTicketActions();
  const searchRef = useRef<HTMLInputElement>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);

  // Override filters to only show user's tickets
  useEffect(() => {
    if (currentUserId) {
      actions.setFilters((prev) => ({ ...prev, createdBy: currentUserId }));
    }
  }, [currentUserId]);

  // Load tickets when filters change
  useEffect(() => {
    actions.loadTickets();
  }, [
    actions.filters.search,
    actions.filters.status,
    actions.filters.priority,
    actions.filters.category,
    actions.sortBy,
    actions.pagination.page,
    actions.pagination.pageSize,
  ]);

  // Count tickets by status
  const openCount = actions.tickets.filter(
    (t) => t.status === 'open' || t.status === 'in_progress'
  ).length;
  const resolvedCount = actions.tickets.filter((t) => t.status === 'resolved').length;

  // Detail view
  if (actions.selectedTicket) {
    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-4"
      >
        <KeyboardShortcuts
          onClose={actions.clearSelection}
          enabled={!showCreate && !showLinkModal}
        />
        {actions.loading ? (
          <DetailSkeleton />
        ) : (
          <TicketDetail
            ticket={actions.selectedTicket}
            comments={actions.ticketComments}
            activities={actions.ticketActivities}
            attachments={actions.ticketAttachments}
            linkedTickets={actions.ticketLinkedTickets}
            categories={data.categories}
            users={data.users}
            servers={data.servers}
            statuses={data.statuses}
            tags={data.tags}
            transitions={data.transitions}
            onBack={actions.clearSelection}
            onUpdate={() => {}}
            onDelete={() => {}}
            onAddComment={(ticketId, content, _isInternal, statusChange) =>
              actions.addNewComment(ticketId, content, false, statusChange)
            }
            onDeleteComment={() => {}}
            onEditComment={() => {}}
            onPinComment={() => {}}
            onUploadAttachment={actions.uploadNewAttachment}
            onDeleteAttachment={() => {}}
            onLinkTicket={actions.linkNewTicket}
            onUnlinkTicket={actions.unlinkTicket}
            onUpdateTags={() => {}}
            isAdmin={false}
            onOpenLinkModal={() => setShowLinkModal(true)}
          />
        )}

        <LinkTicketModal
          open={showLinkModal}
          onClose={() => setShowLinkModal(false)}
          currentTicketId={actions.selectedTicket.id}
          onLinked={() => actions.loadTicketDetail(actions.selectedTicket.id)}
        />
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-gradient-to-br from-primary/10 to-cyan-500/10 blur-3xl dark:from-primary/20 dark:to-cyan-500/20" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-gradient-to-tr from-sky-500/10 to-violet-500/10 blur-3xl dark:from-sky-500/20 dark:to-violet-500/20" />
      </div>

      <div className="relative z-10 space-y-6">
        <KeyboardShortcuts
          onNewTicket={() => setShowCreate(true)}
          onClose={() => {}}
          onFocusSearch={() => searchRef.current?.focus()}
          enabled={!showCreate}
        />

        {/* Header */}
        <motion.div variants={itemVariants}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-primary to-cyan-500 opacity-20 blur-sm" />
                  <Ticket className="relative h-7 w-7 text-primary" />
                </div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
                  My Tickets
                </h1>
              </div>
              <p className="ml-10 text-sm text-muted-foreground">
                Submit and track your support requests
              </p>
            </div>
            <Button onClick={() => setShowCreate(true)} className="gap-2 shadow-sm">
              <Plus className="h-4 w-4" />
              New Ticket
            </Button>
          </div>
        </motion.div>

        {/* User summary cards */}
        <motion.div variants={itemVariants} className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatsCard
            title="Total"
            value={actions.pagination.total}
            subtitle="All your tickets"
            icon={<Ticket className="h-4 w-4" />}
          />
          <StatsCard
            title="Active"
            value={openCount}
            subtitle="Awaiting response"
            icon={<CircleDot className="h-4 w-4" />}
            variant="info"
          />
          <StatsCard
            title="Resolved"
            value={resolvedCount}
            subtitle="Ready to close"
            icon={<CheckCircle2 className="h-4 w-4" />}
            variant="success"
          />
          <StatsCard
            title="Response Time"
            value="—"
            subtitle="Avg. first reply"
            icon={<Clock className="h-4 w-4" />}
            variant="default"
          />
        </motion.div>

        {/* Filters */}
        <motion.div variants={itemVariants}>
          <FilterBar
            filters={actions.filters}
            sortBy={actions.sortBy}
            categories={data.categories}
            users={data.users}
            tags={data.tags}
            showCategoryFilter={false}
            showAssigneeFilter={false}
            onFilterChange={actions.updateFilter}
            onSortChange={actions.setSortBy}
            onClearFilters={actions.clearFilters}
            hasActiveFilters={actions.hasActiveFilters}
          />
        </motion.div>

        {/* Ticket List */}
        <motion.div variants={itemVariants} className="space-y-2">
          {actions.loading ? (
            <ListSkeleton count={3} />
          ) : actions.tickets.length === 0 ? (
            <EmptyState
              type={actions.hasActiveFilters ? 'no-results' : 'no-tickets'}
              title={actions.hasActiveFilters ? 'No matching tickets' : 'No tickets yet'}
              description={
                actions.hasActiveFilters
                  ? 'Try adjusting your filters'
                  : "You haven't submitted any tickets yet"
              }
              actionLabel={actions.hasActiveFilters ? undefined : 'Submit a Ticket'}
              onAction={actions.hasActiveFilters ? undefined : () => setShowCreate(true)}
            />
          ) : (
            <>
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-medium text-muted-foreground">
                  {actions.pagination.total} ticket{actions.pagination.total !== 1 ? 's' : ''}
                </span>
              </div>
              {actions.tickets.map((ticket) => (
                <TicketRow
                  key={ticket.id}
                  ticket={ticket}
                  onSelect={actions.loadTicketDetail}
                  users={data.users}
                />
              ))}
            </>
          )}
        </motion.div>

        {/* Pagination */}
        <Pagination
          pagination={actions.pagination}
          onPageChange={actions.setPage}
          onPageSizeChange={actions.setPageSize}
        />
      </div>

      {/* Modals */}
      <CreateTicketModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        categories={data.categories}
        users={data.users}
        servers={data.servers}
        defaultUserId={currentUserId || undefined}
        onCreated={(ticket) => {
          actions.loadTickets();
          actions.loadTicketDetail(ticket.id);
        }}
        templates={data.templates}
        tags={data.tags}
      />
    </motion.div>
  );
}
