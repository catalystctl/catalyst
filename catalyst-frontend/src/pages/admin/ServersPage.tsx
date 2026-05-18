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
import TabHeader from '../../components/servers/tabs/TabHeader';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
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

// ── Status Config ──
function getStatusConfig(serverStatus: string) {
  switch (serverStatus) {
    case 'running':
      return {
        variant: 'success' as const,
        dot: 'bg-success/50',
        label: 'Running',
      };
    case 'stopped':
      return {
        variant: 'secondary' as const,
        dot: 'bg-surface-3',
        label: 'Stopped',
      };
    case 'suspended':
      return {
        variant: 'destructive' as const,
        dot: 'bg-destructive/50',
        label: 'Suspended',
      };
    case 'starting':
    case 'stopping':
      return {
        variant: 'warning' as const,
        dot: 'bg-warning/50',
        label: serverStatus === 'starting' ? 'Starting' : 'Stopping',
      };
    default:
      return {
        variant: 'secondary' as const,
        dot: 'bg-surface-3',
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
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${config.dot}`} />
      </span>
      {config.label}
    </Badge>
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
    <div className="space-y-5">
      <TabHeader
        icon={Server}
        title="All Servers"
        description="Monitor and manage every server across all nodes"
        actions={
          <div className="flex flex-wrap gap-2">
            {isLoading ? (
              <>
                <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
                <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
              </>
            ) : (
              <>
                <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                  <span className="h-2 w-2 rounded-full bg-surface-3" />
                  {data?.pagination?.total ?? 0} total
                </Badge>
                {statusCounts['running'] ? (
                  <Badge variant="success" className="h-8 gap-1.5 px-3 text-xs">
                    <span className="h-2 w-2 rounded-full bg-success" />
                    {statusCounts['running']} running
                  </Badge>
                ) : null}
                {statusCounts['stopped'] ? (
                  <Badge variant="secondary" className="h-8 gap-1.5 px-3 text-xs">
                    <span className="h-2 w-2 rounded-full bg-surface-3" />
                    {statusCounts['stopped']} stopped
                  </Badge>
                ) : null}
                {statusCounts['suspended'] ? (
                  <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
                    <span className="h-2 w-2 rounded-full bg-destructive/60" />
                    {statusCounts['suspended']} suspended
                  </Badge>
                ) : null}
              </>
            )}
          </div>
        }
        variant="default"
      />

      {/* ── Search & Controls Bar ── */}
      <div className="flex flex-wrap items-center gap-2.5">
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
            className="border-border/40 pl-9"
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
          <SelectTrigger className="w-40 gap-2 border-border/40 text-xs">
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
      </div>

      {/* ── Expandable Filter Panel ── */}
      {showFilters && (
        <div className="overflow-hidden">
          <div className="rounded-xl border border-border/30 bg-card/80 p-4">
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
                  <SelectTrigger className="w-44 border-border/40">
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
                  <SelectTrigger className="w-44 border-border/40">
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
                  <SelectTrigger className="w-44 border-border/40">
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
                  className="w-44 border-border/40"
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
        </div>
      )}

      {/* ── Bulk Actions Bar ── */}
      {selectedIds.length > 0 && (
        <div className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
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
                className="gap-1.5 text-xs text-success hover:border-success/20 hover:bg-success/5 hover:text-success"
              >
                <Play className="h-3 w-3" />
                Start
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkAction('stop', selectedIds, `${selectedIds.length} servers`)}
                disabled={bulkActionMutation.isPending}
                className="gap-1.5 text-xs text-warning hover:border-warning/20 hover:bg-warning/5 hover:text-warning"
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
                className="gap-1.5 text-xs text-destructive hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
              >
                <Ban className="h-3 w-3" />
                Suspend
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkAction('unsuspend', selectedIds, `${selectedIds.length} servers`)}
                disabled={bulkActionMutation.isPending}
                className="gap-1.5 text-xs text-success hover:border-success/20 hover:bg-success/5 hover:text-success"
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
        </div>
      )}

      {/* ── Server List ── */}
      <div className="rounded-xl border border-border/30 bg-card/80 shadow-sm">
        {isLoading ? (
          <div className="p-4">
            <TabLoadingState rows={6} />
          </div>
        ) : filteredServers.length > 0 ? (
          <>
            {/* Select-all header */}
            <div className="flex items-center gap-3 border-b border-border/30 px-4 py-2">
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
                  className="h-4 w-4 rounded border-border/40 bg-card text-primary"
                />
                <span className="text-xs font-medium text-muted-foreground">
                  Select all
                </span>
              </label>
            </div>

            {/* Server rows */}
            <div className="divide-y divide-border/30">
              {filteredServers.map((server: AdminServer) => {
                const isSelected = selectedIds.includes(server.id);
                const isSuspended = server.status === 'suspended';
                const isRunning = server.status === 'running';
                const isStopped = server.status === 'stopped';
                const isBusy = server.status === 'starting' || server.status === 'stopping';

                return (
                  <div
                    key={server.id}
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
                      className="h-4 w-4 flex-shrink-0 rounded border-border/40 bg-card text-primary"
                    />

                    {/* Server info — primary column */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2.5">
                        <Link
                          to={`/servers/${server.id}/console`}
                          className="truncate font-semibold text-foreground transition-colors hover:text-primary"
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
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-success/5 hover:text-success disabled:pointer-events-none disabled:opacity-30"
                          onClick={() => handleBulkAction('start', [server.id], server.name)}
                          disabled={bulkActionMutation.isPending || isRunning || isBusy}
                          title="Start"
                        >
                          <Play className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {!isSuspended && (
                        <button
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-warning/5 hover:text-warning disabled:pointer-events-none disabled:opacity-30"
                          onClick={() => handleBulkAction('stop', [server.id], server.name)}
                          disabled={bulkActionMutation.isPending || isStopped || isBusy}
                          title="Stop"
                        >
                          <Square className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {isSuspended ? (
                        <button
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-success/5 hover:text-success disabled:pointer-events-none disabled:opacity-30"
                          onClick={() => handleBulkAction('unsuspend', [server.id], server.name)}
                          disabled={bulkActionMutation.isPending}
                          title="Unsuspend"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
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
                              className="gap-2 text-xs text-success"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                              Unsuspend
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onClick={() => handleBulkAction('suspend', [server.id], server.name)}
                              disabled={bulkActionMutation.isPending}
                              className="gap-2 text-xs text-destructive"
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
                            className="gap-2 text-xs text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {pagination && pagination.totalPages > 1 ? (
              <div className="border-t border-border/30 px-4 py-3">
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
            <TabEmptyState
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
              <span className="text-sm text-muted-foreground">
                Reason (optional)
              </span>
              <input
                className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
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
            <p className="text-xs text-muted-foreground">
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
    </div>
  );
}

export default AdminServersPage;
