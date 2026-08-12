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
 Network,
 ArrowRight,
 Zap,
 Shield,
 Clock,
 Sparkles,
 BarChart3,
} from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
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
 {
 label: 'Network',
 value: resources?.networkThroughput ?? 0,
 icon: Network,
 color: 'text-warning',
 bg: 'bg-warning',
 },
 ],
 [resources?.cpuUtilization, resources?.memoryUtilization, resources?.networkThroughput],
 );

 const quickActions = useMemo(
 () =>
 [
 {
 title: 'Create Server',
 description: 'Deploy a new game server',
 icon: Plus,
 href: '/servers',
 color: 'bg-primary',
 textColor: 'text-primary-foreground',
 show: canCreateServer,
 },
 {
 title: 'View Servers',
 description: 'Manage your servers',
 icon: Server,
 href: '/servers',
 color: 'bg-primary',
 textColor: 'text-primary-foreground',
 show: !canCreateServer,
 },
 {
 title: 'Register Node',
 description: 'Add infrastructure',
 icon: HardDrive,
 href: '/admin/nodes',
 color: 'bg-primary',
 textColor: 'text-primary-foreground',
 show: isAdmin,
 },
 {
 title: 'View Alerts',
 description: alertsUnacked > 0 ? `${alertsUnacked} need attention` : 'All clear',
 icon: Shield,
 href: isAdmin ? '/admin/alerts' : '/profile',
 color: alertsUnacked > 0 ? 'bg-danger' : 'bg-muted-foreground',
 textColor: alertsUnacked > 0 ? 'text-destructive-foreground' : 'text-primary-foreground',
 show: isAdmin,
 },
 {
 title: 'Profile Settings',
 description: 'Manage your account',
 icon: Activity,
 href: '/profile',
 color: 'bg-muted-foreground',
 textColor: 'text-primary-foreground',
 show: !isAdmin,
 },
 ].filter((action) => action.show),
 [canCreateServer, isAdmin, alertsUnacked],
 );

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Sparkles}
 title={`${getGreeting()}, ${user?.firstName || user?.lastName
 ? [user.firstName, user.lastName].filter(Boolean).join(' ')
 : user?.username || 'there'}`}
 description="Overview of your infrastructure at a glance."
 actions={
 <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
 <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
 System healthy
 </div>
 }
 />

 <ServerTabCard>
 <SectionHeader icon={BarChart3} title="Overview" />
 {statsLoading ? (
 <TabLoadingState rows={3} />
 ) : (
 <div className={`grid grid-cols-1 gap-3 ${isAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
 <Link
 to="/servers"
 className="group flex items-center gap-3 rounded-lg border border-border/30 bg-card p-3 transition-colors hover:border-primary/30"
 >
 <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
 <Server className="h-4 w-4" />
 </div>
 <div className="flex-1">
 <div className="text-xl font-bold text-foreground">{serversTotal}</div>
 <div className="text-xs text-muted-foreground">{serversOnline} running</div>
 </div>
 <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
 </Link>

 {isAdmin && (
 <Link
 to="/admin/nodes"
 className="group flex items-center gap-3 rounded-lg border border-border/30 bg-card p-3 transition-colors hover:border-primary/30"
 >
 <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
 <HardDrive className="h-4 w-4" />
 </div>
 <div className="flex-1">
 <div className="text-xl font-bold text-foreground">{nodesTotal}</div>
 <div className="text-xs text-muted-foreground">{nodesOnline} connected</div>
 </div>
 <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
 </Link>
 )}

 {isAdmin && (
 <Link
 to="/admin/alerts"
 className="group flex items-center gap-3 rounded-lg border border-border/30 bg-card p-3 transition-colors hover:border-primary/30"
 >
 <div className="flex h-9 w-9 items-center justify-center rounded-md bg-warning/10 text-warning">
 <AlertTriangle className="h-4 w-4" />
 </div>
 <div className="flex-1">
 <div className="text-xl font-bold text-foreground">{stats?.alerts ?? 0}</div>
 <div className="text-xs text-muted-foreground">
 {alertsUnacked > 0 ? `${alertsUnacked} unacknowledged` : 'All resolved'}
 </div>
 </div>
 <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
 </Link>
 )}

 {!isAdmin && (
 <Link
 to="/profile"
 className="group flex items-center gap-3 rounded-lg border border-border/30 bg-card p-3 transition-colors hover:border-primary/30"
 >
 <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
 <Activity className="h-4 w-4" />
 </div>
 <div className="flex-1">
 <div className="text-xl font-bold text-foreground">Account</div>
 <div className="text-xs text-muted-foreground">Manage your profile</div>
 </div>
 <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
 className="group flex items-center gap-3 rounded-lg border border-border/30 bg-card p-4 transition-colors hover:border-primary/30"
 >
 <div className={`flex h-9 w-9 items-center justify-center rounded-md ${action.color} ${action.textColor}`}>
 <action.icon className="h-4 w-4" />
 </div>
 <div className="flex-1">
 <div className="text-sm font-semibold text-foreground">{action.title}</div>
 <div className="text-xs text-muted-foreground">{action.description}</div>
 </div>
 <ArrowRight className="h-4 w-4 text-muted-foreground transition-all group-hover:text-primary group-hover:translate-x-0.5" />
 </Link>
 ))}
 </div>

 {/* Metrics + Activity */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
 <ServerTabCard className="lg:col-span-3">
 <div className="flex items-center justify-between">
 <SectionHeader icon={Activity} title="Resource Utilization" description="Live metrics across all nodes" />
 <div className="flex items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-0.5 text-[11px] font-medium text-success">
 <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />
 Live
 </div>
 </div>

 {resourcesLoading ? (
 <TabLoadingState rows={3} />
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
 <span className="text-sm font-semibold text-foreground">{metric.value}%</span>
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
 <TabEmptyState title="No recent activity" description="Check back later for updates." />
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
