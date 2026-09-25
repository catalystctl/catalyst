import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import { nodesApi } from '../../services/api/nodes';
import { adminApi } from '../../services/api/admin';
import { useAccessibleNodes } from '../../hooks/useNodes';
import { useAuthStore } from '../../stores/authStore';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getLocalizedErrorMessage } from '../../i18n/api-errors';
import { Button } from '@/components/ui/button';
import Combobox from '@/components/ui/combobox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { Server } from '../../types/server';
import type { CloneServerPayload } from '../../types/server';

/** Deck field chrome — 4px radius, 32px control height, mini type ramp. */
const fieldClass =
  'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';
/** Labelled block on the dialog surface — never a nested rounded card. */
const blockClass = 'rounded-sm border border-border/50 bg-surface-1/40 p-3';
/** 1px separator for stacked fields inside a block. */
const dividerClass = 'border-t border-border/50 pt-3';

type Props = {
  server: Server;
  disabled?: boolean;
};

function CloneServerDialog({ server, disabled = false }: Props) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);

  const isAdmin =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write');

  // Fetch available nodes for the dropdown
  const { data: accessibleNodesData } = useAccessibleNodes();

  const { data: allNodes } = useQuery({
    queryKey: qk.nodes(),
    queryFn: () => nodesApi.list(),
    enabled: open && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const availableNodes: Array<{ id: string; name: string }> =
    isAdmin
      ? (allNodes || [])
      : (accessibleNodesData?.nodes || []);

  // Fetch users for owner dropdown (admin only)
  const { data: usersData } = useQuery({
    queryKey: qk.adminUsers({ limit: 200 }),
    queryFn: () => adminApi.listUsers({ limit: 200 }),
    enabled: open && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const users = usersData?.users ?? [];
  const userOptions = users.map((u: any) => ({
    value: u.id,
    label: (
      <div className="flex items-center gap-2">
        <span className="font-medium">{u.username || u.email}</span>
        {u.username && <span className="text-muted-foreground">({u.email})</span>}
        <span className="ml-auto type-numeric text-micro text-muted-foreground">{u.id.slice(0, 8)}…</span>
      </div>
    ),
    keywords: [u.username || '', u.email || '', u.id],
  }));

  // Form state — pre-populated from source server
  const [name, setName] = useState(`${server.name} Copy`);
  const [nodeId, setNodeId] = useState(server.nodeId);
  const [networkMode, setNetworkMode] = useState(server.networkMode || 'host');
  const [allocationId, setAllocationId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [copyFiles, setCopyFiles] = useState(false);
  const [memoryMb, setMemoryMb] = useState(server.allocatedMemoryMb ?? 1024);
  const [cpuCores, setCpuCores] = useState(server.allocatedCpuCores ?? 1);
  const [diskMb, setDiskMb] = useState(server.allocatedDiskMb ?? 1024);

  // Load available allocations for the selected node in host mode
  const [availableAllocations, setAvailableAllocations] = useState<
    Array<{ id: string; ip: string; port: number; alias?: string | null }>
  >([]);
  const [allocLoadError, setAllocLoadError] = useState<string | null>(null);

  const [prevAllocDeps, setPrevAllocDeps] = useState({ nodeId, networkMode, open });
  if (
    prevAllocDeps.nodeId !== nodeId ||
    prevAllocDeps.networkMode !== networkMode ||
    prevAllocDeps.open !== open
  ) {
    setPrevAllocDeps({ nodeId, networkMode, open });
    setAllocationId('');
    if (!nodeId || networkMode !== 'host') {
      setAvailableAllocations([]);
      setAllocLoadError(null);
    } else {
      setAllocLoadError(null);
    }
  }

  useEffect(() => {
    if (!nodeId || networkMode !== 'host') {
      return;
    }
    let active = true;
    nodesApi
      .allocations(nodeId)
      .then((allocations) => {
        if (!active) return;
        setAvailableAllocations(
          allocations
            .filter((allocation: any) => !allocation.serverId)
            .map((allocation: any) => ({
              id: allocation.id,
              ip: allocation.ip,
              port: allocation.port,
              alias: allocation.alias,
            })),
        );
      })
      .catch((error: any) => {
        if (!active) return;
        setAvailableAllocations([]);
        setAllocLoadError(getLocalizedErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [nodeId, networkMode, open]);

  // Reset form only when dialog transitions from closed → open
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setName(`${server.name} Copy`);
      setNodeId(server.nodeId);
      setNetworkMode(server.networkMode || 'host');
      setAllocationId('');
      setOwnerId('');
      setCopyFiles(false);
      setMemoryMb(server.allocatedMemoryMb ?? 1024);
      setCpuCores(server.allocatedCpuCores ?? 1);
      setDiskMb(server.allocatedDiskMb ?? 1024);
    }
    prevOpenRef.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only open; server read at transition time

  const canClone =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('server.create') ||
    isAdmin;

  const cloneMutation = useMutation({
    mutationFn: () => {
      const payload: CloneServerPayload = {
        name: name.trim() || undefined,
        nodeId: nodeId !== server.nodeId ? nodeId : undefined,
        networkMode: networkMode !== server.networkMode ? networkMode : undefined,
        allocationId: allocationId || undefined,
        ownerId: ownerId || undefined,
        copyFiles: copyFiles || undefined,
        allocatedMemoryMb: memoryMb !== server.allocatedMemoryMb ? memoryMb : undefined,
        allocatedCpuCores: cpuCores !== server.allocatedCpuCores ? cpuCores : undefined,
        allocatedDiskMb: diskMb !== server.allocatedDiskMb ? diskMb : undefined,
      };
      return serversApi.clone(server.id, payload);
    },
    onSuccess: (newServer) => {
      notifySuccess(copyFiles ? t('cloneServer.startedCopyingFiles') : t('cloneServer.cloned'));
      setOpen(false);
      // Navigate to the new server's page
      if (newServer?.id) {
        navigate(`/servers/${newServer.id}`);
      }
    },
    onSettled: (newServer) => {
      queryClient.invalidateQueries({ queryKey: qk.servers() });
      queryClient.invalidateQueries({ queryKey: qk.server(server.id) });
      if (newServer?.id) {
        queryClient.invalidateQueries({ queryKey: qk.server(newServer.id) });
      }
    },
    onError: (error: any) => {
      notifyError(error);
    },
  });

  const isHostNetwork = networkMode === 'host';
  const needsAllocation = isHostNetwork;
  const allocationValid = !needsAllocation || allocationId;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 text-mini"
          disabled={disabled || !canClone}
          onClick={() => setOpen(true)}
        >
          {t('cloneServer.clone')}
        </Button>
      </DialogTrigger>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('cloneServer.title')}</DialogTitle>
          <DialogDescription>
            {t('cloneServer.description', { name: server.name })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
        <div className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 p-3 text-mini text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            {copyFiles
              ? t('cloneServer.warningCopyFiles')
              : t('cloneServer.warningFreshInstall')}
          </span>
        </div>

        <div className={`${blockClass} space-y-3`}>
          {/* Name */}
          <div className="space-y-1.5">
            <label htmlFor="clone-name" className="type-overline">
              {t('fields.name')}
            </label>
            <input
              id="clone-name"
              className={fieldClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('cloneServer.namePlaceholder')}
            />
          </div>

          {/* Node */}
          <div className={cn('space-y-1.5', dividerClass)}>
            <label htmlFor="clone-node" className="type-overline">
              {t('fields.node')}
            </label>
            <select
              id="clone-node"
              className={fieldClass}
              value={nodeId}
              onChange={(e) => setNodeId(e.target.value)}
            >
              {availableNodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.name}
                </option>
              ))}
            </select>
          </div>

          {/* Network Mode */}
          <div className={cn('space-y-1.5', dividerClass)}>
            <label htmlFor="clone-network" className="type-overline">
              {t('fields.networkMode')}
            </label>
            <select
              id="clone-network"
              className={fieldClass}
              value={networkMode}
              onChange={(e) => setNetworkMode(e.target.value)}
            >
              <option value="host">{t('networkModes.host')}</option>
              <option value="bridge">{t('networkModes.bridge')}</option>
              <option value="macvlan">{t('networkModes.macvlan')}</option>
              <option value="mc-lan-static">{t('networkModes.mcLanStatic')}</option>
              <option value="mc-lan-dynamic">{t('networkModes.mcLanDynamic')}</option>
            </select>
          </div>

          {/* Allocation (host mode) */}
          {isHostNetwork && (
            <div className={cn('space-y-1.5', dividerClass)}>
              <label className="type-overline">
                {t('cloneServer.networkAllocation')} <span className="text-danger">*</span>
              </label>
              <select
                className={cn(fieldClass, 'font-mono tabular-nums')}
                value={allocationId}
                onChange={(e) => setAllocationId(e.target.value)}
              >
                <option value="">{t('fields.selectAllocation')}</option>
                {availableAllocations.map((allocation) => (
                  <option key={allocation.id} value={allocation.id}>
                    {allocation.ip}:{allocation.port}
                    {allocation.alias ? ` (${allocation.alias})` : ''}
                  </option>
                ))}
              </select>
              {allocLoadError ? (
                <p className="text-micro text-warning">{allocLoadError}</p>
              ) : null}
              {!allocLoadError && availableAllocations.length === 0 && nodeId ? (
                <p className="type-meta">
                  {t('fields.noAllocations')}{' '}
                  <a
                    href={`/admin/nodes/${encodeURIComponent(nodeId)}/allocations`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-primary hover:underline"
                  >
                    {t('fields.createOne')}
                  </a>
                </p>
              ) : null}
            </div>
          )}

          {/* Server Owner (admin only) */}
          {isAdmin && (
            <div className={cn('space-y-1.5', dividerClass)}>
              <label className="type-overline">
                {t('cloneServer.serverOwner')} <span className="text-danger">*</span>
              </label>
              <Combobox
                value={ownerId}
                onChange={(val: string) => setOwnerId(val)}
                options={userOptions}
                placeholder={t('cloneServer.ownerPlaceholder')}
                searchPlaceholder={t('cloneServer.ownerSearchPlaceholder')}
                className={fieldClass}
              />
              <p className="type-meta">
                {t('cloneServer.ownerHint')}
              </p>
            </div>
          )}

          {/* Copy Files Toggle */}
          <div className={cn('flex items-center justify-between gap-3', dividerClass)}>
            <div className="min-w-0">
              <p className="type-overline">{t('cloneServer.copyFiles')}</p>
              <p className="type-meta">
                {t('cloneServer.copyFilesHint')}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={copyFiles}
              onClick={() => setCopyFiles(!copyFiles)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2 ${
                copyFiles ? 'bg-primary' : 'bg-surface-3'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-card shadow ring-0 transition duration-200 ease-in-out ${
                  copyFiles ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {copyFiles && (
            <p className="text-micro text-warning">
              {t('cloneServer.copyFilesStatusWarning')}
            </p>
          )}

          {/* Resources */}
          <div className={cn('grid grid-cols-3 gap-3', dividerClass)}>
            <div className="space-y-1.5">
              <label htmlFor="clone-memory" className="type-overline">
                {t('fields.memoryMb')}
              </label>
              <input
                id="clone-memory"
                type="number"
                min={512}
                className={cn(fieldClass, 'font-mono tabular-nums')}
                value={memoryMb}
                onChange={(e) => setMemoryMb(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="clone-cpu" className="type-overline">
                {t('fields.cpuCores')}
              </label>
              <input
                id="clone-cpu"
                type="number"
                min={1}
                className={cn(fieldClass, 'font-mono tabular-nums')}
                value={cpuCores}
                onChange={(e) => setCpuCores(Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="clone-disk" className="type-overline">
                {t('fields.diskMb')}
              </label>
              <input
                id="clone-disk"
                type="number"
                min={1024}
                className={cn(fieldClass, 'font-mono tabular-nums')}
                value={diskMb}
                onChange={(e) => setDiskMb(Number(e.target.value))}
              />
            </div>
          </div>
        </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3 text-mini"
            onClick={() => setOpen(false)}
            disabled={cloneMutation.isPending}
          >
            {t('common:actions.cancel')}
          </Button>
          <Button
            size="sm"
            className="h-8 px-3 text-mini"
            onClick={() => cloneMutation.mutate()}
            disabled={cloneMutation.isPending || !name.trim() || !allocationValid}
          >
            {cloneMutation.isPending ? t('cloneServer.cloning') : t('cloneServer.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CloneServerDialog;
