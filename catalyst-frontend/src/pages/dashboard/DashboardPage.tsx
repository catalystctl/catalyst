import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/i18n/format';
import { formatRelativeTime } from '../../utils/formatters';
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
 const { t } = useTranslation('dashboard');
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
 label: t('resources.cpu'),
 value: resources?.cpuUtilization ?? 0,
 icon: Cpu,
 color: 'text-primary',
 bg: 'bg-primary',
 },
 {
 label: t('resources.memory'),
 value: resources?.memoryUtilization ?? 0,
 icon: MemoryStick,
 color: 'text-success',
 bg: 'bg-success',
 },
 ],
 [resources?.cpuUtilization, resources?.memoryUtilization, t],
 );

 const quickActions = useMemo(
 () =>
 [
 {
 title: t('quickActions.createServer'),
 description: t('quickActions.createServerDescription'),
 icon: Plus,
 href: '/servers',
 iconClass: 'bg-primary/10 text-primary',
 show: canCreateServer,
 },
 {
 title: t('quickActions.viewServers'),
 description: t('quickActions.viewServersDescription'),
 icon: Server,
 href: '/servers',
 iconClass: 'bg-primary/10 text-primary',
 show: !canCreateServer,
 },
 {
 title: t('quickActions.registerNode'),
 description: t('quickActions.registerNodeDescription'),
 icon: HardDrive,
 href: '/admin/nodes',
 iconClass: 'bg-primary/10 text-primary',
 show: isAdmin,
 },
 {
 title: t('quickActions.viewAlerts'),
 description: alertsUnacked > 0
 ? t('quickActions.viewAlertsAttention', { alerts: alertsUnacked })
 : t('quickActions.viewAlertsAllClear'),
 icon: Shield,
 href: isAdmin ? '/admin/alerts' : '/profile',
 iconClass: alertsUnacked > 0 ? 'bg-warning/10 text-warning' : 'bg-surface-2 text-muted-foreground',
 show: isAdmin,
 },
 {
 title: t('quickActions.profileSettings'),
 description: t('quickActions.profileSettingsDescription'),
 icon: Activity,
 href: '/profile',
 iconClass: 'bg-surface-2 text-muted-foreground',
 show: !isAdmin,
 },
 ].filter((action) => action.show),
 [canCreateServer, isAdmin, alertsUnacked, t],
 );

 return (
 <div className="space-y-4">
 <TabHeader
 icon={LayoutDashboard}
 title={t('title')}
 description={t('description', { name: user?.firstName || user?.lastName
 ? [user.firstName, user.lastName].filter(Boolean).join(' ')
 : user?.username || t('accountFallback') })}
 actions={alertsUnacked > 0 ? (
 <div className="rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">
 {t('pendingAlerts', { count: alertsUnacked })}
 </div>
 ) : undefined}
 />

 <ServerTabCard>
 <SectionHeader icon={BarChart3} title={t('overview.title')} />
 {statsLoading ? (
 <TabLoadingState rows={3} />
 ) : statsError ? (
 <TabErrorState title={t('overview.errorTitle')} description={t('overview.errorDescription')} />
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
                    <div className="type-numeric text-sm font-semibold text-foreground">{formatNumber(serversTotal)}</div>
                    <div className="type-meta">{t('overview.serversRunning', { servers: serversOnline })}</div>
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
                      <div className="type-numeric text-sm font-semibold text-foreground">{formatNumber(nodesTotal)}</div>
                      <div className="type-meta">{t('overview.nodesConnected', { nodes: nodesOnline })}</div>
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
                      <div className="type-numeric text-sm font-semibold text-foreground">{formatNumber(stats?.alerts ?? 0)}</div>
                      <div className="type-meta">
                        {alertsUnacked > 0 ? t('overview.alertsUnacknowledged', { alerts: alertsUnacked }) : t('overview.allResolved')}
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
                      <div className="text-sm font-semibold tracking-tight text-foreground">{t('overview.account')}</div>
                      <div className="type-meta">{t('overview.accountDescription')}</div>
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
 <SectionHeader icon={Activity} title={t('resources.title')} description={t('resources.description')} />

 {resourcesLoading ? (
 <TabLoadingState rows={2} />
 ) : resourcesError ? (
 <TabErrorState title={t('resources.errorTitle')} description={t('resources.errorDescription')} />
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
 <span className="type-numeric text-sm font-semibold text-foreground">{formatNumber(metric.value)}%</span>
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
 <SectionHeader icon={Clock} title={t('activity.title')} />
 {isAdmin && (
 <Link
 to="/admin/audit-logs"
 className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
 >
 {t('activity.viewAll')}
 <ArrowRight className="h-3 w-3" />
 </Link>
 )}
 </div>

 {activitiesLoading ? (
 <TabLoadingState rows={3} />
 ) : activitiesError ? (
 <TabErrorState title={t('activity.errorTitle')} description={t('activity.errorDescription')} />
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
 {item.timestamp ? formatRelativeTime(item.timestamp) : item.time}
 </span>
 </div>
 </div>
 </div>
 ))}
 </div>
 ) : (
 <div className="mt-4">
 <TabEmptyState title={t('activity.emptyTitle')} description={t('activity.emptyDescription')} />
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
