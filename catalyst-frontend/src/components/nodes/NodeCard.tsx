import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/i18n/format';
import { ExternalLink, AlertTriangle, CheckCircle } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import type { NodeInfo } from '../../types/node';

type Props = {
 node: NodeInfo;
 index?: number;
 latestAgentVersion?: string | null;
};

function NodeCard({ node, latestAgentVersion }: Props) {
 const { t } = useTranslation('nodes');
 const lastSeen = node.lastSeenAt ? formatDateTime(node.lastSeenAt) : t('state.notAvailable');
 const serverCount = node._count?.servers ?? node.servers?.length ?? 0;
 const memoryGB = node.maxMemoryMb ? (node.maxMemoryMb / 1024).toFixed(1) : '0';

 // Determine agent version status
 const agentVersion = node.agentVersion;
 const agentOutdated = agentVersion && latestAgentVersion
 ? compareVersions(agentVersion, latestAgentVersion)
 : false;

 return (
 <div
 className={`group relative overflow-hidden rounded-md border border-border/50 bg-card transition-colors hover:border-primary/20 ${
 node.isOnline
 ? 'hover:border-success/30'
 : ''
 }`}
 >
 {/* Left accent bar */}
 <div
 className={`absolute left-0 top-0 h-full w-1 transition-colors ${
 node.isOnline ? 'bg-success/50' : 'bg-muted'
 }`}
 />

 <div className="p-5 pl-6">
 {/* Header row */}
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0">
 <div className="flex items-center gap-2.5">
 <Link
 to={`/admin/nodes/${node.id}`}
 className="truncate font-semibold text-foreground transition-colors hover:text-primary"
 >
 {node.name}
 </Link>
 <Badge
 variant={node.isOnline ? 'success' : 'secondary'}
 className="shrink-0 gap-1.5"
 >
 <span className="relative flex h-1.5 w-1.5">
 {node.isOnline && (
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
 )}
 <span
 className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
 node.isOnline ? 'bg-success/50' : 'bg-muted'
 }`}
 />
 </span>
 {node.isOnline ? t('common:status.online') : t('common:status.offline')}
 </Badge>
 {/* Agent version badge */}
 {agentVersion && (
 <Badge
 variant={agentOutdated ? 'warning' : 'outline'}
 className="shrink-0 gap-1 font-mono text-[10px] tabular-nums"
 >
 {agentOutdated ? (
 <AlertTriangle className="h-2.5 w-2.5" />
 ) : (
 <CheckCircle className="h-2.5 w-2.5" />
 )}
 {t('card.agentVersion', { version: agentVersion })}
 {agentOutdated && latestAgentVersion && (
 <span className="text-muted-foreground">→ v{latestAgentVersion}</span>
 )}
 </Badge>
 )}
 </div>
 <div className="type-meta mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
 <span className="font-mono text-[11px] tabular-nums opacity-70">{node.hostname ?? t('card.hostnameUnknown')}</span>
 {node.location && (
 <>
 <span className="text-muted-foreground">·</span>
 <span>{node.location.name}</span>
 </>
 )}
 <span className="text-muted-foreground">·</span>
 <span className="font-mono tabular-nums">{t('card.lastSeen', { time: lastSeen })}</span>
 </div>
 </div>

 <Link
 to={`/admin/nodes/${node.id}`}
 className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
 >
 {t('card.manage')}
 <ExternalLink className="h-3 w-3" />
 </Link>
 </div>

 {/* Resource stats */}
 <div className="mt-4 grid grid-cols-3 gap-2.5">
 <div className="rounded-md border border-border/50 bg-surface-2/30 p-3">
 <div className="type-overline">{t('servers.title')}</div>
 <div className="type-numeric mt-1 text-lg text-foreground">
 {serverCount}
 </div>
 </div>
 <div className="rounded-md border border-border/50 bg-surface-2/30 p-3">
 <div className="type-overline">{t('card.cpu')}</div>
 <div className="type-numeric mt-1 text-lg text-foreground">
 {node.maxCpuCores ?? 0}
 <span className="ml-1 text-xs font-normal text-muted-foreground">{t('card.cores')}</span>
 </div>
 {node.cpuOverallocatePercent !== undefined && node.cpuOverallocatePercent !== 0 && (
 <div className="type-meta mt-0.5 tabular-nums">
 {node.cpuOverallocatePercent === -1
 ? t('card.effectiveUnlimited')
 : t('card.effectiveCpu', {
   cores: ((node.maxCpuCores ?? 0) * (1 + node.cpuOverallocatePercent / 100)).toFixed(1),
   percent: node.cpuOverallocatePercent,
 })}
 </div>
 )}
 </div>
 <div className="rounded-md border border-border/50 bg-surface-2/30 p-3">
 <div className="type-overline">{t('card.memory')}</div>
 <div className="type-numeric mt-1 text-lg text-foreground">
 {memoryGB}
 <span className="ml-1 text-xs font-normal text-muted-foreground">GB</span>
 </div>
 {node.memoryOverallocatePercent !== undefined && node.memoryOverallocatePercent !== 0 && (
 <div className="type-meta mt-0.5 tabular-nums">
 {node.memoryOverallocatePercent === -1
 ? t('card.effectiveUnlimited')
 : t('card.effectiveMemory', {
   gb: ((node.maxMemoryMb ?? 0) * (1 + node.memoryOverallocatePercent / 100) / 1024).toFixed(1),
   percent: node.memoryOverallocatePercent,
 })}
 </div>
 )}
 </div>
 </div>
 </div>
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
