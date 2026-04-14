import { Link } from 'react-router-dom';
import { Server, Cpu, HardDrive, ExternalLink } from 'lucide-react';
import { motion } from 'framer-motion';
import { Badge } from '../../components/ui/badge';
import type { NodeInfo } from '../../types/node';

type Props = {
  node: NodeInfo;
  index?: number;
};

function NodeCard({ node, index = 0 }: Props) {
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverCount = node._count?.servers ?? node.servers?.length ?? 0;
  const memoryGB = node.maxMemoryMb ? (node.maxMemoryMb / 1024).toFixed(1) : '0';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 24,
        delay: index * 0.04,
      }}
      className={`group relative overflow-hidden rounded-xl border bg-card/80 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${
        node.isOnline
          ? 'border-border hover:border-emerald-500/50'
          : 'border-border hover:border-border'
      }`}
    >
      {/* Online indicator strip */}
      <div
        className={`absolute left-0 top-0 h-full w-1 transition-colors ${
          node.isOnline ? 'bg-emerald-500' : 'bg-zinc-300 dark:bg-surface-3'
        }`}
      />

      <div className="p-5 pl-6">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
                node.isOnline
                  ? 'bg-emerald-100 dark:bg-emerald-900/30'
                  : 'bg-surface-2 dark:bg-surface-2'
              }`}
            >
              <Server
                className={`h-4.5 w-4.5 transition-colors ${
                  node.isOnline
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-muted-foreground'
                }`}
              />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <Link
                  to={`/admin/nodes/${node.id}`}
                  className="truncate font-semibold text-foreground transition-colors hover:text-primary dark:text-zinc-100 dark:hover:text-primary-400"
                >
                  {node.name}
                </Link>
                <Badge
                  variant={node.isOnline ? 'success' : 'secondary'}
                  className="shrink-0 gap-1.5"
                >
                  <span className="relative flex h-1.5 w-1.5">
                    {node.isOnline && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    )}
                    <span
                      className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                        node.isOnline ? 'bg-emerald-500' : 'bg-zinc-400'
                      }`}
                    />
                  </span>
                  {node.isOnline ? 'Online' : 'Offline'}
                </Badge>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <span className="font-mono text-[11px] opacity-70">{node.hostname ?? 'hostname n/a'}</span>
                {node.location && (
                  <>
                    <span className="text-zinc-300 dark:text-zinc-700">·</span>
                    <span>{node.location.name}</span>
                  </>
                )}
                <span className="text-zinc-300 dark:text-zinc-700">·</span>
                <span>Last seen {lastSeen}</span>
              </div>
            </div>
          </div>

          <Link
            to={`/admin/nodes/${node.id}`}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary dark:hover:text-primary-400"
          >
            Manage
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>

        {/* Resource stats */}
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <div className="rounded-lg border border-border/50 bg-surface-2/50 p-3 dark:bg-surface-2/30">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Server className="h-3 w-3" />
              <span>Servers</span>
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground dark:text-zinc-100">
              {serverCount}
            </div>
          </div>
          <div className="rounded-lg border border-border/50 bg-surface-2/50 p-3 dark:bg-surface-2/30">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Cpu className="h-3 w-3" />
              <span>CPU</span>
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground dark:text-zinc-100">
              {node.maxCpuCores ?? 0}
              <span className="ml-1 text-xs font-normal text-muted-foreground">cores</span>
            </div>
          </div>
          <div className="rounded-lg border border-border/50 bg-surface-2/50 p-3 dark:bg-surface-2/30">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HardDrive className="h-3 w-3" />
              <span>Memory</span>
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground dark:text-zinc-100">
              {memoryGB}
              <span className="ml-1 text-xs font-normal text-muted-foreground">GB</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export default NodeCard;
