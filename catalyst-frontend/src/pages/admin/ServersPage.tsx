import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import EmptyState from '../../components/shared/EmptyState';
import Input from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-4 py-6 text-slate-600 dark:text-slate-200">
          Loading servers...
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
            <div className="flex flex-wrap gap-2">
              <button
                className="rounded-md border border-emerald-600 px-3 py-1 font-semibold text-emerald-600 transition-all duration-300 hover:border-emerald-500 disabled:opacity-60 dark:text-emerald-300"
                onClick={() => handleBulkAction('start', selectedIds, `${selectedIds.length} servers`)}
                disabled={!selectedIds.length || bulkActionMutation.isPending}
              >
                Start
              </button>
              <button
                className="rounded-md border border-amber-600 px-3 py-1 font-semibold text-amber-600 transition-all duration-300 hover:border-amber-500 disabled:opacity-60 dark:text-amber-300"
                onClick={() => handleBulkAction('stop', selectedIds, `${selectedIds.length} servers`)}
                disabled={!selectedIds.length || bulkActionMutation.isPending}
              >
                Stop
              </button>
              <button
                className="rounded-md border border-primary-600 px-3 py-1 font-semibold text-primary-600 transition-all duration-300 hover:border-primary-500 disabled:opacity-60 dark:text-primary-300"
                onClick={() =>
                  handleBulkAction('restart', selectedIds, `${selectedIds.length} servers`)
                }
                disabled={!selectedIds.length || bulkActionMutation.isPending}
              >
                Restart
              </button>
              <button
                className="rounded-md border border-rose-600 px-3 py-1 font-semibold text-rose-600 transition-all duration-300 hover:border-rose-500 disabled:opacity-60 dark:text-rose-300"
                onClick={() =>
                  handleBulkAction('suspend', selectedIds, `${selectedIds.length} servers`)
                }
                disabled={!selectedIds.length || bulkActionMutation.isPending}
              >
                Suspend
              </button>
              <button
                className="rounded-md border border-emerald-600 px-3 py-1 font-semibold text-emerald-600 transition-all duration-300 hover:border-emerald-500 disabled:opacity-60 dark:text-emerald-300"
                onClick={() =>
                  handleBulkAction('unsuspend', selectedIds, `${selectedIds.length} servers`)
                }
                disabled={!selectedIds.length || bulkActionMutation.isPending}
              >
                Unsuspend
              </button>
              <button
                className="rounded-md border border-rose-700 px-3 py-1 font-semibold text-rose-700 transition-all duration-300 hover:border-rose-500 disabled:opacity-60 dark:text-rose-300"
                onClick={() => handleBulkAction('delete', selectedIds, `${selectedIds.length} servers`)}
                disabled={!selectedIds.length || bulkActionMutation.isPending}
              >
                Delete
              </button>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
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
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-surface-light transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/60 dark:shadow-surface-dark dark:hover:border-primary-500/30"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <label className="pt-1">
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
                      </label>
                      <div>
                        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          {server.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-500">{server.id}</div>
                      </div>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                      {server.status}
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                        Node
                      </div>
                      <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                        {server.node.name}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-500">
                        {server.node.hostname}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                        Template
                      </div>
                      <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                        {server.template.name}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                        Owner
                      </div>
                      <div className="mt-1 font-semibold text-slate-900 dark:text-slate-100">
                        {server.owner?.username || server.owner?.email || 'Unassigned'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-end gap-2 text-xs">
                    <button
                      className="rounded-md border border-emerald-600 px-3 py-1 font-semibold text-emerald-600 transition-all duration-300 hover:border-emerald-500 disabled:opacity-60 dark:text-emerald-300"
                      onClick={() => handleBulkAction('start', [server.id], server.name)}
                      disabled={bulkActionMutation.isPending || isSuspended || isRunning || isBusy}
                    >
                      Start
                    </button>
                    <button
                      className="rounded-md border border-amber-600 px-3 py-1 font-semibold text-amber-600 transition-all duration-300 hover:border-amber-500 disabled:opacity-60 dark:text-amber-300"
                      onClick={() => handleBulkAction('stop', [server.id], server.name)}
                      disabled={bulkActionMutation.isPending || isSuspended || isStopped || isBusy}
                    >
                      Stop
                    </button>
                    <button
                      className="rounded-md border border-primary-600 px-3 py-1 font-semibold text-primary-600 transition-all duration-300 hover:border-primary-500 disabled:opacity-60 dark:text-primary-300"
                      onClick={() => handleBulkAction('restart', [server.id], server.name)}
                      disabled={bulkActionMutation.isPending || isSuspended || isStopped || isBusy}
                    >
                      Restart
                    </button>
                    {isSuspended ? (
                      <button
                        className="rounded-md border border-emerald-600 px-3 py-1 font-semibold text-emerald-600 transition-all duration-300 hover:border-emerald-500 disabled:opacity-60 dark:text-emerald-300"
                        onClick={() => handleBulkAction('unsuspend', [server.id], server.name)}
                        disabled={bulkActionMutation.isPending}
                      >
                        Unsuspend
                      </button>
                    ) : (
                      <button
                        className="rounded-md border border-rose-700 px-3 py-1 font-semibold text-rose-600 transition-all duration-300 hover:border-rose-500 disabled:opacity-60 dark:text-rose-300"
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
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-surface-light dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400 dark:shadow-surface-dark">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-200 disabled:opacity-50"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <button
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-200 disabled:opacity-50"
                  onClick={() =>
                    setPage((prev) => (pagination.page < pagination.totalPages ? prev + 1 : prev))
                  }
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
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
      {suspendTargets ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Suspend server</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setSuspendTargets(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-900 dark:text-slate-100">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Server: {suspendTargets.label}
              </div>
              <label className="block space-y-1">
                <span className="text-slate-600 dark:text-slate-300">Reason (optional)</span>
                <input
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                  value={suspendReason}
                  onChange={(event) => setSuspendReason(event.target.value)}
                  placeholder="e.g., Billing issue"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setSuspendTargets(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-rose-600 px-4 py-2 font-semibold text-white shadow-lg shadow-rose-500/20 transition-all duration-300 hover:bg-rose-500 disabled:opacity-60"
                onClick={() =>
                  bulkActionMutation.mutate({
                    serverIds: suspendTargets.serverIds,
                    action: 'suspend',
                    reason: suspendReason.trim() || undefined,
                  })
                }
                disabled={bulkActionMutation.isPending}
              >
                Suspend
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deleteTargets ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Delete servers</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setDeleteTargets(null)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <div>
                You are about to delete <span className="font-semibold">{deleteTargets.label}</span>.
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Servers must be stopped before deletion. This cannot be undone.
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setDeleteTargets(null)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-rose-700 px-4 py-2 font-semibold text-white shadow-lg shadow-rose-500/20 transition-all duration-300 hover:bg-rose-600 disabled:opacity-60"
                onClick={() =>
                  bulkActionMutation.mutate({
                    serverIds: deleteTargets.serverIds,
                    action: 'delete',
                  })
                }
                disabled={bulkActionMutation.isPending}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AdminServersPage;
