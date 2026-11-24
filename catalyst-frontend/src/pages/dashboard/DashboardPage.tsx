import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { formatNumber } from '@/i18n/format';
import { formatRelativeTime } from '../../utils/formatters';
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useDashboardStats, useDashboardActivity, useResourceStats } from '../../hooks/useDashboard';
import { useServers } from '../../hooks/useServers';
import { ArrowRight, Bell, Plus } from 'lucide-react';
import type { DashboardActivity } from '../../services/api/dashboard';
import { PluginSlot } from '../../plugins/PluginSlot';
import { serverStatusLabel } from '../../utils/constants';
import { auditActionLabel, auditResourceLabel } from '../../utils/logLabels';
import { BracketLabel, Meter, StatusLed } from '../../components/deck/primitives';
import { Skeleton } from '../../components/shared/Skeleton';
import { buttonVariants } from '../../components/ui/button';
import { cn } from '@/lib/utils';
import { hasAnyPermission } from '../../components/auth/ProtectedRoute';

// Statuses that mean "this server needs an operator" on the fleet wall.
const DOWN_STATUSES = new Set(['crashed', 'error', 'suspended', 'unhealthy']);
const MAX_ATTENTION_ITEMS = 8;
const MAX_SERVER_ATTENTION_ITEMS = MAX_ATTENTION_ITEMS - 2;
/** Relative timestamps advance on their own: 1s while fresh, 15s once an hour old. */
const TICK_MS = 1_000;
const SLOW_TICK_MS = 15_000;
const FRESH_WINDOW_MS = 60_000;

interface AttentionItem {
  key: string;
  tone: 'danger' | 'warning';
  title: string;
  detail: string;
  to: string;
}

type LedTone = 'go' | 'hazard' | 'alarm' | 'idle' | 'info';

/** Load severity belongs on the reading; the meter is only a glance. */
function severityClass(value: number | null) {
  if (value == null) return undefined;
  return value >= 90 ? 'text-danger' : value >= 75 ? 'text-warning' : undefined;
}

/**
 * Wall-clock reference for relative activity times. `formatRelativeTime` reads
 * `Date.now()` on every call, so without a ticker the feed freezes at whatever
 * "2m ago" was when the query last settled. Same adaptive cadence as
 * `useDataFreshness`: 1s while the reading is fresh, 15s once it is older.
 */
function useTickingNow(newest: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const fresh = newest === 0 || Date.now() - newest < FRESH_WINDOW_MS;
    const timer = window.setTimeout(() => setNow(Date.now()), fresh ? TICK_MS : SLOW_TICK_MS);
    return () => window.clearTimeout(timer);
  }, [newest, now]);
  return now;
}

/** First eight characters of an id — the same shape the audit page shows. */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/**
 * Human summary for one activity row.
 *
 * The API's `detail` is the raw stored audit blob whenever an entry has no
 * `resourceId` (`{"ip":"127.0.0.1","_meta":{…}}`), which is unreadable in a
 * feed. When the payload is structured, pull the actor / action / resource out
 * of it and label them; the whole blob stays on the audit-logs page. Otherwise
 * the `resource: <short id>` shorthand is localized.
 */
function summarizeActivity(
  t: TFunction,
  item: DashboardActivity,
): { title: string; meta: string } {
  const raw = typeof item.detail === 'string' ? item.detail.trim() : '';

  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as {
        _meta?: { action?: string; resource?: string; resourceId?: string };
        _actor?: { username?: string; name?: string };
      };
      const actor = parsed._actor?.name || parsed._actor?.username;
      const resource = parsed._meta?.resource
        ? parsed._meta.resourceId
          ? `${auditResourceLabel(t, parsed._meta.resource)} ${shortId(parsed._meta.resourceId)}`
          : auditResourceLabel(t, parsed._meta.resource)
        : '';
      const parts = [resource, actor ? t('activity.byActor', { actor }) : ''].filter(Boolean);
      return {
        title: parsed._meta?.action ? auditActionLabel(t, parsed._meta.action) : item.title,
        meta: parts.join(' · '),
      };
    } catch {
      // Unparseable JSON is still stored data, not a sentence: show the action only.
      return { title: item.title, meta: '' };
    }
  }

  const resourceShorthand = /^([A-Za-z_]+):\s*(.+)$/.exec(raw);
  if (resourceShorthand) {
    return {
      title: item.title,
      meta: `${auditResourceLabel(t, resourceShorthand[1])} · ${resourceShorthand[2]}`,
    };
  }

  return { title: item.title, meta: raw };
}

/** One vitals reading: overline label, mono value, optional meter + sub. */
function VitalsRow({
  label,
  value,
  sub,
  to,
  meter,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  to?: string;
  meter?: number | null;
  tone?: 'default' | 'warning' | 'danger';
}) {
  const valueCls =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-warning'
        : severityClass(meter ?? null);
  const body = (
    <>
      <span className="type-overline min-w-0 shrink-0 truncate">{label}</span>
      <span className={cn('min-w-0 shrink-0 truncate font-mono text-sm font-semibold tabular-nums', valueCls)}>
        {value}
      </span>
      {meter !== undefined ? <span className="hidden sm:inline-flex"><Meter value={meter} width="w-16" /></span> : null}
      <span className="min-w-0 flex-1 truncate text-right type-meta">{sub}</span>
    </>
  );
  const cls = 'flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors';
  if (to) {
    return (
      <Link to={to} className={cn(cls, 'hover:bg-surface-1/40 focus-visible:bg-surface-1/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/50')}>
        {body}
      </Link>
    );
  }
  return <div className={cls}>{body}</div>;
}

function AttentionRow({ item }: { item: AttentionItem }) {
  return (
    <Link
      to={item.to}
      className="group flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-surface-1/40 focus-visible:bg-surface-1/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/50"
    >
      <StatusLed tone={item.tone === 'danger' ? 'alarm' : 'hazard'} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate font-display text-data font-semibold text-foreground group-hover:text-primary">
          {item.title}
        </span>
        <span className="type-overline shrink-0">{item.detail}</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

// Status-carrier LED per activity type.
const activityTone: Record<DashboardActivity['type'], LedTone> = {
  server: 'info',
  backup: 'go',
  node: 'hazard',
  alert: 'alarm',
  user: 'idle',
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
  const canCreateNodes = hasAnyPermission(user?.permissions, ['node.create']);
  const canManageTemplates = hasAnyPermission(user?.permissions, ['template.create']);
  const canCreateServers = hasAnyPermission(user?.permissions, ['server.create']);

  // ── Attention feed: only what needs an operator, most severe first ──
  const attentionFeed = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    for (const server of servers) {
      if (items.length >= MAX_SERVER_ATTENTION_ITEMS) break;
      if (DOWN_STATUSES.has(server.status)) {
        items.push({
          key: server.id,
          tone: server.status === 'suspended' || server.status === 'unhealthy' ? 'warning' : 'danger',
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

  // Keep the dashboard's operator feed bounded even on a large unhealthy fleet,
  // while reserving room for the aggregate node/alert entries — and say so
  // instead of dropping the remainder silently.
  const attentionItems = attentionFeed.slice(0, MAX_ATTENTION_ITEMS);
  const hiddenAttentionCount = attentionFeed.length - attentionItems.length;

  const showAlertsTile = isAdmin || alertsUnacked > 0;
  const showResourceTiles = canReadNodes;

  // Relative times tick on their own instead of freezing at refetch time.
  const newestActivity = useMemo(() => {
    if (!activities?.length) return 0;
    const stamps = activities
      .map((item) => (item.timestamp ? Date.parse(item.timestamp) : 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    return stamps.length ? Math.max(...stamps) : 0;
  }, [activities]);
  // The ticker re-renders this component; each row then re-derives its own
  // label from the clock (a memo would freeze the strings it exists to move).
  useTickingNow(newestActivity);

  // Operators see the alert queue; everyone else is pointed at their fleet.
  const alertsHref = isAdmin ? '/admin/alerts' : '/servers';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── Deck header ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('layout:nav.overview')}</BracketLabel>
          <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            {t('title')}
          </h1>
          <p className="type-meta">
            {t('description', { name: user?.firstName || user?.lastName
              ? [user.firstName, user.lastName].filter(Boolean).join(' ')
              : user?.username || t('accountFallback') })}
          </p>
        </div>
        {alertsUnacked > 0 && (
          <Link
            to={alertsHref}
            className="flex h-8 items-center gap-2 rounded-sm border border-warning/30 bg-warning/10 px-3 font-display text-mini text-foreground transition-colors hover:border-warning/60 hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/50"
          >
            <StatusLed tone="hazard" pulse />
            {t('pendingAlerts', { count: alertsUnacked })}
          </Link>
        )}
      </header>

      {!statsLoading && !statsError && serversTotal === 0 && (
        <section className="deck-panel px-3 py-3" aria-labelledby="onboarding-title">
          <BracketLabel>{t('onboarding.overline')}</BracketLabel>
          <h2 id="onboarding-title" className="mt-2 font-display text-base font-semibold text-foreground">{t('onboarding.title')}</h2>
          <p className="type-meta mt-1">{t('onboarding.description')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {nodesTotal === 0 && canCreateNodes && (
              <Link to="/admin/nodes" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('onboarding.addNode')}
              </Link>
            )}
            {canManageTemplates && (
              <Link to="/admin/templates" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('onboarding.templates')}
              </Link>
            )}
            <Link
              to={canCreateServers ? '/servers?action=create' : '/servers'}
              className={buttonVariants({ variant: 'default', size: 'sm' })}
            >
              {t(canCreateServers ? 'onboarding.createServer' : 'onboarding.browseServers')}
            </Link>
          </div>
        </section>
      )}

      {/* Quick actions — the two things an operator does most, after setup. */}
      {serversTotal > 0 && (canCreateServers || alertsUnacked > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {canCreateServers && (
            <Link to="/servers?action=create" className={buttonVariants({ variant: 'default', size: 'sm' })}>
              <Plus className="h-3.5 w-3.5" />
              {t('quickActions.newServer')}
            </Link>
          )}
          <Link to={alertsHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Bell className="h-3.5 w-3.5" />
            {t('quickActions.viewAlerts')}
          </Link>
        </div>
      )}

      {/* ── Fleet vitals: one framed panel of readings ── */}
      <section className="deck-panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-surface-1/40 px-3 py-2">
          <BracketLabel>{t('vitals.title')}</BracketLabel>
          <Link
            to="/servers"
            className="flex min-h-7 -my-1 items-center gap-1 text-micro text-muted-foreground transition-colors hover:text-primary"
          >
            {t('activity.viewAll')}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {statsLoading ? (
          <div className="space-y-2 px-3 py-3">
            <Skeleton height={12} className="h-3 w-2/3" />
            <Skeleton height={12} className="h-3 w-1/2" />
          </div>
        ) : statsError && !stats ? (
          <div className="flex items-start gap-2.5 px-3 py-3">
            <StatusLed tone="alarm" className="mt-1" />
            <div className="min-w-0">
              <p className="text-mini text-danger">{t('overview.errorTitle')}</p>
              <p className="type-meta mt-0.5">{t('overview.errorDescription')}</p>
            </div>
          </div>
        ) : (
          <div>
            <VitalsRow
              label={t('vitals.servers')}
              value={`${formatNumber(serversOnline)}/${formatNumber(serversTotal)}`}
              sub={t('overview.serversRunning', { servers: serversOnline })}
              to="/servers"
            />
            {canReadNodes && (
              <VitalsRow
                label={t('vitals.nodes')}
                value={`${formatNumber(nodesOnline)}/${formatNumber(nodesTotal)}`}
                sub={t('overview.nodesConnected', { nodes: nodesOnline })}
                to="/admin/nodes"
              />
            )}
            {showResourceTiles && (
              <>
                <VitalsRow
                  label={t('resources.cpu')}
                  value={resourcesError || !resources ? '—' : `${formatNumber(resources.cpuUtilization)}%`}
                  meter={resourcesError || !resources ? null : resources.cpuUtilization}
                />
                <VitalsRow
                  label={t('resources.memory')}
                  value={resourcesError || !resources ? '—' : `${formatNumber(resources.memoryUtilization)}%`}
                  meter={resourcesError || !resources ? null : resources.memoryUtilization}
                />
                <VitalsRow
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
              <VitalsRow
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
      </section>

      {/* ── Attention + activity ── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-5 lg:items-start">
        <section className="deck-panel overflow-hidden lg:col-span-2">
          <div className="border-b border-border/50 bg-surface-1/40 px-3 py-2">
            <BracketLabel tone={attentionItems.length > 0 ? 'hazard' : 'muted'}>
              {t('attention.title')}
            </BracketLabel>
          </div>
          {attentionItems.length > 0 ? (
            <div>
              {attentionItems.map((item) => (
                <AttentionRow key={item.key} item={item} />
              ))}
              {hiddenAttentionCount > 0 && (
                <Link
                  to="/servers"
                  className="flex items-center gap-1 border-t border-border/50 px-3 py-2 text-micro text-muted-foreground transition-colors hover:text-primary focus-visible:bg-surface-1/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/50"
                >
                  {t('attention.andMore', { count: hiddenAttentionCount })}
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2.5 px-3 py-3">
              <StatusLed tone="go" pulse />
              <div className="min-w-0">
                <div className="type-overline">{t('attention.allClear')}</div>
                <div className="type-meta">{t('attention.allClearDetail')}</div>
              </div>
            </div>
          )}
        </section>

        <section className="deck-panel overflow-hidden lg:col-span-3">
          <div className="flex items-center justify-between gap-3 border-b border-border/50 bg-surface-1/40 px-3 py-2">
            <BracketLabel>{t('activity.title')}</BracketLabel>
            {isAdmin && (
              <Link
                to="/admin/audit-logs"
                className="flex min-h-7 -my-1 items-center gap-1 text-micro text-muted-foreground transition-colors hover:text-primary"
              >
                {t('activity.viewAll')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>

          {activitiesLoading ? (
            <div className="space-y-2 px-3 py-3">
              <Skeleton height={12} className="h-3 w-3/4" />
              <Skeleton height={12} className="h-3 w-2/3" />
              <Skeleton height={12} className="h-3 w-1/2" />
            </div>
          ) : activitiesError && !activities ? (
            <div className="flex items-start gap-2.5 px-3 py-3">
              <StatusLed tone="alarm" className="mt-1" />
              <div className="min-w-0">
                <p className="text-mini text-danger">{t('activity.errorTitle')}</p>
                <p className="type-meta mt-0.5">{t('activity.errorDescription')}</p>
              </div>
            </div>
          ) : activities && activities.length > 0 ? (
            <div>
              {activities.map((item) => {
                const summary = summarizeActivity(t, item);
                const time = item.timestamp ? formatRelativeTime(item.timestamp) : item.time;
                const row = (
                  <>
                    <StatusLed tone={activityTone[item.type] ?? 'idle'} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-display text-data font-semibold text-foreground group-hover:text-primary">
                        {summary.title}
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-2 text-mini text-muted-foreground">
                        {summary.meta && <span className="truncate">{summary.meta}</span>}
                        {summary.meta && <span className="shrink-0" aria-hidden>·</span>}
                        <span className="shrink-0 font-mono tabular-nums text-micro">{time}</span>
                      </div>
                    </div>
                    {isAdmin && (
                      <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    )}
                  </>
                );

                const rowClass =
                  'group flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-surface-1/40 focus-visible:bg-surface-1/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/50';

                // Admins land on the entry in the audit trail; the raw detail
                // blob is readable there and never rendered in this feed.
                return isAdmin ? (
                  <Link key={item.id} to="/admin/audit-logs" className={rowClass}>
                    {row}
                  </Link>
                ) : (
                  <div key={item.id} className="group flex w-full items-start gap-2.5 px-3 py-2">
                    {row}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-3">
              <p className="type-overline">{t('activity.emptyTitle')}</p>
              <p className="type-meta mt-1">{t('activity.emptyDescription')}</p>
            </div>
          )}
        </section>

        {/* Plugin extension point — plugins register via components: [{ slot: 'dashboard-widgets', … }] */}
        <PluginSlot
          name="dashboard-widgets"
          className="lg:col-span-5 space-y-3"
          />
      </div>
    </div>
  );
}

export default DashboardPage;
