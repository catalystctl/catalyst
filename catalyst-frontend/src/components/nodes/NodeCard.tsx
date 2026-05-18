import { Link } from 'react-router-dom';
import { Server, Cpu, HardDrive, ExternalLink, AlertTriangle, CheckCircle } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import type { NodeInfo } from '../../types/node';

type Props = {
  node: NodeInfo;
  index?: number;
  latestAgentVersion?: string | null;
};

function NodeCard({ node, latestAgentVersion }: Props) {
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverCount = node._count?.servers ?? node.servers?.length ?? 0;
  const memoryGB = node.maxMemoryMb ? (node.maxMemoryMb / 1024).toFixed(1) : '0';

  // Determine agent version status
  const agentVersion = node.agentVersion;
  const agentOutdated = agentVersion && latestAgentVersion
    ? compareVersions(agentVersion, latestAgentVersion)
    : false;

  return (
    <div
      className={`group relative overflow-hidden rounded-xl border border-border/30 bg-card transition-all duration-200 hover:border-primary/15 hover:shadow-[0_2px_8px_-2px_hsl(var(--primary)/0.06)] ${
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
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                node.isOnline
                  ? 'bg-success/10'
                  : 'bg-surface-2'
              }`}
            >
              <Server
                className={`h-4.5 w-4.5 transition-colors ${
                  node.isOnline
                    ? 'text-success'
                    : 'text-muted-foreground'
                }`}
              />
            </div>
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
                  {node.isOnline ? 'Online' : 'Offline'}
                </Badge>
                {/* Agent version badge */}
                {agentVersion && (
                  <Badge
                    variant={agentOutdated ? 'warning' : 'outline'}
                    className="shrink-0 gap-1 font-mono text-[10px]"
                  >
                    {agentOutdated ? (
                      <AlertTriangle className="h-2.5 w-2.5" />
                    ) : (
                      <CheckCircle className="h-2.5 w-2.5" />
                    )}
                    Agent v{agentVersion}
                    {agentOutdated && latestAgentVersion && (
                      <span className="text-muted-foreground">→ v{latestAgentVersion}</span>
                    )}
                  </Badge>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="font-mono text-[11px] opacity-70">{node.hostname ?? 'hostname n/a'}</span>
                {node.location && (
                  <>
                    <span className="text-muted-foreground">·</span>
                    <span>{node.location.name}</span>
                  </>
                )}
                <span className="text-muted-foreground">·</span>
                <span>Last seen {lastSeen}</span>
              </div>
            </div>
          </div>

          <Link
            to={`/admin/nodes/${node.id}`}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
          >
            Manage
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {/* Resource stats */}
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <div className="rounded-lg border border-border/30 bg-surface-2/30 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Server className="h-3 w-3" />
              <span>Servers</span>
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {serverCount}
            </div>
          </div>
          <div className="rounded-lg border border-border/30 bg-surface-2/30 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Cpu className="h-3 w-3" />
              <span>CPU</span>
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {node.maxCpuCores ?? 0}
              <span className="ml-1 text-xs font-normal text-muted-foreground">cores</span>
            </div>
            {node.cpuOverallocatePercent !== undefined && node.cpuOverallocatePercent !== 0 && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {node.cpuOverallocatePercent === -1
                  ? 'effective: ∞'
                  : `effective: ${((node.maxCpuCores ?? 0) * (1 + node.cpuOverallocatePercent / 100)).toFixed(1)} cores (${node.cpuOverallocatePercent}%)`}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border/30 bg-surface-2/30 p-3">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HardDrive className="h-3 w-3" />
              <span>Memory</span>
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {memoryGB}
              <span className="ml-1 text-xs font-normal text-muted-foreground">GB</span>
            </div>
            {node.memoryOverallocatePercent !== undefined && node.memoryOverallocatePercent !== 0 && (
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {node.memoryOverallocatePercent === -1
                  ? 'effective: ∞'
                  : `effective: ${((node.maxMemoryMb ?? 0) * (1 + node.memoryOverallocatePercent / 100) / 1024).toFixed(1)} GB (${node.memoryOverallocatePercent}%)`}
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
