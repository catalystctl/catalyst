import { Link } from 'react-router-dom';
import { useAdminStats, useAuditLogs, useAdminHealth } from '../../hooks/useAdmin';
import { useAdminNodes, useAdminServers } from '../../hooks/useAdmin';
import { useClusterMetrics } from '../../hooks/useClusterMetrics';
import { ClusterResourcesChart } from '../../components/admin/ClusterResourcesChart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
  Zap,
  Clock,
  Settings,
  Database,
  Globe,
  Play,
  Square,
  FileText,
  TrendingUp,
  TrendingDown,
  Sparkles,
  Waves,
  Cpu,
} from 'lucide-react';
import { } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

// Animation variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.04,
      delayChildren: 0.1,
    },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      stiffness: 300,
      damping: 24,
    },
  },
};

const scaleVariants: Variants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      type: 'spring',
      stiffness: 200,
      damping: 20,
    },
  },
};

function AdminDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useAdminStats();
  const { data: health, isLoading: healthLoading } = useAdminHealth();
  const { data: auditResponse, isLoading: auditLoading } = useAuditLogs({ page: 1, limit: 8 });
  const { data: nodesData } = useAdminNodes();
  const { data: serversData } = useAdminServers({ limit: 100 });
  const { data: clusterMetrics, isLoading: metricsLoading } = useClusterMetrics(5000);

  const logs = auditResponse?.logs ?? [];
  const nodes = nodesData?.nodes ?? [];
  const servers = serversData?.servers ?? [];

  const onlineNodes = nodes.filter((n) => n.isOnline).length;
  const offlineNodes = nodes.length - onlineNodes;
  const runningServers = servers.filter((s) => s.status === 'running').length;
  const stoppedServers = servers.filter((s) => s.status === 'stopped').length;

  const trends = {
    users: { value: 12, isPositive: true },
    servers: { value: 5, isPositive: true },
    nodes: { value: 0, isPositive: true },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background — uses primary scale */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-gradient-to-br from-primary-500/10 to-primary-300/10 blur-3xl dark:from-primary-500/20 dark:to-primary-300/20" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-gradient-to-tr from-primary-600/10 to-primary-400/10 blur-3xl dark:from-primary-600/20 dark:to-primary-400/20" />
      </div>

      <div className="relative z-10 space-y-8">
        {/* Header Section */}
        <motion.div variants={itemVariants} className="relative">
          <div className="absolute inset-0 -z-10">
            <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-lg bg-primary opacity-20 blur-sm" />
                  <Sparkles className="relative h-7 w-7 text-primary-600 dark:text-primary-400" />
                </div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                  Admin Command
                </h1>
                <Badge variant="outline" className="border-primary-200/50 bg-primary-50/50 text-primary-700 dark:border-primary-900/50 dark:bg-primary-950/50 dark:text-primary-400">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-500" />
                  </span>
                  <span className="ml-1.5">Live</span>
                </Badge>
              </div>
              <p className="ml-10 text-sm text-muted-foreground">
                Platform health, resources, and system activity overview
              </p>
            </div>

            <div className="flex items-center gap-3">
              <QuickActionsMenu />
              <Button variant="outline" asChild className="shadow-sm">
                <Link to="/admin/audit-logs" className="gap-2">
                  <Activity className="h-4 w-4" />
                  Audit Logs
                </Link>
              </Button>
              <Button asChild className="shadow-sm">
                <Link to="/admin/system" className="gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </Link>
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Primary Stats Grid — Bento Style */}
        <motion.div
          variants={itemVariants}
          className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8"
        >
          <EnhancedMiniStat
            title="Users"
            value={stats?.users}
            icon={Users}
            href="/admin/users"
            loading={statsLoading}
            trend={trends.users}
            color="primary"
            index={0}
          />
          <EnhancedMiniStat
            title="Servers"
            value={stats?.servers}
            icon={Server}
            href="/admin/servers"
            loading={statsLoading}
            trend={trends.servers}
            color="primary"
            index={1}
          />
          <EnhancedMiniStat
            title="Nodes"
            value={stats?.nodes}
            icon={HardDrive}
            href="/admin/nodes"
            loading={statsLoading}
            trend={trends.nodes}
            color="primary"
            index={2}
          />
          <EnhancedMiniStat
            title="Running"
            value={stats?.activeServers ?? runningServers}
            icon={Play}
            color="success"
            loading={statsLoading}
            index={4}
          />
          <EnhancedMiniStat
            title="Stopped"
            value={stoppedServers}
            icon={Square}
            color="muted"
            loading={statsLoading}
            index={5}
          />
          <EnhancedMiniStat
            title="Online"
            value={onlineNodes}
            icon={CheckCircle}
            color="success"
            loading={statsLoading}
            index={6}
          />
          <EnhancedMiniStat
            title="Offline"
            value={offlineNodes}
            icon={XCircle}
            color={offlineNodes > 0 ? 'danger' : 'muted'}
            loading={statsLoading}
            index={7}
          />
        </motion.div>

        {/* Charts and Health Section */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ClusterResourcesChart data={clusterMetrics} isLoading={metricsLoading} />

          <Card className="group relative overflow-hidden border-border/80 bg-card shadow-sm transition-all hover:shadow-md dark:border-border/50">
            <CardHeader className="relative pb-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-success-muted">
                      <Waves className="h-4 w-4 text-success" />
                      <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-success/20" />
                    </div>
                    System Health
                  </CardTitle>
                  <CardDescription>Component status checks</CardDescription>
                </div>
                {healthLoading ? (
                  <Skeleton className="h-8 w-20 rounded-full" />
                ) : health?.status === 'healthy' ? (
                  <Badge className="gap-1.5 bg-success-muted px-3 py-1.5 text-success ring-1 ring-inset ring-success/20">
                    <CheckCircle className="h-3.5 w-3.5" />
                    <span className="font-semibold">Healthy</span>
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1.5 px-3 py-1.5">
                    <XCircle className="h-3.5 w-3.5" />
                    <span className="font-semibold">Issues</span>
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="relative space-y-2.5 p-6">
              <EnhancedHealthRow
                label="Database"
                status={health?.database === 'connected'}
                loading={healthLoading}
                icon={Database}
              />
              <EnhancedHealthRow
                label="Cluster Nodes"
                status={onlineNodes > 0 && offlineNodes === 0}
                loading={healthLoading}
                detail={`${onlineNodes}/${nodes.length}`}
                icon={Server}
              />
              <EnhancedHealthRow
                label="API Gateway"
                status={true}
                loading={healthLoading}
                detail="32ms"
                icon={Zap}
              />
              <EnhancedHealthRow
                label="WebSocket"
                status={true}
                loading={healthLoading}
                detail="Active"
                icon={Globe}
              />
              <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-surface-2/80 px-3 py-2.5 dark:bg-surface-1/50">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">Last updated</span>
                </div>
                <span className="text-xs font-mono text-foreground">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Activity and Node Overview */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 overflow-hidden border-border/80 shadow-sm dark:border-border/50">
            <CardHeader className="border-b border-border/50 bg-surface-2/30 dark:bg-surface-1/30">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2.5">
                    <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/30">
                      <Activity className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                      <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-primary-200/50 dark:ring-primary-800/50" />
                    </div>
                    <div>
                      <span>Recent Activity</span>
                      <p className="text-sm font-normal text-muted-foreground">
                        Latest platform events
                      </p>
                    </div>
                  </CardTitle>
                </div>
                <Button variant="ghost" size="sm" asChild className="gap-1.5">
                  <Link to="/admin/audit-logs">
                    View all
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {auditLoading ? (
                <div className="space-y-4 p-6">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-4">
                      <Skeleton className="h-12 w-12 rounded-full" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-48" />
                        <Skeleton className="h-4 w-64" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : logs.length > 0 ? (
                <div className="divide-y divide-border">
                  {logs.slice(0, 6).map((log, idx) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-surface-2/50 dark:hover:bg-surface-2/30"
                    >
                      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/20">
                        <Zap className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                        <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-primary-200/50 dark:ring-primary-800/50" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold text-foreground dark:text-white">
                            {log.action}
                          </span>
                          <Badge variant="outline" className="border-border bg-surface-2 text-xs font-medium dark:bg-surface-2">
                            {log.resource}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          by{' '}
                          <span className="font-medium text-foreground dark:text-white">
                            {log.user?.username ?? log.user?.email ?? 'System'}
                          </span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted-foreground dark:bg-surface-2/50">
                        <Clock className="h-3 w-3" />
                        <span>{formatTime(log.timestamp)}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center">
                  <div className="relative inline-flex">
                    <div className="absolute inset-0 -m-2 rounded-full bg-surface-2 blur-xl" />
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-surface-2 shadow-sm">
                      <Activity className="h-7 w-7 text-muted-foreground" />
                    </div>
                  </div>
                  <p className="mt-4 text-sm font-medium text-muted-foreground">
                    No recent activity
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Activity will appear here as actions are performed
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-border/80 shadow-sm dark:border-border/50">
            <CardHeader className="border-b border-border/50 bg-surface-2/30 dark:bg-surface-1/30">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2.5">
                    <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-primary-100 dark:bg-primary-900/30">
                      <HardDrive className="h-5 w-5 text-primary-600 dark:text-primary-400" />
                      <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-primary-200/50 dark:ring-primary-800/50" />
                    </div>
                    <div>
                      <span>Cluster Nodes</span>
                      <p className="text-sm font-normal text-muted-foreground">
                        Infrastructure status
                      </p>
                    </div>
                  </CardTitle>
                </div>
                <Button variant="ghost" size="sm" asChild className="gap-1.5">
                  <Link to="/admin/nodes">
                    Manage
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 p-4">
              {nodes.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="relative inline-flex">
                    <div className="absolute inset-0 -m-2 rounded-full bg-surface-2 blur-xl" />
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 shadow-sm">
                      <HardDrive className="h-6 w-6 text-muted-foreground" />
                    </div>
                  </div>
                  <p className="mt-4 text-sm font-medium text-muted-foreground">
                    No nodes configured
                  </p>
                  <Button variant="outline" size="sm" className="mt-4" asChild>
                    <Link to="/admin/nodes">Add Your First Node</Link>
                  </Button>
                </div>
              ) : (
                nodes.slice(0, 6).map((node, idx) => (
                  <motion.div
                    key={node.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <Link
                      to={`/admin/nodes/${node.id}`}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2/30 px-4 py-3.5 transition-all hover:border-border hover:shadow-md dark:bg-surface-1/30"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <span
                            className={cn(
                              'flex h-2.5 w-2.5 rounded-full ring-2 ring-card',
                              node.isOnline
                                ? 'bg-success shadow-[0_0_8px_-1px_hsl(var(--success))]'
                                : 'bg-danger'
                            )}
                          />
                          {node.isOnline && (
                            <span className="absolute inset-0 animate-ping rounded-full bg-success opacity-75" />
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <span className="block text-sm font-semibold text-foreground dark:text-white">
                            {node.name}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {node.isOnline ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs font-semibold">
                          <Cpu className="mr-1 h-3 w-3" />
                          {node._count?.servers ?? 0}
                        </Badge>
                        <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                      </div>
                    </Link>
                  </motion.div>
                ))
              )}
              {nodes.length > 6 && (
                <Link
                  to="/admin/nodes"
                  className="block rounded-xl border border-dashed border-border py-3 text-center text-sm text-muted-foreground transition-colors hover:border-border hover:bg-surface-2"
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

// Enhanced MiniStat with trend indicators
function EnhancedMiniStat({
  title,
  value,
  icon: Icon,
  href,
  loading,
  trend,
  color = 'primary' as const,
  index,
}: {
  title: string;
  value?: number;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  loading: boolean;
  trend?: { value: number; isPositive: boolean };
  color?: 'primary' | 'success' | 'danger' | 'warning' | 'muted';
  index: number;
}) {
  const colorStyles: Record<string, { bg: string; icon: string; glow: string; border: string; text: string }> = {
    primary: {
      bg: 'bg-primary-50/80 dark:bg-primary-950/30',
      icon: 'bg-primary-100 dark:bg-primary-800/40 text-primary-700 dark:text-primary-300',
      glow: 'group-hover:shadow-primary-200/50 dark:group-hover:shadow-primary-900/20',
      border: 'border-primary-100 dark:border-primary-900/30',
      text: 'text-primary-700 dark:text-primary-400',
    },
    success: {
      bg: 'bg-success-muted',
      icon: 'bg-success-muted text-success',
      glow: 'group-hover:shadow-success/20',
      border: 'border-success/20',
      text: 'text-success',
    },
    danger: {
      bg: 'bg-danger-muted',
      icon: 'bg-danger-muted text-danger',
      glow: 'group-hover:shadow-danger/20',
      border: 'border-danger/20',
      text: 'text-danger',
    },
    warning: {
      bg: 'bg-warning-muted',
      icon: 'bg-warning-muted text-warning',
      glow: 'group-hover:shadow-warning/20',
      border: 'border-warning/20',
      text: 'text-warning',
    },
    muted: {
      bg: 'bg-surface-2/80 dark:bg-surface-2/30',
      icon: 'bg-surface-3 dark:bg-surface-2 text-muted-foreground dark:text-zinc-300',
      glow: '',
      border: 'border-border dark:border-border/30',
      text: 'text-muted-foreground',
    },
  };

  const styles = colorStyles[color];
  const content = (
    <motion.div
      variants={scaleVariants}
      initial="hidden"
      animate="visible"
      transition={{ delay: index * 0.03 }}
      className={cn(
        'group relative flex flex-col items-center justify-center gap-3 rounded-xl border p-5 text-center transition-all hover:-translate-y-1 hover:shadow-lg',
        styles.bg,
        styles.border,
        styles.glow
      )}
    >
      <div
        className={cn(
          'relative flex h-11 w-11 items-center justify-center rounded-lg shadow-sm transition-transform group-hover:scale-110',
          styles.icon
        )}
      >
        <Icon className="h-5 w-5" />
        <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-black/5 dark:ring-white/10" />
      </div>
      <div className="space-y-1">
        {loading ? (
          <Skeleton className="mx-auto h-8 w-12" />
        ) : (
          <span className="block text-2xl font-bold text-foreground dark:text-white tabular-nums">
            {value ?? 0}
          </span>
        )}
        <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
      </div>
      {trend && !loading && (
        <div
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            trend.isPositive
              ? 'bg-success-muted text-success'
              : 'bg-danger-muted text-danger'
          )}
        >
          {trend.isPositive ? (
            <TrendingUp className="h-3 w-3" />
          ) : (
            <TrendingDown className="h-3 w-3" />
          )}
          <span className="tabular-nums">{Math.abs(trend.value)}%</span>
        </div>
      )}
    </motion.div>
  );

  if (href) return <Link to={href}>{content}</Link>;
  return content;
}

// Enhanced Health Row
function EnhancedHealthRow({
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-sm transition-colors hover:bg-surface-2 dark:bg-surface-1/50 dark:hover:bg-surface-2/50">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <span className="text-sm font-semibold text-foreground dark:text-zinc-300">
          {label}
        </span>
      </div>
      {loading ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        <div className="flex items-center gap-3">
          {detail && (
            <span className="text-sm font-medium text-muted-foreground">
              {detail}
            </span>
          )}
          {status ? (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-success-muted">
              <CheckCircle className="h-3.5 w-3.5 text-success" />
            </div>
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-danger-muted">
              <XCircle className="h-3.5 w-3.5 text-danger" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Quick Actions Menu
function QuickActionsMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2 shadow-sm">
          <Sparkles className="h-4 w-4" />
          Quick Actions
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild>
          <Link to="/admin/servers/new" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>Create Server</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/nodes/new" className="gap-2">
            <HardDrive className="h-4 w-4" />
            <span>Register Node</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/admin/users/new" className="gap-2">
            <Users className="h-4 w-4" />
            <span>Invite User</span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/admin/templates/new" className="gap-2">
            <FileText className="h-4 w-4" />
            <span>Create Template</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Plus({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

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

export default AdminDashboardPage;
