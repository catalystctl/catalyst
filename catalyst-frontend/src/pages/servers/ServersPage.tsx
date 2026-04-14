import { useMemo, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import ServerFilters from '../../components/servers/ServerFilters';
import ServerList from '../../components/servers/ServerList';
import CreateServerModal from '../../components/servers/CreateServerModal';
import { useServers } from '../../hooks/useServers';
import type { Server } from '../../types/server';
import { useAuthStore } from '../../stores/authStore';
import { Badge } from '@/components/ui/badge';
import { StatsCard } from '@/components/ui/stats-card';
import { ServerIcon, Play, Square, AlertTriangle, Loader2 } from 'lucide-react';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

function ServersPage() {
  const [filters, setFilters] = useState({});
  const { data, isLoading } = useServers(filters);
  const { user } = useAuthStore();
  const canCreateServer =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('server.create');

  const filtered = useMemo(() => {
    if (!data) return [] as Server[];
    const { search, status } = filters as { search?: string; status?: string };
    return data.filter((server) => {
      const matchesStatus = status ? server.status === status : true;
      const matchesSearch = search
        ? server.name.toLowerCase().includes(search.toLowerCase()) ||
          server.nodeName?.toLowerCase().includes(search.toLowerCase())
        : true;
      return matchesStatus && matchesSearch;
    });
  }, [data, filters]);

  const statusCounts = useMemo(() => {
    const counts = { running: 0, stopped: 0, transitioning: 0, issues: 0 };
    data?.forEach((server) => {
      if (server.status === 'running') { counts.running += 1; return; }
      if (server.status === 'stopped') { counts.stopped += 1; return; }
      if (['installing', 'starting', 'stopping', 'transferring'].includes(server.status)) { counts.transitioning += 1; return; }
      if (server.status === 'crashed' || server.status === 'suspended') { counts.issues += 1; }
    });
    return counts;
  }, [data]);

  const totalServers = data?.length ?? 0;
  const filteredServers = filtered.length;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-primary-500/8 to-primary-300/8 blur-3xl dark:from-primary-500/15 dark:to-primary-300/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-primary-600/8 to-primary-400/8 blur-3xl dark:from-primary-600/15 dark:to-primary-400/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-primary opacity-20 blur-sm" />
                <ServerIcon className="relative h-7 w-7 text-primary-600 dark:text-primary-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                Servers
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Manage your game servers, monitor resources, and control power states.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {totalServers} server{totalServers === 1 ? '' : 's'}
            </Badge>
            {canCreateServer && <CreateServerModal />}
          </div>
        </motion.div>

        {/* ── Stats Grid ── */}
        <motion.div variants={itemVariants} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <StatsCard
            title="Total"
            value={totalServers}
            subtitle={filteredServers === totalServers ? 'All servers' : `${filteredServers} visible`}
            icon={<ServerIcon className="h-4 w-4" />}
            onClick={() => setFilters({})}
          />
          <StatsCard
            title="Running"
            value={statusCounts.running}
            subtitle="Active right now"
            icon={<Play className="h-4 w-4" />}
            variant="success"
            onClick={() => setFilters({ status: 'running' })}
          />
          <StatsCard
            title="Stopped"
            value={statusCounts.stopped}
            subtitle="Ready to start"
            icon={<Square className="h-4 w-4" />}
            onClick={() => setFilters({ status: 'stopped' })}
          />
          <StatsCard
            title="Issues"
            value={statusCounts.issues}
            subtitle="Needs attention"
            icon={<AlertTriangle className="h-4 w-4" />}
            variant="danger"
            onClick={() => setFilters({ status: 'crashed' })}
          />
        </motion.div>

        {/* ── Filters ── */}
        <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border/50 bg-card/60 p-4 backdrop-blur-sm">
          <ServerFilters onChange={setFilters} />
        </motion.div>

        {/* ── Server List ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="flex items-center justify-center rounded-xl border border-border bg-card/80 py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </motion.div>
        ) : (
          <ServerList servers={filtered} />
        )}
      </div>
    </motion.div>
  );
}

export default ServersPage;
