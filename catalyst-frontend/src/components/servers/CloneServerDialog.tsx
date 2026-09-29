import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import { nodesApi } from '../../services/api/nodes';
import { adminApi } from '../../services/api/admin';
import { useAccessibleNodes } from '../../hooks/useNodes';
import { useAuthStore } from '../../stores/authStore';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getApiErrorCode, getLocalizedErrorMessage } from '../../i18n/api-errors';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import CloneReviewStep from './clone/CloneReviewStep';
import type { CloneMode, ClonePlan, Server } from '../../types/server';

/** Deck field chrome — 4px radius, 32px control height, mini type ramp. */
const fieldClass =
  'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';
/** Labelled block on the dialog surface — never a nested rounded card. */
const blockClass = 'rounded-sm border border-border/50 bg-surface-1/40 p-3';
/** 1px separator for stacked fields inside a block. */
const dividerClass = 'border-t border-border/50 pt-3';

/** Network modes whose ports come from the panel's allocation pool. */
const ALLOCATION_MODES = new Set(['host', 'bridge']);

type Props = {
  server: Server;
  disabled?: boolean;
};

function CloneServerDialog({ server, disabled = false }: Props) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'configure' | 'review'>('configure');
  const [plan, setPlan] = useState<ClonePlan | null>(null);
  const [acknowledgedWarnings, setAcknowledgedWarnings] = useState<string[]>([]);
  const [stopPending, setStopPending] = useState(false);

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
  const [mode, setMode] = useState<CloneMode>('configuration');
  const [name, setName] = useState(`${server.name} Copy`);
  const [nodeId, setNodeId] = useState(server.nodeId);
  const [networkMode, setNetworkMode] = useState(server.networkMode || 'host');
  const [allocationId, setAllocationId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [memoryMb, setMemoryMb] = useState(server.allocatedMemoryMb ?? 1024);
  const [cpuCores, setCpuCores] = useState(server.allocatedCpuCores ?? 1);
  const [diskMb, setDiskMb] = useState(server.allocatedDiskMb ?? 1024);
  const [includeAccess, setIncludeAccess] = useState(true);
  const [includeRoleGrants, setIncludeRoleGrants] = useState(true);
  const [includeScheduledTasks, setIncludeScheduledTasks] = useState(false);
  const [includeDatabases, setIncludeDatabases] = useState(false);
  const [includeInstalledMods, setIncludeInstalledMods] = useState(false);

  // Load available allocations for the selected node when the mode uses them.
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
    if (!nodeId || !ALLOCATION_MODES.has(networkMode)) {
      setAvailableAllocations([]);
      setAllocLoadError(null);
    } else {
      setAllocLoadError(null);
    }
  }

  useEffect(() => {
    if (!nodeId || !ALLOCATION_MODES.has(networkMode)) {
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
      setStep('configure');
      setPlan(null);
      setAcknowledgedWarnings([]);
      setMode('configuration');
      setName(`${server.name} Copy`);
      setNodeId(server.nodeId);
      setNetworkMode(server.networkMode || 'host');
      setAllocationId('');
      setOwnerId('');
      setMemoryMb(server.allocatedMemoryMb ?? 1024);
      setCpuCores(server.allocatedCpuCores ?? 1);
      setDiskMb(server.allocatedDiskMb ?? 1024);
      setIncludeAccess(true);
      setIncludeRoleGrants(true);
      setIncludeScheduledTasks(false);
      setIncludeDatabases(false);
      setIncludeInstalledMods(false);
    }
    prevOpenRef.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only open; server read at transition time

  const canClone =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('server.create') ||
    isAdmin;

  const buildPayload = () => ({
    mode,
    targetNodeId: nodeId,
    name: name.trim() || undefined,
    networkMode: networkMode !== server.networkMode ? networkMode : undefined,
    allocationId: allocationId || undefined,
    ownerId: ownerId || undefined,
    allocatedMemoryMb: memoryMb !== server.allocatedMemoryMb ? memoryMb : undefined,
    allocatedCpuCores: cpuCores !== server.allocatedCpuCores ? cpuCores : undefined,
    allocatedDiskMb: diskMb !== server.allocatedDiskMb ? diskMb : undefined,
    includeAccess,
    includeRoleGrants,
    includeScheduledTasks,
    includeDatabases,
    includeInstalledMods,
  });

  const preflightMutation = useMutation({
    mutationFn: () => serversApi.clonePreflight(server.id, buildPayload()),
    onSuccess: (result) => {
      setPlan(result);
      setAcknowledgedWarnings([]);
      setStep('review');
    },
    onError: (error: any) => {
      notifyError(error);
    },
  });

  const cloneMutation = useMutation({
    mutationFn: () =>
      serversApi.clone(server.id, {
        ...buildPayload(),
        preflightId: plan?.preflightId,
        fingerprint: plan?.fingerprint,
        acknowledgedWarnings,
      }),
    onSuccess: (newServer) => {
      notifySuccess(
        mode === 'full' ? t('cloneServer.startedCopyingFiles') : t('cloneServer.cloned'),
      );
      setOpen(false);
      if (newServer?.id) {
        navigate(`/servers/${newServer.id}`);
      }
    },
    onError: (error: any) => {
      const code = getApiErrorCode(error);
      if (code === 'CLONE_PREFLIGHT_STALE' || code === 'CLONE_PREFLIGHT_EXPIRED') {
        // The reviewed plan is no longer valid — re-run the preflight so the
        // user sees the current blockers/warnings instead of a dead end.
        notifyError(error);
        preflightMutation.mutate();
        return;
      }
      notifyError(error);
    },
    onSettled: (newServer) => {
      queryClient.invalidateQueries({ queryKey: qk.servers() });
      queryClient.invalidateQueries({ queryKey: qk.server(server.id) });
      if (newServer?.id) {
        queryClient.invalidateQueries({ queryKey: qk.server(newServer.id) });
      }
    },
  });

  const stopSource = async () => {
    setStopPending(true);
    try {
      await serversApi.stop(server.id);
      preflightMutation.mutate();
    } catch (error: any) {
      notifyError(error);
    } finally {
      setStopPending(false);
    }
  };

  const needsAllocation = ALLOCATION_MODES.has(networkMode);

  const modeOption = (value: CloneMode, title: string, description: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(value);
        setIncludeInstalledMods(value === 'full');
      }}
      aria-pressed={mode === value}
      className={cn(
        'flex-1 rounded-sm border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        mode === value
          ? 'border-primary bg-primary/10'
          : 'border-border/50 bg-surface-1/40 hover:border-border',
      )}
    >
      <span className="block text-mini font-medium text-foreground">{title}</span>
      <span className="mt-1 block text-micro text-muted-foreground">{description}</span>
    </button>
  );

  const includeToggle = (
    id: string,
    checked: boolean,
    onChange: (value: boolean) => void,
    label: string,
    hint: string,
  ) => (
    <div className="flex items-start gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-mini text-foreground">{label}</span>
        <span className="block text-micro text-muted-foreground">{hint}</span>
      </label>
    </div>
  );

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
      <DialogContent size={step === 'review' ? 'lg' : 'md'}>
        <DialogHeader>
          <DialogTitle>{t('cloneServer.title')}</DialogTitle>
          <DialogDescription>
            {step === 'configure'
              ? t('cloneServer.description', { name: server.name })
              : t('cloneServer.review.description')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
          {step === 'review' && plan ? (
            <CloneReviewStep
              plan={plan}
              acknowledgedWarnings={acknowledgedWarnings}
              onToggleWarning={(code) =>
                setAcknowledgedWarnings((current) =>
                  current.includes(code)
                    ? current.filter((item) => item !== code)
                    : [...current, code],
                )
              }
              onBack={() => setStep('configure')}
              onConfirm={() => cloneMutation.mutate()}
              submitting={cloneMutation.isPending}
              stopSourcePending={stopPending}
              onStopSource={stopSource}
            />
          ) : (
            <>
              <div className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 p-3 text-mini text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  {mode === 'full'
                    ? t('cloneServer.warningCopyFiles')
                    : t('cloneServer.warningFreshInstall')}
                </span>
              </div>

              {preflightMutation.isPending && (
                <div className="flex items-center gap-2 rounded-sm border border-info/30 bg-info/10 p-3 text-mini text-info">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span>{t('cloneServer.preflightPending')}</span>
                </div>
              )}

              <div className={`${blockClass} space-y-3`}>
                {/* Mode */}
                <div className="space-y-1.5">
                  <span className="type-overline">{t('cloneServer.modeLabel')}</span>
                  <div className="flex gap-2">
                    {modeOption(
                      'full',
                      t('cloneServer.mode.full.title'),
                      t('cloneServer.mode.full.description'),
                    )}
                    {modeOption(
                      'configuration',
                      t('cloneServer.mode.configuration.title'),
                      t('cloneServer.mode.configuration.description'),
                    )}
                  </div>
                </div>

                {/* Name */}
                <div className={cn('space-y-1.5', dividerClass)}>
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

                {/* Allocation */}
                {needsAllocation && (
                  <div className={cn('space-y-1.5', dividerClass)}>
                    <label className="type-overline">
                      {t('cloneServer.networkAllocation')}{' '}
                      <span className="text-muted-foreground">{t('cloneServer.allocationOptional')}</span>
                    </label>
                    <select
                      className={cn(fieldClass, 'font-mono tabular-nums')}
                      value={allocationId}
                      onChange={(e) => setAllocationId(e.target.value)}
                    >
                      <option value="">{t('cloneServer.allocationAuto')}</option>
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
                      {t('cloneServer.serverOwner')}{' '}
                      <span className="text-muted-foreground">{t('cloneServer.ownerOptional')}</span>
                    </label>
                    <Combobox
                      value={ownerId}
                      onChange={(val: string) => setOwnerId(val)}
                      options={userOptions}
                      placeholder={t('cloneServer.ownerPlaceholder')}
                      searchPlaceholder={t('cloneServer.ownerSearchPlaceholder')}
                      className={fieldClass}
                    />
                    <p className="type-meta">{t('cloneServer.ownerHint')}</p>
                  </div>
                )}

                {/* Resources */}
                <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-3', dividerClass)}>
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

                {/* Portable configuration surfaces */}
                <div className={cn('space-y-3', dividerClass)}>
                  <span className="type-overline">{t('cloneServer.includeTitle')}</span>
                  {includeToggle(
                    'clone-include-access',
                    includeAccess,
                    setIncludeAccess,
                    t('cloneServer.include.access'),
                    t('cloneServer.include.accessHint'),
                  )}
                  {includeToggle(
                    'clone-include-roles',
                    includeRoleGrants,
                    setIncludeRoleGrants,
                    t('cloneServer.include.roleGrants'),
                    t('cloneServer.include.roleGrantsHint'),
                  )}
                  {includeToggle(
                    'clone-include-tasks',
                    includeScheduledTasks,
                    setIncludeScheduledTasks,
                    t('cloneServer.include.scheduledTasks'),
                    t('cloneServer.include.scheduledTasksHint'),
                  )}
                  {includeToggle(
                    'clone-include-databases',
                    includeDatabases,
                    setIncludeDatabases,
                    t('cloneServer.include.databases'),
                    t('cloneServer.include.databasesHint'),
                  )}
                  {includeToggle(
                    'clone-include-mods',
                    includeInstalledMods,
                    setIncludeInstalledMods,
                    t('cloneServer.include.installedMods'),
                    t('cloneServer.include.installedModsHint'),
                  )}
                </div>
              </div>
            </>
          )}
        </DialogBody>

        <DialogFooter>
          {step === 'configure' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-mini"
                onClick={() => setOpen(false)}
                disabled={preflightMutation.isPending}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button
                size="sm"
                className="h-8 px-3 text-mini"
                onClick={() => preflightMutation.mutate()}
                disabled={preflightMutation.isPending || !name.trim()}
              >
                {preflightMutation.isPending && (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                )}
                {t('cloneServer.reviewChanges')}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CloneServerDialog;
