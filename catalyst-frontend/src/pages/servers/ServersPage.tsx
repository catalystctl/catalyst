import { useMemo, useState } from 'react';
import ServerFilters from '../../components/servers/ServerFilters';
import ServerList from '../../components/servers/ServerList';
import CreateServerModal from '../../components/servers/CreateServerModal';
import { useServers } from '../../hooks/useServers';
import type { Server } from '../../types/server';
import { useAuthStore } from '../../stores/authStore';
import { StatsCard } from '@/components/ui/stats-card';
import { ServerIcon, Play, Square, AlertTriangle } from 'lucide-react';

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
    const counts = {
      running: 0,
      stopped: 0,
      transitioning: 0,
      issues: 0,
    };
    data?.forEach((server) => {
      if (server.status === 'running') {
        counts.running += 1;
        return;
      }
      if (server.status === 'stopped') {
        counts.stopped += 1;
        return;
      }
      if (
        server.status === 'installing' ||
        server.status === 'starting' ||
        server.status === 'stopping' ||
        server.status === 'transferring'
      ) {
        counts.transitioning += 1;
        return;
      }
      if (server.status === 'crashed' || server.status === 'suspended') {
        counts.issues += 1;
      }
    });
    return counts;
  }, [data]);

  const totalServers = data?.length ?? 0;
  const filteredServers = filtered.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-0.5">
          <h1 className="text-xl font-bold tracking-tight text-foreground">Servers</h1>
          <p className="text-sm text-muted-foreground">
            Manage your game servers, monitor resources, and control power states
          </p>
        </div>
        {canCreateServer && <CreateServerModal />}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
          onClick={() => setFilters({ status: 'crashed' })}
        />
      </div>

      <div className="rounded-lg border border-border bg-surface-0 px-3 py-2.5">
        <ServerFilters onChange={setFilters} />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-lg border border-border bg-surface-0 px-6 py-12">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-surface-3 border-t-primary" />
        </div>
      ) : (
        <ServerList servers={filtered} />
      )}
    </div>
  );
}

export default ServersPage;
