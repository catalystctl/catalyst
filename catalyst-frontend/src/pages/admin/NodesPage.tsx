import { useMemo, useState } from 'react';
import { Server, Cpu, HardDrive, Activity, Search, Plus } from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import { Skeleton } from '../../components/shared/Skeleton';
import { Input } from '@/components/ui/input';
import { useAdminNodes } from '../../hooks/useAdmin';
import { useAuthStore } from '../../stores/authStore';
import NodeCard from '../../components/nodes/NodeCard';

function AdminNodesPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useAdminNodes({ search: search.trim() || undefined });
  const { user } = useAuthStore();
  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );
  const nodes = data?.nodes ?? [];
  const locationId = nodes[0]?.locationId ?? '';

  const onlineNodes = nodes.filter((node) => node.isOnline);
  const offlineNodes = nodes.filter((node) => !node.isOnline);
  const totalServers = nodes.reduce((acc, node) => acc + (node._count?.servers ?? node.servers?.length ?? 0), 0);
  const totalCpu = nodes.reduce((acc, node) => acc + (node.maxCpuCores ?? 0), 0);
  const totalMemory = nodes.reduce((acc, node) => acc + (node.maxMemoryMb ?? 0), 0);

  const formatMemory = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb} MB`;
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50/50 p-6 shadow-surface-light dark:border-slate-800 dark:from-slate-900 dark:to-slate-900/50 dark:shadow-surface-dark">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/30">
                <Server className="h-5 w-5 text-primary-600 dark:text-primary-400" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Nodes</h1>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Manage infrastructure nodes and monitor availability
                </p>
              </div>
            </div>
          </div>
          {canWrite && <NodeCreateModal locationId={locationId} />}
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700/50 dark:bg-slate-800/30">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Online</span>
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {onlineNodes.length}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              of {nodes.length} nodes
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700/50 dark:bg-slate-800/30">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-primary-500" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Servers</span>
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {totalServers}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              across all nodes
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700/50 dark:bg-slate-800/30">
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-amber-500" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">CPU Cores</span>
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {totalCpu}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              total capacity
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white/80 p-4 dark:border-slate-700/50 dark:bg-slate-800/30">
            <div className="flex items-center gap-2">
              <HardDrive className="h-4 w-4 text-violet-500" />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Memory</span>
            </div>
            <div className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {formatMemory(totalMemory)}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              total capacity
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nodes by name or hostname..."
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          {offlineNodes.length > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
              {offlineNodes.length} offline
            </span>
          )}
          <span className="text-xs">
            {nodes.length} node{nodes.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-slate-200 bg-white p-5 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-6 w-32" rounded="sm" />
                    <Skeleton className="h-5 w-16" rounded="full" />
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-24" rounded="full" />
                    <Skeleton className="h-6 w-32" rounded="full" />
                  </div>
                </div>
                <Skeleton className="h-7 w-20" rounded="full" />
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      ) : nodes.length ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {nodes.map((node) => (
            <NodeCard key={node.id} node={node} />
          ))}
        </div>
      ) : (
        <EmptyState
          title={search.trim() ? 'No nodes found' : 'No nodes detected'}
          description={
            search.trim()
              ? 'Try a different node name or hostname.'
              : 'Install the Catalyst agent and register nodes to begin.'
          }
          action={canWrite ? <NodeCreateModal locationId={locationId} /> : null}
        />
      )}
    </div>
  );
}

export default AdminNodesPage;
