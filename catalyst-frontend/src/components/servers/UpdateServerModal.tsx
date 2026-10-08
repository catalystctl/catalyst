import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import type { UpdateServerPayload } from '../../types/server';
import { useServer } from '../../hooks/useServer';
import { useSseResizeComplete } from '../../hooks/useSseResizeComplete';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getLocalizedErrorMessage } from '../../i18n/api-errors';
import { nodesApi } from '../../services/api/nodes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { FormSection } from '@/components/ui/form-section';
import { BracketLabel } from '@/components/deck/primitives';
import { cn } from '@/lib/utils';

/** Deck field chrome — 4px radius, 32px control height, mini type ramp. */
const fieldClass =
  'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';

/** Network mode → aside summary label. */
const NETWORK_MODE_LABELS: Record<string, string> = {
  bridge: 'networkModes.bridge',
  host: 'networkModes.host',
  macvlan: 'networkModes.macvlan',
  'mc-lan-static': 'networkModes.mcLanStatic',
  'mc-lan-dynamic': 'networkModes.mcLanDynamic',
};

type Props = {
  serverId: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * The server editor.
 *
 * One screen, three decisions: what the server is called, the resource and
 * allocation limits it runs under, and — depending on the node's network
 * mode — which IP or allocation it is reachable on. The aside mirrors the
 * form live so the resize consequences stay visible while typing.
 */
function UpdateServerModal({ serverId, disabled = false, open: controlledOpen, onOpenChange }: Props) {
  const { t } = useTranslation('servers');
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
    if (!value) setAwaitingResize(false);
  };
  const [memory, setMemory] = useState('1024');
  const [cpu, setCpu] = useState('1');
  const [disk, setDisk] = useState('10240');
  const [databaseAllocation, setDatabaseAllocation] = useState('0');
  const [backupAllocationMb, setBackupAllocationMb] = useState('0');
  const [backupRetentionCount, setBackupRetentionCount] = useState('0');
  const [name, setName] = useState('');
  const [primaryIp, setPrimaryIp] = useState('');
  const [allocationId, setAllocationId] = useState('');
  const [availableAllocations, setAvailableAllocations] = useState<
    Array<{ id: string; ip: string; port: number; alias?: string | null }>
  >([]);
  const [allocLoadError, setAllocLoadError] = useState<string | null>(null);
  const [availableIps, setAvailableIps] = useState<string[]>([]);
  const [ipLoadError, setIpLoadError] = useState<string | null>(null);
  const { data: server } = useServer(serverId);
  const [awaitingResize, setAwaitingResize] = useState(false);
  useSseResizeComplete(serverId, () => {
    setAwaitingResize(false);
    setOpen(false);
  });

  // Backend queues the resize command if the agent is mid-reconnect (30s TTL);
  // if the completion event never arrives, stop waiting instead of hanging.
  useEffect(() => {
    if (!awaitingResize) return;
    const timeout = setTimeout(() => {
      setAwaitingResize(false);
      notifyError(t('updateServer.resizeTimeout'));
    }, 45_000);
    return () => clearTimeout(timeout);
  }, [awaitingResize, t]);

  const isRunning = server?.status !== 'stopped';
  const isIpamNetwork = server?.networkMode && !['bridge', 'host'].includes(server.networkMode);
  const isBridgeNetwork = server?.networkMode === 'bridge';
  const memoryValue = Number(memory);
  const cpuValue = Number(cpu);
  const diskValue = Number(disk);
  const existingMemoryMb = server?.allocatedMemoryMb ?? memoryValue;
  const existingCpuCores = server?.allocatedCpuCores ?? cpuValue;
  const existingDiskMb = server?.allocatedDiskMb ?? (diskValue || 10240);
  const isShrink = Number.isFinite(diskValue) && diskValue > 0 && diskValue < existingDiskMb;

  const mutation = useMutation({
    mutationFn: async () => {
      const updates: UpdateServerPayload = {};
      if (name && name !== server?.name) updates.name = name;
      if (Number.isFinite(memoryValue) && memoryValue > 0 && memoryValue !== existingMemoryMb) {
        updates.allocatedMemoryMb = memoryValue;
      }
      if (Number.isFinite(cpuValue) && cpuValue > 0 && cpuValue !== existingCpuCores) {
        updates.allocatedCpuCores = cpuValue;
      }
      const databaseAllocationValue =
        databaseAllocation.trim() === '' ? undefined : Number(databaseAllocation);
      if (
        databaseAllocationValue !== undefined &&
        Number.isFinite(databaseAllocationValue) &&
        databaseAllocationValue >= 0 &&
        databaseAllocationValue !== (server?.databaseAllocation ?? 0)
      ) {
        updates.databaseAllocation = databaseAllocationValue;
      }
      const backupAllocationValue =
        backupAllocationMb.trim() === '' ? undefined : Number(backupAllocationMb);
      if (
        backupAllocationValue !== undefined &&
        Number.isFinite(backupAllocationValue) &&
        backupAllocationValue >= 0 &&
        backupAllocationValue !== (server?.backupAllocationMb ?? 0)
      ) {
        updates.backupAllocationMb = backupAllocationValue;
      }
      if (isIpamNetwork && primaryIp !== (server?.primaryIp ?? '')) {
        updates.primaryIp = primaryIp.trim() || null;
      }
      if (isBridgeNetwork && allocationId) {
        updates.allocationId = allocationId;
      }

      if (Object.keys(updates).length) {
        await serversApi.update(serverId, updates);
      }

      if (Number.isFinite(diskValue) && diskValue > 0 && diskValue !== existingDiskMb) {
        return serversApi.resizeStorage(serverId, diskValue);
      }
      return undefined;
    },
    onSuccess: () => {
      if (diskValue !== existingDiskMb) {
        notifySuccess(t('updateServer.resizeInitiated'));
        // Wait for SSE event to close modal (with a timeout guard above)
        setAwaitingResize(true);
      } else {
        notifySuccess(t('updateServer.updated'));
        setOpen(false);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.servers() });
    },
    onError: (error) => notifyError(error),
  });

  // Retention rides the dedicated backup-settings endpoint; the plain server
  // update payload doesn't carry it.
  const backupSettingsMutation = useMutation({
    mutationFn: async (retentionCount: number) =>
      serversApi.updateBackupSettings(serverId, { retentionCount }),
    onSuccess: () => notifySuccess(t('updateServer.backupRetentionUpdated')),
    onError: (error) => notifyError(error),
  });

  useEffect(() => {
    if (!open || !server) return;
    setName(server.name ?? '');
    setMemory(String(server.allocatedMemoryMb ?? 1024));
    setCpu(String(server.allocatedCpuCores ?? 1));
    setDisk(String(server.allocatedDiskMb ?? 10240));
    setDatabaseAllocation(String(server.databaseAllocation ?? 0));
    setBackupAllocationMb(String(server.backupAllocationMb ?? 0));
    setBackupRetentionCount(String(server.backupRetentionCount ?? 0));
    setPrimaryIp(server.primaryIp ?? '');
  }, [open, server]);

  const [prevIpDeps, setPrevIpDeps] = useState({
    nodeId: server?.nodeId,
    networkMode: server?.networkMode,
    isIpamNetwork,
  });
  if (
    prevIpDeps.nodeId !== server?.nodeId ||
    prevIpDeps.networkMode !== server?.networkMode ||
    prevIpDeps.isIpamNetwork !== isIpamNetwork
  ) {
    setPrevIpDeps({
      nodeId: server?.nodeId,
      networkMode: server?.networkMode,
      isIpamNetwork,
    });
    if (!server?.nodeId || !isIpamNetwork) {
      setAvailableIps([]);
      setIpLoadError(null);
    } else {
      setIpLoadError(null);
    }
  }

  useEffect(() => {
    if (!server?.nodeId || !isIpamNetwork) {
      return;
    }

    let active = true;
    const networkName = server.networkMode?.trim() || 'mc-lan-static';
    nodesApi
      .availableIps(server.nodeId, networkName, 200)
      .then((ips) => {
        if (!active) return;
        setAvailableIps(ips);
      })
      .catch((error: any) => {
        if (!active) return;
        setAvailableIps([]);
        setIpLoadError(getLocalizedErrorMessage(error));
      });

    return () => {
      active = false;
    };
  }, [server?.nodeId, server?.networkMode, isIpamNetwork]);

  const [prevAllocDeps, setPrevAllocDeps] = useState({
    nodeId: server?.nodeId,
    networkMode: server?.networkMode,
    serverId: server?.id,
    isBridgeNetwork,
  });
  if (
    prevAllocDeps.nodeId !== server?.nodeId ||
    prevAllocDeps.networkMode !== server?.networkMode ||
    prevAllocDeps.serverId !== server?.id ||
    prevAllocDeps.isBridgeNetwork !== isBridgeNetwork
  ) {
    setPrevAllocDeps({
      nodeId: server?.nodeId,
      networkMode: server?.networkMode,
      serverId: server?.id,
      isBridgeNetwork,
    });
    if (!server?.nodeId || !isBridgeNetwork) {
      setAvailableAllocations([]);
      setAllocLoadError(null);
    } else {
      setAllocLoadError(null);
    }
  }

  useEffect(() => {
    if (!server?.nodeId || !isBridgeNetwork) {
      return;
    }
    let active = true;
    nodesApi
      .allocations(server.nodeId, { serverId: server.id })
      .then((allocations) => {
        if (!active) return;
        setAvailableAllocations(
          allocations.map((allocation) => ({
            id: allocation.id,
            ip: allocation.ip,
            port: allocation.port,
            alias: allocation.alias,
          })),
        );
        const current = allocations.find((allocation) => allocation.serverId === server.id);
        setAllocationId(current?.id ?? '');
      })
      .catch((error: any) => {
        if (!active) return;
        setAvailableAllocations([]);
        setAllocLoadError(getLocalizedErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [server?.nodeId, server?.networkMode, server?.id, isBridgeNetwork]);

  // SSE resize handler closes the modal directly via the callback above

  // Empty input means "leave unchanged" (matches the Backups tab semantics);
  // Number('') is 0, so guard against that before parsing.
  const retentionRaw = backupRetentionCount.trim();
  const retentionValue = Number(retentionRaw);
  const retentionChanged =
    retentionRaw !== '' &&
    Number.isFinite(retentionValue) &&
    retentionValue >= 0 &&
    retentionValue !== (server?.backupRetentionCount ?? 0);
  const retentionInvalid =
    retentionRaw !== '' && (!Number.isFinite(retentionValue) || retentionValue < 0);
  const backupAllocationRaw = backupAllocationMb.trim();
  const backupAllocationParsed = Number(backupAllocationRaw);
  const backupAllocationInvalid =
    backupAllocationRaw !== '' &&
    (!Number.isFinite(backupAllocationParsed) || backupAllocationParsed < 0);

  // ── Live summary (aside) ─────────────────────────────────────────────
  const networkModeLabel = server?.networkMode
    ? NETWORK_MODE_LABELS[server.networkMode]
      ? t(NETWORK_MODE_LABELS[server.networkMode])
      : server.networkMode
    : '—';
  const selectedAllocation = isBridgeNetwork
    ? availableAllocations.find((allocation) => allocation.id === allocationId)
    : undefined;
  const allocationSummary = selectedAllocation
    ? `${selectedAllocation.ip}:${selectedAllocation.port}${
        selectedAllocation.alias ? ` (${selectedAllocation.alias})` : ''
      }`
    : '';

  const handleSave = () => {
    if (retentionChanged) {
      backupSettingsMutation.mutate(retentionValue);
    }
    mutation.mutate();
  };

  return (
    <>
      {controlledOpen === undefined && (
        <button
          className="h-8 rounded-sm border border-border/60 px-3 text-mini font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
          onClick={() => {
            if (!disabled) setOpen(true);
          }}
          disabled={disabled}
        >
          {t('updateServer.trigger')}
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="full" className="sm:h-[min(90dvh,54rem)]">
          <DialogHeader>
            <DialogTitle>{t('updateServer.title')}</DialogTitle>
            <DialogDescription>{t('updateServer.description')}</DialogDescription>
          </DialogHeader>
          <DialogBody className="min-h-0 p-0">
            <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
              {/* ── Editor ── */}
              <div className="min-w-0 space-y-3 overflow-y-auto p-4 lg:pr-5">
                {/* 1 — Identity */}
                <FormSection index={1} title={t('createServer.fields.name')}>
                  <label className="block space-y-1.5">
                    <span className="text-micro font-medium text-muted-foreground">
                      {t('fields.name')}
                    </span>
                    <Input
                      className={fieldClass}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="minecraft-01"
                    />
                  </label>
                </FormSection>

                {/* 2 — Resource & allocation limits */}
                <FormSection index={2} title={t('createServer.resources.title')}>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="block space-y-1.5">
                      <span className="text-micro font-medium text-muted-foreground">
                        {t('fields.memoryMb')}
                      </span>
                      <Input
                        className={cn(fieldClass, 'font-mono tabular-nums')}
                        value={memory}
                        onChange={(e) => setMemory(e.target.value)}
                        type="number"
                        min={256}
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-micro font-medium text-muted-foreground">
                        {t('updateServer.cpuCores')}
                      </span>
                      <Input
                        className={cn(fieldClass, 'font-mono tabular-nums')}
                        value={cpu}
                        onChange={(e) => setCpu(e.target.value)}
                        type="number"
                        min={1}
                        step={1}
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-micro font-medium text-muted-foreground">
                        {t('fields.diskMb')}
                      </span>
                      <Input
                        className={cn(fieldClass, 'font-mono tabular-nums')}
                        value={disk}
                        onChange={(e) => setDisk(e.target.value)}
                        type="number"
                        min={1024}
                        step={1024}
                      />
                      {isRunning && isShrink ? (
                        <span className="text-micro text-warning">
                          {t('updateServer.shrinkWarning')}
                        </span>
                      ) : null}
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border/60 pt-3 sm:grid-cols-3">
                    <label className="block space-y-1.5">
                      <span className="text-micro font-medium text-muted-foreground">
                        {t('updateServer.databaseAllocation')}
                      </span>
                      <Input
                        className={cn(fieldClass, 'font-mono tabular-nums')}
                        value={databaseAllocation}
                        onChange={(e) => setDatabaseAllocation(e.target.value)}
                        type="number"
                        min={0}
                        step={1}
                      />
                      <span className="type-meta">
                        {t('updateServer.databaseAllocationHint')}
                      </span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-micro font-medium text-muted-foreground">
                        {t('updateServer.backupAllocation')}
                      </span>
                      <Input
                        className={cn(fieldClass, 'font-mono tabular-nums')}
                        value={backupAllocationMb}
                        onChange={(e) => setBackupAllocationMb(e.target.value)}
                        type="number"
                        min={0}
                        step={128}
                      />
                      <span className="type-meta">
                        {t('updateServer.backupAllocationHint')}
                      </span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-micro font-medium text-muted-foreground">
                        {t('updateServer.backupRetention')}
                      </span>
                      <Input
                        className={cn(fieldClass, 'font-mono tabular-nums')}
                        value={backupRetentionCount}
                        onChange={(e) => setBackupRetentionCount(e.target.value)}
                        type="number"
                        min={0}
                        max={1000}
                        step={1}
                      />
                      <span className="type-meta">
                        {t('updateServer.backupRetentionHint')}
                      </span>
                    </label>
                  </div>
                </FormSection>

                {/* 3 — Network: which IP / allocation answers for this server */}
                {(isIpamNetwork || isBridgeNetwork) && (
                  <FormSection index={3} title={t('cloneServer.networkAllocation')}>
                    {isIpamNetwork ? (
                      <div className="space-y-3">
                        <p className="type-meta">{t('updateServer.primaryIpHint')}</p>
                        <label className="block space-y-1.5">
                          <span className="text-micro font-medium text-muted-foreground">
                            {t('updateServer.primaryIp')}
                          </span>
                          <select
                            className={cn(fieldClass, 'font-mono tabular-nums disabled:opacity-50')}
                            value={primaryIp}
                            onChange={(event) => setPrimaryIp(event.target.value)}
                            disabled={isRunning}
                          >
                            <option value="">{t('fields.autoAssign')}</option>
                            {server?.primaryIp ? (
                              <option value={server.primaryIp}>
                                {t('updateServer.currentIp', { ip: server.primaryIp })}
                              </option>
                            ) : null}
                            {availableIps
                              .filter((ip) => ip !== server?.primaryIp)
                              .map((ip) => (
                                <option key={ip} value={ip}>
                                  {ip}
                                </option>
                              ))}
                          </select>
                        </label>
                        {ipLoadError ? <p className="text-micro text-warning">{ipLoadError}</p> : null}
                        {!ipLoadError && availableIps.length === 0 ? (
                          <p className="type-meta">{t('fields.noIps')}</p>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="type-meta">{t('updateServer.primaryAllocationHint')}</p>
                        <label className="block space-y-1.5">
                          <span className="text-micro font-medium text-muted-foreground">
                            {t('updateServer.primaryAllocation')}
                          </span>
                          <select
                            className={cn(fieldClass, 'font-mono tabular-nums disabled:opacity-50')}
                            value={allocationId}
                            onChange={(event) => setAllocationId(event.target.value)}
                            disabled={isRunning}
                          >
                            <option value="">{t('fields.selectAllocation')}</option>
                            {availableAllocations.map((allocation) => (
                              <option key={allocation.id} value={allocation.id}>
                                {allocation.ip}:{allocation.port}
                                {allocation.alias ? ` (${allocation.alias})` : ''}
                              </option>
                            ))}
                          </select>
                        </label>
                        {allocLoadError ? (
                          <p className="text-micro text-warning">{allocLoadError}</p>
                        ) : null}
                        {!allocLoadError && availableAllocations.length === 0 ? (
                          <p className="type-meta">{t('updateServer.noAllocations')}</p>
                        ) : null}
                      </div>
                    )}
                  </FormSection>
                )}
              </div>

              {/* ── Summary ── */}
              <aside className="min-w-0 space-y-3 overflow-y-auto border-t border-border/70 bg-surface-1/40 p-4 lg:border-l lg:border-t-0">
                <BracketLabel tone="muted">{t('cloneServer.review.summaryTitle')}</BracketLabel>

                <div className="overflow-hidden rounded-sm border border-border bg-card">
                  <div className="border-b border-border/70 px-3 py-2.5">
                    <span className="block truncate text-data font-semibold text-foreground">
                      {name.trim() || '—'}
                    </span>
                  </div>
                  <div className="divide-y divide-border/70">
                    <SummaryRow label={t('fields.memoryMb')} value={memory.trim() || '—'} />
                    <SummaryRow label={t('updateServer.cpuCores')} value={cpu.trim() || '—'} />
                    <SummaryRow label={t('fields.diskMb')} value={disk.trim() || '—'} />
                    <SummaryRow
                      label={t('updateServer.databaseAllocation')}
                      value={databaseAllocation.trim() || '—'}
                    />
                    <SummaryRow
                      label={t('updateServer.backupAllocation')}
                      value={backupAllocationMb.trim() || '—'}
                    />
                    <SummaryRow
                      label={t('updateServer.backupRetention')}
                      value={backupRetentionCount.trim() || '—'}
                    />
                    <SummaryRow label={t('fields.networkMode')} value={networkModeLabel} />
                    {isIpamNetwork ? (
                      <SummaryRow
                        label={t('updateServer.primaryIp')}
                        value={primaryIp.trim() || t('fields.autoAssign')}
                      />
                    ) : isBridgeNetwork ? (
                      <SummaryRow
                        label={t('updateServer.primaryAllocation')}
                        value={allocationSummary || '—'}
                      />
                    ) : null}
                  </div>
                </div>
              </aside>
            </div>
          </DialogBody>
          <DialogFooter className="sm:justify-between">
            <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setOpen(false)}>
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-mini"
              onClick={handleSave}
              disabled={
                mutation.isPending ||
                backupSettingsMutation.isPending ||
                retentionInvalid ||
                backupAllocationInvalid ||
                (isRunning && isShrink) ||
                disabled
              }
            >
              {t('updateServer.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Aside summary row — muted label, live value. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-3 py-2">
      <span className="shrink-0 text-micro text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-micro font-medium text-foreground">{value}</span>
    </div>
  );
}

export default UpdateServerModal;
