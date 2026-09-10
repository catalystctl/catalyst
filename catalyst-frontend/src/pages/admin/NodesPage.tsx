import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 Server,
 Search,
 Filter,
 ArrowUpDown,
 Trash2,
 MoreHorizontal,
 ExternalLink,
 X,
 MapPin,
 AlertTriangle,
 CheckCircle,
} from 'lucide-react';
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
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { useAuthStore } from '../../stores/authStore';
import type { NodeInfo } from '../../types/node';
import { nodesApi } from '../../services/api/nodes';
import { locationsApi } from '../../services/api/locations';
import type { Location } from '../../services/api/locations';
import { notifyError, notifySuccess } from '../../utils/notify';
import { formatDateTime } from '@/i18n/format';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import StatGrid from '../../components/servers/tabs/StatGrid';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';

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
 const { t } = useTranslation('admin-infra');
 if (location) {
 return (
 <div className="sticky top-0 z-10 border-b border-border bg-surface-1/80 px-4 py-2 backdrop-blur-sm">
 <div className="flex items-center gap-2">
 <MapPin className="h-4 w-4 text-success" />
 <h3 className="text-sm font-semibold text-foreground">
 {location.name}
 </h3>
 <Badge variant="secondary" className="text-[10px]">
 {t('nodes.locationNodeCount', { count })}
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
 <h3 className="text-sm font-semibold text-foreground">{t('nodes.unassigned')}</h3>
 <Badge variant="secondary" className="text-[10px]">
 {t('nodes.locationNodeCount', { count })}
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

 return (
 <div
 key={node.id}
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
 className="h-4 w-4 flex-shrink-0 rounded border-border bg-card text-primary"
 />
 )}

 {/* Online indicator dot + icon */}
 <div className="flex items-center gap-2">
 <div
 className={`h-2 w-2 rounded-full transition-colors ${
 node.isOnline ? 'bg-success' : 'bg-surface-3'
 }`}
 />
 <div
 className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors ${
 node.isOnline ? 'bg-success/10' : 'bg-surface-2'
 }`}
 >
 <Server
 className={`h-4 w-4 transition-colors ${
 node.isOnline ? 'text-success' : 'text-muted-foreground'
 }`}
 />
 </div>
 </div>

 {/* Node info — primary column */}
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2.5 flex-wrap">
 <Link
 to={`/admin/nodes/${node.id}`}
 className="truncate font-semibold text-foreground transition-colors hover:text-primary"
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
 node.isOnline ? 'bg-success' : 'bg-surface-3'
 }`}
 />
 </span>
 {node.isOnline ? t('common:status.online') : t('common:status.offline')}
 </Badge>
 {/* Agent version badge */}
 {node.agentVersion && (
 <Badge
 variant={
 latestAgentVersion && compareVersions(node.agentVersion, latestAgentVersion)
 ? 'warning'
 : 'outline'
 }
 className="shrink-0 gap-1 font-mono text-[10px]"
 >
 {latestAgentVersion && compareVersions(node.agentVersion, latestAgentVersion) ? (
 <AlertTriangle className="h-2.5 w-2.5" />
 ) : (
 <CheckCircle className="h-2.5 w-2.5" />
 )}
 {t('nodes.agentVersionShort', { version: node.agentVersion })}
 </Badge>
 )}
 </div>
 <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
 <span className="font-mono text-[11px] opacity-70">
 {node.hostname ?? t('nodes.hostnameUnavailable')}
 </span>
 {node.location && <span>{node.location.name}</span>}
 <span className="hidden sm:inline">{t('nodes.lastSeen', { time: lastSeen })}</span>
 </div>
 </div>

 {/* Resource stats — visible on larger screens */}
 <div className="hidden items-center gap-4 lg:flex">
 <div className="text-right">
 <div className="text-xs font-medium text-foreground">
 {serverCount}
 </div>
 <div className="text-[11px] text-muted-foreground">{t('nodes.stat.servers')}</div>
 </div>
 <div className="text-right">
 <div className="text-xs font-medium text-foreground">
 {node.maxCpuCores ?? 0}
 </div>
 <div className="text-[11px] text-muted-foreground">{t('nodes.stat.cores')}</div>
 </div>
 <div className="text-right">
 <div className="text-xs font-medium text-foreground">
 {memoryGB} GB
 </div>
 <div className="text-[11px] text-muted-foreground">{t('nodes.stat.memory')}</div>
 </div>
 </div>

 {/* Action buttons */}
 <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <Link
 to={`/admin/nodes/${node.id}`}
 className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
 >
 <ExternalLink className="h-3 w-3" />
 <span className="hidden sm:inline">{t('nodes.manage')}</span>
 </Link>

 {canDelete && (
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 title={t('common:actions.more')}
 >
 <MoreHorizontal className="h-3.5 w-3.5" />
 </button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem asChild>
 <Link to={`/admin/nodes/${node.id}`} className="gap-2 text-xs">
 <ExternalLink className="h-3.5 w-3.5" />
 {t('nodes.manage')}
 </Link>
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => handleBulkDelete([node.id], node.name)}
 disabled={deleteMutation.isPending}
 className="gap-2 text-xs text-destructive"
 >
 <Trash2 className="h-3.5 w-3.5" />
 {t('common:actions.delete')}
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 )}
 </div>
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
 className="h-4 w-4 rounded border-border bg-card text-primary"
 />
 <span className="text-xs font-medium text-muted-foreground">{t('nodes.selectAllInSection')}</span>
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
 setSelectedIds={setSelectedIds}
 handleBulkDelete={handleBulkDelete}
 deleteMutation={deleteMutation}
 latestAgentVersion={updateData?.latestVersion}
 />
 ))}
 </div>
 </>
 );

 const summaryStats = [
 { label: t('nodes.stats.nodes'), value: nodes.length },
 { label: t('nodes.stats.online'), value: onlineNodes.length },
 { label: t('nodes.stats.offline'), value: offlineNodes.length },
 { label: t('nodes.stats.totalServers'), value: totalServers },
 { label: t('nodes.stats.cpuCores'), value: totalCpu },
 { label: t('nodes.stats.memory'), value: formatMemory(totalMemory) },
 ];

 return (
 <div className="space-y-5">
 {/* ── Header ── */}
 <TabHeader
 icon={Server}
 title={t('nodes.title')}
 description={t('nodes.description')}
 actions={
 <div className="flex items-center gap-2">
 {canWrite && <NodeCreateModal />}
 {canWrite && (
 <button
 className="flex items-center gap-1.5 rounded-lg border border-border/40 bg-card px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/20 hover:text-foreground"
 onClick={() => setLocationsModalOpen(true)}
 >
 <MapPin className="h-3.5 w-3.5" />
 {t('nodes.locations')}
 </button>
 )}
 </div>
 }
 />

 {/* ── Summary Stats ── */}
 {isLoading ? (
 <TabLoadingState rows={1} rowHeight="h-16" />
 ) : (
 <StatGrid items={summaryStats} columns={3} />
 )}

 {/* ── Search & Controls Bar ── */}
 <div className="flex flex-wrap items-center gap-2.5">
 {/* Search input */}
 <div className="relative min-w-[200px] flex-1 max-w-sm">
 <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder={t('nodes.searchPlaceholder')}
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
 {t('nodes.filters')}
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
 <SelectItem value="name-asc">{t('nodes.sort.nameAsc')}</SelectItem>
 <SelectItem value="name-desc">{t('nodes.sort.nameDesc')}</SelectItem>
 <SelectItem value="status">{t('nodes.sort.status')}</SelectItem>
 <SelectItem value="servers">{t('nodes.sort.mostServers')}</SelectItem>
 <SelectItem value="cpu">{t('nodes.sort.cpuCores')}</SelectItem>
 <SelectItem value="memory">{t('nodes.sort.memory')}</SelectItem>
 </SelectContent>
 </Select>

 {/* Results count */}
 <span className="text-xs text-muted-foreground">
 {t('nodes.resultCount', { shown: filteredNodes.length, total: nodes.length })}
 </span>
 </div>

 {/* ── Location Selector Tabs ── */}
 {locations.length > 0 && (
 <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin">
 <button
 className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
 selectedLocationId === null
 ? 'bg-primary text-primary-foreground '
 : 'bg-surface-2 text-muted-foreground hover:text-foreground'
 }`}
 onClick={() => setSelectedLocationId(null)}
 >
 {t('nodes.allLocations')}
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
 className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
 selectedLocationId === location.id
 ? 'bg-primary text-primary-foreground '
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
 className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
 selectedLocationId === '__unassigned__'
 ? 'bg-primary text-primary-foreground '
 : 'bg-surface-2 text-muted-foreground hover:text-foreground'
 }`}
 onClick={() => setSelectedLocationId('__unassigned__')}
 >
 <MapPin className="h-3.5 w-3.5" />
 {t('nodes.unassigned')}
 <span
 className={`text-[10px] ${selectedLocationId === '__unassigned__' ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}
 >
 {locationCounts.unassignedCount}
 </span>
 </button>
 )}
 </div>
 )}

 {/* ── Expandable Filter Panel ── */}
 {showFilters && (
 <div className="overflow-hidden">
 <ServerTabCard>
 <div className="flex flex-wrap items-end gap-4">
 <label className="space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">{t('nodes.filter.status')}</span>
 <Select
 value={statusFilter || 'all'}
 onValueChange={(value) => {
 setStatusFilter(value === 'all' ? '' : value);
 }}
 >
 <SelectTrigger className="w-44">
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
 <label className="space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">{t('nodes.filter.location')}</span>
 <Select
 value={selectedLocationId || 'all'}
 onValueChange={(value) => {
 setSelectedLocationId(value === 'all' ? null : value);
 }}
 >
 <SelectTrigger className="w-44">
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
 <Button
 variant="ghost"
 size="sm"
 onClick={clearFilters}
 className="gap-1.5 text-xs"
 >
 <X className="h-3 w-3" />
 {t('nodes.clearAll')}
 </Button>
 )}
 </div>
 </ServerTabCard>
 </div>
 )}

 {/* ── Bulk Actions Bar ── */}
 {selectedIds.length > 0 && canDelete && (
 <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
 <div className="flex items-center gap-3">
 <span className="text-sm font-medium text-foreground">
 {t('nodes.selectedCount', { value: selectedIds.length })}
 </span>
 <button
 onClick={() => setSelectedIds([])}
 className="text-xs text-muted-foreground transition-colors hover:text-foreground"
 >
 {t('nodes.clearSelection')}
 </button>
 </div>
 <div className="flex items-center gap-1.5">
 <Button
 variant="destructive"
 size="sm"
 onClick={() => handleBulkDelete(selectedIds, t('nodes.selectedLabel', { value: selectedIds.length }))}
 disabled={deleteMutation.isPending}
 className="gap-1.5 text-xs"
 >
 <Trash2 className="h-3 w-3" />
 {t('common:actions.delete')}
 </Button>
 </div>
 </div>
 )}

 {/* ── Node List ── */}
 {showGroupedView ? (
 /* ── Grouped by Location View ── */
 <div className="space-y-4">
 {isLoading ? (
 <ServerTabCard>
 <TableSkeleton />
 </ServerTabCard>
 ) : groupedByLocation.length > 0 ? (
 groupedByLocation.map(([locationId, groupNodes]) => {
 const location = locationId ? (locationMap.get(locationId) ?? null) : null;
 return (
 <div
 key={locationId ?? '__unassigned__'}
 className="overflow-hidden rounded-xl border border-border bg-card "
 >
 <LocationSectionHeader location={location} count={groupNodes.length} />
 {renderNodeRows(groupNodes, true)}
 </div>
 );
 })
 ) : (
 <ServerTabCard>
 <EmptyState
 title={search.trim() || statusFilter ? t('nodes.empty.notFound') : t('nodes.empty.none')}
 description={
 search.trim() || statusFilter
 ? t('nodes.empty.adjustFilters')
 : t('nodes.empty.installAgent')
 }
 action={
 hasActiveFilters ? (
 <Button variant="outline" size="sm" onClick={clearFilters}>
 <X className="mr-1.5 h-3.5 w-3.5" />
 {t('nodes.clearFilters')}
 </Button>
 ) : canWrite && !search.trim() ? (
 <NodeCreateModal />
 ) : undefined
 }
 />
 </ServerTabCard>
 )}
 </div>
 ) : (
 /* ── Flat List View (single location selected or no locations exist) ── */
 <div className="overflow-hidden rounded-xl border border-border bg-card ">
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
 className="h-4 w-4 rounded border-border bg-card text-primary"
 />
 <span className="text-xs font-medium text-muted-foreground">
 {t('nodes.selectAll')}
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
 setSelectedIds={setSelectedIds}
 handleBulkDelete={handleBulkDelete}
 deleteMutation={deleteMutation}
 latestAgentVersion={updateData?.latestVersion}
 />
 ))}
 </div>
 </>
 ) : (
 <div className="p-6">
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
 <Button variant="outline" size="sm" onClick={clearFilters}>
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
 )}

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
 <p className="text-xs text-muted-foreground">
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
