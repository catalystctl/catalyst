import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useDashboardStats } from '../../hooks/useDashboard';
import { useAuthStore } from '../../stores/authStore';

/**
 * Live fleet heartbeat for the shell status row — a colored pulse plus an
 * up/total readout. Node operators see node health, everyone else sees their
 * servers. SSE server/node events invalidate the dashboard-stats query, so
 * the dot reacts within seconds; the 60s poll is only a safety net.
 */
export default function FleetHeartbeat() {
  const { t } = useTranslation('layout');
  const user = useAuthStore((s) => s.user);
  const canSeeNodes = Boolean(
    user?.permissions?.includes('*') || user?.permissions?.includes('node.read'),
  );
  const { data: stats } = useDashboardStats();

  const online = canSeeNodes ? (stats?.nodesOnline ?? 0) : (stats?.serversOnline ?? 0);
  const total = canSeeNodes ? (stats?.nodes ?? 0) : (stats?.servers ?? 0);
  if (!stats || total === 0) return null;

  const tone = online === 0 ? 'bg-danger' : online < total ? 'bg-warning' : 'bg-success';
  const label = t('shell.fleetHeartbeat', { online, total });

  return (
    <Link
      to={canSeeNodes ? '/admin/nodes' : '/servers'}
      className="pressable hidden items-center gap-2 rounded-md border border-border/70 bg-card px-2.5 py-1.5 font-mono text-[10px] tabular-nums text-muted-foreground shadow-panel transition-colors hover:border-primary/25 hover:text-foreground sm:flex"
      aria-label={label}
      title={label}
    >
      <span className="relative flex h-1.5 w-1.5">
        {online > 0 && (
          <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-50', tone)} />
        )}
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', tone)} />
      </span>
      <span>
        {online}/{total}
      </span>
    </Link>
  );
}
