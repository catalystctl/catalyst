import { useMemo, useState } from 'react';
import { motion, type Variants } from 'framer-motion';
import ServerFilters from '../../components/servers/ServerFilters';
import ServerList from '../../components/servers/ServerList';
import CreateServerModal from '../../components/servers/CreateServerModal';
import { useServers } from '../../hooks/useServers';
import type { Server } from '../../types/server';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import { StatsCard } from '@/components/ui/stats-card';
import { ServerIcon, Play, Square, AlertTriangle, Loader2, LayoutGrid, List, Shield, Users, Globe } from 'lucide-react';

type AccessFilter = 'all' | 'owned' | 'other';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

function ServersPage() {
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all');
  const { data, isLoading } = useServers(filters);
  const user = useAuthStore((s) => s.user);
  const serverViewMode = useThemeStore((s) => s.serverViewMode);
  const setServerViewMode = useThemeStore((s) => s.setServerViewMode);
  const canCreateServer =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('server.create');

  const isAdmin = useMemo(
    () =>
      user?.permissions?.includes('*') ||
      user?.permissions?.includes('admin.read') ||
      user?.permissions?.includes('admin.write'),
    [user?.permissions],
  );

  // Filter servers by access level
  const accessFiltered = useMemo(() => {
    if (!data) return [] as Server[];
    if (accessFilter === 'all') return data;
    return data.filter((server) => {
      const isOwner = server.ownerId === user?.id;
      if (accessFilter === 'owned') return isOwner;
      if (accessFilter === 'other') return !isOwner;
      return true;
    });
  }, [data, accessFilter, user?.id]);

  // Apply text/status filters on top of access filter
  const filtered = useMemo(() => {
    const { search, status } = filters as { search?: string; status?: string };
    return accessFiltered.filter((server) => {
      const matchesStatus = status ? server.status === status : true;
      const matchesSearch = search
        ? server.name.toLowerCase().includes(search.toLowerCase()) ||
          server.nodeName?.toLowerCase().includes(search.toLowerCase())
        : true;
      return matchesStatus && matchesSearch;
    });
  }, [accessFiltered, filters]);

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

  const accessCounts = useMemo(() => {
    const counts = { owned: 0, other: 0 };
    data?.forEach((server) => {
      if (server.ownerId === user?.id) counts.owned += 1;
      else counts.other += 1;
    });
    return counts;
  }, [data, user?.id]);

  const totalServers = data?.length ?? 0;
  const filteredServers = filtered.length;

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-violet-500/8 to-cyan-500/8 blur-3xl dark:from-violet-500/15 dark:to-cyan-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-sky-500/8 to-indigo-500/8 blur-3xl dark:from-sky-500/15 dark:to-indigo-500/15" />
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
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground ">
                Servers
              </h1>
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {totalServers}
              </span>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Manage your game servers, monitor resources, and control power states.
            </p>
          </div>
          <div className="flex items-center gap-2">
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

        {/* ── Toolbar: Access filter + View toggle + Search/Status ── */}
        <motion.div variants={itemVariants} className="space-y-3">
          {/* Access filter tabs + View toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/50 p-1">
              <AccessTab
                active={accessFilter === 'all'}
                onClick={() => setAccessFilter('all')}
                icon={<Globe className="h-3.5 w-3.5" />}
                label="All"
                count={totalServers}
              />
              <AccessTab
                active={accessFilter === 'owned'}
                onClick={() => setAccessFilter('owned')}
                icon={<Users className="h-3.5 w-3.5" />}
                label="Owned"
                count={accessCounts.owned}
              />
              {(isAdmin || accessCounts.other > 0) && (
                <AccessTab
                  active={accessFilter === 'other'}
                  onClick={() => setAccessFilter('other')}
                  icon={<Shield className="h-3.5 w-3.5" />}
                  label="Other"
                  count={accessCounts.other}
                />
              )}
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
              <button
                type="button"
                onClick={() => setServerViewMode('card')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
                  serverViewMode === 'card'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Cards
              </button>
              <button
                type="button"
                onClick={() => setServerViewMode('list')}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
                  serverViewMode === 'list'
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <List className="h-3.5 w-3.5" />
                List
              </button>
            </div>
          </div>

          {/* Filters bar */}
          <div className="overflow-hidden rounded-xl border border-border bg-card px-4 py-3">
            <ServerFilters onChange={setFilters} />
          </div>
        </motion.div>

        {/* ── Server List ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="flex items-center justify-center rounded-xl border border-border bg-card/80 py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </motion.div>
        ) : (
          <ServerList servers={filtered} viewMode={serverViewMode} />
        )}
      </div>
    </motion.div>
  );
}

/* ── Access Tab Button ── */

function AccessTab({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {icon}
      <span>{label}</span>
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
          active
            ? 'bg-white/20 text-primary-foreground'
            : 'bg-surface-2 text-muted-foreground'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

export default ServersPage;
