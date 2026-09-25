import { useEffect, useMemo, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { useParams, Link } from 'react-router-dom';
import {
 Plug,
 Globe,
 Search,
 Trash2,
 Plus,
 ArrowLeft,
 Info,
} from 'lucide-react';
import apiClient from '../../services/api/client';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';
import { useNodes } from '../../hooks/useNodes';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import EmptyState from '../../components/shared/EmptyState';
import { adminApi } from '../../services/api/admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { BracketLabel, Segmented } from '../../components/deck/primitives';
import { cn } from '@/lib/utils';

/**
 * One grid template per table, shared by the column header and every row so
 * columns line up. Fixed / minmax(0,1fr) tracks only — never `auto`.
 */
const PORTS_GRID =
  'grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 ' +
  'md:grid-cols-[1.5rem_minmax(0,1fr)_6rem_6.5rem_5rem]';

const POOLS_GRID =
  'grid grid-cols-1 items-center gap-x-3 gap-y-1.5 ' +
  'md:grid-cols-[minmax(0,1fr)_5rem_6rem_5rem_6rem_5rem]';

interface NodeAllocation {
 id: string;
 nodeId: string;
 serverId: string | null;
 ip: string;
 port: number;
 alias: string | null;
 notes: string | null;
 createdAt: string;
 updatedAt: string;
}

interface IpPool {
 id: string;
 nodeId: string;
 nodeName: string;
 networkName: string;
 cidr: string;
 gateway: string | null;
 rangeStart: string;
 rangeEnd: string;
 total: number;
 availableCount: number;
 usedCount: number;
 reservedCount: number;
 allocations?: Array<{
 id: string;
 ip: string;
 serverId: string | null;
 serverName?: string;
 serverStatus?: string;
 createdAt: string;
 }>;
}

const parseReserved = (value: string) =>
 value
 .split(/[\s,]+/)
 .map((entry) => entry.trim())
 .filter(Boolean);

function NodeAllocationsPage() {
 const { t } = useTranslation('admin-infra');
 const { nodeId } = useParams<{ nodeId: string }>();

 // Tab state
 const [activeTab, setActiveTab] = useState<'ports' | 'ips'>('ports');

 // Port allocations state
 const [search, setSearch] = useState('');
 const [showCreatePortModal, setShowCreatePortModal] = useState(false);
 const [ipInput, setIpInput] = useState('');
 const [portsInput, setPortsInput] = useState('');
 const [aliasInput, setAliasInput] = useState('');
 const [selectedIds, setSelectedIds] = useState<string[]>([]);
 const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false);

 // IP pool state
 const [showCreatePoolModal, setShowCreatePoolModal] = useState(false);
 const [networkName, setNetworkName] = useState('mc-lan');
 const [cidr, setCidr] = useState('');
 const [gateway, setGateway] = useState('');
 const [startIp, setStartIp] = useState('');
 const [endIp, setEndIp] = useState('');
 const [reserved, setReserved] = useState('');
 const [autoFillIp, setAutoFillIp] = useState('');

 const { data: nodes = [] } = useNodes();
 const node = nodes.find((n) => n.id === nodeId);

 // Fetch port allocations (NodeAllocation)
 const { data: allocations = [], isLoading: allocationsLoading } = useQuery<NodeAllocation[]>({
 queryKey: qk.adminNodeAllocations(nodeId!),
 queryFn: async () => {
 const response = await apiClient.get<{ success: boolean; data: NodeAllocation[] }>(`/api/nodes/${nodeId}/allocations`);
 return response.data ?? [];
 },
 enabled: !!nodeId,
 staleTime: 5 * 60 * 1000,
 });

 // Fetch IP pools (IpAllocation via pools)
 const { data: allPools = [], isLoading: poolsLoading } = useQuery({
 queryKey: qk.adminIpPools(nodeId!),
 queryFn: adminApi.listIpPools,
 staleTime: 5 * 60 * 1000,
 });

 const nodePools = useMemo(() => (allPools as IpPool[]).filter((p: IpPool) => p.nodeId === nodeId), [allPools, nodeId]);

 // Port allocation mutations
 const createPortMutation = useMutation({
 mutationFn: async () => {
 return apiClient.post<{ success: boolean; data: { created: number } }>(`/api/nodes/${nodeId}/allocations`, {
 ip: ipInput.trim(),
 ports: portsInput.trim(),
 alias: aliasInput.trim() || undefined,
 });
 },
 onSuccess: (response) => {
 const created = response.data?.created || 0;
 notifySuccess(t('allocations.toast.portsCreated', { count: created }));
 setShowCreatePortModal(false);
 setIpInput('');
 setPortsInput('');
 setAliasInput('');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId!) });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const deletePortMutation = useMutation({
 mutationFn: async (allocationId: string) => {
 return apiClient.delete(`/api/nodes/${nodeId}/allocations/${allocationId}`);
 },
 onSuccess: () => {
 notifySuccess(t('allocations.toast.portDeleted'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId!) });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const bulkDeletePortsMutation = useMutation({
 mutationFn: async (allocationIds: string[]) => {
 return nodesApi.bulkDeleteAllocations(nodeId!, allocationIds);
 },
 onSuccess: (data) => {
 const deleted = data?.deleted ?? 0;
 const skipped = data?.skippedAssigned ?? 0;
 if (deleted > 0) {
 notifySuccess(t('allocations.toast.portsDeleted', { count: deleted }));
 }
 if (skipped > 0) {
 notifyInfo(t('allocations.toast.portsDeleteSkipped', { count: skipped }));
 }
 setSelectedIds([]);
 setShowBulkDeleteDialog(false);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId!) });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 // IP pool mutations
 const createPoolMutation = useMutation({
 mutationFn: () =>
 adminApi.createIpPool({
 nodeId: nodeId!,
 networkName,
 cidr,
 gateway: gateway || undefined,
 startIp: startIp || undefined,
 endIp: endIp || undefined,
 reserved: reserved ? parseReserved(reserved) : undefined,
 }),
 onSuccess: () => {
 notifySuccess(t('allocations.toast.poolCreated'));
 setShowCreatePoolModal(false);
 setCidr('');
 setGateway('');
 setStartIp('');
 setEndIp('');
 setReserved('');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminIpPools(nodeId!) });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 const deletePoolMutation = useMutation({
 mutationFn: (poolId: string) => adminApi.deleteIpPool(poolId),
 onSuccess: () => {
 notifySuccess(t('allocations.toast.poolDeleted'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminIpPools(nodeId!) });
 },
 onError: (error: any) => {
 notifyError(error);
 },
 });

 // Filtered port allocations
 const filteredAllocations = useMemo(() => {
 if (!search.trim()) return allocations;
 const query = search.toLowerCase();
 return allocations.filter(
 (a) =>
 a.ip.includes(query) ||
 a.port.toString().includes(query) ||
 a.alias?.toLowerCase().includes(query) ||
 a.notes?.toLowerCase().includes(query),
 );
 }, [allocations, search]);

 // Bulk selection only covers available (unassigned) allocations.
 const selectableFilteredIds = useMemo(
 () => filteredAllocations.filter((a) => !a.serverId).map((a) => a.id),
 [filteredAllocations],
 );
 const allFilteredSelected =
 selectableFilteredIds.length > 0 &&
 selectableFilteredIds.every((id) => selectedIds.includes(id));
 const someFilteredSelected = selectableFilteredIds.some((id) => selectedIds.includes(id));

 // Drop ids that no longer exist or became assigned.
 useEffect(() => {
 setSelectedIds((prev) => {
 if (prev.length === 0) return prev;
 const valid = new Set(
 allocations.filter((a) => !a.serverId).map((a) => a.id),
 );
 const next = prev.filter((id) => valid.has(id));
 return next.length === prev.length ? prev : next;
 });
 }, [allocations]);

 const toggleAllocationSelected = (allocationId: string) => {
 setSelectedIds((prev) =>
 prev.includes(allocationId) ? prev.filter((id) => id !== allocationId) : [...prev, allocationId],
 );
 };

 const toggleSelectAllFiltered = () => {
 setSelectedIds((prev) => {
 if (selectableFilteredIds.every((id) => prev.includes(id))) {
 return prev.filter((id) => !selectableFilteredIds.includes(id));
 }
 return Array.from(new Set([...prev, ...selectableFilteredIds]));
 });
 };

 // Port allocation stats
 const portStats = useMemo(() => {
 const assigned = allocations.filter((a) => a.serverId).length;
 const available = allocations.length - assigned;
 const uniqueIps = new Set(allocations.map((a) => a.ip)).size;
 return { total: allocations.length, assigned, available, uniqueIps };
 }, [allocations]);

 // IP pool stats
 const ipPoolStats = useMemo(() => {
 const totals = nodePools.reduce(
 (acc: { available: number; used: number; total: number; reserved: number }, pool: IpPool) => {
 acc.available += pool.availableCount;
 acc.used += pool.usedCount;
 acc.reserved += pool.reservedCount;
 acc.total += pool.total;
 return acc;
 },
 { available: 0, used: 0, reserved: 0, total: 0 },
 );
 return { ...totals, pools: nodePools.length };
 }, [nodePools]);

 const handleQuickFillPorts = () => {
 if (node?.publicAddress) {
 setIpInput(node.publicAddress);
 setPortsInput('25565-25664');
 }
 };

 const handleAutoFillPool = () => {
 if (!autoFillIp) return;
 const parts = autoFillIp.trim().split('.');
 if (parts.length < 3) return;
 const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
 setCidr(`${base}.0/24`);
 setGateway(`${base}.1`);
 setStartIp(`${base}.10`);
 setEndIp(`${base}.250`);
 };

 const allPortStatItems = [
 { label: t('allocations.stats.totalPorts'), value: portStats.total },
 { label: t('allocations.stats.available'), value: portStats.available },
 { label: t('allocations.stats.assigned'), value: portStats.assigned },
 { label: t('allocations.stats.uniqueIps'), value: portStats.uniqueIps },
 ];

 const allIpStatItems = [
 { label: t('allocations.stats.totalIps'), value: ipPoolStats.total },
 { label: t('allocations.stats.available'), value: ipPoolStats.available },
 { label: t('allocations.stats.used'), value: ipPoolStats.used },
 { label: t('allocations.stats.reserved'), value: ipPoolStats.reserved },
 ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── Deck header ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('layout:sections.infrastructure')}</BracketLabel>
          <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            {t('allocations.title')}
          </h1>
          <p className="text-mini text-muted-foreground">
            {t('allocations.description', { node: node?.name || t('allocations.thisNode') })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/admin/nodes"
            className="flex h-7 items-center gap-1.5 rounded-sm border border-border/60 px-2.5 text-mini text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            {t('nodes.title')}
          </Link>
          <span className="hidden items-center gap-3 sm:flex">
            <span className="flex items-center gap-1.5">
              <Plug className="h-3 w-3 text-muted-foreground" />
              <Segmented muted>{t('allocations.portCount', { value: portStats.total })}</Segmented>
            </span>
            <span className="flex items-center gap-1.5">
              <Globe className="h-3 w-3 text-muted-foreground" />
              <Segmented muted>{t('allocations.poolCount', { value: ipPoolStats.pools })}</Segmented>
            </span>
          </span>
        </div>
      </header>

      {/* Info note */}
      <div className="flex max-w-2xl items-start gap-2.5 rounded-sm border border-border/50 px-3 py-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-micro font-medium text-foreground">{t('allocations.info.title')}</p>
          <ul className="ml-3 list-disc space-y-0.5 text-micro text-muted-foreground">
            <li>
              <Trans i18nKey="allocations.info.portAllocations" ns="admin-infra">
                <strong>Port Allocations</strong> — Track IP:Port combinations for proxy/NAT setups (like Pterodactyl)
              </Trans>
            </li>
            <li>
              <Trans i18nKey="allocations.info.ipPools" ns="admin-infra">
                <strong>IP Pools</strong> — Automatic MACVLAN networking with dedicated IPs per server (advanced)
              </Trans>
            </li>
          </ul>
        </div>
      </div>

      {/* ── The deck: tabs, controls, stats, columns and rows in one frame ── */}
      <div className="deck-panel flex min-h-0 flex-col overflow-hidden">
        {/* Control strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
          <div className="flex items-center gap-0.5">
            <RailTab
              active={activeTab === 'ports'}
              onClick={() => setActiveTab('ports')}
              icon={<Plug className="h-3 w-3" />}
              label={t('allocations.tabs.ports')}
              count={portStats.total}
            />
            <RailTab
              active={activeTab === 'ips'}
              onClick={() => setActiveTab('ips')}
              icon={<Globe className="h-3 w-3" />}
              label={t('allocations.tabs.ips')}
              count={ipPoolStats.pools}
            />
          </div>

          <span className="mx-1 h-5 w-px bg-border/60" aria-hidden />

          {activeTab === 'ports' ? (
            <>
              <label className="relative flex min-w-[12rem] flex-1 items-center">
                <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('allocations.searchPlaceholder')}
                  className="h-7 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
                />
              </label>
              <span className="font-mono text-micro tabular-nums text-muted-foreground">
                {t('allocations.resultCount', {
                  shown: filteredAllocations.length,
                  total: allocations.length,
                })}
              </span>
              <button
                type="button"
                onClick={() => setShowCreatePortModal(true)}
                className="flex h-7 items-center gap-1.5 rounded-sm bg-primary px-2.5 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <Plus className="h-3 w-3" />
                {t('allocations.createAllocations')}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setShowCreatePoolModal(true)}
              className="ml-auto flex h-7 items-center gap-1.5 rounded-sm bg-primary px-2.5 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-3 w-3" />
              {t('allocations.createPoolButton')}
            </button>
          )}
        </div>

        {/* Stats strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/50 bg-surface-1/20 px-3 py-1.5">
          {(activeTab === 'ports' ? allPortStatItems : allIpStatItems).map((stat) => (
            <span key={stat.label} className="flex items-center gap-1.5">
              <span className="type-overline">{stat.label}</span>
              <Segmented muted className="text-micro">
                {stat.value}
              </Segmented>
            </span>
          ))}
          {/* Mobile has no column header, so select-all lives here. */}
          {activeTab === 'ports' && (
            <label className="ml-auto -my-2 flex cursor-pointer items-center gap-1.5 py-2 text-micro text-muted-foreground md:hidden">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                ref={(el) => {
                  if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
                }}
                onChange={toggleSelectAllFiltered}
                disabled={selectableFilteredIds.length === 0}
                aria-label={t('allocations.selectAll')}
                className="h-3.5 w-3.5 rounded-sm border-border bg-card text-primary disabled:cursor-not-allowed disabled:opacity-40"
              />
              {t('allocations.selectAll')}
            </label>
          )}
        </div>

        {/* Bulk actions strip */}
        {activeTab === 'ports' && selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-primary/5 px-3 py-1.5">
            <div className="flex items-center gap-3">
              <span className="text-mini text-foreground">
                {t('allocations.selectedCount', { value: selectedIds.length })}
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="flex h-7 items-center rounded-sm px-2.5 text-mini text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                {t('allocations.clearSelection')}
              </button>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBulkDeleteDialog(true)}
              disabled={bulkDeletePortsMutation.isPending}
              className="h-7 gap-1.5 rounded-sm px-2.5 text-mini"
            >
              <Trash2 className="h-3 w-3" />
              {t('common:actions.delete')}
            </Button>
          </div>
        )}

        {activeTab === 'ports' ? (
          <>
            {/* Column header */}
            <div
              className={cn(
                PORTS_GRID,
                'sticky top-0 z-10 hidden border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground/70 md:grid',
              )}
            >
              <label className="-m-2 flex cursor-pointer items-center justify-center p-2">
                <input
                  type="checkbox"
                  checked={allFilteredSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
                  }}
                  onChange={toggleSelectAllFiltered}
                  disabled={selectableFilteredIds.length === 0}
                  aria-label={t('allocations.selectAll')}
                  className="h-3.5 w-3.5 rounded-sm border-border bg-card text-primary disabled:cursor-not-allowed disabled:opacity-40"
                />
              </label>
              <span className="type-overline">{t('allocations.field.ip')}</span>
              <span className="type-overline hidden justify-self-end md:inline-flex">{t('allocations.field.port')}</span>
              <span className="type-overline hidden justify-self-end md:inline-flex">{t('nodes.sort.status')}</span>
              <span className="type-overline justify-self-end">{t('common:actions.more')}</span>
            </div>

            {/* Rows */}
            <div className="max-h-[calc(100dvh-22rem)] min-w-0 overflow-y-auto bg-background/25">
              {allocationsLoading ? (
                <div>
                  {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} className={cn(PORTS_GRID, 'border-t border-border/40 py-2 pl-3 pr-3')}>
                      <span />
                      <div className="h-3.5 w-32 animate-pulse bg-surface-3" />
                    </div>
                  ))}
                </div>
              ) : filteredAllocations.length === 0 ? (
                <div className="p-3">
                  <EmptyState
                    title={search.trim() ? t('allocations.empty.noMatches') : t('allocations.empty.noPorts')}
                    description={search.trim() ? undefined : t('allocations.empty.noPortsDescription')}
                    action={
                      !search.trim() ? (
                        <button
                          type="button"
                          onClick={() => setShowCreatePortModal(true)}
                          className="h-7 rounded-sm border border-border/60 px-3 text-mini font-medium text-primary transition-colors hover:border-primary/40"
                        >
                          {t('allocations.empty.createFirst')}
                        </button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                filteredAllocations.map((allocation) => {
                  const isSelected = selectedIds.includes(allocation.id);
                  const isAssigned = Boolean(allocation.serverId);
                  return (
                    <div
                      key={allocation.id}
                      role="row"
                      className={cn(
                        PORTS_GRID,
                        'py-1.5 pl-3 pr-3 transition-colors hover:bg-surface-1/40',
                        isSelected && 'bg-primary/5',
                      )}
                    >
                      <label className="-m-2 flex cursor-pointer items-center justify-center p-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleAllocationSelected(allocation.id)}
                          disabled={isAssigned}
                          title={
                            isAssigned
                              ? t('allocations.assignedCannotSelect')
                              : t('allocations.selectAllocation', {
                                  ip: allocation.ip,
                                  port: allocation.port,
                                })
                          }
                          aria-label={t('allocations.selectAllocation', {
                            ip: allocation.ip,
                            port: allocation.port,
                          })}
                          className="h-3.5 w-3.5 rounded-sm border-border bg-card text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        />
                      </label>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="truncate font-mono text-data tabular-nums text-foreground"
                          title={allocation.ip}
                        >
                          {allocation.ip}
                        </span>
                        <span className="font-mono text-micro text-muted-foreground md:hidden">
                          :{allocation.port}
                        </span>
                        {allocation.alias && (
                          <span
                            className="hidden min-w-0 truncate text-micro text-muted-foreground md:inline"
                            title={allocation.alias}
                          >
                            {allocation.alias}
                          </span>
                        )}
                        <span
                          className={cn(
                            'shrink-0 text-micro uppercase md:hidden',
                            isAssigned ? 'text-muted-foreground' : 'text-success',
                          )}
                        >
                          {isAssigned ? t('allocations.assigned') : t('allocations.available')}
                        </span>
                      </span>
                      <Segmented className="hidden justify-self-end md:inline-flex">{allocation.port}</Segmented>
                      <span className="hidden justify-self-end overflow-hidden md:flex">
                        {isAssigned ? (
                          <span className="truncate text-micro uppercase text-muted-foreground">
                            {t('allocations.assigned')}
                          </span>
                        ) : (
                          <span className="truncate text-micro uppercase text-success">
                            {t('allocations.available')}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center justify-end gap-1">
                        {!allocation.serverId && (
                          <button
                            type="button"
                            onClick={() => deletePortMutation.mutate(allocation.id)}
                            disabled={deletePortMutation.isPending}
                            className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                            title={t('common:actions.delete')}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <>
            {/* Column header */}
            <div
              className={cn(
                POOLS_GRID,
                'sticky top-0 z-10 hidden border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground/70 md:grid',
              )}
            >
              <span className="type-overline">{t('allocations.createPool.networkName')}</span>
              <span className="type-overline hidden justify-self-end md:inline-flex">{t('allocations.stats.totalIps')}</span>
              <span className="type-overline hidden justify-self-end md:inline-flex">{t('allocations.stats.available')}</span>
              <span className="type-overline hidden justify-self-end md:inline-flex">{t('allocations.stats.used')}</span>
              <span className="type-overline hidden justify-self-end md:inline-flex">{t('allocations.stats.reserved')}</span>
              <span className="type-overline justify-self-end">{t('common:actions.more')}</span>
            </div>

            <div className="max-h-[calc(100dvh-22rem)] min-w-0 overflow-y-auto bg-background/25">
              {poolsLoading ? (
                <div>
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className={cn(POOLS_GRID, 'border-t border-border/40 py-2 pl-3 pr-3')}>
                      <div className="h-3.5 w-32 animate-pulse bg-surface-3" />
                    </div>
                  ))}
                </div>
              ) : nodePools.length === 0 ? (
                <div className="p-3">
                  <EmptyState
                    title={t('allocations.empty.noPools')}
                    description={t('allocations.empty.noPoolsDescription')}
                    action={
                      <button
                        type="button"
                        onClick={() => setShowCreatePoolModal(true)}
                        className="h-7 rounded-sm border border-border/60 px-3 text-mini font-medium text-primary transition-colors hover:border-primary/40"
                      >
                        {t('allocations.empty.createFirstPool')}
                      </button>
                    }
                  />
                </div>
              ) : (
                nodePools.map((pool: IpPool) => (
                  <div key={pool.id} className="border-t border-border/40">
                    <div
                      role="row"
                      className={cn(POOLS_GRID, 'py-1.5 pl-3 pr-3 transition-colors hover:bg-surface-1/40')}
                    >
                      <div className="flex min-w-0 flex-col leading-tight">
                        <span
                          className="truncate font-display text-data font-semibold tracking-tight text-foreground"
                          title={pool.networkName}
                        >
                          {pool.networkName}
                        </span>
                        <span className="flex min-w-0 items-center gap-2 text-micro text-muted-foreground">
                          <span className="shrink-0 font-mono">{pool.cidr}</span>
                          <span className="truncate">{pool.rangeStart} → {pool.rangeEnd}</span>
                          <span className="hidden truncate lg:inline">
                            {t('allocations.poolTotals', { total: pool.total, gateway: pool.gateway ?? 'n/a' })}
                          </span>
                        </span>
                      </div>
                      <Segmented className="hidden justify-self-end md:inline-flex">{pool.total}</Segmented>
                      <Segmented className="hidden justify-self-end md:inline-flex">{pool.availableCount}</Segmented>
                      <Segmented className="hidden justify-self-end md:inline-flex">{pool.usedCount}</Segmented>
                      <Segmented className="hidden justify-self-end md:inline-flex">{pool.reservedCount}</Segmented>
                      <span className="col-span-full flex shrink-0 items-center justify-start md:col-auto md:justify-end">
                        <button
                          type="button"
                          onClick={() => deletePoolMutation.mutate(pool.id)}
                          disabled={deletePoolMutation.isPending}
                          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                          title={t('common:actions.delete')}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    </div>
                    {pool.allocations && pool.allocations.length > 0 && (
                      <div className="border-t border-border/40 bg-surface-1/20 px-3 py-1.5">
                        <div className="type-overline mb-1">
                          {t('allocations.assignedIps', { value: pool.allocations.length })}
                        </div>
                        <div className="max-h-32 space-y-0.5 overflow-y-auto">
                          {pool.allocations.map((alloc: any) => (
                            <div key={alloc.id} className="flex items-center gap-2 text-micro">
                              <span className="font-mono tabular-nums text-muted-foreground">{alloc.ip}</span>
                              <span className="text-muted-foreground/30">→</span>
                              <span className="truncate text-foreground">{alloc.serverName}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Create Port Allocations Modal */}
      <Dialog open={showCreatePortModal} onOpenChange={setShowCreatePortModal}>
        <DialogContent size="lg">
          <DialogHeader icon={<Plug className="h-4 w-4" />}>
            <DialogTitle>{t('allocations.createPort.title')}</DialogTitle>
            <DialogDescription>{t('allocations.createPort.description')}</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <div className="rounded-sm border border-border/60 bg-surface-1/30 px-3 py-2">
              <p className="text-micro leading-relaxed text-muted-foreground">
                <Trans i18nKey="allocations.createPort.ipFormat" ns="admin-infra">
                  <strong>IP format:</strong> Single IP (192.168.1.100), multiple IPs (192.168.1.100, 192.168.1.101), or CIDR (192.168.1.0/24)
                </Trans>
              </p>
              <p className="mt-1 text-micro leading-relaxed text-muted-foreground">
                <Trans i18nKey="allocations.createPort.portFormat" ns="admin-infra">
                  <strong>Port format:</strong> Single port (25565), range (25565-25664), or multiple (25565, 25566, 25567)
                </Trans>
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="type-overline">{t('allocations.createPort.ipLabel')}</span>
              <Input
                type="text"
                value={ipInput}
                onChange={(e) => setIpInput(e.target.value)}
                placeholder={t('allocations.createPort.ipPlaceholder')}
                className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="type-overline">{t('allocations.createPort.portsLabel')}</span>
              <Input
                type="text"
                value={portsInput}
                onChange={(e) => setPortsInput(e.target.value)}
                placeholder={t('allocations.createPort.portsPlaceholder')}
                className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="type-overline">{t('allocations.createPort.aliasLabel')}</span>
              <Input
                type="text"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                placeholder={t('allocations.createPort.aliasPlaceholder')}
                className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
              />
            </label>

            <Button variant="outline" size="sm" className="h-7 px-2.5 text-mini" onClick={handleQuickFillPorts}>
              {t('allocations.createPort.quickFill')}
            </Button>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setShowCreatePortModal(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-mini"
              onClick={() => createPortMutation.mutate()}
              disabled={!ipInput.trim() || !portsInput.trim() || createPortMutation.isPending}
            >
              {createPortMutation.isPending ? t('allocations.createPort.creating') : t('allocations.createPort.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create IP Pool Modal */}
      <Dialog open={showCreatePoolModal} onOpenChange={setShowCreatePoolModal}>
        <DialogContent size="xl">
          <DialogHeader icon={<Globe className="h-4 w-4" />}>
            <DialogTitle>{t('allocations.createPool.title')}</DialogTitle>
            <DialogDescription>{t('allocations.createPool.description')}</DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <div className="rounded-sm border border-border/60 bg-surface-1/30 px-3 py-2">
              <p className="text-micro leading-relaxed text-muted-foreground">
                {t('allocations.createPool.intro')}
              </p>
            </div>

            <label className="block space-y-1.5">
              <span className="type-overline">{t('allocations.createPool.networkName')}</span>
              <Input
                type="text"
                value={networkName}
                onChange={(e) => setNetworkName(e.target.value)}
                placeholder="mc-lan"
                className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="type-overline">{t('allocations.createPool.cidr')}</span>
              <Input
                type="text"
                value={cidr}
                onChange={(e) => setCidr(e.target.value)}
                placeholder={t('allocations.createPool.cidrPlaceholder')}
                className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="type-overline">{t('allocations.createPool.gateway')}</span>
                <Input
                  type="text"
                  value={gateway}
                  onChange={(e) => setGateway(e.target.value)}
                  placeholder="192.168.50.1"
                  className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="type-overline">{t('allocations.createPool.startIp')}</span>
                <Input
                  type="text"
                  value={startIp}
                  onChange={(e) => setStartIp(e.target.value)}
                  placeholder="192.168.50.10"
                  className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="type-overline">{t('allocations.createPool.endIp')}</span>
                <Input
                  type="text"
                  value={endIp}
                  onChange={(e) => setEndIp(e.target.value)}
                  placeholder="192.168.50.200"
                  className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
                />
              </label>
            </div>

            {/* Autofill reads the quick-setup IP, so it sits beside that field. */}
            <div className="flex flex-wrap items-end gap-2">
              <label className="block min-w-[12rem] flex-1 space-y-1.5">
                <span className="type-overline">{t('allocations.createPool.quickSetupIp')}</span>
                <Input
                  type="text"
                  value={autoFillIp}
                  onChange={(e) => setAutoFillIp(e.target.value)}
                  placeholder={node?.publicAddress || '0.0.0.0'}
                  className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
                />
              </label>
              <Button
                variant="outline"
                onClick={handleAutoFillPool}
                disabled={!autoFillIp.trim()}
                className="h-8 rounded-sm px-3 text-mini"
              >
                {t('allocations.createPool.autofill')}
              </Button>
            </div>

            <label className="block space-y-1.5">
              <span className="type-overline">{t('allocations.createPool.reservedIps')}</span>
              <Textarea
                value={reserved}
                onChange={(e) => setReserved(e.target.value)}
                rows={2}
                placeholder="192.168.50.20, 192.168.50.21"
                className="min-h-[4rem] resize-none rounded-sm border-border/60 bg-background/40 px-2.5 py-2 text-mini"
              />
            </label>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setShowCreatePoolModal(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-mini"
              onClick={() => createPoolMutation.mutate()}
              disabled={!networkName || !cidr || createPoolMutation.isPending}
            >
              {createPoolMutation.isPending ? t('allocations.createPool.creating') : t('allocations.createPool.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={showBulkDeleteDialog}
        title={t('allocations.bulkDelete.title')}
        message={
          <div className="space-y-2">
            <p>
              <Trans
                i18nKey="allocations.bulkDelete.message"
                ns="admin-infra"
                count={selectedIds.length}
                values={{ count: selectedIds.length }}
              >
                You are about to delete <span className="font-semibold">{'{{count}} allocations'}</span>.
              </Trans>
            </p>
            <p className="text-mini text-muted-foreground">{t('allocations.bulkDelete.warning')}</p>
          </div>
        }
        confirmText={t('common:actions.delete')}
        cancelText={t('common:actions.cancel')}
        onConfirm={() => selectedIds.length > 0 && bulkDeletePortsMutation.mutate(selectedIds)}
        onCancel={() => setShowBulkDeleteDialog(false)}
        variant="danger"
        loading={bulkDeletePortsMutation.isPending}
      />
    </div>
  );
}

/** Rail tab — underline marker for the active allocation view. */
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
        'relative flex h-7 items-center gap-1.5 px-2.5 text-mini transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active && <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />}
      {icon}
      <span className="whitespace-nowrap">{label}</span>
      <span className="font-mono text-micro tabular-nums text-muted-foreground/80">{count}</span>
    </button>
  );
}

export default NodeAllocationsPage;
