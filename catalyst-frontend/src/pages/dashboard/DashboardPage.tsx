import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useDashboardStats, useDashboardActivity, useResourceStats } from '../../hooks/useDashboard';
import {
 Server,
 HardDrive,
 AlertTriangle,
 Plus,
 Activity,
 Cpu,
 MemoryStick,
 ArrowRight,
 Zap,
 Shield,
 Clock,
 BarChart3,
 LayoutDashboard,
} from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import TabErrorState from '../../components/servers/tabs/TabErrorState';
import { PluginSlot } from '../../plugins/PluginSlot';

function DashboardPage() {
 const user = useAuthStore((s) => s.user);
 const canCreateServer =
 user?.permissions?.includes('*') ||
 user?.permissions?.includes('admin.write') ||
 user?.permissions?.includes('server.create');

 const isAdmin =
 user?.permissions?.includes('*') ||
 user?.permissions?.includes('admin.write') ||
 user?.permissions?.includes('admin.read');

 const { data: stats, isLoading: statsLoading, isError: statsError } = useDashboardStats();
 const { data: activities, isLoading: activitiesLoading, isError: activitiesError } = useDashboardActivity(5);
 const { data: resources, isLoading: resourcesLoading, isError: resourcesError } = useResourceStats();


 const serversOnline = stats?.serversOnline ?? 0;
 const serversTotal = stats?.servers ?? 0;
 const nodesOnline = stats?.nodesOnline ?? 0;
 const nodesTotal = stats?.nodes ?? 0;
 const alertsUnacked = stats?.alertsUnacknowledged ?? 0;

 const resourceMetrics = useMemo(
 () => [
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
 ],
 [resources?.cpuUtilization, resources?.memoryUtilization],
 );

 const quickActions = useMemo(
 () =>
 [
 {
 title: 'Create Server',
 description: 'Deploy a new game server',
 icon: Plus,
 href: '/servers',
 iconClass: 'bg-primary/10 text-primary',
 show: canCreateServer,
 },
 {
 title: 'View Servers',
 description: 'Manage your servers',
 icon: Server,
 href: '/servers',
 iconClass: 'bg-primary/10 text-primary',
 show: !canCreateServer,
 },
 {
 title: 'Register Node',
 description: 'Add infrastructure',
 icon: HardDrive,
 href: '/admin/nodes',
 iconClass: 'bg-primary/10 text-primary',
 show: isAdmin,
 },
 {
 title: 'View Alerts',
 description: alertsUnacked > 0 ? `${alertsUnacked} need attention` : 'All clear',
 icon: Shield,
 href: isAdmin ? '/admin/alerts' : '/profile',
 iconClass: alertsUnacked > 0 ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-muted-foreground',
 show: isAdmin,
 },
 {
 title: 'Profile Settings',
 description: 'Manage your account',
 icon: Activity,
 href: '/profile',
 iconClass: 'bg-surface-2 text-muted-foreground',
 show: !isAdmin,
 },
 ].filter((action) => action.show),
 [canCreateServer, isAdmin, alertsUnacked],
 );

 return (
 <div className="space-y-4">
 <TabHeader
 icon={LayoutDashboard}
 title="Dashboard"
 description={`Infrastructure overview for ${user?.firstName || user?.lastName
 ? [user.firstName, user.lastName].filter(Boolean).join(' ')
 : user?.username || 'your account'}.`}
 actions={alertsUnacked > 0 ? (
 <div className="rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">
 {alertsUnacked} unacknowledged alert{alertsUnacked === 1 ? '' : 's'}
 </div>
 ) : undefined}
 />

 <ServerTabCard>
 <SectionHeader icon={BarChart3} title="Overview" />
 {statsLoading ? (
 <TabLoadingState rows={3} />
 ) : statsError ? (
 <TabErrorState title="Unable to load overview" description="Dashboard counts could not be loaded." />
 ) : (
 <div className={`grid grid-cols-1 gap-3 ${isAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                <Link
                  to="/servers"
                  className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2.5"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-primary">
                    <Server className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="type-numeric text-sm font-semibold text-foreground">{serversTotal}</div>
                    <div className="type-meta">{serversOnline} running</div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                </Link>

                {isAdmin && (
                  <Link
                    to="/admin/nodes"
                    className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2.5"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-primary">
                      <HardDrive className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="type-numeric text-sm font-semibold text-foreground">{nodesTotal}</div>
                      <div className="type-meta">{nodesOnline} connected</div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </Link>
                )}

                {isAdmin && (
                  <Link
                    to="/admin/alerts"
                    className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2.5"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-md border border-warning/30 bg-warning/10 text-warning">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="type-numeric text-sm font-semibold text-foreground">{stats?.alerts ?? 0}</div>
                      <div className="type-meta">
                        {alertsUnacked > 0 ? `${alertsUnacked} unacknowledged` : 'All resolved'}
                      </div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </Link>
                )}

                {!isAdmin && (
                  <Link
                    to="/profile"
                    className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2.5"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 text-primary">
                      <Activity className="h-4 w-4" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-semibold tracking-tight text-foreground">Account</div>
                      <div className="type-meta">Manage your profile</div>
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                  </Link>
                )}
              </div>
            )}
 </ServerTabCard>

 {/* Quick Actions */}
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
 {quickActions.map((action) => (
          <Link
            key={action.title}
            to={action.href}
            className="group flex items-center gap-2.5 rounded-lg border border-border/70 bg-card px-3 py-2.5"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface-2 ${action.iconClass}`}>
              <action.icon className="h-4 w-4" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold tracking-tight text-foreground">{action.title}</div>
              <div className="type-meta">{action.description}</div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
          </Link>
 ))}
 </div>

 {/* Metrics + Activity */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
 <ServerTabCard className="lg:col-span-3">
 <SectionHeader icon={Activity} title="Resource Utilization" description="Latest metrics across all nodes" />

 {resourcesLoading ? (
 <TabLoadingState rows={2} />
 ) : resourcesError ? (
 <TabErrorState title="Unable to load resources" description="Resource utilization is currently unavailable." />
 ) : (
 <div className="mt-6 space-y-5">
 {resourceMetrics.map((metric) => (
 <div key={metric.label} className="space-y-2">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-2">
 <div className="rounded-lg bg-surface-2 p-1.5">
 <metric.icon className={`h-4 w-4 ${metric.color}`} />
 </div>
 <span className="text-sm font-medium text-foreground">{metric.label}</span>
 </div>
 <span className="type-numeric text-sm font-semibold text-foreground">{metric.value}%</span>
 </div>
 <div className="h-2 overflow-hidden rounded-full bg-surface-2">
 <div
 className={`h-full rounded-full ${metric.bg} transition-all duration-500`}
 style={{ width: `${Math.min(100, metric.value)}%` }}
 />
 </div>
 </div>
 ))}
 </div>
 )}
 </ServerTabCard>

 <ServerTabCard className="lg:col-span-2">
 <div className="flex items-center justify-between">
 <SectionHeader icon={Clock} title="Recent Activity" />
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

 {activitiesLoading ? (
 <TabLoadingState rows={3} />
 ) : activitiesError ? (
 <TabErrorState title="Unable to load activity" description="Recent activity could not be loaded." />
 ) : activities && activities.length > 0 ? (
 <div className="mt-4 space-y-1">
 {activities.map((item) => (
 <div
 key={item.id}
 className="flex items-start gap-3 rounded-lg p-3 transition-colors hover:bg-surface-2"
 >
 <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2">
 <Zap className="h-4 w-4 text-muted-foreground" />
 </div>
 <div className="min-w-0 flex-1">
 <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
 <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
 <span className="truncate">{item.detail}</span>
 <span className="shrink-0 text-muted-foreground">|</span>
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
 <div className="mt-4">
 <TabEmptyState title="No recent activity" description="No recorded actions in this window." />
 </div>
 )}
 </ServerTabCard>

 {/* Plugin extension point — plugins register via components: [{ slot: 'dashboard-widgets', … }] */}
 <PluginSlot
 name="dashboard-widgets"
 className="lg:col-span-2 space-y-3"
 />
 </div>
 </div>
 );
}

export default DashboardPage;
