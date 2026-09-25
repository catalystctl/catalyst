import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAdminStats, useAdminHealth } from '../../hooks/useAdmin';
import { useAdminNodes } from '../../hooks/useAdmin';

import { useClusterMetrics } from '../../hooks/useClusterMetrics';
import { ClusterResourcesChart } from '../../components/admin/ClusterResourcesChart';
import TabHeader from '../../components/servers/tabs/TabHeader';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import { BracketLabel, StatusLed } from '../../components/deck/primitives';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/i18n/format';
import { Server, Activity, ArrowUpRight, Database } from 'lucide-react';

function AdminDashboardPage() {
  const { t } = useTranslation('admin');
  const { data: stats } = useAdminStats();
  const { data: health, isLoading: healthLoading } = useAdminHealth();
  const { data: nodesData } = useAdminNodes();
  const { data: clusterMetrics, isLoading: metricsLoading } = useClusterMetrics(60_000);

  const nodes = nodesData?.nodes ?? [];
  const onlineNodes = nodes.filter((n) => n.isOnline).length;
  const offlineNodes = nodes.length - onlineNodes;

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <TabHeader
        icon={Activity}
        title={t('dashboard.title')}
        description={t('dashboard.description', {
          servers: stats?.servers ?? 0,
          nodes: stats?.nodes ?? 0,
          users: stats?.users ?? 0,
        })}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" className="h-8 px-3 text-mini" asChild>
              <Link to="/admin/nodes">{t('dashboard.nav.nodes')}</Link>
            </Button>
            <Button variant="outline" size="sm" className="h-8 px-3 text-mini" asChild>
              <Link to="/admin/system">{t('dashboard.nav.settings')}</Link>
            </Button>
          </div>
        }
      />

      {/* ── Charts & Health ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ClusterResourcesChart data={clusterMetrics} isLoading={metricsLoading} />
        </div>

        <div className="deck-panel lg:col-span-1">
          <div className="flex items-center border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
            <BracketLabel>{t('dashboard.health.title')}</BracketLabel>
          </div>
          <div className="divide-y divide-border/40">
            <HealthRow
              label={t('dashboard.health.database')}
              status={health?.database === 'connected'}
              loading={healthLoading}
              icon={Database}
            />
            <HealthRow
              label={t('dashboard.health.clusterNodes')}
              status={onlineNodes > 0 && offlineNodes === 0}
              loading={healthLoading}
              detail={`${onlineNodes}/${nodes.length}`}
              icon={Server}
            />
            {!healthLoading && (
              <div className="flex items-center justify-between px-3 py-1.5 text-mini text-muted-foreground">
                <span>{t('dashboard.health.lastChecked')}</span>
                <span className="font-mono tabular-nums">{formatTime(Date.now())}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="deck-panel">
        <div className="flex items-center justify-between border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
          <BracketLabel>{t('dashboard.nodes.title')}</BracketLabel>
          <Button variant="ghost" size="sm" asChild className="h-7 gap-1 px-2 text-mini">
            <Link to="/admin/nodes">
              {t('dashboard.nodes.manage')} <ArrowUpRight className="h-3 w-3" />
            </Link>
          </Button>
        </div>
        {nodes.length === 0 ? (
          <TabEmptyState
            title={t('dashboard.nodes.emptyTitle')}
            description={t('dashboard.nodes.emptyDescription')}
            action={
              <Button variant="outline" size="sm" className="h-8 px-3 text-mini" asChild>
                <Link to="/admin/nodes">{t('dashboard.nodes.addNode')}</Link>
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-border/40">
            {nodes.slice(0, 8).map((node) => (
              <Link
                key={node.id}
                to={`/admin/nodes/${node.id}`}
                className="flex items-center justify-between gap-3 px-3 py-1.5 transition-colors hover:bg-surface-1/40"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <StatusLed tone={node.isOnline ? 'go' : 'alarm'} />
                  <span className="truncate text-data text-foreground">{node.name}</span>
                </div>
                <span className="text-mini text-muted-foreground">
                  {t('dashboard.nodes.serverCount', { value: node._count?.servers ?? 0 })}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Health Row ──
function HealthRow({
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
  const { t } = useTranslation('admin');
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-mini text-foreground">{label}</span>
      </div>
      {loading ? (
        <span className="text-mini text-muted-foreground">
          {t('dashboard.health.checking')}
        </span>
      ) : (
        <span
          className={`font-mono text-mini tabular-nums ${status ? 'text-success' : 'text-danger'}`}
        >
          {detail ?? (status ? t('dashboard.health.ok') : t('dashboard.health.down'))}
        </span>
      )}
    </div>
  );
}

export default AdminDashboardPage;
