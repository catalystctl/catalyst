import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@/csync';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Info, Loader2, ShieldAlert } from 'lucide-react';
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
import { BracketLabel } from '@/components/deck/primitives';
import { FormSection } from '@/components/ui/form-section';
import type { CloneMode, ClonePlan, Server } from '../../types/server';

/** Deck field chrome — 4px radius, 32px control height, mini type ramp. */
const fieldClass =
  'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';

/** Network modes whose ports come from the panel's allocation pool. */
const ALLOCATION_MODES = new Set(['host', 'bridge']);

/** Network mode value → catalog label key, for the live summary aside. */
const NETWORK_MODE_LABELS: Record<string, string> = {
  host: 'networkModes.host',
  bridge: 'networkModes.bridge',
  macvlan: 'networkModes.macvlan',
  'mc-lan-static': 'networkModes.mcLanStatic',
  'mc-lan-dynamic': 'networkModes.mcLanDynamic',
};

function formatBytes(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatFieldValue(value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

type Props = {
  server: Server;
  disabled?: boolean;
};

function CloneServerDialog({ server, disabled = false }: Props) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<ClonePlan | null>(null);
  // Signature of the form the current plan was computed from. Any edit
  // invalidates the binding: submit goes back to preflight instead of sending
  // a plan the server would reject as stale.
  const [planSignature, setPlanSignature] = useState<string | null>(null);
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
      setPlan(null);
      setPlanSignature(null);
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

  const buildSharedPayload = () => ({
    mode,
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

  // Everything the payload depends on, as a comparable string. A clone plan
  // only binds the form it was computed from.
  const configSignature = JSON.stringify(buildSharedPayload());
  const planFresh = plan !== null && planSignature === configSignature;
  const preflightSignatureRef = useRef<string | null>(null);

  const blockers = planFresh && plan ? plan.blockers : [];
  const unacknowledgedWarnings = (
    planFresh && plan ? plan.warnings : []
  ).filter((warning) => !acknowledgedWarnings.includes(warning.code));

  // The preflight route names the target `targetNodeId`; the submit route reads
  // `nodeId`. Sending the preflight name on submit made the server fall back to
  // the source node, re-resolve the plan there and reject the review as stale.
  const buildPayload = () => ({ ...buildSharedPayload(), targetNodeId: nodeId });

  const preflightMutation = useMutation({
    mutationFn: () => serversApi.clonePreflight(server.id, buildPayload()),
    onSuccess: (result) => {
      setPlan(result);
      setPlanSignature(preflightSignatureRef.current);
      setAcknowledgedWarnings([]);
    },
    onError: (error: any) => {
      notifyError(error);
    },
  });

  const runPreflight = () => {
    preflightSignatureRef.current = configSignature;
    preflightMutation.mutate();
  };

  const cloneMutation = useMutation({
    mutationFn: () =>
      serversApi.clone(server.id, {
        ...buildSharedPayload(),
        nodeId,
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
        preflightSignatureRef.current = configSignature;
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

  // One submit: without a fresh plan it runs the preflight (the old "review
  // changes" click); with one it clones. Disabled until the form is valid and
  // the plan has no blockers or unacknowledged warnings — the old per-step
  // gating, now submit-time.
  const canSubmit =
    name.trim().length > 0 &&
    !preflightMutation.isPending &&
    !cloneMutation.isPending &&
    blockers.length === 0 &&
    unacknowledgedWarnings.length === 0;

  const handleSubmit = () => {
    if (planFresh && plan) {
      cloneMutation.mutate();
    } else {
      runPreflight();
    }
  };

  const stopSource = async () => {
    setStopPending(true);
    try {
      await serversApi.stop(server.id);
      runPreflight();
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

  // ── Live summary values ─────────────────────────────────────────────
  const selectedNode = availableNodes.find((node) => node.id === nodeId);
  const selectedAllocation = availableAllocations.find(
    (allocation) => allocation.id === allocationId,
  );
  const selectedOwner = users.find((u: any) => u.id === ownerId);
  const networkModeLabel = NETWORK_MODE_LABELS[networkMode]
    ? t(NETWORK_MODE_LABELS[networkMode])
    : networkMode;
  const includeSummary = [
    includeAccess && t('cloneServer.include.access'),
    includeRoleGrants && t('cloneServer.include.roleGrants'),
    includeScheduledTasks && t('cloneServer.include.scheduledTasks'),
    includeDatabases && t('cloneServer.include.databases'),
    includeInstalledMods && t('cloneServer.include.installedMods'),
  ]
    .filter(Boolean)
    .join(', ');
  const notStoppedBlocker = blockers.some((b) => b.code === 'CLONE_SOURCE_NOT_STOPPED');
  const sizeLabel = plan ? formatBytes(plan.source.dataSizeBytes) : null;

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
      <DialogContent size="full" className="sm:h-[min(90dvh,54rem)]">
        <DialogHeader>
          <DialogTitle>{t('cloneServer.title')}</DialogTitle>
          <DialogDescription>
            {planFresh
              ? t('cloneServer.review.description')
              : t('cloneServer.description', { name: server.name })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="min-h-0 p-0">
          <div className="grid min-h-0 grid-cols-1 lg:h-full lg:grid-cols-[minmax(0,1fr)_20rem]">
            {/* ── Configuration ── */}
            <div className="min-w-0 space-y-3 overflow-y-auto p-4 lg:pr-5">
              {preflightMutation.isPending && (
                <div className="flex items-center gap-2 rounded-sm border border-info/30 bg-info/10 p-3 text-mini text-info">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span>{t('cloneServer.preflightPending')}</span>
                </div>
              )}

              {/* 1 — Clone mode */}
              <FormSection index={1} title={t('cloneServer.modeLabel')}>
                <div className="space-y-3">
                  <div className="flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/10 p-3 text-mini text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <span>
                      {mode === 'full'
                        ? t('cloneServer.warningCopyFiles')
                        : t('cloneServer.warningFreshInstall')}
                    </span>
                  </div>
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
              </FormSection>

              {/* 2 — Details */}
              <FormSection index={2} title={t('createServer.steps.details')}>
                <div className="space-y-3">
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

                  <div className="space-y-1.5">
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

                  {/* Server Owner (admin only) */}
                  {isAdmin && (
                    <div className="space-y-1.5">
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
                </div>
              </FormSection>

              {/* 3 — Resource allocation */}
              <FormSection index={3} title={t('createServer.resources.title')}>
                <div className="space-y-3">
                  <div className="space-y-1.5">
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
                    <div className="space-y-1.5">
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

                  {/* Resources */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
              </FormSection>

              {/* 4 — Also copy */}
              <FormSection index={4} title={t('cloneServer.includeTitle')}>
                <div className="space-y-3">
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
              </FormSection>
            </div>

            {/* ── Live clone plan ── */}
            <aside className="min-w-0 space-y-3 overflow-y-auto border-t border-border/70 bg-surface-1/40 p-4 lg:border-l lg:border-t-0">
              <BracketLabel tone="muted">{t('cloneServer.review.summaryTitle')}</BracketLabel>

              {/* Configuration so far — updates with every field */}
              <div className="overflow-hidden rounded-sm border border-border bg-card">
                <SummaryRow label={t('cloneServer.review.changeFrom')} value={server.name} />
                <SummaryRow
                  label={t('cloneServer.modeLabel')}
                  value={t(mode === 'full' ? 'cloneServer.mode.full.title' : 'cloneServer.mode.configuration.title')}
                />
                <SummaryRow
                  label={t('fields.name')}
                  value={name.trim() || t('cloneServer.namePlaceholder')}
                  muted={!name.trim()}
                />
                <SummaryRow label={t('fields.node')} value={selectedNode?.name ?? nodeId} />
                <SummaryRow label={t('fields.networkMode')} value={networkModeLabel} />
                {needsAllocation && (
                  <SummaryRow
                    label={t('cloneServer.networkAllocation')}
                    value={
                      selectedAllocation
                        ? `${selectedAllocation.ip}:${selectedAllocation.port}`
                        : t('cloneServer.allocationAuto')
                    }
                  />
                )}
                {isAdmin && (
                  <SummaryRow
                    label={t('cloneServer.serverOwner')}
                    value={
                      selectedOwner
                        ? selectedOwner.username || selectedOwner.email
                        : t('cloneServer.ownerOptional')
                    }
                  />
                )}
                <SummaryRow label={t('fields.memoryMb')} value={memoryMb} />
                <SummaryRow label={t('fields.cpuCores')} value={cpuCores} />
                <SummaryRow label={t('fields.diskMb')} value={diskMb} />
                <SummaryRow
                  label={t('cloneServer.includeTitle')}
                  value={includeSummary || '—'}
                  muted={!includeSummary}
                />
              </div>

              {/* Preflight result — visible once the plan is bound and only
                  while the form still matches it */}
              {planFresh && plan && (
                <div className="overflow-hidden rounded-sm border border-border bg-card">
                  <div className="space-y-1 border-b border-border/70 px-3 py-2.5">
                    <p className="text-micro leading-relaxed text-muted-foreground">
                      {plan.mode === 'full'
                        ? t('cloneServer.review.fullSummary')
                        : t('cloneServer.review.configurationSummary')}
                    </p>
                    <p className="text-micro leading-relaxed text-foreground">
                      {plan.crossNode
                        ? t('cloneServer.review.crossNodeTarget', {
                            source: plan.source.nodeName,
                            target: plan.target.nodeName,
                          })
                        : t('cloneServer.review.sameNodeTarget', { target: plan.target.nodeName })}
                    </p>
                    {plan.requirements.installWillRun && (
                      <p className="text-micro text-muted-foreground">
                        {t('cloneServer.review.installWillRun')}
                      </p>
                    )}
                    {plan.mode === 'full' && (
                      <p className="text-micro text-muted-foreground">
                        {sizeLabel
                          ? t('cloneServer.review.estimatedSize', { size: sizeLabel })
                          : t('cloneServer.review.estimatedSizeUnknown')}
                        {typeof plan.requirements.estimatedDurationSec === 'number'
                          ? ` · ${t('cloneServer.review.estimatedDuration', {
                              seconds: plan.requirements.estimatedDurationSec,
                            })}`
                          : ''}
                      </p>
                    )}
                  </div>

                  {blockers.length > 0 && (
                    <div className="border-b border-border/70 px-3 py-2.5">
                      <p className="mb-1.5 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-danger">
                        <ShieldAlert className="h-3 w-3 shrink-0" />
                        {t('cloneServer.review.blockersTitle')}
                      </p>
                      <ul className="space-y-1">
                        {blockers.map((blocker) => (
                          <li
                            key={blocker.code}
                            className="flex items-start gap-1.5 text-micro leading-snug text-muted-foreground"
                          >
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-danger" />
                            <span className="min-w-0">
                              {t(`cloneServer.blockers.${blocker.code}`, {
                                defaultValue: blocker.message,
                              })}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {notStoppedBlocker && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-2 h-7 px-2.5 text-micro"
                          onClick={stopSource}
                          disabled={stopPending}
                        >
                          {stopPending
                            ? t('cloneServer.review.stoppingSource')
                            : t('cloneServer.review.stopSourceAndContinue')}
                        </Button>
                      )}
                    </div>
                  )}

                  {plan.changes.length > 0 && (
                    <div className="border-b border-border/70 px-3 py-2.5">
                      <p className="mb-1.5 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('cloneServer.review.changesTitle')}
                      </p>
                      <ul className="space-y-1.5">
                        {plan.changes.map((change) => (
                          <li key={change.field} className="text-micro">
                            <span className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
                              {t(`cloneServer.changeLabels.${change.field}`, {
                                defaultValue: change.label,
                              })}
                              {change.nodeSpecific && (
                                <span className="rounded-sm bg-warning/15 px-1 py-0.5 text-warning">
                                  {t('cloneServer.review.nodeSpecific')}
                                </span>
                              )}
                            </span>
                            <span className="block break-all font-mono text-muted-foreground">
                              {t('cloneServer.review.changeFrom')}: {formatFieldValue(change.from)}
                            </span>
                            <span className="block break-all font-mono text-foreground">
                              {t('cloneServer.review.changeTo')}: {formatFieldValue(change.to)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {plan.warnings.length > 0 && (
                    <div className="border-b border-border/70 px-3 py-2.5">
                      <p className="mb-1.5 flex items-center gap-1.5 text-micro font-semibold uppercase tracking-wider text-warning">
                        <Info className="h-3 w-3 shrink-0" />
                        {t('cloneServer.review.warningsTitle')}
                      </p>
                      <ul className="space-y-1.5">
                        {plan.warnings.map((warning) => (
                          <li
                            key={warning.code}
                            className="flex items-start gap-2 text-micro leading-snug text-muted-foreground"
                          >
                            <Checkbox
                              id={`clone-warning-${warning.code}`}
                              checked={acknowledgedWarnings.includes(warning.code)}
                              onCheckedChange={() =>
                                setAcknowledgedWarnings((current) =>
                                  current.includes(warning.code)
                                    ? current.filter((item) => item !== warning.code)
                                    : [...current, warning.code],
                                )
                              }
                              className="mt-0.5"
                            />
                            <label
                              htmlFor={`clone-warning-${warning.code}`}
                              className="min-w-0 cursor-pointer"
                            >
                              {t(`cloneServer.warnings.${warning.code}`, {
                                defaultValue: warning.message,
                              })}
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5 px-3 py-2.5 text-micro text-muted-foreground">
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    <span>
                      {t('cloneServer.review.targetHint', {
                        node: plan.target.nodeName,
                        location: plan.target.locationName,
                      })}
                    </span>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </DialogBody>

        <DialogFooter className="sm:justify-between">
          {/* Unmet requirements — why the submit button is disabled */}
          <div className="min-w-0 flex-1 space-y-1">
            {!name.trim() && (
              <p className="text-micro text-warning">
                {t('createServer.validation.required', { field: t('fields.name') })}
              </p>
            )}
            {blockers.length > 0 && (
              <div>
                <p className="text-micro font-semibold text-danger">
                  {t('cloneServer.review.blockersTitle')}
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {blockers.map((blocker) => (
                    <li key={blocker.code} className="text-micro text-muted-foreground">
                      {t(`cloneServer.blockers.${blocker.code}`, { defaultValue: blocker.message })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {unacknowledgedWarnings.length > 0 && (
              <div>
                <p className="text-micro font-semibold text-warning">
                  {t('cloneServer.review.warningsTitle')}
                </p>
                <ul className="mt-0.5 space-y-0.5">
                  {unacknowledgedWarnings.map((warning) => (
                    <li key={warning.code} className="text-micro text-muted-foreground">
                      {t(`cloneServer.warnings.${warning.code}`, { defaultValue: warning.message })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-mini"
              onClick={() => setOpen(false)}
              disabled={preflightMutation.isPending || cloneMutation.isPending}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-mini"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {(preflightMutation.isPending || cloneMutation.isPending) && (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              )}
              {cloneMutation.isPending
                ? t('cloneServer.cloning')
                : planFresh && plan
                  ? plan.crossNode
                    ? t('cloneServer.review.confirmCrossNode', { node: plan.target.nodeName })
                    : t('cloneServer.review.confirmSameNode')
                  : t('cloneServer.reviewChanges')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One label/value line of the live summary card. */
function SummaryRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-border/40 px-3 py-1.5 last:border-b-0">
      <span className="shrink-0 text-micro text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 truncate text-right text-mini',
          muted ? 'italic text-muted-foreground/70' : 'text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default CloneServerDialog;
