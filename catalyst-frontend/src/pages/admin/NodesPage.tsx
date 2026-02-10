import { useMemo, useState } from 'react';
import EmptyState from '../../components/shared/EmptyState';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import NodeList from '../../components/nodes/NodeList';
import Input from '../../components/ui/input';
import { useAdminNodes } from '../../hooks/useAdmin';
import { useAuthStore } from '../../stores/authStore';

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

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Nodes</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Track connected infrastructure and node availability.
            </p>
          </div>
          {canWrite ? (
            <NodeCreateModal locationId={locationId} />
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-500">Admin access required</span>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {nodes.length} nodes detected
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {nodes.filter((node) => node.isOnline).length} online
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {nodes.filter((node) => !node.isOnline).length} offline
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-surface-light dark:border-slate-800 dark:bg-slate-950/60 dark:shadow-surface-dark">
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Search
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search nodes"
            className="mt-1 w-56"
          />
        </label>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Showing {nodes.length} node{nodes.length === 1 ? '' : 's'}
        </div>
      </div>
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-4 py-6 text-slate-600 dark:text-slate-200">
          Loading nodes...
        </div>
      ) : nodes.length ? (
        <NodeList nodes={nodes} />
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
