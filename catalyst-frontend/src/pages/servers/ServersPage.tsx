import { useMemo, useState } from 'react';
import ServerFilters from '../../components/servers/ServerFilters';
import ServerList from '../../components/servers/ServerList';
import CreateServerModal from '../../components/servers/CreateServerModal';
import { useServers } from '../../hooks/useServers';
import type { Server } from '../../types/server';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import StatGrid from '../../components/servers/tabs/StatGrid';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import { ServerIcon, BarChart3, LayoutGrid, List, Shield, Users, Globe } from 'lucide-react';

type AccessFilter = 'all' | 'owned' | 'other';

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
 if (['installing', 'starting', 'stopping', 'transferring', 'cloning', 'restoring', 'creating_backup'].includes(server.status)) { counts.transitioning += 1; return; }
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

 return (
 <div className="space-y-4">
 {/* ── Header ── */}
 <TabHeader
 icon={ServerIcon}
 title="Servers"
 description="Manage your game servers, monitor resources, and control power states."
 actions={canCreateServer ? <CreateServerModal /> : undefined}
 />

 {/* ── Stats Grid ── */}
 <ServerTabCard>
 <SectionHeader icon={BarChart3} title="Overview" />
 <StatGrid
 columns={4}
 items={[
 { label: 'Total', value: totalServers },
 { label: 'Running', value: statusCounts.running },
 { label: 'Stopped', value: statusCounts.stopped },
 { label: 'Issues', value: statusCounts.issues },
 ]}
 />
 </ServerTabCard>

 {/* ── Toolbar: Access filter + View toggle + Search/Status ── */}
 <div className="space-y-3">
 {/* Access filter tabs + View toggle */}
 <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-surface-2/40 p-1">
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
          <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-surface-2/40 p-1">
 <button
 type="button"
 onClick={() => setServerViewMode('card')}
 className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
 serverViewMode === 'card'
 ? 'bg-primary text-primary-foreground '
 : 'text-muted-foreground hover:text-foreground'
 }`}
 >
 <LayoutGrid className="h-3.5 w-3.5" />
 Cards
 </button>
 <button
 type="button"
 onClick={() => setServerViewMode('list')}
 className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
 serverViewMode === 'list'
 ? 'bg-primary text-primary-foreground '
 : 'text-muted-foreground hover:text-foreground'
 }`}
 >
 <List className="h-3.5 w-3.5" />
 List
 </button>
 </div>
 </div>

 {/* Filters bar */}
 <div className="rounded-lg border border-border/30 bg-surface-2/20 px-4 py-3">
 <ServerFilters onChange={setFilters} />
 </div>
 </div>

 {/* ── Server List ── */}
 {isLoading ? (
 <TabLoadingState rows={5} />
 ) : (
 <ServerList servers={filtered} viewMode={serverViewMode} />
 )}
 </div>
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
 ? 'bg-primary text-primary-foreground '
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
