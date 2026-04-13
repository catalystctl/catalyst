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
  Zap,
  Shield,
  Clock,
  Sparkles,
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
      bg: 'bg-primary',
    },
    {
      label: 'Memory',
      value: resources?.memoryUtilization ?? 0,
      icon: MemoryStick,
      color: 'text-success',
      bg: 'bg-success',
    },
    {
      label: 'Network',
      value: resources?.networkThroughput ?? 0,
      icon: Network,
      color: 'text-warning',
      bg: 'bg-warning',
    },
  ];

  const quickActions = [
    {
      title: 'Create Server',
      description: 'Deploy a new game server',
      icon: Plus,
      href: '/servers',
      color: 'bg-primary',
      show: canCreateServer,
    },
    {
      title: 'View Servers',
      description: 'Manage your servers',
      icon: Server,
      href: '/servers',
      color: 'bg-primary',
      show: !canCreateServer,
    },
    {
      title: 'Register Node',
      description: 'Add infrastructure',
      icon: HardDrive,
      href: '/admin/nodes',
      color: 'bg-primary',
      show: isAdmin,
    },
    {
      title: 'View Alerts',
      description: alertsUnacked > 0 ? `${alertsUnacked} need attention` : 'All clear',
      icon: Shield,
      href: isAdmin ? '/admin/alerts' : '/profile',
      color: alertsUnacked > 0 ? 'bg-danger' : 'bg-zinc-600',
      show: isAdmin,
    },
    {
      title: 'Profile Settings',
      description: 'Manage your account',
      icon: Activity,
      href: '/profile',
      color: 'bg-zinc-600',
      show: !isAdmin,
    },
  ].filter((action) => action.show);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent p-8">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
        
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-primary">
                <Sparkles className="h-4 w-4" />
                <span className="text-sm font-medium">Dashboard</span>
              </div>
              <h1 className="mt-2 font-display text-3xl font-bold text-foreground">
                {getGreeting()}, {user?.username || 'there'}
              </h1>
              <p className="mt-2 max-w-lg text-sm text-muted-foreground">
                Welcome back. Here's an overview of your infrastructure at a glance.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-4 py-2 text-sm text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              System healthy
            </div>
          </div>

          <div className={`mt-8 grid grid-cols-1 gap-3 ${isAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            <Link
              to="/servers"
              className="group flex items-center gap-4 rounded-xl border border-border bg-card/50 p-4 backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-card"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Server className="h-5 w-5" />
              </div>
              <div className="flex-1">
                {statsLoading ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  <div className="font-display text-2xl font-bold text-foreground">{serversTotal}</div>
                )}
                <div className="text-sm text-muted-foreground">{serversOnline} running</div>
              </div>
              <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>

            {isAdmin && (
              <Link
                to="/admin/nodes"
                className="group flex items-center gap-4 rounded-xl border border-border bg-card/50 p-4 backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-card"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <HardDrive className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  {statsLoading ? (
                    <Skeleton className="h-8 w-16" />
                  ) : (
                    <div className="font-display text-2xl font-bold text-foreground">{nodesTotal}</div>
                  )}
                  <div className="text-sm text-muted-foreground">{nodesOnline} connected</div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            )}

            {isAdmin && (
              <Link
                to="/admin/alerts"
                className="group flex items-center gap-4 rounded-xl border border-border bg-card/50 p-4 backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-card"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-warning/15 text-warning">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  {statsLoading ? (
                    <Skeleton className="h-8 w-16" />
                  ) : (
                    <div className="font-display text-2xl font-bold text-foreground">{stats?.alerts ?? 0}</div>
                  )}
                  <div className="text-sm text-muted-foreground">
                    {alertsUnacked > 0 ? `${alertsUnacked} unacknowledged` : 'All resolved'}
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            )}

            {!isAdmin && (
              <Link
                to="/profile"
                className="group flex items-center gap-4 rounded-xl border border-border bg-card/50 p-4 backdrop-blur-sm transition-all hover:border-primary/30 hover:bg-card"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <Activity className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <div className="font-display text-2xl font-bold text-foreground">Account</div>
                  <div className="text-sm text-muted-foreground">Manage your profile</div>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
            className="group flex items-center gap-4 rounded-xl border border-border bg-card p-5 shadow-surface-light transition-all duration-200 hover:border-zinc-300 hover:shadow-elevated dark:shadow-surface-dark dark:hover:border-zinc-700 dark:hover:shadow-elevated-dark"
          >
            <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${action.color} text-white`}>
              <action.icon className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-foreground">{action.title}</div>
              <div className="text-sm text-muted-foreground">{action.description}</div>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground transition-all group-hover:text-primary group-hover:translate-x-1" />
          </Link>
        ))}
      </div>

      {/* Metrics + Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-xl border border-border bg-card p-6 shadow-surface-light dark:shadow-surface-dark">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold text-foreground">Resource Utilization</h2>
              <p className="text-sm text-muted-foreground">Live metrics across all nodes</p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-xs font-medium text-success">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
              Live
            </div>
          </div>

          <div className="mt-6 space-y-5">
            {resourcesLoading ? (
              resourceMetrics.map((metric) => (
                <div key={metric.label} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-surface-2 p-1.5">
                        <metric.icon className={`h-4 w-4 ${metric.color}`} />
                      </div>
                      <span className="text-sm font-medium text-foreground">{metric.label}</span>
                    </div>
                    <Skeleton className="h-5 w-12" />
                  </div>
                  <Skeleton className="h-2 w-full rounded-full" />
                </div>
              ))
            ) : (
              resourceMetrics.map((metric) => (
                <div key={metric.label} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="rounded-lg bg-surface-2 p-1.5">
                        <metric.icon className={`h-4 w-4 ${metric.color}`} />
                      </div>
                      <span className="text-sm font-medium text-foreground">{metric.label}</span>
                    </div>
                    <span className="text-sm font-semibold text-foreground">{metric.value}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${metric.bg} transition-all duration-500`}
                      style={{ width: `${Math.min(100, metric.value)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-6 shadow-surface-light dark:shadow-surface-dark">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-foreground">Recent Activity</h2>
            {isAdmin && (
              <Link
                to="/admin/audit-logs"
                className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
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
                  <div key={i} className="flex items-start gap-3">
                    <Skeleton className="mt-0.5 h-8 w-8 rounded-lg" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activities && activities.length > 0 ? (
              <div className="space-y-1">
                {activities.map((item, index) => (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-surface-2 ${
                      index !== activities.length - 1 ? '' : ''
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2">
                      <Zap className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="truncate">{item.detail}</span>
                        <span className="shrink-0 text-zinc-600 dark:text-zinc-500">|</span>
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
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <Activity className="h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">No recent activity</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardPage;
