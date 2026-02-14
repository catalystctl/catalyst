import { Link } from 'react-router-dom';
import { useAdminStats, useAuditLogs, useAdminHealth } from '../../hooks/useAdmin';
import { useDashboardActivity } from '../../hooks/useDashboard';
import { useAdminNodes, useAdminServers } from '../../hooks/useAdmin';
import { useClusterMetrics } from '../../hooks/useClusterMetrics';
import { ClusterResourcesChart } from '../../components/admin/ClusterResourcesChart';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';
import {
  Users,
  Server,
  HardDrive,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  ArrowUpRight,
  Zap,
  Shield,
  Clock,
  Settings,
  Database,
  Globe,
  Lock,
  Play,
  Square,
  FileText,
  TrendingUp,
  TrendingDown,
  MoreVertical,
  Sparkles,
  Waves,
  Cpu,
} from 'lucide-react';
import { useState, useEffect } from 'react';
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

const itemVariants = {
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

const scaleVariants = {
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

  // Simulated trend data (in real app, this would come from API)
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
      {/* Ambient background effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 -right-40 h-96 w-96 rounded-full bg-gradient-to-br from-cyan-500/10 to-violet-500/10 blur-3xl dark:from-cyan-500/20 dark:to-violet-500/20" />
        <div className="absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-gradient-to-tr from-sky-500/10 to-indigo-500/10 blur-3xl dark:from-sky-500/20 dark:to-indigo-500/20" />
      </div>

      <div className="relative z-10 space-y-8">
        {/* Header Section */}
        <motion.div variants={itemVariants} className="relative">
          <div className="absolute inset-0 -z-10">
            <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent dark:via-slate-800" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-cyan-500 to-violet-500 opacity-20 blur-sm" />
                  <Sparkles className="relative h-7 w-7 text-cyan-600 dark:text-cyan-400" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
                  Admin Command
                </h1>
                <Badge
                  variant="outline"
                  className="border-cyan-200/50 bg-cyan-50/50 text-cyan-700 dark:border-cyan-900/50 dark:bg-cyan-950/50 dark:text-cyan-400"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" />
                  </span>
                  <span className="ml-1.5">Live</span>
                </Badge>
              </div>
              <p className="ml-10 text-sm text-slate-600 dark:text-slate-400">
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

        {/* Primary Stats Grid - Bento Style */}
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
            color="cyan"
            index={0}
          />
          <EnhancedMiniStat
            title="Servers"
            value={stats?.servers}
            icon={Server}
            href="/admin/servers"
            loading={statsLoading}
            trend={trends.servers}
            color="violet"
            index={1}
          />
          <EnhancedMiniStat
            title="Nodes"
            value={stats?.nodes}
            icon={HardDrive}
            href="/admin/nodes"
            loading={statsLoading}
            trend={trends.nodes}
            color="sky"
            index={2}
          />
          <EnhancedMiniStat
            title="Running"
            value={stats?.activeServers ?? runningServers}
            icon={Play}
            color="emerald"
            loading={statsLoading}
            index={4}
          />
          <EnhancedMiniStat
            title="Stopped"
            value={stoppedServers}
            icon={Square}
            color="slate"
            loading={statsLoading}
            index={5}
          />
          <EnhancedMiniStat
            title="Online"
            value={onlineNodes}
            icon={CheckCircle}
            color="emerald"
            loading={statsLoading}
            index={6}
          />
          <EnhancedMiniStat
            title="Offline"
            value={offlineNodes}
            icon={XCircle}
            color={offlineNodes > 0 ? 'rose' : 'slate'}
            loading={statsLoading}
            index={7}
          />
        </motion.div>

        {/* Charts and Health Section */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ClusterResourcesChart data={clusterMetrics} isLoading={metricsLoading} />

          <Card className="group relative overflow-hidden border-slate-200/80 bg-gradient-to-br from-white to-slate-50/50 shadow-sm transition-all hover:shadow-md dark:border-slate-700/50 dark:from-slate-900 dark:to-slate-800/50">
            <div className="pointer-events-none absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTTAgNDBWMGg0MHYyMEgwTDIwIDBoMjBMMCA0MHoiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2U1ZTdlNyIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIiBvcGFjaXR5PSIwLjAyIi8+PC9zdmc+')] opacity-50 dark:opacity-20" />
            <CardHeader className="relative pb-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/50 dark:to-emerald-900/30">
                      <Waves className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-emerald-200/50 dark:ring-emerald-800/50" />
                    </div>
                    System Health
                  </CardTitle>
                  <CardDescription>Component status checks</CardDescription>
                </div>
                {healthLoading ? (
                  <Skeleton className="h-8 w-20 rounded-full" />
                ) : health?.status === 'healthy' ? (
                  <Badge className="gap-1.5 bg-emerald-50 px-3 py-1.5 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400 dark:ring-emerald-900/50">
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
              <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/50">
                <div className="flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">Last updated</span>
                </div>
                <span className="text-xs font-mono text-slate-700 dark:text-slate-300">
                  {new Date().toLocaleTimeString()}
                </span>
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Activity and Node Overview */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 overflow-hidden border-slate-200/80 shadow-sm dark:border-slate-700/50">
            <CardHeader className="border-b border-slate-100/50 bg-gradient-to-r from-slate-50/50 to-transparent dark:border-slate-800/50 dark:from-slate-800/30">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2.5">
                    <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-950/50 dark:to-violet-900/30">
                      <Activity className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                      <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-violet-200/50 dark:ring-violet-800/50" />
                    </div>
                    <div>
                      <span>Recent Activity</span>
                      <p className="text-sm font-normal text-slate-500 dark:text-slate-400">
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
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {logs.slice(0, 6).map((log, idx) => (
                    <motion.div
                      key={log.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
                    >
                      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-50 to-violet-100 dark:from-violet-950/30 dark:to-violet-900/20">
                        <Zap className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                        <div className="absolute inset-0 rounded-full ring-1 ring-inset ring-violet-200/50 dark:ring-violet-800/50" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            {log.action}
                          </span>
                          <Badge
                            variant="outline"
                            className="border-slate-200 bg-slate-50 text-xs font-medium dark:border-slate-700 dark:bg-slate-800"
                          >
                            {log.resource}
                          </Badge>
                        </div>
                        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">
                          by{' '}
                          <span className="font-medium text-slate-900 dark:text-white">
                            {log.user?.username ?? log.user?.email ?? 'System'}
                          </span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
                        <Clock className="h-3 w-3" />
                        <span>{formatTime(log.timestamp)}</span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="py-16 text-center">
                  <div className="relative inline-flex">
                    <div className="absolute inset-0 -m-2 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 blur-xl dark:from-slate-800 dark:to-slate-700" />
                    <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-slate-50 to-slate-100 shadow-sm dark:from-slate-900 dark:to-slate-800">
                      <Activity className="h-7 w-7 text-slate-400" />
                    </div>
                  </div>
                  <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-400">
                    No recent activity
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
                    Activity will appear here as actions are performed
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden border-slate-200/80 shadow-sm dark:border-slate-700/50">
            <CardHeader className="border-b border-slate-100/50 bg-gradient-to-r from-slate-50/50 to-transparent dark:border-slate-800/50 dark:from-slate-800/30">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2.5">
                    <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-sky-50 to-sky-100 dark:from-sky-950/50 dark:to-sky-900/30">
                      <HardDrive className="h-5 w-5 text-sky-600 dark:text-sky-400" />
                      <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-sky-200/50 dark:ring-sky-800/50" />
                    </div>
                    <div>
                      <span>Cluster Nodes</span>
                      <p className="text-sm font-normal text-slate-500 dark:text-slate-400">
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
                    <div className="absolute inset-0 -m-2 rounded-full bg-gradient-to-br from-slate-100 to-slate-200 blur-xl dark:from-slate-800 dark:to-slate-700" />
                    <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-slate-50 to-slate-100 shadow-sm dark:from-slate-900 dark:to-slate-800">
                      <HardDrive className="h-6 w-6 text-slate-400" />
                    </div>
                  </div>
                  <p className="mt-4 text-sm font-medium text-slate-600 dark:text-slate-400">
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
                      className="group flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-gradient-to-r from-slate-50/50 to-transparent px-4 py-3.5 transition-all hover:border-slate-200 hover:shadow-md dark:border-slate-800 dark:from-slate-800/30 dark:hover:border-slate-700"
                    >
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <span
                            className={cn(
                              'flex h-2.5 w-2.5 rounded-full ring-2 ring-white dark:ring-slate-900',
                              node.isOnline
                                ? 'bg-emerald-500 shadow-[0_0_8px_-1px_rgba(16,185,129,0.5)]'
                                : 'bg-rose-500'
                            )}
                          />
                          {node.isOnline && (
                            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400 opacity-75" />
                          )}
                        </div>
                        <div className="space-y-0.5">
                          <span className="block text-sm font-semibold text-slate-900 dark:text-white">
                            {node.name}
                          </span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            {node.isOnline ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="secondary"
                          className="bg-slate-100 text-xs font-semibold dark:bg-slate-700"
                        >
                          <Cpu className="mr-1 h-3 w-3" />
                          {node._count?.servers ?? 0}
                        </Badge>
                        <ArrowUpRight className="h-4 w-4 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-600 dark:group-hover:text-slate-300" />
                      </div>
                    </Link>
                  </motion.div>
                ))
              )}
              {nodes.length > 6 && (
                <Link
                  to="/admin/nodes"
                  className="block rounded-xl border border-dashed border-slate-200 py-3 text-center text-sm text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
                >
                  +{nodes.length - 6} more node{nodes.length - 6 > 1 ? 's' : ''}
                </Link>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick Navigation Grid */}
        <motion.div variants={itemVariants}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Quick Navigation</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Jump to administration sections
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <EnhancedAdminLink
              href="/admin/users"
              icon={Users}
              label="Users"
              description="User accounts"
              color="cyan"
              index={0}
            />
            <EnhancedAdminLink
              href="/admin/roles"
              icon={Shield}
              label="Roles"
              description="Access control"
              color="violet"
              index={1}
            />
            <EnhancedAdminLink
              href="/admin/servers"
              icon={Server}
              label="Servers"
              description="Game servers"
              color="sky"
              index={2}
            />
            <EnhancedAdminLink
              href="/admin/nodes"
              icon={HardDrive}
              label="Nodes"
              description="Infrastructure"
              color="emerald"
              index={3}
            />
            <EnhancedAdminLink
              href="/admin/templates"
              icon={FileText}
              label="Templates"
              description="Server templates"
              color="amber"
              index={4}
            />
            <EnhancedAdminLink
              href="/admin/database"
              icon={Database}
              label="Databases"
              description="Data management"
              color="rose"
              index={5}
            />
            <EnhancedAdminLink
              href="/admin/network"
              icon={Globe}
              label="Network"
              description="Networking"
              color="indigo"
              index={6}
            />
            <EnhancedAdminLink
              href="/admin/security"
              icon={Lock}
              label="Security"
              description="Security settings"
              color="slate"
              index={7}
            />
          </div>
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
  color = 'primary',
  index,
}: {
  title: string;
  value?: number;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  loading: boolean;
  trend?: { value: number; isPositive: boolean };
  color?: 'cyan' | 'violet' | 'sky' | 'emerald' | 'rose' | 'amber' | 'indigo' | 'slate';
  index: number;
}) {
  const colorStyles: Record<
    string,
    {
      bg: string;
      icon: string;
      glow: string;
      border: string;
      text: string;
    }
  > = {
    cyan: {
      bg: 'bg-cyan-50/80 dark:bg-cyan-950/30',
      icon: 'bg-gradient-to-br from-cyan-100 to-cyan-200 dark:from-cyan-900/40 dark:to-cyan-800/40 text-cyan-700 dark:text-cyan-300',
      glow: 'group-hover:shadow-cyan-200/50 dark:group-hover:shadow-cyan-900/20',
      border: 'border-cyan-100 dark:border-cyan-900/30',
      text: 'text-cyan-700 dark:text-cyan-400',
    },
    violet: {
      bg: 'bg-violet-50/80 dark:bg-violet-950/30',
      icon: 'bg-gradient-to-br from-violet-100 to-violet-200 dark:from-violet-900/40 dark:to-violet-800/40 text-violet-700 dark:text-violet-300',
      glow: 'group-hover:shadow-violet-200/50 dark:group-hover:shadow-violet-900/20',
      border: 'border-violet-100 dark:border-violet-900/30',
      text: 'text-violet-700 dark:text-violet-400',
    },
    sky: {
      bg: 'bg-sky-50/80 dark:bg-sky-950/30',
      icon: 'bg-gradient-to-br from-sky-100 to-sky-200 dark:from-sky-900/40 dark:to-sky-800/40 text-sky-700 dark:text-sky-300',
      glow: 'group-hover:shadow-sky-200/50 dark:group-hover:shadow-sky-900/20',
      border: 'border-sky-100 dark:border-sky-900/30',
      text: 'text-sky-700 dark:text-sky-400',
    },
    emerald: {
      bg: 'bg-emerald-50/80 dark:bg-emerald-950/30',
      icon: 'bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-900/40 dark:to-emerald-800/40 text-emerald-700 dark:text-emerald-300',
      glow: 'group-hover:shadow-emerald-200/50 dark:group-hover:shadow-emerald-900/20',
      border: 'border-emerald-100 dark:border-emerald-900/30',
      text: 'text-emerald-700 dark:text-emerald-400',
    },
    rose: {
      bg: 'bg-rose-50/80 dark:bg-rose-950/30',
      icon: 'bg-gradient-to-br from-rose-100 to-rose-200 dark:from-rose-900/40 dark:to-rose-800/40 text-rose-700 dark:text-rose-300',
      glow: 'group-hover:shadow-rose-200/50 dark:group-hover:shadow-rose-900/20',
      border: 'border-rose-100 dark:border-rose-900/30',
      text: 'text-rose-700 dark:text-rose-400',
    },
    amber: {
      bg: 'bg-amber-50/80 dark:bg-amber-950/30',
      icon: 'bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/40 dark:to-amber-800/40 text-amber-700 dark:text-amber-300',
      glow: 'group-hover:shadow-amber-200/50 dark:group-hover:shadow-amber-900/20',
      border: 'border-amber-100 dark:border-amber-900/30',
      text: 'text-amber-700 dark:text-amber-400',
    },
    indigo: {
      bg: 'bg-indigo-50/80 dark:bg-indigo-950/30',
      icon: 'bg-gradient-to-br from-indigo-100 to-indigo-200 dark:from-indigo-900/40 dark:to-indigo-800/40 text-indigo-700 dark:text-indigo-300',
      glow: 'group-hover:shadow-indigo-200/50 dark:group-hover:shadow-indigo-900/20',
      border: 'border-indigo-100 dark:border-indigo-900/30',
      text: 'text-indigo-700 dark:text-indigo-400',
    },
    slate: {
      bg: 'bg-slate-50/80 dark:bg-slate-800/30',
      icon: 'bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800/40 dark:to-slate-700/40 text-slate-700 dark:text-slate-300',
      glow: 'group-hover:shadow-slate-200/50 dark:group-hover:shadow-slate-700/20',
      border: 'border-slate-200 dark:border-slate-700/30',
      text: 'text-slate-700 dark:text-slate-400',
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
          <span className="block text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {value ?? 0}
          </span>
        )}
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          {title}
        </span>
      </div>
      {trend && !loading && (
        <div
          className={cn(
            'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
            trend.isPositive
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400'
              : 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400'
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50 dark:hover:bg-slate-800/50">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
          <Icon className="h-4 w-4 text-slate-600 dark:text-slate-400" />
        </div>
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
          {label}
        </span>
      </div>
      {loading ? (
        <Skeleton className="h-5 w-20" />
      ) : (
        <div className="flex items-center gap-3">
          {detail && (
            <span className="text-sm font-medium text-slate-600 dark:text-slate-400">
              {detail}
            </span>
          )}
          {status ? (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/50">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            </div>
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-950/50">
              <XCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Enhanced Admin Link
function EnhancedAdminLink({
  href,
  icon: Icon,
  label,
  description,
  color,
  index,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  description: string;
  color: string;
  index: number;
}) {
  const colorMap: Record<
    string,
    {
      from: string;
      to: string;
      icon: string;
      hover: string;
    }
  > = {
    cyan: {
      from: 'from-cyan-50',
      to: 'to-cyan-100/50',
      icon: 'text-cyan-600 dark:text-cyan-400',
      hover: 'hover:border-cyan-200 dark:hover:border-cyan-800',
    },
    violet: {
      from: 'from-violet-50',
      to: 'to-violet-100/50',
      icon: 'text-violet-600 dark:text-violet-400',
      hover: 'hover:border-violet-200 dark:hover:border-violet-800',
    },
    sky: {
      from: 'from-sky-50',
      to: 'to-sky-100/50',
      icon: 'text-sky-600 dark:text-sky-400',
      hover: 'hover:border-sky-200 dark:hover:border-sky-800',
    },
    emerald: {
      from: 'from-emerald-50',
      to: 'to-emerald-100/50',
      icon: 'text-emerald-600 dark:text-emerald-400',
      hover: 'hover:border-emerald-200 dark:hover:border-emerald-800',
    },
    rose: {
      from: 'from-rose-50',
      to: 'to-rose-100/50',
      icon: 'text-rose-600 dark:text-rose-400',
      hover: 'hover:border-rose-200 dark:hover:border-rose-800',
    },
    amber: {
      from: 'from-amber-50',
      to: 'to-amber-100/50',
      icon: 'text-amber-600 dark:text-amber-400',
      hover: 'hover:border-amber-200 dark:hover:border-amber-800',
    },
    indigo: {
      from: 'from-indigo-50',
      to: 'to-indigo-100/50',
      icon: 'text-indigo-600 dark:text-indigo-400',
      hover: 'hover:border-indigo-200 dark:hover:border-indigo-800',
    },
    slate: {
      from: 'from-slate-50',
      to: 'to-slate-100/50',
      icon: 'text-slate-600 dark:text-slate-400',
      hover: 'hover:border-slate-200 dark:hover:border-slate-700',
    },
  };

  const colors = colorMap[color] || colorMap.slate;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.04 }}
    >
      <Link to={href}>
        <Card
          className={cn(
            'group h-full border-slate-200/80 bg-gradient-to-br shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg dark:border-slate-700/50',
            colors.from,
            colors.to,
            colors.hover
          )}
        >
          <CardContent className="flex flex-col items-center justify-center gap-3 p-5">
            <div
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-xl bg-white shadow-sm transition-transform group-hover:scale-110 dark:bg-slate-900',
                colors.icon
              )}
            >
              <Icon className="h-5.5 w-5.5" />
            </div>
            <div className="space-y-1 text-center">
              <span className="block text-sm font-bold text-slate-900 dark:text-white">
                {label}
              </span>
              <span className="block text-xs text-slate-600 dark:text-slate-400">
                {description}
              </span>
            </div>
            <ArrowUpRight className="h-4 w-4 text-slate-400 opacity-0 transition-all group-hover:translate-x-1 group-hover:translate-y-[-1px] group-hover:opacity-100 dark:text-slate-500" />
          </CardContent>
        </Card>
      </Link>
    </motion.div>
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
