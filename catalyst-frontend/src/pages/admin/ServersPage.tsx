import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Play, Square, RotateCw, Ban, CheckCircle, Trash2 } from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import Pagination from '../../components/shared/Pagination';
import { Input } from '../../components/ui/input';
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

function AdminServersPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [ownerSearch, setOwnerSearch] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [sort, setSort] = useState('name-asc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [suspendTargets, setSuspendTargets] = useState<{ serverIds: string[]; label: string } | null>(
    null,
  );
  const [deleteTargets, setDeleteTargets] = useState<{ serverIds: string[]; label: string } | null>(
    null,
  );
  const [suspendReason, setSuspendReason] = useState('');
  const queryClient = useQueryClient();
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

  const filteredServers = useMemo(() => {
    let filtered = servers;
    if (status) {
      filtered = filtered.filter((server) => server.status === status);
    }
    if (nodeId) {
      filtered = filtered.filter((server) => server.node.id === nodeId);
    }
    if (templateId) {
      filtered = filtered.filter((server) => server.template.id === templateId);
    }
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

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => servers.some((server) => server.id === id)));
  }, [servers]);

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

  const getStatusBadgeClass = (serverStatus: string) => {
    if (serverStatus === 'running') {
      return 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
    }
    if (serverStatus === 'stopped') {
      return 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300';
    }
    if (serverStatus === 'suspended') {
      return 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300';
    }
    if (serverStatus === 'starting' || serverStatus === 'stopping') {
      return 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
    }
    return 'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300';
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">All Servers</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Monitor every server across nodes and manage suspensions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {data?.pagination?.total ?? servers.length} total servers
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {statuses.length || 'All'} statuses
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-surface-light dark:border-slate-800 dark:bg-slate-950/60 dark:shadow-surface-dark">
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Search
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search servers"
            className="mt-1 w-56"
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Owner
          <Input
            value={ownerSearch}
            onChange={(event) => {
              setOwnerSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search owners"
            className="mt-1 w-56"
          />
        </label>
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Status
          <Select
            value={status || 'all'}
            onValueChange={(value) => {
              setStatus(value === 'all' ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger className="mt-1 w-44">
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
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Node
          <Select
            value={nodeId || 'all'}
            onValueChange={(value) => {
              setNodeId(value === 'all' ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger className="mt-1 w-44">
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
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Template
          <Select
            value={templateId || 'all'}
            onValueChange={(value) => {
              setTemplateId(value === 'all' ? '' : value);
              setPage(1);
            }}
          >
            <SelectTrigger className="mt-1 w-44">
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
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Sort
          <Select value={sort} onValueChange={(value) => setSort(value)}>
            <SelectTrigger className="mt-1 w-44">
              <SelectValue placeholder="Sort servers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name (A-Z)</SelectItem>
              <SelectItem value="name-desc">Name (Z-A)</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="node">Node</SelectItem>
              <SelectItem value="template">Template</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Showing {filteredServers.length} of {data?.pagination?.total ?? servers.length}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
          <div className="grid grid-cols-12 gap-3 border-b border-slate-200 px-5 py-3 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-500">
            <div className="col-span-1">Select</div>
            <div className="col-span-2">Server</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-2">Node</div>
            <div className="col-span-2">Template</div>
            <div className="col-span-2">Owner</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-12 gap-3 px-5 py-4">
                <div className="col-span-1">
                  <div className="h-4 w-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="col-span-2 space-y-2">
                  <div className="h-4 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-3 w-16 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="col-span-1">
                  <div className="h-5 w-16 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="col-span-2 space-y-2">
                  <div className="h-4 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-3 w-24 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="col-span-2">
                  <div className="h-4 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="col-span-2">
                  <div className="h-4 w-20 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                </div>
                <div className="col-span-2 flex justify-end gap-1">
                  <div className="h-6 w-14 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="h-6 w-14 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : filteredServers.length ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs shadow-surface-light dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 dark:shadow-surface-dark">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
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
                  className="h-4 w-4 rounded border-slate-200 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
                />
                Select all
              </label>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {selectedIds.length} selected
              </span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
                  disabled={!selectedIds.length || bulkActionMutation.isPending}
                >
                  Actions
                  {selectedIds.length > 0 && (
                    <span className="ml-1 rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-bold text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
                      {selectedIds.length}
                    </span>
                  )}
                  <ChevronDown className="ml-1 h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700">
                <DropdownMenuItem
                  onClick={() => handleBulkAction('start', selectedIds, `${selectedIds.length} servers`)}
                  className="text-emerald-600 focus:text-emerald-700 dark:text-emerald-400"
                >
                  <Play className="mr-2 h-4 w-4" />
                  Start
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleBulkAction('stop', selectedIds, `${selectedIds.length} servers`)}
                  className="text-amber-600 focus:text-amber-700 dark:text-amber-400"
                >
                  <Square className="mr-2 h-4 w-4" />
                  Stop
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleBulkAction('restart', selectedIds, `${selectedIds.length} servers`)}
                  className="text-primary-600 focus:text-primary-700 dark:text-primary-400"
                >
                  <RotateCw className="mr-2 h-4 w-4" />
                  Restart
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleBulkAction('suspend', selectedIds, `${selectedIds.length} servers`)}
                  className="text-rose-600 focus:text-rose-700 dark:text-rose-400"
                >
                  <Ban className="mr-2 h-4 w-4" />
                  Suspend
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleBulkAction('unsuspend', selectedIds, `${selectedIds.length} servers`)}
                  className="text-emerald-600 focus:text-emerald-700 dark:text-emerald-400"
                >
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Unsuspend
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => handleBulkAction('delete', selectedIds, `${selectedIds.length} servers`)}
                  className="text-rose-700 focus:text-rose-800 dark:text-rose-500"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
            <div className="grid grid-cols-12 gap-3 border-b border-slate-200 px-5 py-3 text-xs uppercase text-slate-500 dark:border-slate-800 dark:text-slate-500">
              <div className="col-span-1">Select</div>
              <div className="col-span-2">Server</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-2">Node</div>
              <div className="col-span-2">Template</div>
              <div className="col-span-2">Owner</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredServers.map((server: AdminServer) => {
                const isSelected = selectedIds.includes(server.id);
                const isSuspended = server.status === 'suspended';
                const isRunning = server.status === 'running';
                const isStopped = server.status === 'stopped';
                const isStarting = server.status === 'starting';
                const isStopping = server.status === 'stopping';
                const isBusy = isStarting || isStopping;
                return (
                  <div
                    key={server.id}
                    className="grid grid-cols-12 gap-3 px-5 py-4 text-sm text-slate-600 transition-all duration-200 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50"
                  >
                    <div className="col-span-1 flex items-center">
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
                        className="h-4 w-4 rounded border-slate-200 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
                      />
                    </div>
                    <div className="col-span-2">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {server.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{server.id}</div>
                    </div>
                    <div className="col-span-1 flex items-center">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs ${getStatusBadgeClass(server.status)}`}
                      >
                        {server.status}
                      </span>
                    </div>
                    <div className="col-span-2">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {server.node.name}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {server.node.hostname}
                      </div>
                    </div>
                    <div className="col-span-2 flex items-center">
                      <span className="text-slate-900 dark:text-slate-100">{server.template.name}</span>
                    </div>
                    <div className="col-span-2 flex items-center">
                      <span className="text-slate-900 dark:text-slate-100">
                        {server.owner?.username || server.owner?.email || 'Unassigned'}
                      </span>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1">
                      <Link
                        to={`/servers/${server.id}/console`}
                        className="rounded border border-slate-600 px-2 py-0.5 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-slate-500 hover:bg-slate-50 dark:border-slate-400 dark:text-slate-400 dark:hover:bg-slate-800/50"
                      >
                        Console
                      </Link>
                      <button
                        className="rounded border border-emerald-600 px-2 py-0.5 text-xs font-semibold text-emerald-600 transition-all duration-300 hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                        onClick={() => handleBulkAction('start', [server.id], server.name)}
                        disabled={bulkActionMutation.isPending || isSuspended || isRunning || isBusy}
                      >
                        Start
                      </button>
                      <button
                        className="rounded border border-amber-600 px-2 py-0.5 text-xs font-semibold text-amber-600 transition-all duration-300 hover:border-amber-500 hover:bg-amber-50 disabled:opacity-60 dark:text-amber-300 dark:hover:bg-amber-950/50"
                        onClick={() => handleBulkAction('stop', [server.id], server.name)}
                        disabled={bulkActionMutation.isPending || isSuspended || isStopped || isBusy}
                      >
                        Stop
                      </button>
                      {isSuspended ? (
                        <button
                          className="rounded border border-emerald-600 px-2 py-0.5 text-xs font-semibold text-emerald-600 transition-all duration-300 hover:border-emerald-500 hover:bg-emerald-50 disabled:opacity-60 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                          onClick={() => handleBulkAction('unsuspend', [server.id], server.name)}
                          disabled={bulkActionMutation.isPending}
                        >
                          Unsuspend
                        </button>
                      ) : (
                        <button
                          className="rounded border border-rose-600 px-2 py-0.5 text-xs font-semibold text-rose-600 transition-all duration-300 hover:border-rose-500 hover:bg-rose-50 disabled:opacity-60 dark:text-rose-300 dark:hover:bg-rose-950/50"
                          onClick={() => handleBulkAction('suspend', [server.id], server.name)}
                          disabled={bulkActionMutation.isPending}
                        >
                          Suspend
                        </button>
                      )}
                      <UpdateServerModal serverId={server.id} disabled={bulkActionMutation.isPending} />
                      <DeleteServerDialog
                        serverId={server.id}
                        serverName={server.name}
                        disabled={bulkActionMutation.isPending}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            {pagination ? (
              <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-800">
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={setPage}
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <EmptyState
          title={search.trim() ? 'No servers found' : 'No servers'}
          description={
            search.trim()
              ? 'Try a different server name, ID, or node.'
              : 'No servers match the selected status filter.'
          }
        />
      )}

      <ConfirmDialog
        open={!!suspendTargets}
        title="Suspend Servers"
        message={
          <div className="space-y-3">
            <p>
              You are about to suspend <span className="font-semibold">{suspendTargets?.label}</span>.
            </p>
            <label className="block space-y-1">
              <span className="text-sm text-slate-600 dark:text-slate-300">Reason (optional)</span>
              <input
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
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

      <ConfirmDialog
        open={!!deleteTargets}
        title="Delete Servers"
        message={
          <div className="space-y-2">
            <p>
              You are about to delete <span className="font-semibold">{deleteTargets?.label}</span>.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
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
    </div>
  );
}

export default AdminServersPage;
