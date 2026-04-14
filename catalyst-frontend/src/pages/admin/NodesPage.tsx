import { useMemo, useState } from 'react';
import { Server, Cpu, HardDrive, Activity, Search } from 'lucide-react';
import { motion, type Variants } from 'framer-motion';
import EmptyState from '../../components/shared/EmptyState';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAdminNodes } from '../../hooks/useAdmin';
import { useAuthStore } from '../../stores/authStore';
import NodeCard from '../../components/nodes/NodeCard';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

// ── Stat Mini Card ──
function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub: string;
  color: string;
  loading?: boolean;
}) {
  return (
    <motion.div variants={itemVariants} className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-foreground dark:text-zinc-100">
        {loading ? (
          <span className="inline-block h-7 w-16 animate-pulse rounded bg-surface-3" />
        ) : (
          value
        )}
      </div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </motion.div>
  );
}

function AdminNodesPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useAdminNodes({ search: search.trim() || undefined });
  const { user } = useAuthStore();
  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );
  const nodes = data?.nodes ?? [];
  const locationId = nodes[0]?.locationId ?? '';

  const onlineNodes = nodes.filter((node) => node.isOnline);
  const offlineNodes = nodes.filter((node) => !node.isOnline);
  const totalServers = nodes.reduce((acc, node) => acc + (node._count?.servers ?? 0), 0);
  const totalCpu = nodes.reduce((acc, node) => acc + (node.maxCpuCores ?? 0), 0);
  const totalMemory = nodes.reduce((acc, node) => acc + (node.maxMemoryMb ?? 0), 0);

  const formatMemory = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb} MB`;
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-emerald-500/8 to-cyan-500/8 blur-3xl dark:from-emerald-500/15 dark:to-cyan-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-sky-500/8 to-violet-500/8 blur-3xl dark:from-sky-500/15 dark:to-violet-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 opacity-20 blur-sm" />
                <Server className="relative h-7 w-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                Nodes
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Manage infrastructure nodes and monitor availability
            </p>
          </div>

          {canWrite && (
            <NodeCreateModal locationId={locationId} />
          )}
        </motion.div>

        {/* ── Summary Stats ── */}
        <motion.div
          variants={itemVariants}
          className="grid grid-cols-2 gap-3 sm:grid-cols-4"
        >
          <StatCard
            icon={Activity}
            label="Online"
            value={onlineNodes.length}
            sub={`of ${nodes.length} nodes`}
            color="text-emerald-500"
            loading={isLoading}
          />
          <StatCard
            icon={Server}
            label="Servers"
            value={totalServers}
            sub="across all nodes"
            color="text-primary-500"
            loading={isLoading}
          />
          <StatCard
            icon={Cpu}
            label="CPU Cores"
            value={totalCpu}
            sub="total capacity"
            color="text-amber-500"
            loading={isLoading}
          />
          <StatCard
            icon={HardDrive}
            label="Memory"
            value={formatMemory(totalMemory)}
            sub="total capacity"
            color="text-violet-500"
            loading={isLoading}
          />
        </motion.div>

        {/* ── Search Bar ── */}
        <motion.div
          variants={itemVariants}
          className="flex flex-wrap items-center gap-3"
        >
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search nodes by name or hostname…"
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            {offlineNodes.length > 0 && (
              <Badge variant="destructive" className="gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                {offlineNodes.length} offline
              </Badge>
            )}
            {!isLoading && (
              <span className="text-xs text-muted-foreground">
                {nodes.length} node{nodes.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </motion.div>

        {/* ── Node Grid ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="relative overflow-hidden rounded-xl border border-border bg-card/80"
              >
                <div className="absolute left-0 top-0 h-full w-1 bg-surface-3" />
                <div className="p-5 pl-6">
                  <div className="flex items-start gap-3">
                    <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-3" />
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="h-5 w-32 animate-pulse rounded bg-surface-3" />
                        <div className="h-5 w-16 animate-pulse rounded-full bg-surface-3" />
                      </div>
                      <div className="h-3 w-48 animate-pulse rounded bg-surface-2" />
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2.5">
                    {[1, 2, 3].map((j) => (
                      <div key={j} className="h-16 animate-pulse rounded-lg bg-surface-2/50" />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        ) : nodes.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            {nodes.map((node, i) => (
              <NodeCard key={node.id} node={node} index={i} />
            ))}
          </div>
        ) : (
          <motion.div variants={itemVariants}>
            <EmptyState
              title={search.trim() ? 'No nodes found' : 'No nodes detected'}
              description={
                search.trim()
                  ? 'Try a different node name or hostname.'
                  : 'Install the Catalyst agent and register nodes to begin.'
              }
              action={
                canWrite && !search.trim() ? (
                  <NodeCreateModal locationId={locationId} />
                ) : undefined
              }
            />
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

export default AdminNodesPage;
