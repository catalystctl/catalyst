import { useMemo, useState } from 'react';
import EmptyState from '../../components/shared/EmptyState';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import NodeList from '../../components/nodes/NodeList';
import { Skeleton } from '../../components/shared/Skeleton';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
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
      <Card className="rounded-2xl">
        <CardContent className="p-6">
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
            <Badge variant="outline">{nodes.length} nodes detected</Badge>
            <Badge variant="outline">{nodes.filter((node) => node.isOnline).length} online</Badge>
            <Badge variant="outline">{nodes.filter((node) => !node.isOnline).length} offline</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Search</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search nodes"
                className="w-56"
              />
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Showing {nodes.length} node{nodes.length === 1 ? '' : 's'}
            </div>
          </div>
        </CardContent>
      </Card>

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
