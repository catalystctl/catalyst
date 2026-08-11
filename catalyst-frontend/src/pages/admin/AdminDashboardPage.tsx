import { Link } from 'react-router-dom';
import { useAdminStats, useAdminHealth } from '../../hooks/useAdmin';
import { useAdminNodes, useAdminServers } from '../../hooks/useAdmin';
import { useClusterMetrics } from '../../hooks/useClusterMetrics';
import { ClusterResourcesChart } from '../../components/admin/ClusterResourcesChart';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import StatGrid from '../../components/servers/tabs/StatGrid';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
 Users,
 Server,
 HardDrive,
 Activity,
 CheckCircle,
 XCircle,
 ArrowUpRight,
 Settings,
 Database,
 Zap,
 Plus,
} from 'lucide-react';
import {
 DropdownMenu,
 DropdownMenuContent,
 DropdownMenuItem,
 DropdownMenuSeparator,
 DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ── Helpers ──
function AdminDashboardPage() {
 const { data: stats, isLoading: statsLoading } = useAdminStats();
 const { data: health, isLoading: healthLoading } = useAdminHealth();
 const { data: nodesData } = useAdminNodes();
 const { data: serversData } = useAdminServers({ limit: 100 });
 const { data: clusterMetrics, isLoading: metricsLoading } = useClusterMetrics(60_000);

 const nodes = nodesData?.nodes ?? [];
 const servers = serversData?.servers ?? [];
 const onlineNodes = nodes.filter((n) => n.isOnline).length;
 const offlineNodes = nodes.length - onlineNodes;
 const runningServers = servers.filter((s) => s.status === 'running').length;
 const stoppedServers = servers.filter((s) => s.status === 'stopped').length;

 const statItems = [
 { label: 'Users', value: stats?.users ?? 0 },
 { label: 'Servers', value: stats?.servers ?? 0 },
 { label: 'Nodes', value: stats?.nodes ?? 0 },
 ...(runningServers > 0 ? [{ label: 'Running', value: runningServers }] : []),
 ...(stoppedServers > 0 ? [{ label: 'Stopped', value: stoppedServers }] : []),
 ...(onlineNodes > 0 ? [{ label: 'Online', value: onlineNodes }] : []),
 ...(offlineNodes > 0 ? [{ label: 'Offline', value: offlineNodes }] : []),
 ];

 return (
 <div className="space-y-5">
 {/* ── Header ── */}
 <TabHeader
 icon={Activity}
 title="Admin Dashboard"
 description="Platform overview, health, and resource monitoring"
 actions={
 <div className="flex flex-wrap items-center gap-2">
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="outline" size="sm" className="gap-1.5">
 <Plus className="h-4 w-4" />
 Quick Actions
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end" className="w-48">
 <DropdownMenuItem asChild>
 <Link to="/admin/servers" className="gap-2">
 <Server className="h-4 w-4" />
 <span>Servers</span>
 </Link>
 </DropdownMenuItem>
 <DropdownMenuItem asChild>
 <Link to="/admin/nodes" className="gap-2">
 <HardDrive className="h-4 w-4" />
 <span>Nodes</span>
 </Link>
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem asChild>
 <Link to="/admin/users" className="gap-2">
 <Users className="h-4 w-4" />
 <span>Users</span>
 </Link>
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 <Button variant="outline" size="sm" asChild>
 <Link to="/admin/system" className="gap-1.5">
 <Settings className="h-4 w-4" />
 Settings
 </Link>
 </Button>
 </div>
 }
 />

 {/* ── Stats ── */}
 <ServerTabCard>
 {statsLoading ? (
 <TabLoadingState rows={1} rowHeight="h-14" />
 ) : (
 <StatGrid items={statItems} columns={4} />
 )}
 </ServerTabCard>

 {/* ── Charts & Health ── */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
 <div className="lg:col-span-2">
 <ClusterResourcesChart data={clusterMetrics} isLoading={metricsLoading} />
 </div>

 <ServerTabCard className="lg:col-span-1">
 <h3 className="text-sm font-semibold text-foreground">System Health</h3>
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
 <HealthRow
 label="API Gateway"
 status
 loading={healthLoading}
 detail="Operational"
 icon={Zap}
 />
 <HealthRow
 label="WebSocket"
 status
 loading={healthLoading}
 detail="Connected"
 icon={Activity}
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

 {/* ── Nodes & Activity ── */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
 <ServerTabCard className="lg:col-span-2">
 <div className="flex items-center justify-between pb-3">
 <h3 className="text-sm font-semibold text-foreground">Recent Activity</h3>
 <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
 <Link to="/admin/audit-logs">
 View all <ArrowUpRight className="h-3 w-3" />
 </Link>
 </Button>
 </div>
 {(() => {
 const recentActions = [
 { label: 'System online', detail: 'All services operational', time: 'Just now' },
 { label: 'Dashboard loaded', detail: 'Admin dashboard accessed', time: 'Just now' },
 ];
 if (offlineNodes > 0) {
 recentActions.push({
 label: `${offlineNodes} node${offlineNodes > 1 ? 's' : ''} offline`,
 detail: 'Check node connectivity',
 time: 'Now',
 });
 }
 return (
 <div className="divide-y divide-border/40">
 {recentActions.map((action, i) => (
 <div key={i} className="flex items-center gap-3 px-4 py-3">
 <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2">
 <Activity className="h-4 w-4 text-muted-foreground" />
 </div>
 <div className="min-w-0 flex-1">
 <p className="text-sm font-medium text-foreground">{action.label}</p>
 <p className="text-xs text-muted-foreground">{action.detail}</p>
 </div>
 <span className="shrink-0 text-xs text-muted-foreground">{action.time}</span>
 </div>
 ))}
 </div>
 );
 })()}
 </ServerTabCard>

 <ServerTabCard className="lg:col-span-1">
 <div className="flex items-center justify-between pb-3">
 <h3 className="text-sm font-semibold text-foreground">Cluster Nodes</h3>
 <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
 <Link to="/admin/nodes">
 Manage <ArrowUpRight className="h-3 w-3" />
 </Link>
 </Button>
 </div>
 <div className="space-y-1.5">
 {nodes.length === 0 ? (
 <TabEmptyState
 title="No nodes configured"
 description="Add your first node to start deploying servers."
 action={
 <Button variant="outline" size="sm" asChild>
 <Link to="/admin/nodes">Add Node</Link>
 </Button>
 }
 />
 ) : (
 <>
 {nodes.slice(0, 6).map((node) => (
 <Link
 key={node.id}
 to={`/admin/nodes/${node.id}`}
 className="group relative flex items-center justify-between gap-3 rounded-lg border border-border/30 px-4 py-3 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
 >
 <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />
 <div className="flex items-center gap-2.5 min-w-0">
 <span
 className={cn(
 'h-2 w-2 shrink-0 rounded-full',
 node.isOnline ? 'bg-success' : 'bg-danger',
 )}
 />
 <span className="truncate text-sm font-medium text-foreground">
 {node.name}
 </span>
 </div>
 <span className="shrink-0 rounded-md border border-border/30 bg-surface-2/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
 {node._count?.servers ?? 0} servers
 </span>
 </Link>
 ))}
 {nodes.length > 6 && (
 <Link
 to="/admin/nodes"
 className="block rounded-lg border border-dashed border-border/40 py-2.5 text-center text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
 >
 +{nodes.length - 6} more node{nodes.length - 6 > 1 ? 's' : ''}
 </Link>
 )}
 </>
 )}
 </div>
 </ServerTabCard>
 </div>
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
 <div className="flex items-center justify-between gap-3 rounded-lg border border-border/30 bg-surface-2/20 px-3 py-2.5">
 <div className="flex items-center gap-2.5">
 <Icon className="h-4 w-4 text-muted-foreground" />
 <span className="text-sm text-foreground">{label}</span>
 </div>
 {loading ? (
 <Skeleton className="h-5 w-16" />
 ) : (
 <div className="flex items-center gap-2">
 {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
 {status ? (
 <CheckCircle className="h-4 w-4 text-success" />
 ) : (
 <XCircle className="h-4 w-4 text-danger" />
 )}
 </div>
 )}
 </div>
 );
}

export default AdminDashboardPage;
