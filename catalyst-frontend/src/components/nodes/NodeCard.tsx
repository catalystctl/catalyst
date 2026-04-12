import { Link } from 'react-router-dom';
import { Server, Cpu, HardDrive, ExternalLink } from 'lucide-react';
import type { NodeInfo } from '../../types/node';
import NodeStatusBadge from './NodeStatusBadge';

function NodeCard({ node }: { node: NodeInfo }) {
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverCount = node._count?.servers ?? node.servers?.length ?? 0;
  const memoryGB = node.maxMemoryMb ? (node.maxMemoryMb / 1024).toFixed(1) : 0;

  return (
    <div className="group rounded-lg border border-border bg-surface-0 transition-all duration-150 hover:border-primary/30 hover:shadow-surface-md">
      <div className="p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              node.isOnline 
                ? 'bg-emerald-500/10 text-emerald-500' 
                : 'bg-surface-2 text-muted-foreground'
            }`}>
              <Server className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/admin/nodes/${node.id}`}
                  className="text-base font-semibold text-foreground transition-colors hover:text-primary"
                >
                  {node.name}
                </Link>
                <NodeStatusBadge isOnline={node.isOnline} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono">{node.hostname ?? 'hostname n/a'}</span>
                <span className="text-border">·</span>
                <span>Last seen {lastSeen}</span>
              </div>
            </div>
          </div>
          <Link
            to={`/admin/nodes/${node.id}`}
            className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground"
          >
            Manage
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div className="rounded-md border border-border bg-surface-1 p-2.5">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Server className="h-3 w-3" />
              <span>Servers</span>
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
              {serverCount}
            </div>
          </div>
          <div className="rounded-md border border-border bg-surface-1 p-2.5">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Cpu className="h-3 w-3" />
              <span>CPU</span>
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
              {node.maxCpuCores ?? 0}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">cores</span>
            </div>
          </div>
          <div className="rounded-md border border-border bg-surface-1 p-2.5">
            <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <HardDrive className="h-3 w-3" />
              <span>Memory</span>
            </div>
            <div className="mt-1 text-lg font-bold tabular-nums text-foreground">
              {memoryGB}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">GB</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default NodeCard;
