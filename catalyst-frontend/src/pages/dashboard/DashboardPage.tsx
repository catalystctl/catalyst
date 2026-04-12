import { Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useDashboardStats, useDashboardActivity, useResourceStats } from '../../hooks/useDashboard';
import { Skeleton } from '../../components/shared/Skeleton';
import {
  Server,
  HardDrive,
  AlertTriangle,
  Plus,
  Activity,
  Cpu,
  MemoryStick,
  Network,
  ArrowRight,
  Shield,
  Clock,
  Zap,
} from 'lucide-react';

function DashboardPage() {
  const { user } = useAuthStore();
  const canCreateServer =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('server.create');
  
  const isAdmin =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('admin.read');

  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: activities, isLoading: activitiesLoading } = useDashboardActivity(5);
  const { data: resources, isLoading: resourcesLoading } = useResourceStats();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const serversOnline = stats?.serversOnline ?? 0;
  const serversTotal = stats?.servers ?? 0;
  const nodesOnline = stats?.nodesOnline ?? 0;
  const nodesTotal = stats?.nodes ?? 0;
  const alertsUnacked = stats?.alertsUnacknowledged ?? 0;

  const resourceMetrics = [
    {
      label: 'CPU',
      value: resources?.cpuUtilization ?? 0,
      icon: Cpu,
      color: 'text-primary',
      barColor: 'bg-primary',
    },
    {
      label: 'Memory',
      value: resources?.memoryUtilization ?? 0,
      icon: MemoryStick,
      color: 'text-emerald-500',
      barColor: 'bg-emerald-500',
    },
    {
      label: 'Network',
      value: resources?.networkThroughput ?? 0,
      icon: Network,
      color: 'text-amber-500',
      barColor: 'bg-amber-500',
    },
  ];

  const quickActions = [
    {
      title: 'Create Server',
      description: 'Deploy a new game server',
      icon: Plus,
      href: '/servers',
      accent: 'text-primary',
      show: canCreateServer,
    },
    {
      title: 'View Servers',
      description: 'Manage your servers',
      icon: Server,
      href: '/servers',
      accent: 'text-primary',
      show: !canCreateServer,
    },
    {
      title: 'Register Node',
      description: 'Add infrastructure',
      icon: HardDrive,
      href: '/admin/nodes',
      accent: 'text-emerald-500',
      show: isAdmin,
    },
    {
      title: 'View Alerts',
      description: alertsUnacked > 0 ? `${alertsUnacked} need attention` : 'All clear',
      icon: Shield,
      href: isAdmin ? '/admin/alerts' : '/profile',
      accent: alertsUnacked > 0 ? 'text-destructive' : 'text-muted-foreground',
      show: isAdmin,
    },
    {
      title: 'Profile Settings',
      description: 'Manage your account',
      icon: Activity,
      href: '/profile',
      accent: 'text-violet-400',
      show: !isAdmin,
    },
  ].filter((action) => action.show);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface-0 p-6 lg:p-8">
        {/* Subtle gradient accent */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-violet-500/5" />
        <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
        
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
                {getGreeting()}, {user?.username || 'there'}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Welcome back. Here's an overview of your infrastructure.
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-500 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              All systems operational
            </div>
          </div>

          <div className={`mt-6 grid grid-cols-1 gap-3 ${isAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            <Link
              to="/servers"
              className="group flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-4 transition-all duration-150 hover:border-primary/30 hover:bg-surface-2"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Server className="h-5 w-5" />
              </div>
              <div className="flex-1">
                {statsLoading ? (
                  <Skeleton className="h-7 w-12" />
                ) : (
                  <div className="text-2xl font-bold tabular-nums text-foreground">{serversTotal}</div>
                )}
                <div className="text-xs text-muted-foreground">
                  {serversOnline} running
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
            </Link>

            {isAdmin && (
              <Link
                to="/admin/nodes"
                className="group flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-4 transition-all duration-150 hover:border-emerald-500/30 hover:bg-surface-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  {statsLoading ? (
                    <Skeleton className="h-7 w-12" />
                  ) : (
                    <div className="text-2xl font-bold tabular-nums text-foreground">{nodesTotal}</div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {nodesOnline} connected
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
              </Link>
            )}

            {isAdmin && (
              <Link
                to="/admin/alerts"
                className="group flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-4 transition-all duration-150 hover:border-amber-500/30 hover:bg-surface-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  {statsLoading ? (
                    <Skeleton className="h-7 w-12" />
                  ) : (
                    <div className="text-2xl font-bold tabular-nums text-foreground">{stats?.alerts ?? 0}</div>
                  )}
                  <div className="text-xs text-muted-foreground">
                    {alertsUnacked > 0 ? `${alertsUnacked} unacknowledged` : 'All resolved'}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
              </Link>
            )}

            {!isAdmin && (
              <Link
                to="/profile"
                className="group flex items-center gap-3 rounded-lg border border-border bg-surface-1 p-4 transition-all duration-150 hover:border-primary/30 hover:bg-surface-2"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                  <Activity className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="text-2xl font-bold text-foreground">Account</div>
                  <div className="text-xs text-muted-foreground">
                    Manage your profile
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" />
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {quickActions.map((action) => (
          <Link
            key={action.title}
            to={action.href}
            className="group flex items-center gap-3 rounded-lg border border-border bg-surface-0 p-4 transition-all duration-150 hover:border-primary/30 hover:shadow-surface-md"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg bg-surface-1 ${action.accent} transition-colors group-hover:bg-surface-2`}>
              <action.icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground">
                {action.title}
              </div>
              <div className="text-xs text-muted-foreground">
                {action.description}
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-all group-hover:text-primary group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Resource Utilization */}
        <div className="lg:col-span-3 rounded-lg border border-border bg-surface-0 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Resource Utilization
              </h2>
              <p className="text-xs text-muted-foreground">
                Live metrics across all nodes
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-500 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Live
            </div>
          </div>

          <div className="mt-5 space-y-4">
            {resourcesLoading ? (
              resourceMetrics.map((metric) => (
                <div key={metric.label} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <metric.icon className={`h-4 w-4 text-muted-foreground`} />
                      <span className="text-sm font-medium text-foreground">
                        {metric.label}
                      </span>
                    </div>
                    <Skeleton className="h-4 w-10" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))
            ) : (
              resourceMetrics.map((metric) => (
                <div key={metric.label} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <metric.icon className={`h-4 w-4 ${metric.color}`} />
                      <span className="text-sm font-medium text-foreground">
                        {metric.label}
                      </span>
                    </div>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {metric.value}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${metric.barColor} transition-all duration-500`}
                      style={{ width: `${Math.min(100, metric.value)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-surface-0 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Recent Activity
            </h2>
            {isAdmin && (
              <Link
                to="/admin/audit-logs"
                className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-hover"
              >
                View all
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>

          <div className="mt-4">
            {activitiesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <Skeleton className="mt-0.5 h-7 w-7 rounded-md" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-3.5 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activities && activities.length > 0 ? (
              <div className="space-y-0.5">
                {activities.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-2.5 rounded-md p-2 transition-colors hover:bg-surface-1"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-1 text-muted-foreground">
                      <Zap className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">
                        {item.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="truncate">{item.detail}</span>
                        <span className="text-border">·</span>
                        <span className="flex items-center gap-1 shrink-0">
                          <Clock className="h-3 w-3" />
                          {item.time}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-1 px-4 py-8 text-center">
                <Activity className="h-7 w-7 text-muted-foreground/40" />
                <p className="mt-2 text-sm text-muted-foreground">
                  No recent activity
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
