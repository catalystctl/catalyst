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
} from 'lucide-react';

function AdminDashboardPage() {
  const { data: stats, isLoading: statsLoading } = useAdminStats();
  const { data: health, isLoading: healthLoading } = useAdminHealth();
  const { data: auditResponse, isLoading: auditLoading } = useAuditLogs({ page: 1, limit: 8 });
  const { data: nodesData } = useAdminNodes();
  const { data: serversData } = useAdminServers({ limit: 100 });
  const { data: activity } = useDashboardActivity(5);
  const { data: clusterMetrics, isLoading: metricsLoading } = useClusterMetrics(5000);

  const logs = auditResponse?.logs ?? [];
  const nodes = nodesData?.nodes ?? [];
  const servers = serversData?.servers ?? [];

  const onlineNodes = nodes.filter((n) => n.isOnline).length;
  const offlineNodes = nodes.length - onlineNodes;
  const runningServers = servers.filter((s) => s.status === 'running').length;
  const stoppedServers = servers.filter((s) => s.status === 'stopped').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Admin Overview</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Monitor platform health, resources, and recent activity.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link to="/admin/audit-logs">Audit Logs</Link>
          </Button>
          <Button asChild>
            <Link to="/admin/system">
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <MiniStat title="Users" value={stats?.users} icon={Users} href="/admin/users" loading={statsLoading} />
        <MiniStat title="Servers" value={stats?.servers} icon={Server} href="/admin/servers" loading={statsLoading} />
        <MiniStat title="Nodes" value={stats?.nodes} icon={HardDrive} href="/admin/nodes" loading={statsLoading} />
        <MiniStat title="Alerts" value={stats?.alerts} icon={AlertTriangle} href="/admin/alerts" loading={statsLoading} color="rose" />
        <MiniStat title="Running" value={stats?.activeServers ?? runningServers} icon={Play} color="emerald" loading={statsLoading} />
        <MiniStat title="Stopped" value={stoppedServers} icon={Square} color="slate" loading={statsLoading} />
        <MiniStat title="Online" value={onlineNodes} icon={CheckCircle} color="emerald" loading={statsLoading} />
        <MiniStat title="Offline" value={offlineNodes} icon={XCircle} color={offlineNodes > 0 ? 'rose' : 'slate'} loading={statsLoading} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ClusterResourcesChart data={clusterMetrics} isLoading={metricsLoading} />

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle>System Health</CardTitle>
              {healthLoading ? (
                <Skeleton className="h-6 w-16" />
              ) : health?.status === 'healthy' ? (
                <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Healthy
                </Badge>
              ) : (
                <Badge variant="destructive">
                  <XCircle className="mr-1 h-3 w-3" />
                  Issues
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            <HealthRow label="Database" status={health?.database === 'connected'} loading={healthLoading} />
            <HealthRow label="Nodes" status={onlineNodes > 0 && offlineNodes === 0} loading={healthLoading} detail={`${onlineNodes}/${nodes.length}`} />
            <HealthRow label="API" status={true} loading={healthLoading} detail="< 50ms" />
            <HealthRow label="WebSocket" status={true} loading={healthLoading} detail="Connected" />
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Last updated</span>
                <span>{new Date().toLocaleTimeString()}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary-500" />
                  Recent Activity
                </CardTitle>
                <CardDescription>Latest platform events</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin/audit-logs" className="gap-1">
                  View all <ArrowUpRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {auditLoading ? (
              <div className="space-y-3 p-6">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-60" />
                    </div>
                  </div>
                ))}
              </div>
            ) : logs.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.slice(0, 6).map((log) => (
                  <div key={log.id} className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800">
                      <Zap className="h-4 w-4 text-primary-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-900 dark:text-white">{log.action}</span>
                        <Badge variant="outline" className="text-xs">{log.resource}</Badge>
                      </div>
                      <p className="text-xs text-slate-500">
                        by {log.user?.username ?? log.user?.email ?? 'System'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-400">
                      <Clock className="h-3 w-3" />
                      {formatTime(log.timestamp)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center">
                <Activity className="mx-auto h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-sm text-slate-500">No recent activity</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="h-5 w-5 text-primary-500" />
                  Node Overview
                </CardTitle>
                <CardDescription>Infrastructure status</CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/admin/nodes" className="gap-1">
                  Manage <ArrowUpRight className="h-3 w-3" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 p-4">
            {nodes.length === 0 ? (
              <div className="py-6 text-center">
                <HardDrive className="mx-auto h-6 w-6 text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-xs text-slate-500">No nodes</p>
                <Button variant="outline" size="sm" className="mt-3" asChild>
                  <Link to="/admin/nodes">Add Node</Link>
                </Button>
              </div>
            ) : (
              nodes.slice(0, 6).map((node) => (
                <Link
                  key={node.id}
                  to={`/admin/nodes/${node.id}`}
                  className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 transition-colors hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/50 dark:hover:bg-slate-800"
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${node.isOnline ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{node.name}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {node._count?.servers ?? 0}
                  </Badge>
                </Link>
              ))
            )}
            {nodes.length > 6 && (
              <Link to="/admin/nodes" className="block rounded-lg border border-dashed border-slate-200 py-2 text-center text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                +{nodes.length - 6} more
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <AdminLink href="/admin/users" icon={Users} label="Users" />
        <AdminLink href="/admin/roles" icon={Shield} label="Roles" />
        <AdminLink href="/admin/servers" icon={Server} label="Servers" />
        <AdminLink href="/admin/nodes" icon={HardDrive} label="Nodes" />
        <AdminLink href="/admin/templates" icon={FileText} label="Templates" />
        <AdminLink href="/admin/database" icon={Database} label="Databases" />
        <AdminLink href="/admin/network" icon={Globe} label="Network" />
        <AdminLink href="/admin/security" icon={Lock} label="Security" />
      </div>
    </div>
  );
}

function MiniStat({
  title,
  value,
  icon: Icon,
  href,
  loading,
  color = 'primary',
}: {
  title: string;
  value?: number;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  loading: boolean;
  color?: 'primary' | 'emerald' | 'rose' | 'slate';
}) {
  const colorStyles = {
    primary: {
      bg: 'bg-sky-50 dark:bg-sky-900/20',
      icon: 'bg-sky-100 dark:bg-sky-800/50 text-sky-600 dark:text-sky-400',
    },
    emerald: {
      bg: 'bg-emerald-50 dark:bg-emerald-900/20',
      icon: 'bg-emerald-100 dark:bg-emerald-800/50 text-emerald-600 dark:text-emerald-400',
    },
    rose: {
      bg: 'bg-rose-50 dark:bg-rose-900/20',
      icon: 'bg-rose-100 dark:bg-rose-800/50 text-rose-600 dark:text-rose-400',
    },
    slate: {
      bg: 'bg-slate-50 dark:bg-slate-800/50',
      icon: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400',
    },
  };
  const styles = colorStyles[color];
  const content = (
    <div
      className={cn(
        'group flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200/80 p-4 text-center transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-700/80 dark:hover:border-slate-600',
        href && 'cursor-pointer',
        styles.bg
      )}
    >
      <div className={cn('rounded-lg p-2 transition-transform group-hover:scale-110', styles.icon)}>
        <Icon className="h-4 w-4" />
      </div>
      {loading ? (
        <Skeleton className="h-7 w-10" />
      ) : (
        <span className="text-2xl font-bold text-slate-900 dark:text-white">{value ?? 0}</span>
      )}
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{title}</span>
    </div>
  );
  if (href) return <Link to={href}>{content}</Link>;
  return content;
}

function HealthRow({
  label,
  status,
  loading,
  detail,
}: {
  label: string;
  status: boolean;
  loading?: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50/50 px-3 py-2.5 dark:bg-slate-800/30">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      {loading ? (
        <Skeleton className="h-4 w-16" />
      ) : (
        <div className="flex items-center gap-2">
          {detail && <span className="text-xs text-slate-500 dark:text-slate-400">{detail}</span>}
          {status ? (
            <CheckCircle className="h-4 w-4 text-emerald-500" />
          ) : (
            <XCircle className="h-4 w-4 text-rose-500" />
          )}
        </div>
      )}
    </div>
  );
}

function AdminLink({ href, icon: Icon, label }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link to={href}>
      <Card className="group border-slate-200/80 bg-slate-50/50 transition-all hover:border-primary-300 hover:bg-white hover:shadow-sm dark:border-slate-700/80 dark:bg-slate-800/30 dark:hover:border-primary-600 dark:hover:bg-slate-800">
        <CardContent className="flex flex-col items-center justify-center gap-2 p-4">
          <div className="rounded-lg bg-slate-100 p-2 transition-all group-hover:bg-primary-100 dark:bg-slate-700 dark:group-hover:bg-primary-900/50">
            <Icon className="h-5 w-5 text-slate-500 transition-colors group-hover:text-primary-600 dark:text-slate-400 dark:group-hover:text-primary-400" />
          </div>
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
        </CardContent>
      </Card>
    </Link>
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
