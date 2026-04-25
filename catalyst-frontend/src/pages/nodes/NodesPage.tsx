import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { Server, MapPin, Search } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import NodeList from '../../components/nodes/NodeList';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import LocationsManagerModal from '../../components/nodes/LocationsManagerModal';
import EmptyState from '../../components/shared/EmptyState';
import { useNodes } from '../../hooks/useNodes';
import { useAuthStore } from '../../stores/authStore';
import { locationsApi } from '../../services/api/locations';
import type { Location } from '../../services/api/locations';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.05 },
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

// ── Location Section Header ──
function LocationSectionHeader({ location, count }: { location: Location | null; count: number }) {
  if (location) {
    return (
      <div className="sticky top-0 z-10 border-b border-border bg-surface-1/80 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <h3 className="text-sm font-semibold text-foreground dark:text-zinc-100">
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
    <div className="sticky top-0 z-10 border-b border-border bg-surface-1/80 px-4 py-2 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <MapPin className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground dark:text-zinc-100">Unassigned</h3>
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
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-emerald-500/8 to-cyan-500/8 blur-3xl dark:from-emerald-500/15 dark:to-cyan-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-sky-500/8 to-violet-500/8 blur-3xl dark:from-sky-500/15 dark:to-violet-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {!hideHeader && (
          <>
            {/* ── Header ── */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-end justify-between gap-4"
            >
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
                  Track connected infrastructure nodes.
                </p>
              </div>

              {/* Summary stats */}
              <div className="flex flex-wrap items-center gap-2">
                {isLoading ? (
                  <>
                    <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
                    <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
                  </>
                ) : (
                  <>
                    <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                      <span className="h-2 w-2 rounded-full bg-zinc-400" />
                      {nodes.length} nodes
                    </Badge>
                    <Badge variant="success" className="h-8 gap-1.5 px-3 text-xs">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      {onlineCount} online
                    </Badge>
                    {offlineCount > 0 && (
                      <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
                        <span className="h-2 w-2 rounded-full bg-rose-400" />
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
                    className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
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
            </motion.div>

            {/* ── Search Bar ── */}
            <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-2.5">
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
            </motion.div>

            {/* ── Location Selector Tabs ── */}
            {locations.length > 0 && (
              <motion.div
                variants={itemVariants}
                className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin"
              >
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
              </motion.div>
            )}
          </>
        )}

        {/* ── Node List ── */}
        <motion.div variants={itemVariants}>
          {showGroupedView ? (
            /* ── Grouped by Location View ── */
            <div className="space-y-4">
              {isLoading ? (
                <div className="rounded-xl border border-border bg-card/80 p-4 shadow-sm backdrop-blur-sm">
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg px-4 py-3.5">
                        <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-3" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 w-36 animate-pulse rounded bg-surface-3" />
                          <div className="h-3 w-52 animate-pulse rounded bg-surface-2" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : groupedByLocation.length > 0 ? (
                groupedByLocation.map(([locationId, groupNodes]) => {
                  const location = locationId ? (locationMap.get(locationId) ?? null) : null;
                  return (
                    <div
                      key={locationId ?? '__unassigned__'}
                      className="rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-sm overflow-hidden"
                    >
                      <LocationSectionHeader location={location} count={groupNodes.length} />
                      <div className="p-4">
                        <NodeList nodes={groupNodes} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-border bg-card/80 p-6 shadow-sm backdrop-blur-sm">
                  <EmptyState
                    title={search.trim() ? 'No nodes found' : 'No nodes detected'}
                    description={
                      search.trim()
                        ? 'Try adjusting your search.'
                        : 'Install the Catalyst agent and register nodes to begin.'
                    }
                    action={canWrite && !search.trim() ? <NodeCreateModal /> : undefined}
                  />
                </div>
              )}
            </div>
          ) : (
            /* ── Flat List View (single location selected or no locations exist) ── */
            <div className="rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-sm overflow-hidden">
              {isLoading ? (
                <div className="p-4">
                  <div className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 rounded-lg px-4 py-3.5">
                        <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-3" />
                        <div className="flex-1 space-y-2">
                          <div className="h-4 w-36 animate-pulse rounded bg-surface-3" />
                          <div className="h-3 w-52 animate-pulse rounded bg-surface-2" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : filteredNodes.length > 0 ? (
                <div className="p-4">
                  <NodeList nodes={filteredNodes} />
                </div>
              ) : (
                <div className="p-6">
                  <EmptyState
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
        </motion.div>
      </div>

      {/* ── Locations Manager Modal ── */}
      <LocationsManagerModal open={locationsModalOpen} onOpenChange={setLocationsModalOpen} />
    </motion.div>
  );
}

export default NodesPage;
