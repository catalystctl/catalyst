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
 MoreHorizontal,
 Settings,
 X,
} from 'lucide-react';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import Pagination from '../../components/shared/Pagination';
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
import { BracketLabel, GameChip, Segmented, StatusLed } from '../../components/deck/primitives';
import { cn } from '@/lib/utils';

const pageSize = 20;

type Tone = 'go' | 'hazard' | 'alarm' | 'idle' | 'info';

/** Status is state, so it earns colour — but only via the LED and label. */
const STATE_TONE: Record<string, Tone> = {
 running: 'go',
 stopped: 'idle',
 suspended: 'hazard',
 starting: 'info',
 stopping: 'info',
 restoring: 'hazard',
 creating_backup: 'hazard',
 installing: 'info',
 crashed: 'alarm',
 error: 'alarm',
};
const toneForState = (status: string): Tone => STATE_TONE[status] ?? 'idle';

function stateTextClass(status: string) {
 if (status === 'suspended') return 'text-warning';
 if (status === 'crashed' || status === 'error') return 'text-danger';
 if (status === 'running') return 'text-success';
 return 'text-muted-foreground';
}

/**
 * One grid template shared by the column header and every row so columns line
 * up at each breakpoint. Fixed / minmax(0,1fr) tracks only — never `auto`.
 *   base : identity · actions
 *   md   : identity · node · state · actions
 *   xl   : identity · owner · node · template · state · actions
 */
const GRID =
 'grid grid-cols-1 items-center gap-x-3 gap-y-1.5 ' +
 'md:grid-cols-[minmax(0,1fr)_9rem_6.5rem_8.5rem] ' +
 'xl:grid-cols-[minmax(0,1fr)_9rem_9rem_8rem_6.5rem_8.5rem]';

// ── Server Action Label ──
// Module-level helper, so the namespace is spelled out: this file is inside
// `admin-infra`, but the extractor cannot infer that for a standalone `t`.
function serverActionVerb(t: TFunction, action: AdminServerAction): string {
 switch (action) {
 case 'start':
 return t('admin-infra:servers.actionVerb.start');
 case 'stop':
 return t('admin-infra:servers.actionVerb.stop');
 case 'restart':
 return t('admin-infra:servers.actionVerb.restart');
 case 'suspend':
 return t('admin-infra:servers.actionVerb.suspend');
 case 'unsuspend':
 return t('admin-infra:servers.actionVerb.unsuspend');
 case 'delete':
 return t('admin-infra:servers.actionVerb.delete');
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── Deck header ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('layout:sections.administration')}</BracketLabel>
          <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            {t('servers.title')}
          </h1>
          <p className="text-mini text-muted-foreground">{t('servers.description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CreateServerModal />
        </div>
      </header>

      {/* ── The deck: controls, columns, rows and totals in one frame ── */}
      <div className="deck-panel flex min-h-0 flex-col overflow-hidden">
        {/* Control strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t('servers.searchPlaceholder')}
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
            {t('servers.filters')}
            {hasActiveFilters && (
              <span className="font-mono text-micro tabular-nums text-primary">
                {[status, nodeId, templateId, ownerSearch.trim()].filter(Boolean).length}
              </span>
            )}
          </button>

          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="h-7 w-40 gap-2 rounded-sm border-border/60 text-mini">
              <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
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

          <span className="ml-auto font-mono text-micro tabular-nums text-muted-foreground">
            {t('servers.resultCount', {
              shown: filteredServers.length,
              total: data?.pagination?.total ?? servers.length,
            })}
          </span>
        </div>

        {/* Expandable filter panel */}
        {showFilters && (
          <div className="flex flex-wrap items-end gap-4 border-b border-border/50 bg-surface-1/20 px-3 py-2">
            <label className="flex flex-col gap-1">
              <span className="type-overline">{t('servers.filter.status')}</span>
              <Select
                value={status || 'all'}
                onValueChange={(value) => {
                  setStatus(value === 'all' ? '' : value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-7 w-40 rounded-sm border-border/60 text-mini">
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
            <label className="flex flex-col gap-1">
              <span className="type-overline">{t('servers.filter.node')}</span>
              <Select
                value={nodeId || 'all'}
                onValueChange={(value) => {
                  setNodeId(value === 'all' ? '' : value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-7 w-40 rounded-sm border-border/60 text-mini">
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
            <label className="flex flex-col gap-1">
              <span className="type-overline">{t('servers.filter.template')}</span>
              <Select
                value={templateId || 'all'}
                onValueChange={(value) => {
                  setTemplateId(value === 'all' ? '' : value);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-7 w-40 rounded-sm border-border/60 text-mini">
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
            <label className="flex flex-col gap-1">
              <span className="type-overline">{t('servers.filter.owner')}</span>
              <input
                value={ownerSearch}
                onChange={(event) => {
                  setOwnerSearch(event.target.value);
                  setPage(1);
                }}
                placeholder={t('servers.filter.ownerPlaceholder')}
                className="h-7 w-40 rounded-sm border border-border/60 bg-background/40 px-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
              />
            </label>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-mini text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-3 w-3" />
                {t('servers.clearAll')}
              </button>
            )}
          </div>
        )}

        {/* Bulk actions strip — swapped into the column-header slot so entering
            selection does not reflow the table you were reading */}
        {selectedIds.length > 0 ? (
          <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-primary/5 px-3 py-1.5">
            <div className="flex items-center gap-3">
              <span className="text-mini text-foreground">
                {t('servers.selectedCount', { value: selectedIds.length })}
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="text-micro text-muted-foreground transition-colors hover:text-foreground"
              >
                {t('servers.clearSelection')}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkAction('start', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
                disabled={bulkActionMutation.isPending}
                className="h-7 gap-1.5 rounded-sm px-2.5 text-mini text-muted-foreground"
              >
                <Play className="h-3 w-3" />
                {t('servers.actions.start')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkAction('stop', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
                disabled={bulkActionMutation.isPending}
                className="h-7 gap-1.5 rounded-sm px-2.5 text-mini text-muted-foreground"
              >
                <Square className="h-3 w-3" />
                {t('servers.actions.stop')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkAction('restart', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
                disabled={bulkActionMutation.isPending}
                className="h-7 gap-1.5 rounded-sm px-2.5 text-mini"
              >
                <RotateCw className="h-3 w-3" />
                {t('servers.actions.restart')}
              </Button>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkAction('suspend', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
                disabled={bulkActionMutation.isPending}
                className="h-7 gap-1.5 rounded-sm px-2.5 text-mini text-destructive hover:border-destructive/20 hover:bg-destructive/5 hover:text-destructive"
              >
                <Ban className="h-3 w-3" />
                {t('servers.actions.suspend')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkAction('unsuspend', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
                disabled={bulkActionMutation.isPending}
                className="h-7 gap-1.5 rounded-sm px-2.5 text-mini text-muted-foreground"
              >
                <CheckCircle className="h-3 w-3" />
                {t('servers.actions.unsuspend')}
              </Button>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleBulkAction('delete', selectedIds, t('servers.selectedLabel', { value: selectedIds.length }))}
                disabled={bulkActionMutation.isPending}
                className="h-7 gap-1.5 rounded-sm px-2.5 text-mini"
              >
                <Trash2 className="h-3 w-3" />
                {t('common:actions.delete')}
              </Button>
            </div>
          </div>
        ) : (
          /* Column header — same grid as the rows, so columns always line up */
          <div
            className={cn(
              GRID,
              'sticky top-0 z-10 hidden border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground/70 md:grid',
            )}
          >
            <span className="flex items-center gap-2">
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
                aria-label={t('servers.selectAll')}
                className="h-3.5 w-3.5 shrink-0 rounded-sm border-border bg-card text-primary"
              />
              <span className="type-overline">{t('servers:columns.server')}</span>
            </span>
            <span className="type-overline hidden justify-self-end xl:inline-flex">{t('servers.filter.owner')}</span>
            <span className="type-overline hidden justify-self-end md:inline-flex">{t('servers.filter.node')}</span>
            <span className="type-overline hidden justify-self-end xl:inline-flex">{t('servers.filter.template')}</span>
            <span className="type-overline hidden justify-self-end md:inline-flex">{t('servers.filter.status')}</span>
            <span className="type-overline justify-self-end">{t('common:actions.more')}</span>
          </div>
        )}

        {/* Rows */}
        <div className="max-h-[calc(100dvh-20rem)] min-w-0 overflow-y-auto bg-background/25">
          {isLoading ? (
            <div>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className={cn(GRID, 'border-t border-border/40 py-2 pl-3 pr-3')}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-surface-3" />
                    <div className="h-3.5 w-40 animate-pulse bg-surface-3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredServers.length > 0 ? (
            filteredServers.map((server: AdminServer) => {
              const isSelected = selectedIds.includes(server.id);
              const isSuspended = server.status === 'suspended';
              const isRunning = server.status === 'running';
              const isStopped = server.status === 'stopped';
              const isBusy = server.status === 'starting' || server.status === 'stopping' || server.status === 'restoring' || server.status === 'creating_backup';
              const game = server.template.name;

              return (
                <div
                  key={server.id}
                  role="row"
                  className={cn(
                    GRID,
                    'group py-1.5 pl-3 pr-3 transition-colors hover:bg-surface-1/40',
                    isSelected && 'bg-primary/5',
                  )}
                >
                  {/* identity */}
                  <div className="flex min-w-0 items-center gap-2">
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
                      className="h-3.5 w-3.5 shrink-0 rounded-sm border-border bg-card text-primary"
                    />
                    <StatusLed tone={toneForState(server.status)} pulse={isRunning} />
                    <GameChip game={game} className="hidden sm:inline-flex" />
                    <div className="flex min-w-0 flex-col leading-tight">
                      <Link
                        to={`/servers/${server.id}/console`}
                        title={server.name}
                        className="flex min-h-7 min-w-0 items-center truncate font-display text-data font-semibold tracking-tight text-foreground transition-colors hover:text-primary"
                      >
                        <span className="truncate">{server.name}</span>
                      </Link>
                      <span className="flex min-w-0 items-center gap-2 text-micro text-muted-foreground">
                        <span className="truncate font-mono opacity-60">{server.id}</span>
                        <span className={cn('shrink-0 uppercase md:hidden', stateTextClass(server.status))}>
                          {serverStatusLabel(t, server.status)}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* owner */}
                  <span className="hidden min-w-0 justify-self-end text-right xl:block">
                    <span
                      className="block truncate text-micro text-muted-foreground"
                      title={server.owner ? server.owner.username || server.owner.email : undefined}
                    >
                      {server.owner ? server.owner.username || server.owner.email : '—'}
                    </span>
                  </span>

                  {/* node */}
                  <span className="hidden min-w-0 justify-self-end text-right md:block">
                    <span className="block truncate text-micro text-muted-foreground">{server.node.name}</span>
                  </span>

                  {/* template */}
                  <span className="hidden min-w-0 justify-self-end text-right xl:block">
                    <span className="block truncate text-micro text-muted-foreground">{server.template.name}</span>
                  </span>

                  {/* state */}
                  <span className="hidden min-w-0 justify-end overflow-hidden md:flex">
                    <span className={cn('truncate text-micro uppercase', stateTextClass(server.status))}>
                      {serverStatusLabel(t, server.status)}
                    </span>
                  </span>

                  {/* actions */}
                  <span className="col-span-full flex shrink-0 items-center justify-start gap-1 md:col-auto md:justify-end">
                    {!isSuspended && (
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-success/50 hover:text-success disabled:pointer-events-none disabled:opacity-30"
                        onClick={() => handleBulkAction('start', [server.id], server.name)}
                        disabled={bulkActionMutation.isPending || isRunning || isBusy}
                        title={t('servers.actions.start')}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {!isSuspended && (
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-warning/50 hover:text-warning disabled:pointer-events-none disabled:opacity-30"
                        onClick={() => handleBulkAction('stop', [server.id], server.name)}
                        disabled={bulkActionMutation.isPending || isStopped || isBusy}
                        title={t('servers.actions.stop')}
                      >
                        <Square className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {isSuspended ? (
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-success/50 hover:text-success disabled:pointer-events-none disabled:opacity-30"
                        onClick={() => handleBulkAction('unsuspend', [server.id], server.name)}
                        disabled={bulkActionMutation.isPending}
                        title={t('servers.actions.unsuspend')}
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                      </button>
                    ) : (
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
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
                          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                          title={t('common:actions.more')}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link to={`/servers/${server.id}/console`} className="gap-2 text-mini">
                            {t('servers.actions.console')}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleBulkAction('restart', [server.id], server.name)}
                          disabled={bulkActionMutation.isPending || isSuspended}
                          className="gap-2 text-mini"
                        >
                          <RotateCw className="h-3.5 w-3.5" />
                          {t('servers.actions.restart')}
                        </DropdownMenuItem>
                        {isSuspended ? (
                          <DropdownMenuItem
                            onClick={() => handleBulkAction('unsuspend', [server.id], server.name)}
                            disabled={bulkActionMutation.isPending}
                            className="gap-2 text-mini text-success"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                            {t('servers.actions.unsuspend')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onClick={() => handleBulkAction('suspend', [server.id], server.name)}
                            disabled={bulkActionMutation.isPending}
                            className="gap-2 text-mini text-destructive"
                          >
                            <Ban className="h-3.5 w-3.5" />
                            {t('servers.actions.suspend')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setUpdateServerId(server.id)}
                          disabled={bulkActionMutation.isPending}
                          className="gap-2 text-mini"
                        >
                          <Settings className="h-3.5 w-3.5" />
                          {t('servers.actions.update')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleteServer({ id: server.id, name: server.name })}
                          disabled={bulkActionMutation.isPending}
                          className="gap-2 text-mini text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          {t('common:actions.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </span>
                </div>
              );
            })
          ) : (
            <div className="p-3">
              <TabEmptyState
                title={search.trim() || hasActiveFilters ? t('servers.empty.notFound') : t('servers.empty.none')}
                description={
                  search.trim() || hasActiveFilters
                    ? t('servers.empty.adjustFilters')
                    : t('servers.empty.createServer')
                }
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" size="sm" className="h-7 rounded-sm px-2.5 text-mini" onClick={clearFilters}>
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

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 ? (
          <div className="border-t border-border/50 px-3 py-2">
            <Pagination
              page={pagination.page}
              totalPages={pagination.totalPages}
              onPageChange={setPage}
            />
          </div>
        ) : null}

        {/* Footer strip — fleet totals */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 bg-surface-1/40 px-3 py-1.5">
          <LegendStat tone="idle" text={t('servers.totalCount', { value: pagination?.total ?? 0 })} />
          {statusCounts['running'] ? (
            <LegendStat tone="go" text={t('servers.runningCount', { value: statusCounts['running'] })} />
          ) : null}
          {statusCounts['stopped'] ? (
            <LegendStat tone="idle" text={t('servers.stoppedCount', { value: statusCounts['stopped'] })} />
          ) : null}
          {statusCounts['suspended'] ? (
            <LegendStat tone="hazard" text={t('servers.suspendedCount', { value: statusCounts['suspended'] })} />
          ) : null}
        </div>
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
          <span className="text-mini text-muted-foreground">
            {t('servers.suspendDialog.reasonLabel')}
          </span>
          <input
            className="w-full rounded-sm border border-border/60 bg-card px-3 py-1.5 text-mini text-foreground transition-colors focus:border-primary focus:outline-none"
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
        <p className="text-mini text-muted-foreground">
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

/** Footer legend entry — LED + mono count, matching the deck's footer strip. */
function LegendStat({ tone, text }: { tone: Tone; text: string }) {
 return (
 <span className="flex items-center gap-1.5">
 <StatusLed tone={tone} />
 <Segmented muted className="text-micro">
 {text}
 </Segmented>
 </span>
 );
}
