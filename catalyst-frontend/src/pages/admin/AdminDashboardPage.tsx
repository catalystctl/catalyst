import { Link } from 'react-router-dom';
import { useAdminStats, useAdminHealth } from '../../hooks/useAdmin';
import { useAdminNodes } from '../../hooks/useAdmin';

import { useClusterMetrics } from '../../hooks/useClusterMetrics';
import { ClusterResourcesChart } from '../../components/admin/ClusterResourcesChart';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Server, HardDrive, Activity, ArrowUpRight, Database } from 'lucide-react';

function AdminDashboardPage() {
  const { data: stats } = useAdminStats();
  const { data: health, isLoading: healthLoading } = useAdminHealth();
  const { data: nodesData } = useAdminNodes();
  const { data: clusterMetrics, isLoading: metricsLoading } = useClusterMetrics(60_000);

  const nodes = nodesData?.nodes ?? [];
  const onlineNodes = nodes.filter((n) => n.isOnline).length;
  const offlineNodes = nodes.length - onlineNodes;



 return (
 <div className="space-y-5">
 {/* ── Header ── */}
    <TabHeader
      icon={Activity}
      title="Admin"
      description={`${stats?.servers ?? 0} servers · ${stats?.nodes ?? 0} nodes · ${stats?.users ?? 0} users`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/nodes">Nodes</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link to="/admin/system">Settings</Link>
          </Button>
        </div>
      }
    />


 {/* ── Charts & Health ── */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
 <div className="lg:col-span-2">
 <ClusterResourcesChart data={clusterMetrics} isLoading={metricsLoading} />
 </div>

 <ServerTabCard className="lg:col-span-1">
 <SectionHeader icon={Activity} title="System Health" />
 <div className="mt-3 space-y-2">
 <HealthRow
 label="Database"
 status={health?.database === 'connected'}
 loading={healthLoading}
 icon={Database}
 />
 <HealthRow
 label="Cluster Nodes"
 status={onlineNodes > 0 && offlineNodes === 0}
 loading={healthLoading}
 detail={`${onlineNodes}/${nodes.length}`}
 icon={Server}
 />
 {!healthLoading && (
 <div className="flex items-center justify-between rounded-lg border border-border/30 bg-surface-2/20 px-3 py-2 text-xs text-muted-foreground">
 <span>Last checked</span>
 <span className="tabular-nums">{new Date().toLocaleTimeString()}</span>
 </div>
 )}
 </div>
 </ServerTabCard>
 </div>

      <ServerTabCard>
        <div className="flex items-center justify-between pb-3">
          <SectionHeader icon={HardDrive} title="Nodes" />
          <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
            <Link to="/admin/nodes">
              Manage <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
        <div className="space-y-1.5">
          {nodes.length === 0 ? (
            <TabEmptyState
              title="No nodes"
              description="Add a node to deploy servers."
              action={
                <Button variant="outline" size="sm" asChild>
                  <Link to="/admin/nodes">Add node</Link>
                </Button>
              }
            />
          ) : (
            nodes.slice(0, 8).map((node) => (
              <Link
                key={node.id}
                to={`/admin/nodes/${node.id}`}
                className="flex items-center justify-between gap-3 rounded-md px-2 py-2 hover:bg-surface-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={cn('h-2 w-2 shrink-0 rounded-full', node.isOnline ? 'bg-success' : 'bg-danger')} />
                  <span className="truncate text-sm font-medium text-foreground">{node.name}</span>
                </div>
                <span className="type-meta">{node._count?.servers ?? 0} servers</span>
              </Link>
            ))
          )}
        </div>
      </ServerTabCard>

 </div>
 );
}

// ── Health Row ──
function HealthRow({
  label,
  status,
  loading,
  detail,
  icon: Icon,
}: {
  label: string;
  status: boolean;
  loading?: boolean;
  detail?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex items-center gap-2.5">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-foreground">{label}</span>
      </div>
      {loading ? (
        <span className="type-meta">Checking…</span>
      ) : (
        <span className={`text-xs ${status ? 'text-success' : 'text-danger'}`}>
          {detail ?? (status ? 'OK' : 'Down')}
        </span>
      )}
    </div>
  );
}


export default AdminDashboardPage;
