import { useMemo } from 'react';
import NodeList from '../../components/nodes/NodeList';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import EmptyState from '../../components/shared/EmptyState';
import { useNodes } from '../../hooks/useNodes';
import { useAuthStore } from '../../stores/authStore';

type Props = {
  hideHeader?: boolean;
};

function NodesPage({ hideHeader }: Props) {
  const { data: nodes = [], isLoading } = useNodes();
  const { user } = useAuthStore();
  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  const locationId = nodes[0]?.locationId ?? '';

  return (
    <div className={hideHeader ? '' : 'space-y-6'}>
      {!hideHeader ? (
        <div className="rounded-2xl border border-border bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1/70 dark:shadow-surface-dark dark:hover:border-primary/30">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-foreground dark:text-white">Nodes</h1>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                Track connected infrastructure nodes.
              </p>
            </div>
            {canWrite ? (
              <NodeCreateModal locationId={locationId} />
            ) : (
              <span className="text-xs text-muted-foreground dark:text-muted-foreground dark:text-muted-foreground">
                Admin access required
              </span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground dark:text-muted-foreground">
            <span className="rounded-full border border-border bg-surface-2 px-3 py-1 dark:border-border dark:bg-zinc-950/60">
              {nodes.length} nodes detected
            </span>
            <span className="rounded-full border border-border bg-surface-2 px-3 py-1 dark:border-border dark:bg-zinc-950/60">
              {nodes.filter((node) => node.isOnline).length} online
            </span>
            <span className="rounded-full border border-border bg-surface-2 px-3 py-1 dark:border-border dark:bg-zinc-950/60">
              {nodes.filter((node) => !node.isOnline).length} offline
            </span>
          </div>
        </div>
      ) : null}
      {isLoading ? (
        <div className="rounded-xl border border-border bg-white px-4 py-6 text-muted-foreground shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-300 dark:hover:border-primary/30">
          Loading nodes...
        </div>
      ) : nodes.length ? (
        <NodeList nodes={nodes} />
      ) : (
        <EmptyState
          title="No nodes detected"
          description="Install the Catalyst agent and register nodes to begin."
          action={canWrite ? <NodeCreateModal locationId={locationId} /> : null}
        />
      )}
    </div>
  );
}

export default NodesPage;
