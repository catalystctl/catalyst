import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 Search,
 Filter,
 ArrowUpDown,
 Trash2,
 MoreHorizontal,
 ExternalLink,
 X,
 MapPin,
 AlertTriangle,
} from 'lucide-react';
import { BracketLabel, Segmented, StatusLed } from '../../components/deck/primitives';
import { cn } from '@/lib/utils';
import EmptyState from '../../components/shared/EmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import NodeCreateModal from '../../components/nodes/NodeCreateModal';
import LocationsManagerModal from '../../components/nodes/LocationsManagerModal';
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
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { useAuthStore } from '../../stores/authStore';
import type { NodeInfo } from '../../types/node';
import { nodesApi } from '../../services/api/nodes';
import { locationsApi } from '../../services/api/locations';
import type { Location } from '../../services/api/locations';
import { notifyError, notifySuccess } from '../../utils/notify';
import { formatDateTime } from '@/i18n/format';
// ── Helpers ──
const formatMemory = (mb: number) => {
 if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
 return `${mb} MB`;
};

/**
 * One grid template shared by the column header and every row, so columns line
 * up exactly. Only fixed / minmax(0,1fr) tracks — never `auto`, which makes the
 * header and rows compute different widths.
 *   base : identity · actions
 *   md   : identity · servers · cores · memory · actions
 */
const GRID =
 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 ' +
 'md:grid-cols-[minmax(0,1fr)_5rem_5rem_6.5rem_8.5rem]';

// ── Skeleton Loader ──
function TableSkeleton() {
 return (
 <div>
 {Array.from({ length: 6 }).map((_, i) => (
 <div key={i} className={cn(GRID, 'border-t border-border/40 py-2 pl-3 pr-3')}>
 <div className="flex items-center gap-2">
 <div className="h-2 w-2 animate-pulse rounded-full bg-surface-3" />
 <div className="h-3.5 w-40 animate-pulse bg-surface-3" />
 </div>
 </div>
 ))}
 </div>
 );
}

// ── Location Section Header ──
function LocationSectionHeader({
 location,
 count,
 trailing,
}: {
 location: Location | null;
 count: number;
 trailing?: React.ReactNode;
}) {
 const { t } = useTranslation('admin-infra');
 const name = location ? location.name : t('nodes.unassigned');
 return (
 <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/50 bg-surface-1 px-3 py-1.5">
 <BracketLabel tone="muted">{name}</BracketLabel>
 <Segmented muted>{t('nodes.locationNodeCount', { count })}</Segmented>
 {location?.description && (
 <span className="hidden min-w-0 truncate text-micro text-muted-foreground md:inline">
 {location.description}
 </span>
 )}
 {trailing}
 </div>
 );
}

// ── Node Row ──
function NodeRow({
 node,
 isSelected,
 canDelete,
 setSelectedIds,
 handleBulkDelete,
 deleteMutation,
 latestAgentVersion,
}: {
 node: NodeInfo;
 isSelected: boolean;
 canDelete: boolean;
 setSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
 handleBulkDelete: (ids: string[], label: string) => void;
 deleteMutation: { isPending: boolean };
 latestAgentVersion?: string | null;
}) {
 const { t } = useTranslation('admin-infra');
 const serverCount = node._count?.servers ?? node.servers?.length ?? 0;
 const memoryGB = node.maxMemoryMb ? (node.maxMemoryMb / 1024).toFixed(1) : '0';
 const lastSeen = node.lastSeenAt ? formatDateTime(node.lastSeenAt) : 'n/a';

 const outdated = Boolean(
 latestAgentVersion &&
 node.agentVersion &&
 compareVersions(node.agentVersion, latestAgentVersion),
 );

 return (
 <div
 role="row"
 className={cn(
 GRID,
 'group py-1.5 pl-3 pr-3 transition-colors hover:bg-surface-1/40',
 isSelected && 'bg-primary/5',
 )}
 >
 {/* identity — checkbox, LED, name, state; carries host/location/last-seen */}
 <div className="flex min-w-0 items-center gap-2">
 {canDelete && (
 <label className="-m-2 flex shrink-0 cursor-pointer items-center justify-center p-2">
 <input
 type="checkbox"
 checked={isSelected}
 onChange={() =>
 setSelectedIds((prev) =>
 prev.includes(node.id) ? prev.filter((id) => id !== node.id) : [...prev, node.id],
 )
 }
 className="h-3.5 w-3.5 rounded-sm border-border bg-card text-primary"
 />
 </label>
 )}
 <StatusLed tone={node.isOnline ? 'go' : 'idle'} pulse={node.isOnline} />
 <div className="flex min-w-0 flex-col leading-tight">
 <span className="flex min-w-0 items-baseline gap-2">
 <Link
 to={`/admin/nodes/${node.id}`}
 title={node.name}
 className="-my-1.5 truncate py-1.5 font-display text-data font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
 >
 {node.name}
 </Link>
 <span
 className={cn(
 'shrink-0 text-micro uppercase',
 node.isOnline ? 'text-success' : 'text-muted-foreground',
 )}
 >
 {node.isOnline ? t('common:status.online') : t('common:status.offline')}
 </span>
 {/* Agent version — warning only when outdated */}
 {node.agentVersion && (
 <span
 className={cn(
 'hidden shrink-0 items-center gap-1 font-mono text-micro sm:flex',
 outdated ? 'text-warning' : 'text-muted-foreground/70',
 )}
 >
 {outdated && <AlertTriangle className="h-2.5 w-2.5" />}
 {t('nodes.agentVersionShort', { version: node.agentVersion })}
 </span>
 )}
 </span>
 <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-micro text-muted-foreground">
 <span className="truncate font-mono">
 {node.hostname ?? t('nodes.hostnameUnavailable')}
 </span>
 {node.location && <span className="truncate">{node.location.name}</span>}
 <span className="hidden truncate sm:inline">
 {t('nodes.lastSeen', { time: lastSeen })}
 </span>
 </span>
 </div>
 </div>

 {/* capacity columns — header labels them, rows carry only the value */}
 <Segmented className="hidden justify-self-end md:inline-flex">{serverCount}</Segmented>
 <Segmented className="hidden justify-self-end md:inline-flex">
 {node.maxCpuCores ?? 0}
 </Segmented>
 <Segmented className="hidden justify-self-end md:inline-flex">{memoryGB} GB</Segmented>

 <span className="flex shrink-0 items-center justify-end gap-1">
 <Link
 to={`/admin/nodes/${node.id}`}
 className="flex h-7 items-center gap-1 rounded-sm border border-border/60 px-2 text-micro text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
 >
 <ExternalLink className="h-3 w-3" />
 <span className="hidden sm:inline">{t('nodes.manage')}</span>
 </Link>

 {canDelete && (
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
 title={t('common:actions.more')}
 >
 <MoreHorizontal className="h-3.5 w-3.5" />
 </button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem asChild>
 <Link to={`/admin/nodes/${node.id}`} className="gap-2 text-mini">
 <ExternalLink className="h-3.5 w-3.5" />
 {t('nodes.manage')}
 </Link>
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => handleBulkDelete([node.id], node.name)}
 disabled={deleteMutation.isPending}
 className="gap-2 text-mini text-destructive"
 >
 <Trash2 className="h-3.5 w-3.5" />
 {t('common:actions.delete')}
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 )}
 </span>
 </div>
 );
}

// ── Main Component ──
function AdminNodesPage() {
 const { t } = useTranslation('admin-infra');
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
 const { data: updateData } = useUpdateCheck();
 const user = useAuthStore((s) => s.user);

 const { data: locations = [] } = useQuery({
 queryKey: qk.locations(),
 queryFn: locationsApi.list,
 staleTime: 5 * 60 * 1000,
 });

 const canWrite = useMemo(
 () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
 [user?.permissions],
 );

 const canDelete = useMemo(
 () => Boolean(user?.permissions?.includes('node.delete') || user?.permissions?.includes('*')),
 [user?.permissions],
 );

 useEffect(() => {
 const handler = () => setLocationsModalOpen(true);
 window.addEventListener('catalyst:open-locations-modal', handler);
 return () => window.removeEventListener('catalyst:open-locations-modal', handler);
 }, []);

 const nodes = useMemo(() => data?.nodes ?? [], [data?.nodes]);

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
 notifySuccess(t('nodes.toast.deleted', { count: nodeIds.length }));
 setSelectedIds([]);
 setDeleteTargets(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const handleBulkDelete = (nodeIds: string[], label: string) => {
 if (!nodeIds.length) return;
 setDeleteTargets({ nodeIds, label });
 };

 // Determine whether to show grouped or flat view
 const showGroupedView = selectedLocationId === null && locations.length > 0;

 // Helper to render node rows (used in both grouped and flat views)
 const renderNodeRows = (groupNodes: NodeInfo[]) =>
 groupNodes.map((node) => (
 <NodeRow
 key={node.id}
 node={node}
 isSelected={selectedIds.includes(node.id)}
 canDelete={canDelete}
 setSelectedIds={setSelectedIds}
 handleBulkDelete={handleBulkDelete}
 deleteMutation={deleteMutation}
 latestAgentVersion={updateData?.latestVersion}
 />
 ));

 /** Toggle one grouped section's ids without disturbing other selections. */
 const toggleGroupSelection = (groupNodes: NodeInfo[]) => {
 const ids = groupNodes.map((n) => n.id);
 setSelectedIds((prev) => {
 if (ids.every((id) => prev.includes(id))) {
 return prev.filter((id) => !ids.includes(id));
 }
 return Array.from(new Set([...prev, ...ids]));
 });
 };

 const summaryStats = [
 { label: t('nodes.stats.nodes'), value: nodes.length },
 { label: t('nodes.stats.online'), value: onlineNodes.length },
 { label: t('nodes.stats.offline'), value: offlineNodes.length },
 { label: t('nodes.stats.totalServers'), value: totalServers },
 { label: t('nodes.stats.cpuCores'), value: totalCpu },
 { label: t('nodes.stats.memory'), value: formatMemory(totalMemory) },
 ];

 return (
 <div className="flex min-h-0 flex-1 flex-col gap-3">
 {/* ── Deck header ── */}
 <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
 <div className="flex min-w-0 flex-col gap-1">
 <BracketLabel>{t('layout:sections.infrastructure')}</BracketLabel>
 <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
 {t('nodes.title')}
 </h1>
 <p className="text-mini text-muted-foreground">{t('nodes.description')}</p>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 {canWrite && <NodeCreateModal />}
 {canWrite && (
 <button
 type="button"
 onClick={() => setLocationsModalOpen(true)}
 className="flex h-8 items-center gap-1.5 rounded-sm border border-border/60 px-3 text-mini text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
 >
 <MapPin className="h-3.5 w-3.5" />
 {t('nodes.locations')}
 </button>
 )}
 </div>
 </header>

 {/* ── The deck: tabs, controls, columns, rows and totals in one frame ── */}
 <div className="deck-panel flex min-h-0 flex-col overflow-hidden">
 {/* Control strip */}
 <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
 {locations.length > 0 && (
 <div className="flex items-center gap-0.5 overflow-x-auto">
 <RailTab
 active={selectedLocationId === null}
 onClick={() => setSelectedLocationId(null)}
 label={t('nodes.allLocations')}
 count={nodes.length}
 />
 {locations.map((location) => {
 const count = locationCounts.counts.get(location.id) || 0;
 if (count === 0) return null;
 return (
 <RailTab
 key={location.id}
 active={selectedLocationId === location.id}
 onClick={() => setSelectedLocationId(location.id)}
 icon={<MapPin className="h-3 w-3" />}
 label={location.name}
 count={count}
 />
 );
 })}
 {locationCounts.unassignedCount > 0 && (
 <RailTab
 active={selectedLocationId === '__unassigned__'}
 onClick={() => setSelectedLocationId('__unassigned__')}
 icon={<MapPin className="h-3 w-3" />}
 label={t('nodes.unassigned')}
 count={locationCounts.unassignedCount}
 />
 )}
 </div>
 )}

 {locations.length > 0 && <span className="mx-1 h-5 w-px bg-border/60" aria-hidden />}

 <label className="relative flex min-w-[12rem] flex-1 items-center">
 <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
 <input
 type="search"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder={t('nodes.searchPlaceholder')}
 className="h-7 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
 />
 </label>

 <button
 type="button"
 onClick={() => setShowFilters(!showFilters)}
 className={cn(
 'flex h-7 items-center gap-1.5 rounded-sm border border-border/60 px-2.5 text-mini transition-colors',
 hasActiveFilters
 ? 'border-primary/50 text-foreground'
 : 'text-muted-foreground hover:text-foreground',
 )}
 >
 <Filter className="h-3 w-3" />
 {t('nodes.filters')}
 {hasActiveFilters && (
 <span className="font-mono text-micro tabular-nums text-primary">
 {[statusFilter, selectedLocationId].filter(Boolean).length}
 </span>
 )}
 </button>

 <Select value={sort} onValueChange={setSort}>
 <SelectTrigger className="h-7 w-40 gap-2 rounded-sm border-border/60 text-mini">
 <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="name-asc">{t('nodes.sort.nameAsc')}</SelectItem>
 <SelectItem value="name-desc">{t('nodes.sort.nameDesc')}</SelectItem>
 <SelectItem value="status">{t('nodes.sort.status')}</SelectItem>
 <SelectItem value="servers">{t('nodes.sort.mostServers')}</SelectItem>
 <SelectItem value="cpu">{t('nodes.sort.cpuCores')}</SelectItem>
 <SelectItem value="memory">{t('nodes.sort.memory')}</SelectItem>
 </SelectContent>
 </Select>

 <span className="ml-auto font-mono text-micro tabular-nums text-muted-foreground">
 {t('nodes.resultCount', { shown: filteredNodes.length, total: nodes.length })}
 </span>
 </div>

 {/* Expandable filter panel */}
 {showFilters && (
 <div className="flex flex-wrap items-end gap-4 border-b border-border/50 bg-surface-1/20 px-3 py-2">
 <label className="flex flex-col gap-1">
 <span className="type-overline">{t('nodes.filter.status')}</span>
 <Select
 value={statusFilter || 'all'}
 onValueChange={(value) => {
 setStatusFilter(value === 'all' ? '' : value);
 }}
 >
 <SelectTrigger className="h-7 w-44 rounded-sm border-border/60 text-mini">
 <SelectValue placeholder={t('nodes.filter.allStatuses')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">{t('nodes.filter.allStatuses')}</SelectItem>
 <SelectItem value="online">{t('nodes.filter.onlineCount', { value: onlineNodes.length })}</SelectItem>
 <SelectItem value="offline">{t('nodes.filter.offlineCount', { value: offlineNodes.length })}</SelectItem>
 </SelectContent>
 </Select>
 </label>
 {locations.length > 0 && (
 <label className="flex flex-col gap-1">
 <span className="type-overline">{t('nodes.filter.location')}</span>
 <Select
 value={selectedLocationId || 'all'}
 onValueChange={(value) => {
 setSelectedLocationId(value === 'all' ? null : value);
 }}
 >
 <SelectTrigger className="h-7 w-44 rounded-sm border-border/60 text-mini">
 <SelectValue placeholder={t('nodes.filter.allLocations')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">{t('nodes.filter.allLocations')}</SelectItem>
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
 {t('nodes.filter.unassignedCount', { value: locationCounts.unassignedCount })}
 </SelectItem>
 )}
 </SelectContent>
 </Select>
 </label>
 )}
 {hasActiveFilters && (
 <button
 type="button"
 onClick={clearFilters}
 className="flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-mini text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 >
 <X className="h-3 w-3" />
 {t('nodes.clearAll')}
 </button>
 )}
 </div>
 )}

 {/* Bulk actions strip */}
 {selectedIds.length > 0 && canDelete && (
 <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-primary/5 px-3 py-1.5">
 <div className="flex items-center gap-3">
 <span className="text-mini text-foreground">
 {t('nodes.selectedCount', { value: selectedIds.length })}
 </span>
 <button
 type="button"
 onClick={() => setSelectedIds([])}
 className="flex h-7 items-center rounded-sm px-2.5 text-mini text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 >
 {t('nodes.clearSelection')}
 </button>
 </div>
 <Button
 variant="destructive"
 size="sm"
 onClick={() => handleBulkDelete(selectedIds, t('nodes.selectedLabel', { value: selectedIds.length }))}
 disabled={deleteMutation.isPending}
 className="h-7 gap-1.5 px-2.5 text-mini"
 >
 <Trash2 className="h-3 w-3" />
 {t('common:actions.delete')}
 </Button>
 </div>
 )}

 {/* Column header — same grid as the rows, so columns always line up */}
 <div
 className={cn(
 GRID,
 'sticky top-0 z-10 hidden border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground/70 md:grid',
 )}
 >
 <span className="flex items-center gap-2">
 {canDelete && (
 <label className="-m-2 flex shrink-0 cursor-pointer items-center justify-center p-2">
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
 aria-label={t('nodes.selectAll')}
 className="h-3.5 w-3.5 rounded-sm border-border bg-card text-primary"
 />
 </label>
 )}
 <span className="type-overline">{t('nodes.title')}</span>
 </span>
 <span className="type-overline hidden justify-self-end md:inline-flex">{t('nodes.stat.servers')}</span>
 <span className="type-overline hidden justify-self-end md:inline-flex">{t('nodes.stat.cores')}</span>
 <span className="type-overline hidden justify-self-end md:inline-flex">{t('nodes.stat.memory')}</span>
 <span className="type-overline justify-self-end">{t('nodes.manage')}</span>
 </div>

 {/* Rows */}
 <div className="max-h-[calc(100dvh-22rem)] min-w-0 overflow-y-auto bg-background/25">
 {isLoading ? (
 <TableSkeleton />
 ) : showGroupedView ? (
 groupedByLocation.length > 0 ? (
 groupedByLocation.map(([locationId, groupNodes]) => {
 const location = locationId ? (locationMap.get(locationId) ?? null) : null;
 const groupSelected = groupNodes.length > 0 && groupNodes.every((n) => selectedIds.includes(n.id));
 return (
 <div key={locationId ?? '__unassigned__'}>
 <LocationSectionHeader
 location={location}
 count={groupNodes.length}
 trailing={
 canDelete ? (
 <label className="ml-auto -my-2 flex cursor-pointer items-center gap-1.5 py-2 text-micro text-muted-foreground">
 <input
 type="checkbox"
 checked={groupSelected}
 onChange={() => toggleGroupSelection(groupNodes)}
 className="h-3.5 w-3.5 rounded-sm border-border bg-card text-primary"
 />
 {t('nodes.selectAllInSection')}
 </label>
 ) : undefined
 }
 />
 {renderNodeRows(groupNodes)}
 </div>
 );
 })
 ) : (
 <div className="p-3">
 <EmptyState
 title={search.trim() || statusFilter ? t('nodes.empty.notFound') : t('nodes.empty.none')}
 description={
 search.trim() || statusFilter
 ? t('nodes.empty.adjustFilters')
 : t('nodes.empty.installAgent')
 }
 action={
 hasActiveFilters ? (
 <Button variant="outline" size="sm" className="h-7 px-2.5 text-mini" onClick={clearFilters}>
 <X className="mr-1.5 h-3.5 w-3.5" />
 {t('nodes.clearFilters')}
 </Button>
 ) : canWrite && !search.trim() ? (
 <NodeCreateModal />
 ) : undefined
 }
 />
 </div>
 )
 ) : filteredNodes.length > 0 ? (
 renderNodeRows(filteredNodes)
 ) : (
 <div className="p-3">
 <EmptyState
 title={
 search.trim() || hasActiveFilters ? t('nodes.empty.notFound') : t('nodes.empty.none')
 }
 description={
 search.trim() || hasActiveFilters
 ? t('nodes.empty.adjustFilters')
 : t('nodes.empty.installAgent')
 }
 action={
 hasActiveFilters ? (
 <Button variant="outline" size="sm" className="h-7 px-2.5 text-mini" onClick={clearFilters}>
 <X className="mr-1.5 h-3.5 w-3.5" />
 {t('nodes.clearFilters')}
 </Button>
 ) : canWrite ? (
 <NodeCreateModal />
 ) : undefined
 }
 />
 </div>
 )}
 </div>

 {/* Footer strip — fleet totals */}
 <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 bg-surface-1/40 px-3 py-1.5">
 {summaryStats.map((stat) => (
 <span key={stat.label} className="flex items-center gap-1.5">
 <span className="type-overline">{stat.label}</span>
 <Segmented muted className="text-micro">
 {stat.value}
 </Segmented>
 </span>
 ))}
 </div>
 </div>

 {/* ── Delete Confirmation Dialog ── */}
 <LocationsManagerModal open={locationsModalOpen} onOpenChange={setLocationsModalOpen} />
 <ConfirmDialog
 open={!!deleteTargets}
 title={t('nodes.deleteDialog.title')}
 message={
 <div className="space-y-2">
 <p>
 <Trans
 i18nKey="nodes.deleteDialog.message"
 ns="admin-infra"
 values={{ label: deleteTargets?.label }}
 >
 You are about to delete <span className="font-semibold">{'{{label}}'}</span>.
 </Trans>
 </p>
 <p className="text-mini text-muted-foreground">
 {t('nodes.deleteDialog.warning')}
 </p>
 </div>
 }
 confirmText={t('common:actions.delete')}
 cancelText={t('common:actions.cancel')}
 onConfirm={() => deleteTargets && deleteMutation.mutate(deleteTargets.nodeIds)}
 onCancel={() => setDeleteTargets(null)}
 variant="danger"
 loading={deleteMutation.isPending}
 />
 </div>
 );
}

/** Location rail tab — underline marker for the active location. */
function RailTab({
 active,
 onClick,
 icon,
 label,
 count,
}: {
 active: boolean;
 onClick: () => void;
 icon?: React.ReactNode;
 label: string;
 count: number;
}) {
 return (
 <button
 type="button"
 onClick={onClick}
 className={cn(
 'relative flex h-7 shrink-0 items-center gap-1.5 px-2.5 text-mini transition-colors',
 active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
 )}
 >
 {active && (
 <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />
 )}
 {icon}
 <span className="whitespace-nowrap">{label}</span>
 <span className="font-mono text-micro tabular-nums text-muted-foreground/80">{count}</span>
 </button>
 );
}

export default AdminNodesPage;

/** Compare semver-like versions. Returns true if `current` < `latest`. */
function compareVersions(current: string, latest: string): boolean {
 const cur = current.replace(/^v/, '').split('.').map(Number);
 const lat = latest.replace(/^v/, '').split('.').map(Number);
 const maxLen = Math.max(cur.length, lat.length);
 for (let i = 0; i < maxLen; i++) {
 const c = cur[i] || 0;
 const l = lat[i] || 0;
 if (l > c) return true;
 if (l < c) return false;
 }
 return false;
}
