import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import {
  Play,
  Square,
  RotateCw,
  Ban,
  CheckCircle,
  Trash2,
  Search,
  Filter,
  ArrowUpDown,
  Server,
  MoreHorizontal,
  Settings,
  X,
} from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import EmptyState from '../../components/shared/EmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import Pagination from '../../components/shared/Pagination';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import UpdateServerModal from '../../components/servers/UpdateServerModal';
import DeleteServerDialog from '../../components/servers/DeleteServerDialog';
import { useAdminNodes, useAdminServers } from '../../hooks/useAdmin';
import { useTemplates } from '../../hooks/useTemplates';
import type { AdminServer, AdminServerAction } from '../../types/admin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';

const pageSize = 20;

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
};

// ── Status Config ──
function getStatusConfig(serverStatus: string) {
  switch (serverStatus) {
    case 'running':
      return {
        variant: 'success' as const,
        dot: 'bg-emerald-500',
        label: 'Running',
      };
    case 'stopped':
      return {
        variant: 'secondary' as const,
        dot: 'bg-zinc-400',
        label: 'Stopped',
      };
    case 'suspended':
      return {
        variant: 'destructive' as const,
        dot: 'bg-rose-500',
        label: 'Suspended',
      };
    case 'starting':
    case 'stopping':
      return {
        variant: 'warning' as const,
        dot: 'bg-amber-500',
        label: serverStatus === 'starting' ? 'Starting' : 'Stopping',
      };
    default:
      return {
        variant: 'secondary' as const,
        dot: 'bg-zinc-400',
        label: serverStatus,
      };
  }
}

// ── Status Dot Badge ──
function StatusBadge({ status }: { status: string }) {
  const config = getStatusConfig(status);
  return (
    <Badge variant={config.variant} className="gap-1.5 font-medium">
      <span className={`relative flex h-1.5 w-1.5`}>
        {status === 'running' && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${config.dot}`} />
      </span>
      {config.label}
    </Badge>
  );
}

// ── Skeleton Loader ──
function TableSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-lg px-4 py-3.5"
        >
          <div className="h-4 w-4 animate-pulse rounded bg-surface-3" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-40 animate-pulse rounded bg-surface-3" />
            <div className="h-3 w-56 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="h-5 w-20 animate-pulse rounded-full bg-surface-3" />
          <div className="hidden h-4 w-24 animate-pulse rounded bg-surface-3 sm:block" />
          <div className="hidden h-4 w-20 animate-pulse rounded bg-surface-3 md:block" />
          <div className="hidden h-4 w-24 animate-pulse rounded bg-surface-3 lg:block" />
          <div className="flex gap-1">
            <div className="h-7 w-16 animate-pulse rounded-md bg-surface-3" />
            <div className="h-7 w-16 animate-pulse rounded-md bg-surface-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ──
function AdminServersPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [sort, setSort] = useState('name-asc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [suspendTargets, setSuspendTargets] = useState<{ serverIds: string[]; label: string } | null>(
    null,
  );
  const [deleteTargets, setDeleteTargets] = useState<{ serverIds: string[]; label: string } | null>(
    null,
  );
  const [suspendReason, setSuspendReason] = useState('');
  const [updateServerId, setUpdateServerId] = useState<string | null>(null);
  const [deleteServer, setDeleteServer] = useState<{ id: string; name: string } | null>(null);
  const { data, isLoading } = useAdminServers({
    page,
    limit: pageSize,
    status: status || undefined,
    search: search.trim() || undefined,
    owner: ownerSearch.trim() || undefined,
  });
  const { data: nodesData } = useAdminNodes();
  const { data: templates = [] } = useTemplates();

  const servers = data?.servers ?? [];
  const pagination = data?.pagination;
  const nodes = nodesData?.nodes ?? [];

  const statuses = useMemo(
    () => Array.from(new Set(servers.map((server) => server.status))).sort(),
    [servers],
  );

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );

  const sortedTemplates = useMemo(
    () => [...templates].sort((a, b) => a.name.localeCompare(b.name)),
    [templates],
  );

  const hasActiveFilters = status || nodeId || templateId || ownerSearch.trim();

  const clearFilters = () => {
    setStatus('');
    setNodeId('');
    setTemplateId('');
    setOwnerSearch('');
    setPage(1);
  };

  const filteredServers = useMemo(() => {
    let filtered = servers;
    if (status) filtered = filtered.filter((server) => server.status === status);
    if (nodeId) filtered = filtered.filter((server) => server.node.id === nodeId);
    if (templateId) filtered = filtered.filter((server) => server.template.id === templateId);
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'status':
          return a.status.localeCompare(b.status);
        case 'node':
          return a.node.name.localeCompare(b.node.name);
        case 'template':
          return a.template.name.localeCompare(b.template.name);
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [servers, status, nodeId, templateId, sort]);

  const filteredIds = useMemo(() => filteredServers.map((server) => server.id), [filteredServers]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

  const currentServerIds = useMemo(() => new Set(servers.map((s) => s.id)), [servers]);
  const validSelectedIds = useMemo(
    () => selectedIds.filter((id) => currentServerIds.has(id)),
    [selectedIds, currentServerIds],
  );

  if (validSelectedIds.length !== selectedIds.length) {
    setSelectedIds(validSelectedIds);
  }

  const bulkActionMutation = useMutation({
    mutationFn: (payload: { serverIds: string[]; action: AdminServerAction; reason?: string }) =>
      adminApi.bulkServerAction(payload),
    onSuccess: (response, variables) => {
      const successCount =
        response?.summary?.success ??
        response?.results?.filter((result) => result.status === 'success').length ??
        0;
      const failedCount =
        response?.summary?.failed ??
        response?.results?.filter((result) => result.status === 'failed').length ??
        0;
      notifySuccess(
        `Queued ${variables.action} for ${successCount} server${successCount === 1 ? '' : 's'}.`,
      );
      if (failedCount) {
        notifyError(
          `${failedCount} server${failedCount === 1 ? '' : 's'} failed to ${variables.action}.`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ['admin-servers'] });
      setSelectedIds([]);
      setSuspendTargets(null);
      setDeleteTargets(null);
      setSuspendReason('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to run server action';
      notifyError(message);
    },
  });

  const handleBulkAction = (action: AdminServerAction, serverIds: string[], label: string) => {
    if (!serverIds.length) return;
    if (action === 'suspend') {
      setSuspendTargets({ serverIds, label });
      setSuspendReason('');
      return;
    }
    if (action === 'delete') {
      setDeleteTargets({ serverIds, label });
      return;
    }
    bulkActionMutation.mutate({ serverIds, action });
  };

  // ── Status counts for quick filter pills ──
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of servers) {
      counts[s.status] = (counts[s.status] || 0) + 1;
    }
    return counts;
  }, [servers]);

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-violet-500/8 to-cyan-500/8 blur-3xl dark:from-violet-500/15 dark:to-cyan-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-sky-500/8 to-indigo-500/8 blur-3xl dark:from-sky-500/15 dark:to-indigo-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 opacity-20 blur-sm" />
                <Server className="relative h-7 w-7 text-violet-600 dark:text-violet-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                All Servers
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Monitor and manage every server across all nodes
            </p>
          </div>

          {/* Summary stats */}
          <div className="flex flex-wrap gap-2">
            {isLoading ? (
              <>
                <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
                <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
              </>
            ) : (
              <>
                <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                  <span className="h-2 w-2 rounded-full bg-zinc-400" />
                  {data?.pagination?.total ?? 0} total
                </Badge>
                {statusCounts['running'] ? (
                  <Badge variant="success" className="h-8 gap-1.5 px-3 text-xs">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    {statusCounts['running']} running
                  </Badge>
                ) : null}
                {statusCounts['stopped'] ? (
                  <Badge variant="secondary" className="h-8 gap-1.5 px-3 text-xs">
                    <span className="h-2 w-2 rounded-full bg-zinc-400" />
                    {statusCounts['stopped']} stopped
                  </Badge>
                ) : null}
                {statusCounts['suspended'] ? (
                  <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
                    <span className="h-2 w-2 rounded-full bg-rose-400" />
                    {statusCounts['suspended']} suspended
                  </Badge>
                ) : null}
              </>
            )}
          </div>
        </motion.div>

        {/* ── Search & Controls Bar ── */}
        <motion.div
          variants={itemVariants}
          className="flex flex-wrap items-center gap-2.5"
        >
          {/* Search input */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search servers by name or ID…"
              className="pl-9"
            />
          </div>

          {/* Filter toggle */}
          <Button
            variant={hasActiveFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {hasActiveFilters && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                {[status, nodeId, templateId, ownerSearch.trim()].filter(Boolean).length}
              </span>
            )}
          </Button>

          {/* Sort */}
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-40 gap-2 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name A→Z</SelectItem>
              <SelectItem value="name-desc">Name Z→A</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="node">Node</SelectItem>
              <SelectItem value="template">Template</SelectItem>
            </SelectContent>
          </Select>

          {/* Results count */}
          <span className="text-xs text-muted-foreground">
            {filteredServers.length} of {data?.pagination?.total ?? servers.length}
          </span>
        </motion.div>

        {/* ── Expandable Filter Panel ── */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Status</span>
                    <Select
                      value={status || 'all'}
                      onValueChange={(value) => {
                        setStatus(value === 'all' ? '' : value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {statuses.map((entry) => (
                          <SelectItem key={entry} value={entry}>
                            {entry}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Node</span>
                    <Select
                      value={nodeId || 'all'}
                      onValueChange={(value) => {
                        setNodeId(value === 'all' ? '' : value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="All nodes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All nodes</SelectItem>
                        {sortedNodes.map((node) => (
                          <SelectItem key={node.id} value={node.id}>
                            {node.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Template</span>
                    <Select
                      value={templateId || 'all'}
                      onValueChange={(value) => {
                        setTemplateId(value === 'all' ? '' : value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="All templates" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All templates</SelectItem>
                        {sortedTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Owner</span>
                    <Input
                      value={ownerSearch}
                      onChange={(event) => {
                        setOwnerSearch(event.target.value);
                        setPage(1);
                      }}
                      placeholder="Search owners…"
                      className="w-44"
                    />
                  </label>
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-xs">
                      <X className="h-3 w-3" />
                      Clear all
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Bulk Actions Bar ── */}
        <AnimatePresence>
          {selectedIds.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0, y: -8 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 dark:bg-primary/10">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {selectedIds.length} selected
                  </span>
                  <button
                    onClick={() => setSelectedIds([])}
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkAction('start', selectedIds, `${selectedIds.length} servers`)}
                    disabled={bulkActionMutation.isPending}
                    className="gap-1.5 text-xs text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 dark:text-emerald-400 dark:hover:bg-emerald-950/30 dark:hover:border-emerald-800"
                  >
                    <Play className="h-3 w-3" />
                    Start
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkAction('stop', selectedIds, `${selectedIds.length} servers`)}
                    disabled={bulkActionMutation.isPending}
                    className="gap-1.5 text-xs text-amber-600 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200 dark:text-amber-400 dark:hover:bg-amber-950/30 dark:hover:border-amber-800"
                  >
                    <Square className="h-3 w-3" />
                    Stop
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkAction('restart', selectedIds, `${selectedIds.length} servers`)}
                    disabled={bulkActionMutation.isPending}
                    className="gap-1.5 text-xs"
                  >
                    <RotateCw className="h-3 w-3" />
                    Restart
                  </Button>
                  <div className="mx-1 h-4 w-px bg-border" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkAction('suspend', selectedIds, `${selectedIds.length} servers`)}
                    disabled={bulkActionMutation.isPending}
                    className="gap-1.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 dark:text-rose-400 dark:hover:bg-rose-950/30 dark:hover:border-rose-800"
                  >
                    <Ban className="h-3 w-3" />
                    Suspend
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleBulkAction('unsuspend', selectedIds, `${selectedIds.length} servers`)}
                    disabled={bulkActionMutation.isPending}
                    className="gap-1.5 text-xs text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 dark:text-emerald-400 dark:hover:bg-emerald-950/30 dark:hover:border-emerald-800"
                  >
                    <CheckCircle className="h-3 w-3" />
                    Unsuspend
                  </Button>
                  <div className="mx-1 h-4 w-px bg-border" />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleBulkAction('delete', selectedIds, `${selectedIds.length} servers`)}
                    disabled={bulkActionMutation.isPending}
                    className="gap-1.5 text-xs"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Server List ── */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-sm">
            {isLoading ? (
              <div className="p-4">
                <TableSkeleton />
              </div>
            ) : filteredServers.length > 0 ? (
              <>
                {/* Select-all header */}
                <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() =>
                        setSelectedIds((prev) => {
                          if (allSelected) {
                            return prev.filter((id) => !filteredIds.includes(id));
                          }
                          return Array.from(new Set([...prev, ...filteredIds]));
                        })
                      }
                      className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                    />
                    <span className="text-xs font-medium text-muted-foreground">
                      Select all
                    </span>
                  </label>
                </div>

                {/* Server rows */}
                <div className="divide-y divide-border/50">
                  {filteredServers.map((server: AdminServer) => {
                    const isSelected = selectedIds.includes(server.id);
                    const isSuspended = server.status === 'suspended';
                    const isRunning = server.status === 'running';
                    const isStopped = server.status === 'stopped';
                    const isBusy = server.status === 'starting' || server.status === 'stopping';

                    return (
                      <motion.div
                        key={server.id}
                        variants={rowVariants}
                        className={`group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/50 ${
                          isSelected ? 'bg-primary/5' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() =>
                            setSelectedIds((prev) =>
                              prev.includes(server.id)
                                ? prev.filter((id) => id !== server.id)
                                : [...prev, server.id],
                            )
                          }
                          className="h-4 w-4 flex-shrink-0 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                        />

                        {/* Server info — primary column */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2.5">
                            <Link
                              to={`/servers/${server.id}/console`}
                              className="truncate font-semibold text-foreground transition-colors hover:text-primary dark:text-zinc-100 dark:hover:text-primary-400"
                            >
                              {server.name}
                            </Link>
                            <StatusBadge status={server.status} />
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="font-mono text-[11px] opacity-60">{server.id}</span>
                            {server.owner && (
                              <span>
                                {server.owner.username || server.owner.email}
                              </span>
                            )}
                            <span className="hidden sm:inline">
                              {server.node.name}
                            </span>
                            <span className="hidden md:inline">
                              {server.template.name}
                            </span>
                          </div>
                        </div>

                        {/* Quick action buttons — visible on hover or mobile */}
                        <div className="flex items-center gap-1 opacity-100 transition-opacity group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                          {!isSuspended && (
                            <button
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
                              onClick={() => handleBulkAction('start', [server.id], server.name)}
                              disabled={bulkActionMutation.isPending || isRunning || isBusy}
                              title="Start"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {!isSuspended && (
                            <button
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-amber-950/30 dark:hover:text-amber-400"
                              onClick={() => handleBulkAction('stop', [server.id], server.name)}
                              disabled={bulkActionMutation.isPending || isStopped || isBusy}
                              title="Stop"
                            >
                              <Square className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {isSuspended ? (
                            <button
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
                              onClick={() => handleBulkAction('unsuspend', [server.id], server.name)}
                              disabled={bulkActionMutation.isPending}
                              title="Unsuspend"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
                              onClick={() => handleBulkAction('suspend', [server.id], server.name)}
                              disabled={bulkActionMutation.isPending}
                              title="Suspend"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                                title="More"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link to={`/servers/${server.id}/console`} className="gap-2 text-xs">
                                  Console
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleBulkAction('restart', [server.id], server.name)}
                                disabled={bulkActionMutation.isPending || isSuspended}
                                className="gap-2 text-xs"
                              >
                                <RotateCw className="h-3.5 w-3.5" />
                                Restart
                              </DropdownMenuItem>
                              {isSuspended ? (
                                <DropdownMenuItem
                                  onClick={() => handleBulkAction('unsuspend', [server.id], server.name)}
                                  disabled={bulkActionMutation.isPending}
                                  className="gap-2 text-xs text-emerald-600 dark:text-emerald-400"
                                >
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  Unsuspend
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() => handleBulkAction('suspend', [server.id], server.name)}
                                  disabled={bulkActionMutation.isPending}
                                  className="gap-2 text-xs text-rose-600 dark:text-rose-400"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                  Suspend
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setUpdateServerId(server.id)}
                                disabled={bulkActionMutation.isPending}
                                className="gap-2 text-xs"
                              >
                                <Settings className="h-3.5 w-3.5" />
                                Update
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleteServer({ id: server.id, name: server.name })}
                                disabled={bulkActionMutation.isPending}
                                className="gap-2 text-xs text-rose-600 dark:text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 ? (
                  <div className="border-t border-border px-4 py-3">
                    <Pagination
                      page={pagination.page}
                      totalPages={pagination.totalPages}
                      onPageChange={setPage}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="p-6">
                <EmptyState
                  title={search.trim() || hasActiveFilters ? 'No servers found' : 'No servers yet'}
                  description={
                    search.trim() || hasActiveFilters
                      ? 'Try adjusting your search or filters.'
                      : 'Servers will appear here once created.'
                  }
                  action={
                    hasActiveFilters ? (
                      <Button variant="outline" size="sm" onClick={clearFilters}>
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Clear filters
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Suspend Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!suspendTargets}
        title="Suspend Servers"
        message={
          <div className="space-y-3">
            <p>
              You are about to suspend{' '}
              <span className="font-semibold">{suspendTargets?.label}</span>.
            </p>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground dark:text-zinc-300">
                Reason (optional)
              </span>
              <input
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-2 dark:text-zinc-200"
                value={suspendReason}
                onChange={(event) => setSuspendReason(event.target.value)}
                placeholder="e.g., Billing issue"
                onClick={(e) => e.stopPropagation()}
              />
            </label>
          </div>
        }
        confirmText="Suspend"
        cancelText="Cancel"
        onConfirm={() =>
          suspendTargets &&
          bulkActionMutation.mutate({
            serverIds: suspendTargets.serverIds,
            action: 'suspend',
            reason: suspendReason.trim() || undefined,
          })
        }
        onCancel={() => {
          setSuspendTargets(null);
          setSuspendReason('');
        }}
        variant="warning"
        loading={bulkActionMutation.isPending}
      />

      {/* ── Delete Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!deleteTargets}
        title="Delete Servers"
        message={
          <div className="space-y-2">
            <p>
              You are about to delete{' '}
              <span className="font-semibold">{deleteTargets?.label}</span>.
            </p>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              Servers must be stopped before deletion. This cannot be undone.
            </p>
          </div>
        }
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() =>
          deleteTargets &&
          bulkActionMutation.mutate({
            serverIds: deleteTargets.serverIds,
            action: 'delete',
          })
        }
        onCancel={() => setDeleteTargets(null)}
        variant="danger"
        loading={bulkActionMutation.isPending}
      />

      {/* ── Controlled Update Modal ── */}
      {updateServerId && (
        <UpdateServerModal
          serverId={updateServerId}
          open
          onOpenChange={(open) => { if (!open) setUpdateServerId(null); }}
        />
      )}

      {/* ── Controlled Delete Dialog ── */}
      {deleteServer && (
        <DeleteServerDialog
          serverId={deleteServer.id}
          serverName={deleteServer.name}
          open
          onOpenChange={(open) => { if (!open) setDeleteServer(null); }}
        />
      )}
    </motion.div>
  );
}

export default AdminServersPage;
