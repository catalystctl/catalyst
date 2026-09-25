import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/i18n/format';
import { AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';
import { StatusLed, Segmented } from '../deck/primitives';
import { cn } from '@/lib/utils';
import type { NodeInfo } from '../../types/node';

type Props = {
  node: NodeInfo;
  index?: number;
  latestAgentVersion?: string | null;
};

/**
 * One grid template shared by NodeList's column header and every row, so the
 * columns line up at each breakpoint. Hidden cells drop out of grid placement.
 *   base : identity · actions
 *   md   : identity · cpu · memory · actions
 *   xl   : identity · servers · cpu · memory · actions
 */
export const NODE_GRID =
  'grid grid-cols-1 items-center gap-x-3 gap-y-1 ' +
  'md:grid-cols-[minmax(0,1fr)_7rem_7rem_5.5rem] ' +
  'xl:grid-cols-[minmax(0,1fr)_4.5rem_7rem_7rem_5.5rem]';

/** Dense browser row — no card shell, no per-item stat tiles. */
function NodeCard({ node, latestAgentVersion }: Props) {
  const { t } = useTranslation('nodes');
  const lastSeen = node.lastSeenAt ? formatDateTime(node.lastSeenAt) : t('state.notAvailable');
  const serverCount = node._count?.servers ?? node.servers?.length ?? 0;
  const memoryGB = node.maxMemoryMb ? (node.maxMemoryMb / 1024).toFixed(1) : '0';

  const agentVersion = node.agentVersion;
  const agentOutdated = agentVersion && latestAgentVersion
    ? compareVersions(agentVersion, latestAgentVersion)
    : false;

  return (
    <div
      role="row"
      className={cn(
        NODE_GRID,
        'py-1.5 pl-3 pr-3 transition-colors hover:bg-surface-1/40',
      )}
    >
      {/* identity */}
      <div className="flex min-w-0 items-center gap-2">
        <StatusLed tone={node.isOnline ? 'go' : 'idle'} pulse={node.isOnline} />
        <div className="flex min-w-0 flex-col leading-tight">
          <Link
            to={`/admin/nodes/${node.id}`}
            title={node.name}
            className="truncate font-display text-data font-semibold tracking-tight text-foreground hover:text-primary"
          >
            {node.name}
          </Link>
          <span className="flex min-w-0 items-center gap-2 text-micro text-muted-foreground">
            <span className="truncate font-mono tabular-nums">
              {node.hostname ?? t('card.hostnameUnknown')}
            </span>
            {node.location && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{node.location.name}</span>
              </>
            )}
            {agentVersion && (
              <>
                <span aria-hidden>·</span>
                <span className="flex shrink-0 items-center gap-1 font-mono tabular-nums">
                  {agentOutdated ? (
                    <AlertTriangle className="h-2.5 w-2.5 text-warning" />
                  ) : (
                    <CheckCircle className="h-2.5 w-2.5 text-muted-foreground/60" />
                  )}
                  v{agentVersion.replace(/^v/i, '')}
                  {agentOutdated && latestAgentVersion && (
                    <span className="text-muted-foreground/70">→ v{latestAgentVersion.replace(/^v/i, '')}</span>
                  )}
                </span>
              </>
            )}
            <span className="hidden truncate md:inline">
              {t('card.lastSeen', { time: lastSeen })}
            </span>
          </span>
        </div>
      </div>

      {/* servers */}
      <span className="hidden justify-end xl:flex">
        <Segmented muted={serverCount === 0}>{serverCount}</Segmented>
      </span>

      {/* cpu */}
      <span className="hidden flex-col items-end leading-tight md:flex">
        <Segmented>{node.maxCpuCores ?? 0}</Segmented>
        {node.cpuOverallocatePercent !== undefined && node.cpuOverallocatePercent !== 0 && (
          <span className="truncate text-micro text-muted-foreground">
            {node.cpuOverallocatePercent === -1
              ? t('card.effectiveUnlimited')
              : t('card.effectiveCpu', {
                  cores: ((node.maxCpuCores ?? 0) * (1 + node.cpuOverallocatePercent / 100)).toFixed(1),
                  percent: node.cpuOverallocatePercent,
                })}
          </span>
        )}
      </span>

      {/* memory */}
      <span className="hidden flex-col items-end leading-tight md:flex">
        <Segmented>{memoryGB} GB</Segmented>
        {node.memoryOverallocatePercent !== undefined && node.memoryOverallocatePercent !== 0 && (
          <span className="truncate text-micro text-muted-foreground">
            {node.memoryOverallocatePercent === -1
              ? t('card.effectiveUnlimited')
              : t('card.effectiveMemory', {
                  gb: ((node.maxMemoryMb ?? 0) * (1 + node.memoryOverallocatePercent / 100) / 1024).toFixed(1),
                  percent: node.memoryOverallocatePercent,
                })}
          </span>
        )}
      </span>

      {/* actions */}
      <span className="col-span-full flex shrink-0 items-center justify-start gap-1 md:col-auto md:justify-end">
        <Link
          to={`/admin/nodes/${node.id}`}
          title={t('card.manage')}
          aria-label={t('card.manage')}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </span>
    </div>
  );
}

/** Compare semver-like versions. Returns true if `current` < `latest`. */
function compareVersions(current: string, latest: string): boolean {
  const cur = current.replace(/^v/, '').split('.').map(Number);
  const lat = latest.replace(/^v/, '').split('.').map(Number);
  const maxLen = Math.max(cur.length, lat.length);
  for (let i = 0; i < maxLen; i++) {
    const c = cur[i] || 0;
    const l = lat[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

export default NodeCard;
