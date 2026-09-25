import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '@/i18n/format';
import { formatRelativeTime } from '../../utils/formatters';
import { useMemo } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useDashboardStats, useDashboardActivity, useResourceStats } from '../../hooks/useDashboard';
import { useServers } from '../../hooks/useServers';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import type { DashboardActivity } from '../../services/api/dashboard';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabErrorState from '../../components/servers/tabs/TabErrorState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import { PluginSlot } from '../../plugins/PluginSlot';
import { serverStatusLabel } from '../../utils/constants';
import { cn } from '@/lib/utils';

// Statuses that mean "this server needs an operator" on the fleet wall.
const DOWN_STATUSES = new Set(['crashed', 'error', 'suspended']);

interface AttentionItem {
  key: string;
  tone: 'danger' | 'warning';
  title: string;
  detail: string;
  to: string;
}

/** Fleet vital tile: overline label, big mono value, optional sub + meter bar. */
function VitalsTile({
  label,
  value,
  sub,
  to,
  bar,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  to?: string;
  bar?: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const valueCls =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-warning'
        : 'text-foreground';
  const cls =
    'flex min-w-0 flex-col gap-0.5 rounded-md border border-border/40 bg-surface-2/20 px-3 py-2.5';
  const body = (
    <>
      <span className="type-overline">{label}</span>
      <span className={cn('type-numeric text-lg leading-6', valueCls)}>{value}</span>
      {sub ? <span className="type-meta truncate">{sub}</span> : null}
      {bar}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={cn(cls, 'pressable transition-colors hover:border-primary/30')}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

function FleetMeter({ percent, cls }: { percent: number; cls: string }) {
  return (
    <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-surface-3">
      <span
        className={cn('block h-full rounded-full transition-all duration-500', cls)}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </span>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <Link
      to={item.to}
      className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2"
    >
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          item.tone === 'danger' ? 'bg-danger' : 'bg-warning',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{item.title}</span>
        <span className="type-meta block truncate">{item.detail}</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

// Status-carrier dot per activity type — replaces the old generic icon chip.
const activityTone: Record<DashboardActivity['type'], string> = {
  server: 'bg-primary',
  backup: 'bg-info',
  node: 'bg-warning',
  alert: 'bg-danger',
  user: 'bg-foreground/30',
};

function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { t } = useTranslation('dashboard');

  const isAdmin = useMemo(
    () =>
      Boolean(
        user?.permissions?.includes('*') ||
          user?.permissions?.includes('admin.write') ||
          user?.permissions?.includes('admin.read'),
      ),
    [user?.permissions],
  );
  // Mirrors the backend /dashboard/resources gate: fleet aggregates are only
  // meaningful with node visibility, otherwise the API returns fake zeros.
  const canReadNodes = useMemo(
    () => isAdmin || Boolean(user?.permissions?.includes('node.read')),
    [isAdmin, user?.permissions],
  );

  const { data: stats, isLoading: statsLoading, isError: statsError } = useDashboardStats();
  const { data: activities, isLoading: activitiesLoading, isError: activitiesError } = useDashboardActivity(8);
  const { data: resources, isError: resourcesError } = useResourceStats();
  const { data: servers = [] } = useServers();

  const serversOnline = stats?.serversOnline ?? 0;
  const serversTotal = stats?.servers ?? 0;
  const nodesOnline = stats?.nodesOnline ?? 0;
  const nodesTotal = stats?.nodes ?? 0;
  const alertsUnacked = stats?.alertsUnacknowledged ?? 0;

  // ── Attention feed: only what needs an operator, most severe first ──
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    for (const server of servers) {
      if (DOWN_STATUSES.has(server.status)) {
        items.push({
          key: server.id,
          tone: server.status === 'suspended' ? 'warning' : 'danger',
          title: server.name,
          detail: serverStatusLabel(t, server.status),
          to: `/servers/${server.id}`,
        });
      }
    }
    const offlineNodes = Math.max(0, nodesTotal - nodesOnline);
    if (canReadNodes && offlineNodes > 0) {
      items.push({
        key: 'nodes-offline',
        tone: 'warning',
        title: t('attention.nodesOffline', { count: offlineNodes }),
        detail: t('vitals.nodes'),
        to: '/admin/nodes',
      });
    }
    if (alertsUnacked > 0) {
      items.push({
        key: 'alerts',
        tone: 'warning',
        title: t('attention.alertsOpen', { count: alertsUnacked }),
        detail: t('vitals.alerts'),
        to: isAdmin ? '/admin/alerts' : '/servers',
      });
    }
    return items;
  }, [servers, nodesTotal, nodesOnline, alertsUnacked, canReadNodes, isAdmin, t]);

  const showAlertsTile = isAdmin || alertsUnacked > 0;
  const showResourceTiles = canReadNodes;

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

      {/* ── Fleet vitals strip ── */}
      <ServerTabCard>
        <SectionHeader title={t('vitals.title')} />
        {statsLoading ? (
          <TabLoadingState rows={2} />
        ) : statsError ? (
          <TabErrorState title={t('overview.errorTitle')} description={t('overview.errorDescription')} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <VitalsTile
              label={t('vitals.servers')}
              value={`${formatNumber(serversOnline)}/${formatNumber(serversTotal)}`}
              sub={t('overview.serversRunning', { servers: serversOnline })}
              to="/servers"
            />
            {canReadNodes && (
              <VitalsTile
                label={t('vitals.nodes')}
                value={`${formatNumber(nodesOnline)}/${formatNumber(nodesTotal)}`}
                sub={t('overview.nodesConnected', { nodes: nodesOnline })}
                to="/admin/nodes"
              />
            )}
            {showResourceTiles && (
              <>
                <VitalsTile
                  label={t('resources.cpu')}
                  value={resourcesError || !resources ? '—' : `${formatNumber(resources.cpuUtilization)}%`}
                  bar={<FleetMeter percent={resources?.cpuUtilization ?? 0} cls="bg-primary" />}
                />
                <VitalsTile
                  label={t('resources.memory')}
                  value={resourcesError || !resources ? '—' : `${formatNumber(resources.memoryUtilization)}%`}
                  bar={<FleetMeter percent={resources?.memoryUtilization ?? 0} cls="bg-success" />}
                />
                <VitalsTile
                  label={t('vitals.network')}
                  value={
                    resourcesError || !resources
                      ? '—'
                      : `${formatNumber(resources.networkThroughput)} MB/s`
                  }
                />
              </>
            )}
            {showAlertsTile && (
              <VitalsTile
                label={t('vitals.alerts')}
                value={formatNumber(alertsUnacked)}
                sub={
                  alertsUnacked > 0
                    ? t('overview.alertsUnacknowledged', { alerts: alertsUnacked })
                    : t('overview.allResolved')
                }
                tone={alertsUnacked > 0 ? 'warning' : 'default'}
                to={isAdmin ? '/admin/alerts' : '/servers'}
              />
            )}
          </div>
        )}
      </ServerTabCard>

      {/* ── Attention + activity ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <ServerTabCard className="lg:col-span-2">
          <SectionHeader
            title={t('attention.title')}
            accent={attentionItems.length > 0 ? 'warning' : 'primary'}
          />
          {attentionItems.length > 0 ? (
            <div className="-mx-1 space-y-0.5">
              {attentionItems.map((item) => (
                <AttentionRow key={item.key} item={item} />
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-md px-2 py-3">
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-40" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{t('attention.allClear')}</div>
                <div className="type-meta">{t('attention.allClearDetail')}</div>
              </div>
            </div>
          )}
        </ServerTabCard>

        <ServerTabCard className="lg:col-span-3">
          <div className="flex items-center justify-between">
            <SectionHeader title={t('activity.title')} />
            {isAdmin && (
              <Link
                to="/admin/audit-logs"
                className="mb-3 flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
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
            <div className="-mx-1 space-y-0.5">
              {activities.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-md px-2 py-2 transition-colors hover:bg-surface-2"
                >
                  <span
                    className={cn(
                      'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                      activityTone[item.type] ?? 'bg-foreground/30',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{item.detail}</span>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums">
                        {item.timestamp ? formatRelativeTime(item.timestamp) : item.time}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <TabEmptyState title={t('activity.emptyTitle')} description={t('activity.emptyDescription')} />
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
