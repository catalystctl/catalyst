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
      color: 'text-primary-500',
      bg: 'bg-primary-500',
      bgLight: 'bg-primary-100 dark:bg-primary-900/30',
    },
    {
      label: 'Memory',
      value: resources?.memoryUtilization ?? 0,
      icon: MemoryStick,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500',
      bgLight: 'bg-emerald-100 dark:bg-emerald-900/30',
    },
    {
      label: 'Network',
      value: resources?.networkThroughput ?? 0,
      icon: Network,
      color: 'text-amber-500',
      bg: 'bg-amber-500',
      bgLight: 'bg-amber-100 dark:bg-amber-900/30',
    },
  ];

  const quickActions = [
    {
      title: 'Create Server',
      description: 'Deploy a new game server',
      icon: Plus,
      href: '/servers',
      color: 'bg-primary-500',
      show: canCreateServer,
    },
    {
      title: 'View Servers',
      description: 'Manage your servers',
      icon: Server,
      href: '/servers',
      color: 'bg-emerald-500',
      show: !canCreateServer,
    },
    {
      title: 'Register Node',
      description: 'Add infrastructure',
      icon: HardDrive,
      href: '/admin/nodes',
      color: 'bg-emerald-500',
      show: isAdmin,
    },
    {
      title: 'View Alerts',
      description: alertsUnacked > 0 ? `${alertsUnacked} need attention` : 'All clear',
      icon: Shield,
      href: isAdmin ? '/admin/alerts' : '/profile',
      color: alertsUnacked > 0 ? 'bg-rose-500' : 'bg-slate-500',
      show: isAdmin,
    },
    {
      title: 'Profile Settings',
      description: 'Manage your account',
      icon: Activity,
      href: '/profile',
      color: 'bg-violet-500',
      show: !isAdmin,
    },
  ].filter((action) => action.show);

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-primary-700 to-violet-700 p-8 text-white shadow-2xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyek0zNiAyNHYySDI0di0yaDEyeiIvPjwvZz48L2c+PC9zdmc+')] opacity-30" />
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-violet-500/20 blur-3xl" />
        
        <div className="relative z-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-primary-200">
                <Sparkles className="h-4 w-4" />
                <span className="text-sm font-medium">Dashboard</span>
              </div>
              <h1 className="mt-2 text-3xl font-bold">
                {getGreeting()}, {user?.username || 'there'}
              </h1>
              <p className="mt-2 text-primary-100 max-w-lg">
                Welcome back. Here's an overview of your infrastructure at a glance.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur-sm">
              <Activity className="h-4 w-4 text-emerald-300" />
              <span>System healthy</span>
            </div>
          </div>

          <div className={`mt-8 grid grid-cols-1 gap-4 ${isAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            <Link
              to="/servers"
              className="group flex items-center gap-4 rounded-2xl bg-white/10 p-4 backdrop-blur-sm transition-all hover:bg-white/20"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                <Server className="h-6 w-6" />
              </div>
              <div className="flex-1">
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 bg-white/20" />
                ) : (
                  <div className="text-3xl font-bold">{serversTotal}</div>
                )}
                <div className="text-sm text-primary-200">
                  {serversOnline} running
                </div>
              </div>
              <ArrowRight className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" />
            </Link>

            {isAdmin && (
              <Link
                to="/admin/nodes"
                className="group flex items-center gap-4 rounded-2xl bg-white/10 p-4 backdrop-blur-sm transition-all hover:bg-white/20"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                  <HardDrive className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  {statsLoading ? (
                    <Skeleton className="h-8 w-16 bg-white/20" />
                  ) : (
                    <div className="text-3xl font-bold">{nodesTotal}</div>
                  )}
                  <div className="text-sm text-primary-200">
                    {nodesOnline} connected
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            )}

            {isAdmin && (
              <Link
                to="/admin/alerts"
                className="group flex items-center gap-4 rounded-2xl bg-white/10 p-4 backdrop-blur-sm transition-all hover:bg-white/20"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                  <AlertTriangle className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  {statsLoading ? (
                    <Skeleton className="h-8 w-16 bg-white/20" />
                  ) : (
                    <div className="text-3xl font-bold">{stats?.alerts ?? 0}</div>
                  )}
                  <div className="text-sm text-primary-200">
                    {alertsUnacked > 0 ? `${alertsUnacked} unacknowledged` : 'All resolved'}
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            )}

            {!isAdmin && (
              <Link
                to="/profile"
                className="group flex items-center gap-4 rounded-2xl bg-white/10 p-4 backdrop-blur-sm transition-all hover:bg-white/20"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                  <Activity className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <div className="text-3xl font-bold">Account</div>
                  <div className="text-sm text-primary-200">
                    Manage your profile
                  </div>
                </div>
                <ArrowRight className="h-5 w-5 opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {quickActions.map((action) => (
          <Link
            key={action.title}
            to={action.href}
            className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-surface-light transition-all hover:-translate-y-1 hover:border-primary-500 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30"
          >
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${action.color} text-white`}>
              <action.icon className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-slate-900 dark:text-white">
                {action.title}
              </div>
              <div className="text-sm text-slate-500 dark:text-slate-400">
                {action.description}
              </div>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-300 transition-all group-hover:text-primary-500 group-hover:translate-x-1" />
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Resource Utilization
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Live metrics across all nodes
              </p>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
              Live
            </div>
          </div>

          <div className="mt-6 space-y-5">
            {resourcesLoading ? (
              resourceMetrics.map((metric) => (
                <div key={metric.label} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`rounded-lg p-1.5 ${metric.bgLight}`}>
                        <metric.icon className={`h-4 w-4 ${metric.color}`} />
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {metric.label}
                      </span>
                    </div>
                    <Skeleton className="h-5 w-12" />
                  </div>
                  <Skeleton className="h-2.5 w-full rounded-full" />
                </div>
              ))
            ) : (
              resourceMetrics.map((metric) => (
                <div key={metric.label} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`rounded-lg p-1.5 ${metric.bgLight}`}>
                        <metric.icon className={`h-4 w-4 ${metric.color}`} />
                      </div>
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {metric.label}
                      </span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">
                      {metric.value}%
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
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

        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Recent Activity
            </h2>
            {isAdmin && (
              <Link
                to="/admin/audit-logs"
                className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
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
                    className={`flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      index !== activities.length - 1 ? 'border-b border-slate-100 dark:border-slate-800' : ''
                    }`}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                      <Zap className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
                        {item.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span className="truncate">{item.detail}</span>
                        <span className="shrink-0 text-slate-300 dark:text-slate-600">|</span>
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
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
                <Activity className="h-8 w-8 text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
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
