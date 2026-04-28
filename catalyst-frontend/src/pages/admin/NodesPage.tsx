import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
  Server,
  Cpu,
  HardDrive,
  Search,
  Filter,
  ArrowUpDown,
  Trash2,
  MoreHorizontal,
  ExternalLink,
  X,
  MapPin,
} from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import EmptyState from '../../components/shared/EmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import LocationsManagerModal from '../../components/nodes/LocationsManagerModal';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useAdminNodes } from '../../hooks/useAdmin';
import { useAuthStore } from '../../stores/authStore';
import type { NodeInfo } from '../../types/node';
import { nodesApi } from '../../services/api/nodes';
import { locationsApi } from '../../services/api/locations';
import type { Location } from '../../services/api/locations';
import { notifyError, notifySuccess } from '../../utils/notify';

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

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
};

// ── Helpers ──
const formatMemory = (mb: number) => {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
};

// ── Skeleton Loader ──
function TableSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-lg px-4 py-3.5">
          <div className="h-4 w-4 animate-pulse rounded bg-surface-3" />
          <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-3" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-surface-3" />
            <div className="h-3 w-52 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="hidden h-5 w-20 animate-pulse rounded-full bg-surface-3 sm:block" />
          <div className="hidden h-4 w-20 animate-pulse rounded bg-surface-3 md:block" />
          <div className="hidden h-4 w-24 animate-pulse rounded bg-surface-3 lg:block" />
          <div className="flex gap-1">
            <div className="h-7 w-16 animate-pulse rounded-md bg-surface-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Location Section Header ──
function LocationSectionHeader({ location, count }: { location: Location | null; count: number }) {
  if (location) {
    return (
      <div className="sticky top-0 z-10 border-b border-border bg-surface-1/80 px-4 py-2 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-success dark:text-success" />
          <h3 className="text-sm font-semibold text-foreground dark:text-foreground">
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
        <h3 className="text-sm font-semibold text-foreground dark:text-foreground">Unassigned</h3>
        <Badge variant="secondary" className="text-[10px]">
          {count} node{count !== 1 ? 's' : ''}
        </Badge>
      </div>
    </div>
  );
}

// ── Node Row ──
function NodeRow({
  node,
  isSelected,
  canDelete,
  selectedIds,
  setSelectedIds,
  handleBulkDelete,
  deleteMutation,
}: {
  node: NodeInfo;
  isSelected: boolean;
  canDelete: boolean;
  selectedIds: string[];
  setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
  handleBulkDelete: (ids: string[], label: string) => void;
  deleteMutation: { isPending: boolean };
}) {
  const serverCount = node._count?.servers ?? node.servers?.length ?? 0;
  const memoryGB = node.maxMemoryMb ? (node.maxMemoryMb / 1024).toFixed(1) : '0';
  const lastSeen = node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';

  return (
    <motion.div
      key={node.id}
      variants={rowVariants}
      className={`group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/50 ${
        isSelected ? 'bg-primary/5' : ''
      }`}
    >
      {/* Checkbox */}
      {canDelete && (
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() =>
            setSelectedIds((prev) =>
              prev.includes(node.id) ? prev.filter((id) => id !== node.id) : [...prev, node.id],
            )
          }
          className="h-4 w-4 flex-shrink-0 rounded border-border bg-card text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
        />
      )}

      {/* Online indicator dot + icon */}
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full transition-colors ${
            node.isOnline ? 'bg-success/50' : 'bg-surface-3 dark:bg-surface-3'
          }`}
        />
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
            node.isOnline
              ? 'bg-success/10 dark:bg-success/30'
              : 'bg-surface-2 dark:bg-surface-2'
          }`}
        >
          <Server
            className={`h-4 w-4 transition-colors ${
              node.isOnline ? 'text-success dark:text-success' : 'text-muted-foreground'
            }`}
          />
        </div>
      </div>

      {/* Node info — primary column */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <Link
            to={`/admin/nodes/${node.id}`}
            className="truncate font-semibold text-foreground transition-colors hover:text-primary dark:text-foreground dark:hover:text-primary-400"
          >
            {node.name}
          </Link>
          <Badge
            variant={node.isOnline ? 'success' : 'secondary'}
            className="shrink-0 gap-1 text-[11px]"
          >
            <span className="relative flex h-1.5 w-1.5">
              {node.isOnline && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                  node.isOnline ? 'bg-success/50' : 'bg-surface-3'
                }`}
              />
            </span>
            {node.isOnline ? 'Online' : 'Offline'}
          </Badge>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span className="font-mono text-[11px] opacity-70">
            {node.hostname ?? 'hostname n/a'}
          </span>
          {node.location && <span>{node.location.name}</span>}
          <span className="hidden sm:inline">Last seen {lastSeen}</span>
        </div>
      </div>

      {/* Resource stats — visible on larger screens */}
      <div className="hidden items-center gap-4 lg:flex">
        <div className="text-right">
          <div className="text-xs font-medium text-foreground dark:text-foreground">
            {serverCount}
          </div>
          <div className="text-[11px] text-muted-foreground">servers</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium text-foreground dark:text-foreground">
            {node.maxCpuCores ?? 0}
          </div>
          <div className="text-[11px] text-muted-foreground">cores</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-medium text-foreground dark:text-foreground">
            {memoryGB} GB
          </div>
          <div className="text-[11px] text-muted-foreground">memory</div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        <Link
          to={`/admin/nodes/${node.id}`}
          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary dark:hover:text-primary-400"
        >
          <ExternalLink className="h-3 w-3" />
          <span className="hidden sm:inline">Manage</span>
        </Link>

        {canDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                title="More"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link to={`/admin/nodes/${node.id}`} className="gap-2 text-xs">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Manage
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleBulkDelete([node.id], node.name)}
                disabled={deleteMutation.isPending}
                className="gap-2 text-xs text-destructive dark:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Component ──
function AdminNodesPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [sort, setSort] = useState('name-asc');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<{ nodeIds: string[]; label: string } | null>(
    null,
  );
  const [locationsModalOpen, setLocationsModalOpen] = useState(false);

  const { data, isLoading } = useAdminNodes({ search: search.trim() || undefined });
  const user = useAuthStore((s) => s.user);

  const { data: locations = [] } = useQuery({
    queryKey: qk.locations(),
    queryFn: locationsApi.list,
    refetchInterval: 30000,
  });

  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  const canDelete = useMemo(
    () => user?.permissions?.includes('node.delete') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  useEffect(() => {
    const handler = () => setLocationsModalOpen(true);
    window.addEventListener('catalyst:open-locations-modal', handler);
    return () => window.removeEventListener('catalyst:open-locations-modal', handler);
  }, []);

  const nodes = data?.nodes ?? [];

  // ── Derived data ──
  const onlineNodes = nodes.filter((node) => node.isOnline);
  const offlineNodes = nodes.filter((node) => !node.isOnline);
  const totalServers = nodes.reduce((acc, node) => acc + (node._count?.servers ?? 0), 0);
  const totalCpu = nodes.reduce((acc, node) => acc + (node.maxCpuCores ?? 0), 0);
  const totalMemory = nodes.reduce((acc, node) => acc + (node.maxMemoryMb ?? 0), 0);

  // Location lookup map
  const locationMap = useMemo(() => {
    const map = new Map<string, Location>();
    for (const loc of locations) {
      map.set(loc.id, loc);
    }
    return map;
  }, [locations]);

  // Count nodes per location for pills and filter panel
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

  const hasActiveFilters = statusFilter || selectedLocationId !== null;

  const clearFilters = () => {
    setStatusFilter('');
    setSelectedLocationId(null);
  };

  // Nodes filtered by search, status, and location
  const filteredNodes = useMemo(() => {
    let filtered = nodes;
    if (statusFilter === 'online') {
      filtered = filtered.filter((node) => node.isOnline);
    } else if (statusFilter === 'offline') {
      filtered = filtered.filter((node) => !node.isOnline);
    }
    if (selectedLocationId === '__unassigned__') {
      filtered = filtered.filter((node) => !node.locationId);
    } else if (selectedLocationId !== null) {
      filtered = filtered.filter((node) => node.locationId === selectedLocationId);
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'name-desc':
          return b.name.localeCompare(a.name);
        case 'status':
          return (b.isOnline ? 1 : 0) - (a.isOnline ? 1 : 0);
        case 'servers':
          return (b._count?.servers ?? 0) - (a._count?.servers ?? 0);
        case 'cpu':
          return (b.maxCpuCores ?? 0) - (a.maxCpuCores ?? 0);
        case 'memory':
          return (b.maxMemoryMb ?? 0) - (a.maxMemoryMb ?? 0);
        default:
          return a.name.localeCompare(b.name);
      }
    });
    return sorted;
  }, [nodes, statusFilter, selectedLocationId, sort]);

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
      if (a[0] === null) return 1;
      if (b[0] === null) return -1;
      const locA = locationMap.get(a[0]!);
      const locB = locationMap.get(b[0]!);
      return (locA?.name || '').localeCompare(locB?.name || '');
    });
    return entries;
  }, [filteredNodes, locationMap]);

  const filteredIds = useMemo(() => filteredNodes.map((node) => node.id), [filteredNodes]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

  const currentNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  const validSelectedIds = useMemo(
    () => selectedIds.filter((id) => currentNodeIds.has(id)),
    [selectedIds, currentNodeIds],
  );

  if (validSelectedIds.length !== selectedIds.length) {
    setSelectedIds(validSelectedIds);
  }

  // ── Delete mutation ──
  const deleteMutation = useMutation({
    mutationFn: (nodeIds: string[]) => {
      return Promise.all(nodeIds.map((nodeId) => nodesApi.remove(nodeId)));
    },
    onSuccess: (_data, nodeIds) => {
      notifySuccess(`${nodeIds.length} node${nodeIds.length === 1 ? '' : 's'} deleted`);
      queryClient.invalidateQueries({ queryKey: ['admin-nodes'] });
      setSelectedIds([]);
      setDeleteTargets(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete node(s)';
      notifyError(message);
    },
  });

  const handleBulkDelete = (nodeIds: string[], label: string) => {
    if (!nodeIds.length) return;
    setDeleteTargets({ nodeIds, label });
  };

  // Determine whether to show grouped or flat view
  const showGroupedView = selectedLocationId === null && locations.length > 0;

  // Helper to render node rows (used in both grouped and flat views)
  const renderNodeRows = (groupNodes: NodeInfo[], showSelectAll?: boolean) => (
    <>
      {showSelectAll && canDelete && (
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={groupNodes.length > 0 && groupNodes.every((n) => selectedIds.includes(n.id))}
              onChange={() =>
                setSelectedIds((prev) => {
                  const groupIds = groupNodes.map((n) => n.id);
                  if (groupIds.every((id) => prev.includes(id))) {
                    return prev.filter((id) => !groupIds.includes(id));
                  }
                  return Array.from(new Set([...prev, ...groupIds]));
                })
              }
              className="h-4 w-4 rounded border-border bg-card text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
            />
            <span className="text-xs font-medium text-muted-foreground">Select all in section</span>
          </label>
        </div>
      )}
      <div className="divide-y divide-border/50">
        {groupNodes.map((node) => (
          <NodeRow
            key={node.id}
            node={node}
            isSelected={selectedIds.includes(node.id)}
            canDelete={canDelete}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            handleBulkDelete={handleBulkDelete}
            deleteMutation={deleteMutation}
          />
        ))}
      </div>
    </>
  );

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
        {/* ── Header ── */}
        <motion.div
          variants={itemVariants}
          className="flex flex-wrap items-end justify-between gap-4"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 opacity-20 blur-sm" />
                <Server className="relative h-7 w-7 text-success dark:text-success" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground ">
                Nodes
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Manage infrastructure nodes and monitor availability
            </p>
          </div>

          {/* Summary stats */}
          <div className="flex flex-wrap items-center gap-2">
            {isLoading ? (
              <>
                <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
                <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
                <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
              </>
            ) : (
              <>
                <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                  <span className="h-2 w-2 rounded-full bg-surface-3" />
                  {nodes.length} nodes
                </Badge>
                <Badge variant="success" className="h-8 gap-1.5 px-3 text-xs">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  {onlineNodes.length} online
                </Badge>
                {offlineNodes.length > 0 && (
                  <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
                    <span className="h-2 w-2 rounded-full bg-destructive/60" />
                    {offlineNodes.length} offline
                  </Badge>
                )}
                <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                  <Cpu className="h-2.5 w-2.5" />
                  {totalCpu} cores
                </Badge>
                <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                  <HardDrive className="h-2.5 w-2.5" />
                  {formatMemory(totalMemory)}
                </Badge>
              </>
            )}
            {canWrite && <NodeCreateModal />}
            {canWrite && (
              <button
                className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground dark:border-border dark:text-foreground dark:hover:border-primary/30"
                onClick={() => setLocationsModalOpen(true)}
              >
                <MapPin className="mr-1.5 inline h-4 w-4" />
                Locations
              </button>
            )}
          </div>
        </motion.div>

        {/* ── Search & Controls Bar ── */}
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

          {/* Filter toggle */}
          <Button
            variant={hasActiveFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {hasActiveFilters && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                {[statusFilter, selectedLocationId].filter(Boolean).length}
              </span>
            )}
          </Button>

          {/* Sort */}
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-40 gap-2 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name-asc">Name A→Z</SelectItem>
              <SelectItem value="name-desc">Name Z→A</SelectItem>
              <SelectItem value="status">Status</SelectItem>
              <SelectItem value="servers">Most servers</SelectItem>
              <SelectItem value="cpu">CPU cores</SelectItem>
              <SelectItem value="memory">Memory</SelectItem>
            </SelectContent>
          </Select>

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

        {/* ── Expandable Filter Panel ── */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Status</span>
                    <Select
                      value={statusFilter || 'all'}
                      onValueChange={(value) => {
                        setStatusFilter(value === 'all' ? '' : value);
                      }}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="online">Online ({onlineNodes.length})</SelectItem>
                        <SelectItem value="offline">Offline ({offlineNodes.length})</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  {locations.length > 0 && (
                    <label className="space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Location</span>
                      <Select
                        value={selectedLocationId || 'all'}
                        onValueChange={(value) => {
                          setSelectedLocationId(value === 'all' ? null : value);
                        }}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue placeholder="All locations" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All locations</SelectItem>
                          {locations.map((loc) => (
                            <SelectItem key={loc.id} value={loc.id}>
                              <span className="flex items-center gap-2">
                                {loc.name}
                                {locationCounts.counts.get(loc.id)
                                  ? ` (${locationCounts.counts.get(loc.id)})`
                                  : ''}
                              </span>
                            </SelectItem>
                          ))}
                          {locationCounts.unassignedCount > 0 && (
                            <SelectItem value="__unassigned__">
                              Unassigned ({locationCounts.unassignedCount})
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </label>
                  )}
                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="gap-1.5 text-xs"
                    >
                      <X className="h-3 w-3" />
                      Clear all
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Bulk Actions Bar ── */}
        <AnimatePresence>
          {selectedIds.length > 0 && canDelete && (
            <motion.div
              initial={{ height: 0, opacity: 0, y: -8 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 dark:bg-primary/10">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {selectedIds.length} selected
                  </span>
                  <button
                    onClick={() => setSelectedIds([])}
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleBulkDelete(selectedIds, `${selectedIds.length} nodes`)}
                    disabled={deleteMutation.isPending}
                    className="gap-1.5 text-xs"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Node List ── */}
        <motion.div variants={itemVariants}>
          {showGroupedView ? (
            /* ── Grouped by Location View ── */
            <div className="space-y-4">
              {isLoading ? (
                <div className="rounded-xl border border-border bg-card/80 p-4 shadow-sm backdrop-blur-sm">
                  <TableSkeleton />
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
                      {renderNodeRows(groupNodes, true)}
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl border border-border bg-card/80 p-6 shadow-sm backdrop-blur-sm">
                  <EmptyState
                    title={search.trim() || statusFilter ? 'No nodes found' : 'No nodes detected'}
                    description={
                      search.trim() || statusFilter
                        ? 'Try adjusting your search or filters.'
                        : 'Install the Catalyst agent and register nodes to begin.'
                    }
                    action={
                      hasActiveFilters ? (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Clear filters
                        </Button>
                      ) : canWrite && !search.trim() ? (
                        <NodeCreateModal />
                      ) : undefined
                    }
                  />
                </div>
              )}
            </div>
          ) : (
            /* ── Flat List View (single location selected or no locations exist) ── */
            <div className="rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-sm overflow-hidden">
              {isLoading ? (
                <div className="p-4">
                  <TableSkeleton />
                </div>
              ) : filteredNodes.length > 0 ? (
                <>
                  {/* Select-all header */}
                  {canDelete && (
                    <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() =>
                            setSelectedIds((prev) => {
                              if (allSelected) {
                                return prev.filter((id) => !filteredIds.includes(id));
                              }
                              return Array.from(new Set([...prev, ...filteredIds]));
                            })
                          }
                          className="h-4 w-4 rounded border-border bg-card text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                        />
                        <span className="text-xs font-medium text-muted-foreground">
                          Select all
                        </span>
                      </label>
                    </div>
                  )}

                  {/* Node rows */}
                  <div className="divide-y divide-border/50">
                    {filteredNodes.map((node: NodeInfo) => (
                      <NodeRow
                        key={node.id}
                        node={node}
                        isSelected={selectedIds.includes(node.id)}
                        canDelete={canDelete}
                        selectedIds={selectedIds}
                        setSelectedIds={setSelectedIds}
                        handleBulkDelete={handleBulkDelete}
                        deleteMutation={deleteMutation}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="p-6">
                  <EmptyState
                    title={
                      search.trim() || hasActiveFilters ? 'No nodes found' : 'No nodes detected'
                    }
                    description={
                      search.trim() || hasActiveFilters
                        ? 'Try adjusting your search or filters.'
                        : 'Install the Catalyst agent and register nodes to begin.'
                    }
                    action={
                      hasActiveFilters ? (
                        <Button variant="outline" size="sm" onClick={clearFilters}>
                          <X className="mr-1.5 h-3.5 w-3.5" />
                          Clear filters
                        </Button>
                      ) : canWrite ? (
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

      {/* ── Delete Confirmation Dialog ── */}
      <LocationsManagerModal open={locationsModalOpen} onOpenChange={setLocationsModalOpen} />
      <ConfirmDialog
        open={!!deleteTargets}
        title="Delete Nodes"
        message={
          <div className="space-y-2">
            <p>
              You are about to delete <span className="font-semibold">{deleteTargets?.label}</span>.
            </p>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              Nodes with running servers cannot be deleted. Stop all servers on a node before
              deleting it. This cannot be undone.
            </p>
          </div>
        }
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={() => deleteTargets && deleteMutation.mutate(deleteTargets.nodeIds)}
        onCancel={() => setDeleteTargets(null)}
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </motion.div>
  );
}

export default AdminNodesPage;
