import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { Server, MapPin, Search } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import NodeList from '../../components/nodes/NodeList';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import LocationsManagerModal from '../../components/nodes/LocationsManagerModal';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import { useNodes } from '../../hooks/useNodes';
import { useAuthStore } from '../../stores/authStore';
import { locationsApi } from '../../services/api/locations';
import type { Location } from '../../services/api/locations';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';

// ── Location Section Header ──
function LocationSectionHeader({ location, count }: { location: Location | null; count: number }) {
 if (location) {
 return (
 <div className="sticky top-0 z-10 border-b border-border/30 bg-surface-1/80 px-4 py-2 backdrop-blur-sm">
 <div className="flex items-center gap-2">
 <MapPin className="h-4 w-4 text-success" />
 <h3 className="text-sm font-semibold text-foreground">
 {location.name}
 </h3>
 <Badge variant="secondary" className="text-[10px]">
 {count} node{count !== 1 ? 's' : ''}
 </Badge>
 {location.description && (
 <span className="hidden text-xs text-muted-foreground sm:inline">
 {location.description}
 </span>
 )}
 </div>
 </div>
 );
 }

 return (
 <div className="sticky top-0 z-10 border-b border-border/30 bg-surface-1/80 px-4 py-2 backdrop-blur-sm">
 <div className="flex items-center gap-2">
 <MapPin className="h-4 w-4 text-muted-foreground" />
 <h3 className="text-sm font-semibold text-foreground">Unassigned</h3>
 <Badge variant="secondary" className="text-[10px]">
 {count} node{count !== 1 ? 's' : ''}
 </Badge>
 </div>
 </div>
 );
}

// ── Main Component ──
type Props = {
 hideHeader?: boolean;
};

function NodesPage({ hideHeader }: Props) {
 const { data: nodes = [], isLoading } = useNodes();
 const user = useAuthStore((s) => s.user);
 const { data: updateData } = useUpdateCheck();
 const canWrite = useMemo(
 () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
 [user?.permissions],
 );

 const { data: locations = [] } = useQuery({
 queryKey: qk.locations(),
 queryFn: locationsApi.list,
 refetchInterval: 15000,
 });

 const [search, setSearch] = useState('');
 const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
 const [locationsModalOpen, setLocationsModalOpen] = useState(false);

 // Listen for custom events from node modals to open locations manager
 useEffect(() => {
 const handler = () => setLocationsModalOpen(true);
 window.addEventListener('catalyst:open-locations-modal', handler);
 return () => window.removeEventListener('catalyst:open-locations-modal', handler);
 }, []);

 // ── Derived data ──
 const onlineCount = useMemo(() => nodes.filter((n) => n.isOnline).length, [nodes]);
 const offlineCount = useMemo(() => nodes.filter((n) => !n.isOnline).length, [nodes]);

 // Build a location lookup map for grouping
 const locationMap = useMemo(() => {
 const map = new Map<string, Location>();
 for (const loc of locations) {
 map.set(loc.id, loc);
 }
 return map;
 }, [locations]);

 // Nodes filtered by search and location
 const filteredNodes = useMemo(() => {
 let filtered = nodes;
 if (search.trim()) {
 const query = search.trim().toLowerCase();
 filtered = filtered.filter(
 (n) =>
 n.name.toLowerCase().includes(query) ||
 n.hostname?.toLowerCase().includes(query) ||
 n.description?.toLowerCase().includes(query),
 );
 }
 if (selectedLocationId === '__unassigned__') {
 filtered = filtered.filter((n) => !n.locationId);
 } else if (selectedLocationId !== null) {
 filtered = filtered.filter((n) => n.locationId === selectedLocationId);
 }
 return filtered;
 }, [nodes, search, selectedLocationId]);

 // Group nodes by location (used when "All" is selected)
 const groupedByLocation = useMemo(() => {
 const groups = new Map<string | null, typeof nodes>();
 for (const n of filteredNodes) {
 const key = n.locationId || null;
 if (!groups.has(key)) groups.set(key, []);
 groups.get(key)!.push(n);
 }
 // Sort: locations first (sorted by location name), then unassigned last
 const entries = Array.from(groups.entries()).sort((a, b) => {
 if (a[0] === null) return 1; // unassigned goes last
 if (b[0] === null) return -1;
 const locA = locationMap.get(a[0]!);
 const locB = locationMap.get(b[0]!);
 return (locA?.name || '').localeCompare(locB?.name || '');
 });
 return entries;
 }, [filteredNodes, locationMap]);

 // Count nodes per location for the tab badges
 const locationCounts = useMemo(() => {
 const counts = new Map<string, number>();
 let unassignedCount = 0;
 for (const n of nodes) {
 if (n.locationId) {
 counts.set(n.locationId, (counts.get(n.locationId) || 0) + 1);
 } else {
 unassignedCount++;
 }
 }
 return { counts, unassignedCount };
 }, [nodes]);

 // Determine whether to show grouped or flat view
 const showGroupedView = selectedLocationId === null && locations.length > 0;

 return (
 <div className="space-y-4">
 {!hideHeader && (
 <>
 {/* ── Header ── */}
 <TabHeader
 icon={Server}
 title="Nodes"
 description="Track connected infrastructure nodes."
 actions={
 <div className="flex flex-wrap items-center gap-2">
 {isLoading ? (
 <>
 <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
 <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
 </>
 ) : (
 <>
 <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
 <span className="h-2 w-2 rounded-full bg-muted-foreground" />
 {nodes.length} nodes
 </Badge>
 <Badge variant="success" className="h-8 gap-1.5 px-3 text-xs">
 <span className="h-2 w-2 rounded-full bg-success" />
 {onlineCount} online
 </Badge>
 {offlineCount > 0 && (
 <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
 <span className="h-2 w-2 rounded-full bg-destructive/60" />
 {offlineCount} offline
 </Badge>
 )}
 {locations.length > 0 && (
 <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
 <MapPin className="h-2.5 w-2.5" />
 {locations.length} location{locations.length !== 1 ? 's' : ''}
 </Badge>
 )}
 </>
 )}
 {canWrite && (
 <button
 className="rounded-lg border border-border/40 px-3 py-2 text-sm font-semibold text-muted-foreground transition-all hover:border-primary hover:text-foreground"
 onClick={() => setLocationsModalOpen(true)}
 >
 <MapPin className="mr-1.5 inline h-4 w-4" />
 Locations
 </button>
 )}
 {canWrite ? (
 <NodeCreateModal />
 ) : (
 <span className="text-xs text-muted-foreground">Admin access required</span>
 )}
 </div>
 }
 />

 {/* ── Search Bar ── */}
 <div className="flex flex-wrap items-center gap-2.5">
 {/* Search input */}
 <div className="relative min-w-[200px] flex-1 max-w-sm">
 <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="Search nodes by name or hostname…"
 className="pl-9"
 />
 </div>

 {/* Results count */}
 <span className="text-xs text-muted-foreground">
 {filteredNodes.length} of {nodes.length}
 </span>
 </div>

 {/* ── Location Selector Tabs ── */}
 {locations.length > 0 && (
 <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
 <button
 className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
 selectedLocationId === null
 ? 'bg-primary text-primary-foreground shadow-sm'
 : 'bg-surface-2 text-muted-foreground hover:text-foreground'
 }`}
 onClick={() => setSelectedLocationId(null)}
 >
 All
 <span
 className={`text-[10px] ${selectedLocationId === null ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}
 >
 {nodes.length}
 </span>
 </button>
 {locations.map((location) => {
 const count = locationCounts.counts.get(location.id) || 0;
 if (count === 0) return null;
 return (
 <button
 key={location.id}
 className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
 selectedLocationId === location.id
 ? 'bg-primary text-primary-foreground shadow-sm'
 : 'bg-surface-2 text-muted-foreground hover:text-foreground'
 }`}
 onClick={() => setSelectedLocationId(location.id)}
 >
 <MapPin className="h-3.5 w-3.5" />
 {location.name}
 <span
 className={`text-[10px] ${selectedLocationId === location.id ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}
 >
 {count}
 </span>
 </button>
 );
 })}
 {locationCounts.unassignedCount > 0 && (
 <button
 className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
 selectedLocationId === '__unassigned__'
 ? 'bg-primary text-primary-foreground shadow-sm'
 : 'bg-surface-2 text-muted-foreground hover:text-foreground'
 }`}
 onClick={() => setSelectedLocationId('__unassigned__')}
 >
 <MapPin className="h-3.5 w-3.5" />
 Unassigned
 <span
 className={`text-[10px] ${selectedLocationId === '__unassigned__' ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}
 >
 {locationCounts.unassignedCount}
 </span>
 </button>
 )}
 </div>
 )}
 </>
 )}

 {/* ── Node List ── */}
 {showGroupedView ? (
 /* ── Grouped by Location View ── */
 <div className="space-y-4">
 {isLoading ? (
 <ServerTabCard>
 <TabLoadingState rows={3} />
 </ServerTabCard>
 ) : groupedByLocation.length > 0 ? (
 groupedByLocation.map(([locationId, groupNodes]) => {
 const location = locationId ? (locationMap.get(locationId) ?? null) : null;
 return (
 <div
 key={locationId ?? '__unassigned__'}
 className="rounded-xl border border-border/30 bg-card shadow-sm overflow-hidden"
 >
 <LocationSectionHeader location={location} count={groupNodes.length} />
 <div className="p-4">
 <NodeList nodes={groupNodes} latestAgentVersion={updateData?.latestVersion} />
 </div>
 </div>
 );
 })
 ) : (
 <ServerTabCard>
 <TabEmptyState
 title={search.trim() ? 'No nodes found' : 'No nodes detected'}
 description={
 search.trim()
 ? 'Try adjusting your search.'
 : 'Install the Catalyst agent and register nodes to begin.'
 }
 action={canWrite && !search.trim() ? <NodeCreateModal /> : undefined}
 />
 </ServerTabCard>
 )}
 </div>
 ) : (
 /* ── Flat List View (single location selected or no locations exist) ── */
 <div className="rounded-xl border border-border/30 bg-card shadow-sm overflow-hidden">
 {isLoading ? (
 <div className="p-4">
 <TabLoadingState rows={3} />
 </div>
 ) : filteredNodes.length > 0 ? (
 <div className="p-4">
 <NodeList nodes={filteredNodes} latestAgentVersion={updateData?.latestVersion} />
 </div>
 ) : (
 <div className="p-6">
 <TabEmptyState
 title={
 search.trim() || selectedLocationId !== null
 ? 'No nodes found'
 : 'No nodes detected'
 }
 description={
 search.trim() || selectedLocationId !== null
 ? 'Try adjusting your search or location filter.'
 : 'Install the Catalyst agent and register nodes to begin.'
 }
 action={
 canWrite && !search.trim() && selectedLocationId === null ? (
 <NodeCreateModal />
 ) : undefined
 }
 />
 </div>
 )}
 </div>
 )}

 {/* ── Locations Manager Modal ── */}
 <LocationsManagerModal open={locationsModalOpen} onOpenChange={setLocationsModalOpen} />
 </div>
 );
}

export default NodesPage;
