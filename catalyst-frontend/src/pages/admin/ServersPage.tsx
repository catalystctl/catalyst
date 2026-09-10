import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 Play,
 Square,
 RotateCw,
 Ban,
 CheckCircle,
 Trash2,
 Search,
 Filter,
 ArrowUpDown,
 Server,
 MoreHorizontal,
 Settings,
 X,
} from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import Pagination from '../../components/shared/Pagination';
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
import UpdateServerModal from '../../components/servers/UpdateServerModal';
import CreateServerModal from '../../components/servers/CreateServerModal';
import DeleteServerDialog from '../../components/servers/DeleteServerDialog';
import { useAdminNodes, useAdminServers } from '../../hooks/useAdmin';
import { useTemplates } from '../../hooks/useTemplates';
import type { AdminServer, AdminServerAction } from '../../types/admin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { serverStatusLabel } from '../../utils/constants';

const pageSize = 20;

// ── Status Config ──
function getStatusConfig(serverStatus: string) {
 switch (serverStatus) {
 case 'running':
 return {
 variant: 'success' as const,
 dot: 'bg-success/50',
 };
 case 'stopped':
 return {
 variant: 'secondary' as const,
 dot: 'bg-surface-3',
 };
 case 'suspended':
 return {
 variant: 'destructive' as const,
 dot: 'bg-destructive/50',
 };
 case 'starting':
 case 'stopping':
 return {
 variant: 'warning' as const,
 dot: 'bg-warning/50',
 };
 case 'restoring':
 return {
 variant: 'warning' as const,
 dot: 'bg-warning/50',
 };
 case 'creating_backup':
 return {
 variant: 'warning' as const,
 dot: 'bg-warning/50',
 };
 default:
 return {
 variant: 'secondary' as const,
 dot: 'bg-surface-3',
 };
 }
}

// ── Status Dot Badge ──
function StatusBadge({ status }: { status: string }) {
 const { t } = useTranslation('admin-infra');
 const config = getStatusConfig(status);
 return (
 <Badge variant={config.variant} className="gap-1.5 font-medium">
 <span className={`relative flex h-1.5 w-1.5`}>
 {status === 'running' && (
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
 )}
 <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${config.dot}`} />
 </span>
 {serverStatusLabel(t, status)}
 </Badge>
 );
}

// ── Server Action Label ──
function serverActionVerb(t: TFunction, action: AdminServerAction): string {
 switch (action) {
 case 'start':
 return t('servers.actionVerb.start');
 case 'stop':
 return t('servers.actionVerb.stop');
 case 'restart':
 return t('servers.actionVerb.restart');
 case 'suspend':
 return t('servers.actionVerb.suspend');
 case 'unsuspend':
 return t('servers.actionVerb.unsuspend');
 case 'delete':
 return t('servers.actionVerb.delete');
 default:
 return action;
 }
}

// ── Main Component ──
function AdminServersPage() {
 const { t } = useTranslation('admin-infra');
 const [page, setPage] = useState(1);
 const [status, setStatus] = useState('');
 const [search, setSearch] = useState('');
 const [ownerSearch, setOwnerSearch] = useState('');
 const [nodeId, setNodeId] = useState('');
 const [templateId, setTemplateId] = useState('');
 const [sort, setSort] = useState('name-asc');
 const [selectedIds, setSelectedIds] = useState<string[]>([]);
 const [showFilters, setShowFilters] = useState(false);
 const [suspendTargets, setSuspendTargets] = useState<{ serverIds: string[]; label: string } | null>(
 null,
 );
 const [deleteTargets, setDeleteTargets] = useState<{ serverIds: string[]; label: string } | null>(
 null,
 );
 const [suspendReason, setSuspendReason] = useState('');
 const [updateServerId, setUpdateServerId] = useState<string | null>(null);
 const [deleteServer, setDeleteServer] = useState<{ id: string; name: string } | null>(null);
 const { data, isLoading } = useAdminServers({
 page,
 limit: pageSize,
 status: status || undefined,
 search: search.trim() || undefined,
 owner: ownerSearch.trim() || undefined,
 });
 const { data: nodesData } = useAdminNodes();
 const { data: templates = [] } = useTemplates();

 const servers = useMemo(() => data?.servers ?? [], [data?.servers]);
 const pagination = data?.pagination;
 const nodes = useMemo(() => nodesData?.nodes ?? [], [nodesData?.nodes]);

 const statuses = useMemo(
 () => Array.from(new Set(servers.map((server) => server.status))).sort(),
 [servers],
 );

 const sortedNodes = useMemo(
 () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
 [nodes],
 );

 const sortedTemplates = useMemo(
 () => [...templates].sort((a, b) => a.name.localeCompare(b.name)),
 [templates],
 );

 const hasActiveFilters = status || nodeId || templateId || ownerSearch.trim();

 const clearFilters = () => {
 setStatus('');
 setNodeId('');
 setTemplateId('');
 setOwnerSearch('');
 setPage(1);
 };

 const filteredServers = useMemo(() => {
 let filtered = servers;
 if (status) filtered = filtered.filter((server) => server.status === status);
 if (nodeId) filtered = filtered.filter((server) => server.node.id === nodeId);
 if (templateId) filtered = filtered.filter((server) => server.template.id === templateId);
 const sorted = [...filtered];
 sorted.sort((a, b) => {
 switch (sort) {
 case 'name-desc':
 return b.name.localeCompare(a.name);
 case 'status':
 return a.status.localeCompare(b.status);
 case 'node':
 return a.node.name.localeCompare(b.node.name);
 case 'template':
 return a.template.name.localeCompare(b.template.name);
 default:
 return a.name.localeCompare(b.name);
 }
 });
 return sorted;
 }, [servers, status, nodeId, templateId, sort]);

 const filteredIds = useMemo(() => filteredServers.map((server) => server.id), [filteredServers]);
 const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

 const currentServerIds = useMemo(() => new Set(servers.map((s) => s.id)), [servers]);
 const validSelectedIds = useMemo(
 () => selectedIds.filter((id) => currentServerIds.has(id)),
 [selectedIds, currentServerIds],
 );

 if (validSelectedIds.length !== selectedIds.length) {
 setSelectedIds(validSelectedIds);
 }

 const bulkActionMutation = useMutation({
 mutationFn: (payload: { serverIds: string[]; action: AdminServerAction; reason?: string }) =>
 adminApi.bulkServerAction(payload),
 onSuccess: (response, variables) => {
 const successCount =
 response?.summary?.success ??
 response?.results?.filter((result) => result.status === 'success').length ??
 0;
 const failedCount =
 response?.summary?.failed ??
 response?.results?.filter((result) => result.status === 'failed').length ??
 0;
 notifySuccess(
 t('servers.toast.queued', {
 action: serverActionVerb(t, variables.action),
 count: successCount,
 }),
 );
 if (failedCount) {
 notifyError(
 t('servers.toast.failed', {
 action: serverActionVerb(t, variables.action),
 count: failedCount,
 }),
 );
 }
 setSelectedIds([]);
 setSuspendTargets(null);
 setDeleteTargets(null);
 setSuspendReason('');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminServers() });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const handleBulkAction = (action: AdminServerAction, serverIds: string[], label: string) => {
 if (!serverIds.length) return;
 if (action === 'suspend') {
 setSuspendTargets({ serverIds, label });
 setSuspendReason('');
 return;
 }
 if (action === 'delete') {
 setDeleteTargets({ serverIds, label });
 return;
 }
 bulkActionMutation.mutate({ serverIds, action });
 };

 // ── Status counts for quick filter pills ──
 const statusCounts = useMemo(() => {
 const counts: Record<string, number> = {};
 for (const s of servers) {
 counts[s.status] = (counts[s.status] || 0) + 1;
 }
 return counts;
 }, [servers]);

 return (
 <div className="space-y-5">
 <TabHeader
 icon={Server}
 title={t('servers.title')}
 description={t('servers.description')}
 actions={
 <div className="flex flex-wrap gap-2">
 <CreateServerModal />
 {isLoading ? (
 <>
 <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
 <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
 </>
 ) : (
 <>
 <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
 <span className="h-2 w-2 rounded-full bg-surface-3" />
 {t('servers.totalCount', { value: data?.pagination?.total ?? 0 })}
 </Badge>
 {statusCounts['running'] ? (
 <Badge variant="success" className="h-8 gap-1.5 px-3 text-xs">
 <span className="h-2 w-2 rounded-full bg-success" />
 {t('servers.runningCount', { value: statusCounts['running'] })}
 </Badge>
 ) : null}
 {statusCounts['stopped'] ? (
 <Badge variant="secondary" className="h-8 gap-1.5 px-3 text-xs">
 <span className="h-2 w-2 rounded-full bg-surface-3" />
 {t('servers.stoppedCount', { value: statusCounts['stopped'] })}
 </Badge>
 ) : null}
 {statusCounts['suspended'] ? (
 <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
 <span className="h-2 w-2 rounded-full bg-destructive/60" />
 {t('servers.suspendedCount', { value: statusCounts['suspended'] })}
 </Badge>
 ) : null}
 </>
 )}
 </div>
 }
 variant="default"
 />

 {/* ── Search & Controls Bar ── */}
 <div className="flex flex-wrap items-center gap-2.5">
 {/* Search input */}
 <div className="relative flex-1 min-w-[200px] max-w-sm">
 <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(event) => {
 setSearch(event.target.value);
 setPage(1);
 }}
 placeholder={t('servers.searchPlaceholder')}
 className="border-border/40 pl-9"
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
 {t('servers.filters')}
 {hasActiveFilters && (
 <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
 {[status, nodeId, templateId, ownerSearch.trim()].filter(Boolean).length}
 </span>
 )}
 </Button>

 {/* Sort */}
 <Select value={sort} onValueChange={setSort}>
 <SelectTrigger className="w-40 gap-2 border-border/40 text-xs">
 <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="name-asc">{t('servers.sort.nameAsc')}</SelectItem>
 <SelectItem value="name-desc">{t('servers.sort.nameDesc')}</SelectItem>
 <SelectItem value="status">{t('servers.sort.status')}</SelectItem>
 <SelectItem value="node">{t('servers.sort.node')}</SelectItem>
 <SelectItem value="template">{t('servers.sort.template')}</SelectItem>
 </SelectContent>
 </Select>

 {/* Results count */}
 <span className="text-xs text-muted-foreground">
 {t('servers.resultCount', {
 shown: filteredServers.length,
 total: data?.pagination?.total ?? servers.length,
 })}
 </span>
 </div>

 {/* ── Expandable Filter Panel ── */}
 {showFilters && (
 <div className="overflow-hidden">
 <div className="rounded-xl border border-border/30 bg-card/80 p-4">
 <div className="flex flex-wrap items-end gap-4">
 <label className="space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">{t('servers.filter.status')}</span>
 <Select
 value={status || 'all'}
 onValueChange={(value) => {
 setStatus(value === 'all' ? '' : value);
 setPage(1);
 }}
 >
 <SelectTrigger className="w-44 border-border/40">
 <SelectValue placeholder={t('servers.filter.allStatuses')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">{t('servers.filter.allStatuses')}</SelectItem>
 {statuses.map((entry) => (
 <SelectItem key={entry} value={entry}>
 {serverStatusLabel(t, entry)}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </label>
 <label className="space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">{t('servers.filter.node')}</span>
 <Select
 value={nodeId || 'all'}
 onValueChange={(value) => {
 setNodeId(value === 'all' ? '' : value);
 setPage(1);
 }}
 >
 <SelectTrigger className="w-44 border-border/40">
 <SelectValue placeholder={t('servers.filter.allNodes')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">{t('servers.filter.allNodes')}</SelectItem>
 {sortedNodes.map((node) => (
 <SelectItem key={node.id} value={node.id}>
 {node.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </label>
 <label className="space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">{t('servers.filter.template')}</span>
 <Select
 value={templateId || 'all'}
 onValueChange={(value) => {
 setTemplateId(value === 'all' ? '' : value);
 setPage(1);
 }}
 >
 <SelectTrigger className="w-44 border-border/40">
 <SelectValue placeholder={t('servers.filter.allTemplates')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">{t('servers.filter.allTemplates')}</SelectItem>
 {sortedTemplates.map((template) => (
 <SelectItem key={template.id} value={template.id}>
 {template.name}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </label>
 <label className="space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">{t('servers.filter.owner')}</span>
 <Input
 value={ownerSearch}
 onChange={(event) => {
 setOwnerSearch(event.target.value);
 setPage(1);
 }}
 placeholder={t('servers.filter.ownerPlaceholder')}
 className="w-44 border-border/40"
 />
 </label>
 {hasActiveFilters && (
 <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1.5 text-xs">
 <X className="h-3 w-3" />
 {t('servers.clearAll')}
 </Button>
 )}
 </div>
 </div>
 </div>
 )}

 {/* ── Bulk Actions Bar ── */}
 {selectedIds.length > 0 && (
 <div className="overflow-hidden">
 <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
 <div className="flex items-center gap-3">
 <span className="text-sm font-medium text-foreground">
 {t('servers.selectedCount', { value: selectedIds.length })}
 </span>
 <button
 onClick={() => setSelectedIds([])}
 className="text-xs text-muted-foreground transition-colors hover:text-foreground"
 >
 {t('servers.clearSelection')}
 </button>
 </div>
 <div className="flex items-center gap-1.5">
 <Button
 variant="outline"
 size="sm"
 onClick={() => handleBulkAction('start', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
 disabled={bulkActionMutation.isPending}
 className="gap-1.5 text-xs text-success hover:border-success/20 hover:bg-success/5 hover:text-success"
 >
 <Play className="h-3 w-3" />
 {t('servers.actions.start')}
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => handleBulkAction('stop', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
 disabled={bulkActionMutation.isPending}
 className="gap-1.5 text-xs text-warning hover:border-warning/20 hover:bg-warning/5 hover:text-warning"
 >
 <Square className="h-3 w-3" />
 {t('servers.actions.stop')}
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => handleBulkAction('restart', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
 disabled={bulkActionMutation.isPending}
 className="gap-1.5 text-xs"
 >
 <RotateCw className="h-3 w-3" />
 {t('servers.actions.restart')}
 </Button>
 <div className="mx-1 h-4 w-px bg-border" />
 <Button
 variant="outline"
 size="sm"
 onClick={() => handleBulkAction('suspend', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
 disabled={bulkActionMutation.isPending}
 className="gap-1.5 text-xs text-destructive hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
 >
 <Ban className="h-3 w-3" />
 {t('servers.actions.suspend')}
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => handleBulkAction('unsuspend', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
 disabled={bulkActionMutation.isPending}
 className="gap-1.5 text-xs text-success hover:border-success/20 hover:bg-success/5 hover:text-success"
 >
 <CheckCircle className="h-3 w-3" />
 {t('servers.actions.unsuspend')}
 </Button>
 <div className="mx-1 h-4 w-px bg-border" />
 <Button
 variant="destructive"
 size="sm"
 onClick={() => handleBulkAction('delete', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
 disabled={bulkActionMutation.isPending}
 className="gap-1.5 text-xs"
 >
 <Trash2 className="h-3 w-3" />
 {t('common:actions.delete')}
 </Button>
 </div>
 </div>
 </div>
 )}

 {/* ── Server List ── */}
 <div className="rounded-xl border border-border/30 bg-card/80 shadow-sm">
 {isLoading ? (
 <div className="p-4">
 <TabLoadingState rows={6} />
 </div>
 ) : filteredServers.length > 0 ? (
 <>
 {/* Select-all header */}
 <div className="flex items-center gap-3 border-b border-border/30 px-4 py-2">
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
 className="h-4 w-4 rounded border-border/40 bg-card text-primary"
 />
 <span className="text-xs font-medium text-muted-foreground">
 {t('servers.selectAll')}
 </span>
 </label>
 </div>

 {/* Server rows */}
 <div className="divide-y divide-border/30">
 {filteredServers.map((server: AdminServer) => {
 const isSelected = selectedIds.includes(server.id);
 const isSuspended = server.status === 'suspended';
 const isRunning = server.status === 'running';
 const isStopped = server.status === 'stopped';
 const isBusy = server.status === 'starting' || server.status === 'stopping' || server.status === 'restoring' || server.status === 'creating_backup';

 return (
 <div
 key={server.id}
 className={`group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/50 ${
 isSelected ? 'bg-primary/5' : ''
 }`}
 >
 {/* Checkbox */}
 <input
 type="checkbox"
 checked={isSelected}
 onChange={() =>
 setSelectedIds((prev) =>
 prev.includes(server.id)
 ? prev.filter((id) => id !== server.id)
 : [...prev, server.id],
 )
 }
 className="h-4 w-4 flex-shrink-0 rounded border-border/40 bg-card text-primary"
 />

 {/* Server info — primary column */}
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2.5">
 <Link
 to={`/servers/${server.id}/console`}
 className="truncate font-semibold text-foreground transition-colors hover:text-primary"
 >
 {server.name}
 </Link>
 <StatusBadge status={server.status} />
 </div>
 <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
 <span className="font-mono text-[11px] opacity-60">{server.id}</span>
 {server.owner && (
 <span>
 {server.owner.username || server.owner.email}
 </span>
 )}
 <span className="hidden sm:inline">
 {server.node.name}
 </span>
 <span className="hidden md:inline">
 {server.template.name}
 </span>
 </div>
 </div>

 {/* Quick action buttons — visible on hover or mobile */}
 <div className="flex items-center gap-1 opacity-100 transition-opacity group-hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
 {!isSuspended && (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-success/5 hover:text-success disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleBulkAction('start', [server.id], server.name)}
 disabled={bulkActionMutation.isPending || isRunning || isBusy}
 title={t('servers.actions.start')}
 >
 <Play className="h-3.5 w-3.5" />
 </button>
 )}
 {!isSuspended && (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-warning/5 hover:text-warning disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleBulkAction('stop', [server.id], server.name)}
 disabled={bulkActionMutation.isPending || isStopped || isBusy}
 title={t('servers.actions.stop')}
 >
 <Square className="h-3.5 w-3.5" />
 </button>
 )}
 {isSuspended ? (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-success/5 hover:text-success disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleBulkAction('unsuspend', [server.id], server.name)}
 disabled={bulkActionMutation.isPending}
 title={t('servers.actions.unsuspend')}
 >
 <CheckCircle className="h-3.5 w-3.5" />
 </button>
 ) : (
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
 onClick={() => handleBulkAction('suspend', [server.id], server.name)}
 disabled={bulkActionMutation.isPending}
 title={t('servers.actions.suspend')}
 >
 <Ban className="h-3.5 w-3.5" />
 </button>
 )}

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
 <Link to={`/servers/${server.id}/console`} className="gap-2 text-xs">
 {t('servers.actions.console')}
 </Link>
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => handleBulkAction('restart', [server.id], server.name)}
 disabled={bulkActionMutation.isPending || isSuspended}
 className="gap-2 text-xs"
 >
 <RotateCw className="h-3.5 w-3.5" />
 {t('servers.actions.restart')}
 </DropdownMenuItem>
 {isSuspended ? (
 <DropdownMenuItem
 onClick={() => handleBulkAction('unsuspend', [server.id], server.name)}
 disabled={bulkActionMutation.isPending}
 className="gap-2 text-xs text-success"
 >
 <CheckCircle className="h-3.5 w-3.5" />
 {t('servers.actions.unsuspend')}
 </DropdownMenuItem>
 ) : (
 <DropdownMenuItem
 onClick={() => handleBulkAction('suspend', [server.id], server.name)}
 disabled={bulkActionMutation.isPending}
 className="gap-2 text-xs text-destructive"
 >
 <Ban className="h-3.5 w-3.5" />
 {t('servers.actions.suspend')}
 </DropdownMenuItem>
 )}
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => setUpdateServerId(server.id)}
 disabled={bulkActionMutation.isPending}
 className="gap-2 text-xs"
 >
 <Settings className="h-3.5 w-3.5" />
 {t('servers.actions.update')}
 </DropdownMenuItem>
 <DropdownMenuSeparator />
 <DropdownMenuItem
 onClick={() => setDeleteServer({ id: server.id, name: server.name })}
 disabled={bulkActionMutation.isPending}
 className="gap-2 text-xs text-destructive"
 >
 <Trash2 className="h-3.5 w-3.5" />
 {t('common:actions.delete')}
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </div>
 </div>
 );
 })}
 </div>

 {/* Pagination */}
 {pagination && pagination.totalPages > 1 ? (
 <div className="border-t border-border/30 px-4 py-3">
 <Pagination
 page={pagination.page}
 totalPages={pagination.totalPages}
 onPageChange={setPage}
 />
 </div>
 ) : null}
 </>
 ) : (
 <div className="p-6">
 <TabEmptyState
 title={search.trim() || hasActiveFilters ? t('servers.empty.notFound') : t('servers.empty.none')}
 description={
 search.trim() || hasActiveFilters
 ? t('servers.empty.adjustFilters')
 : t('servers.empty.createServer')
 }
 action={
 hasActiveFilters ? (
 <Button variant="outline" size="sm" onClick={clearFilters}>
 <X className="mr-1.5 h-3.5 w-3.5" />
 {t('servers.clearFilters')}
 </Button>
 ) : (
 <CreateServerModal />
 )
 }
 />
 </div>
 )}
 </div>

  <ConfirmDialog
    open={!!suspendTargets}
    title={t('servers.suspendDialog.title')}
    message={
      <div className="space-y-3">
        <p>
          <Trans
            i18nKey="servers.suspendDialog.message"
            ns="admin-infra"
            values={{ label: suspendTargets?.label }}
          >
            You are about to suspend <span className="font-semibold">{'{{label}}'}</span>.
          </Trans>
        </p>
        <label className="block space-y-1">
          <span className="text-sm text-muted-foreground">
            {t('servers.suspendDialog.reasonLabel')}
          </span>
          <input
            className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
            value={suspendReason}
            onChange={(event) => setSuspendReason(event.target.value)}
            placeholder={t('servers.suspendDialog.reasonPlaceholder')}
            onClick={(e) => e.stopPropagation()}
          />
        </label>
      </div>
    }
    confirmText={t('servers.actions.suspend')}
    cancelText={t('common:actions.cancel')}
    onConfirm={() =>
      suspendTargets &&
      bulkActionMutation.mutate({
        serverIds: suspendTargets.serverIds,
        action: 'suspend',
        reason: suspendReason.trim() || undefined,
      })
    }
    onCancel={() => {
      setSuspendTargets(null);
      setSuspendReason('');
    }}
    variant="warning"
    loading={bulkActionMutation.isPending}
  />

  {/* ── Delete Confirmation Dialog ── */}
  <ConfirmDialog
    open={!!deleteTargets}
    title={t('servers.deleteDialog.title')}
    message={
      <div className="space-y-2">
        <p>
          <Trans
            i18nKey="servers.deleteDialog.message"
            ns="admin-infra"
            values={{ label: deleteTargets?.label }}
          >
            You are about to delete <span className="font-semibold">{'{{label}}'}</span>.
          </Trans>
        </p>
        <p className="text-xs text-muted-foreground">
          {t('servers.deleteDialog.warning')}
        </p>
      </div>
    }
    confirmText={t('common:actions.delete')}
    cancelText={t('common:actions.cancel')}
 onConfirm={() =>
 deleteTargets &&
 bulkActionMutation.mutate({
 serverIds: deleteTargets.serverIds,
 action: 'delete',
 })
 }
 onCancel={() => setDeleteTargets(null)}
 variant="danger"
 loading={bulkActionMutation.isPending}
 />

 {/* ── Controlled Update Modal ── */}
 {updateServerId && (
 <UpdateServerModal
 serverId={updateServerId}
 open
 onOpenChange={(open) => { if (!open) setUpdateServerId(null); }}
 />
 )}

 {/* ── Controlled Delete Dialog ── */}
 {deleteServer && (
 <DeleteServerDialog
 serverId={deleteServer.id}
 serverName={deleteServer.name}
 open
 onOpenChange={(open) => { if (!open) setDeleteServer(null); }}
 />
 )}
 </div>
 );
}

export default AdminServersPage;
