import { Link } from 'react-router-dom';
import { useAdminStats, useAdminHealth } from '../../hooks/useAdmin';
import { useAdminNodes, useAdminServers } from '../../hooks/useAdmin';
import { useClusterMetrics } from '../../hooks/useClusterMetrics';
import { ClusterResourcesChart } from '../../components/admin/ClusterResourcesChart';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { motion, type Variants } from 'framer-motion';
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
  Play,
  Square,
  Plus,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
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

// ── Helpers ──
function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString();
}

function AdminDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useAdminStats();
  const { data: health, isLoading: healthLoading } = useAdminHealth();
  const { data: nodesData } = useAdminNodes();
  const { data: serversData } = useAdminServers({ limit: 100 });
  const { data: clusterMetrics, isLoading: metricsLoading } = useClusterMetrics(5000);

  const nodes = nodesData?.nodes ?? [];
  const servers = serversData?.servers ?? [];
  const onlineNodes = nodes.filter((n) => n.isOnline).length;
  const offlineNodes = nodes.length - onlineNodes;
  const runningServers = servers.filter((s) => s.status === 'running').length;
  const stoppedServers = servers.filter((s) => s.status === 'stopped').length;

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative overflow-hidden"
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
                <Activity className="relative h-7 w-7 text-violet-600 dark:text-violet-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground ">
                Admin Dashboard
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Platform overview, health, and resource monitoring
            </p>
          </div>

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
        </motion.div>

        {/* ── Stats Row ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap gap-2">
          {statsLoading ? (
            <>
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
              <Skeleton className="h-8 w-24 rounded-lg" />
            </>
          ) : (
            <>
              <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                <Users className="h-3 w-3 text-muted-foreground" />
                {stats?.users ?? 0} users
              </Badge>
              <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                <Server className="h-3 w-3 text-muted-foreground" />
                {stats?.servers ?? 0} servers
              </Badge>
              <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                <HardDrive className="h-3 w-3 text-muted-foreground" />
                {stats?.nodes ?? 0} nodes
              </Badge>
              {runningServers > 0 ? (
                <Badge variant="success" className="h-8 gap-1.5 px-3 text-xs">
                  <Play className="h-3 w-3" />
                  {runningServers} running
                </Badge>
              ) : null}
              {stoppedServers > 0 ? (
                <Badge variant="secondary" className="h-8 gap-1.5 px-3 text-xs">
                  <Square className="h-3 w-3" />
                  {stoppedServers} stopped
                </Badge>
              ) : null}
              {onlineNodes > 0 ? (
                <Badge variant="success" className="h-8 gap-1.5 px-3 text-xs">
                  <CheckCircle className="h-3 w-3" />
                  {onlineNodes} online
                </Badge>
              ) : null}
              {offlineNodes > 0 ? (
                <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
                  <XCircle className="h-3 w-3" />
                  {offlineNodes} offline
                </Badge>
              ) : null}
            </>
          )}
        </motion.div>

        {/* ── Charts & Health ── */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ClusterResourcesChart data={clusterMetrics} isLoading={metricsLoading} />
          </div>

          <Card className="border-border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">System Health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
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
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span>Last checked</span>
                  <span className="tabular-nums">{new Date().toLocaleTimeString()}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* ── Nodes ── */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold">Recent Activity</CardTitle>
              <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
                <Link to="/admin/audit-logs">
                  View all <ArrowUpRight className="h-3 w-3" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {(() => {
                // Inline activity display — simple list
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
                  <div className="divide-y divide-border">
                    {recentActions.map((action, i) => (
                      <div key={i} className="flex items-center gap-3 px-6 py-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
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
            </CardContent>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-sm font-semibold">Cluster Nodes</CardTitle>
              <Button variant="ghost" size="sm" asChild className="gap-1 text-xs">
                <Link to="/admin/nodes">
                  Manage <ArrowUpRight className="h-3 w-3" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-1.5">
              {nodes.length === 0 ? (
                <div className="py-8 text-center">
                  <HardDrive className="mx-auto h-8 w-8 text-muted-foreground/40" />
                  <p className="mt-3 text-sm text-muted-foreground">No nodes configured</p>
                  <Button variant="outline" size="sm" className="mt-3" asChild>
                    <Link to="/admin/nodes">Add Node</Link>
                  </Button>
                </div>
              ) : (
                nodes.slice(0, 6).map((node) => (
                  <Link
                    key={node.id}
                    to={`/admin/nodes/${node.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 transition-colors hover:bg-muted/50"
                  >
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
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {node._count?.servers ?? 0} servers
                    </Badge>
                  </Link>
                ))
              )}
              {nodes.length > 6 && (
                <Link
                  to="/admin/nodes"
                  className="block rounded-lg border border-dashed border-border py-2.5 text-center text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                >
                  +{nodes.length - 6} more node{nodes.length - 6 > 1 ? 's' : ''}
                </Link>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5">
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
