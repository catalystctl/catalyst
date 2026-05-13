import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { qk } from '../../../lib/queryKeys';
import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Container,
  Copy,
  Database,
  HardDrive,
  Info,
  KeyRound,
  Loader2,
  Network,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Shield,
  Skull,
  Trash2,
  UserRoundCog,
  Zap,
  Clock,
  ChevronDown,
} from 'lucide-react';
import { serversApi } from '../../../services/api/servers';
import { notifySuccess, notifyError } from '../../../utils/notify';
import { reportSystemError } from '../../../services/api/systemErrors';
import UpdateServerModal from '../UpdateServerModal';
import TransferServerModal from '../TransferServerModal';
import DeleteServerDialog from '../DeleteServerDialog';
import ServerTabCard from './ServerTabCard';

// ── Types ──

interface Allocation {
  containerPort: number;
  hostPort: number;
  isPrimary: boolean;
}

interface TemplateImage {
  name: string;
  label?: string;
  image: string;
}

interface ServerInfo {
  id: string;
  name: string;
  ownerId?: string;
  status: string;
  nodeId: string;
  templateId?: string;
  nodeName?: string;
  primaryPort?: number;
  primaryIp?: string | null;
  allocatedMemoryMb?: number;
  allocatedCpuCores?: number;
  allocatedDiskMb?: number;
  allocatedSwapMb?: number;
  ioWeight?: number;
  environment?: Record<string, string>;
  restartPolicy?: 'always' | 'on-failure' | 'never';
  crashCount?: number;
  maxCrashCount?: number;
  lastCrashAt?: string | null;
  lastExitCode?: number | null;
  suspendedAt?: string | null;
  suspendedByUserId?: string | null;
  suspensionReason?: string | null;
  backupStorageMode?: string;
  backupRetentionCount?: number;
  backupRetentionDays?: number;
  backupAllocationMb?: number;
  networkMode?: string;
  startupCommand?: string | null;
  template?: {
    name?: string;
    image?: string;
    startup?: string;
    images?: TemplateImage[];
    defaultImage?: string;
  };
  node?: {
    name?: string;
    hostname?: string;
    publicAddress?: string;
  };
  connection?: {
    assignedIp?: string | null;
    nodeIp?: string | null;
    host?: string | null;
    port?: number | null;
  };
}

interface Props {
  serverId: string;
  serverName: string;
  server: ServerInfo;
  isSuspended: boolean;
  canAdminWrite: boolean;

  // Suspension
  suspendReason: string;
  onSuspendReasonChange: (reason: string) => void;
  suspendPending: boolean;
  onSuspend: (reason?: string) => void;
  unsuspendPending: boolean;
  onUnsuspend: () => void;

  // Allocations
  allocations: Allocation[];
  allocationsError: string | null;
  newContainerPort: string;
  onNewContainerPortChange: (port: string) => void;
  newHostPort: string;
  onNewHostPortChange: (port: string) => void;
  addAllocationPending: boolean;
  onAddAllocation: () => void;
  removeAllocationPending: boolean;
  onRemoveAllocation: (containerPort: number) => void;
  setPrimaryPending: boolean;
  onSetPrimary: (containerPort: number) => void;

  // Crash recovery
  restartPolicy: 'always' | 'on-failure' | 'never';
  onRestartPolicyChange: (policy: 'always' | 'on-failure' | 'never') => void;
  maxCrashCount: string;
  onMaxCrashCountChange: (count: string) => void;
  crashCount: number;
  maxCrashCountValue: number;
  lastCrashAt?: string | null;
  lastExitCode?: number | null;
  restartPolicyPending: boolean;
  onSaveRestartPolicy: () => void;
  resetCrashCountPending: boolean;
  onResetCrashCount: () => void;

  // Permissions
  canDelete: boolean;
}

// ── Helpers ──

function CopyableValue({ label, value }: { label: string; value: string }) {
  const copy = useCallback(() => {
    navigator.clipboard.writeText(value).then(
      () => notifySuccess('Copied to clipboard'),
      () => notifyError('Failed to copy'),
    );
  }, [value]);

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-surface-2/50 px-3 py-2 dark:bg-surface-2/30">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <button
        type="button"
        onClick={copy}
        className="group flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-mono text-foreground transition-colors hover:bg-primary/10"
        title="Click to copy"
      >
        <span className="max-w-[240px] truncate">{value || '—'}</span>
        <Copy className="h-2.5 w-2.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    </div>
  );
}

// ── Section Header ──

function SectionHeader({
  icon: Icon,
  title,
  description,
  accent = 'primary',
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  accent?: 'primary' | 'warning' | 'danger';
}) {
  const iconColor = accent === 'danger'
    ? 'text-danger'
    : accent === 'warning'
      ? 'text-warning'
      : 'text-primary';
  return (
    <div className="mb-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {description && (
        <p className="mt-0.5 pl-5.5 text-[11px] text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

// ── Confirm Dialog ──

function ConfirmAction({
  open,
  title,
  description,
  confirmLabel,
  variant = 'danger',
  pending,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  variant?: 'danger' | 'warning' | 'primary';
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  const btnClass =
    variant === 'danger'
      ? 'bg-danger hover:bg-danger text-foreground shadow-lg shadow-danger/20'
      : variant === 'warning'
        ? 'bg-warning hover:bg-warning text-foreground shadow-lg shadow-warning/20'
        : 'bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      <div className="relative w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-60 ${btnClass}`}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stat Chip ──

function StatChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border/50 bg-surface-2/50 px-3 py-2 dark:bg-surface-2/30">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold text-foreground ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

// ── Main Component ──

export default function ServerAdminTab({
  serverId,
  serverName,
  server,
  isSuspended,
  canAdminWrite,
  suspendReason,
  onSuspendReasonChange,
  suspendPending,
  onSuspend,
  unsuspendPending,
  onUnsuspend,
  allocations,
  allocationsError,
  newContainerPort,
  onNewContainerPortChange,
  newHostPort,
  onNewHostPortChange,
  addAllocationPending,
  onAddAllocation,
  removeAllocationPending,
  onRemoveAllocation,
  setPrimaryPending,
  onSetPrimary,
  restartPolicy,
  onRestartPolicyChange,
  maxCrashCount,
  onMaxCrashCountChange,
  crashCount,
  maxCrashCountValue,
  lastCrashAt,
  lastExitCode,
  restartPolicyPending,
  onSaveRestartPolicy,
  resetCrashCountPending,
  onResetCrashCount,
  canDelete,
}: Props) {
  // ── State ──
  const [rebuildConfirm, setRebuildConfirm] = useState(false);
  const [killConfirm, setKillConfirm] = useState(false);
  const [reinstallConfirm, setReinstallConfirm] = useState(false);
  const [rebuildPending, setRebuildPending] = useState(false);
  const [killPending, setKillPending] = useState(false);
  const [reinstallPending, setReinstallPending] = useState(false);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [transferOwnerPending, setTransferOwnerPending] = useState(false);
  const [transferOwnerConfirm, setTransferOwnerConfirm] = useState(false);
  const [envExpanded, setEnvExpanded] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // ── Environment variables state ──
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [envDirty, setEnvDirty] = useState(false);

  useEffect(() => {
    if (!server?.environment) {
      setEnvVars([]);
      return;
    }
    const entries = Object.entries(server.environment).map(([key, value]) => ({
      key,
      value: String(value),
    }));
    setEnvVars(entries.length ? entries : [{ key: '', value: '' }]);
    setEnvDirty(false);
  }, [server?.id, server?.environment]);

  const envMutation = useMutation({
    mutationFn: () => {
      const env: Record<string, string> = {};
      for (const row of envVars) {
        const k = row.key.trim();
        if (k) env[k] = row.value;
      }
      return serversApi.update(serverId, { environment: env });
    },
    onSuccess: () => {
      notifySuccess('Environment variables updated');
      setEnvDirty(false);
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error ||
          error?.message ||
          'Failed to update environment',
      ),
  });

  // ── Derived ──
  const templateImages = server.template?.images ?? [];
  const currentImageVariant = server.environment?.IMAGE_VARIANT ?? '';
  const currentResolvedImage =
    server.environment?.TEMPLATE_IMAGE ??
    server.template?.defaultImage ??
    server.template?.image ??
    '';
  const currentImageLabel =
    templateImages.find((img) => img.name === currentImageVariant)?.label ??
    (currentImageVariant || 'Default');

  const canEdit = !isSuspended && server.status !== 'archived';
  const canEditWhenStopped =
    canEdit && (server.status === 'stopped' || server.status === 'crashed' || server.status === 'error');

  const statusBadgeColor = (() => {
    switch (server.status) {
      case 'running':
        return 'bg-success/10 text-success border-success/20';
      case 'stopped':
        return 'bg-surface-2 text-muted-foreground border-border';
      case 'crashed':
        return 'bg-danger/10 text-danger border-danger/20';
      case 'suspended':
        return 'bg-warning/10 text-warning border-warning/20';
      case 'archived':
        return 'bg-surface-2 text-muted-foreground border-border';
      default:
        return 'bg-primary-500/10 text-primary border-primary/20';
    }
  })();

  // ── Handlers ──
  const handleRebuild = useCallback(async () => {
    try {
      setRebuildPending(true);
      await serversApi.rebuild(serverId);
      notifySuccess('Container rebuild initiated');
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setRebuildConfirm(false);
    } catch (err: unknown) {
      reportSystemError({
        level: 'error',
        component: 'ServerAdminTab',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'rebuild container' },
      });
      notifyError(err instanceof Error ? err.message : 'Failed to rebuild container');
    } finally {
      setRebuildPending(false);
    }
  }, [serverId]);

  const handleKill = useCallback(async () => {
    try {
      setKillPending(true);
      await serversApi.kill(serverId);
      notifySuccess('Server process killed');
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setKillConfirm(false);
    } catch (err: unknown) {
      reportSystemError({
        level: 'error',
        component: 'ServerAdminTab',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'kill server' },
      });
      notifyError(err instanceof Error ? err.message : 'Failed to kill server');
    } finally {
      setKillPending(false);
    }
  }, [serverId]);

  const handleReinstall = useCallback(async () => {
    try {
      setReinstallPending(true);
      await serversApi.install(serverId);
      notifySuccess('Reinstall initiated');
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      setReinstallConfirm(false);
    } catch (err: unknown) {
      reportSystemError({
        level: 'error',
        component: 'ServerAdminTab',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'reinstall server' },
      });
      notifyError(err instanceof Error ? err.message : 'Failed to reinstall');
    } finally {
      setReinstallPending(false);
    }
  }, [serverId]);

  const handleTransferOwnership = useCallback(async () => {
    try {
      setTransferOwnerPending(true);
      await serversApi.transferOwnership(serverId, { newOwnerId: newOwnerId.trim() });
      notifySuccess('Ownership transferred');
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      queryClient.invalidateQueries({ queryKey: qk.serverPermissions(serverId) });
      setNewOwnerId('');
      setTransferOwnerConfirm(false);
    } catch (err: unknown) {
      reportSystemError({
        level: 'error',
        component: 'ServerAdminTab',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'transfer ownership' },
      });
      notifyError(err instanceof Error ? err.message : 'Failed to transfer ownership');
    } finally {
      setTransferOwnerPending(false);
    }
  }, [serverId, newOwnerId]);

  // ── Guard ──
  if (!canAdminWrite) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-muted px-4 py-6 text-center text-sm text-danger">
        <Shield className="mx-auto mb-2 h-8 w-8 opacity-50" />
        Admin access required to view this tab.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Overview Card ── */}
      <ServerTabCard>
        <SectionHeader icon={Server} title="Server Information" />

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <CopyableValue label="Server ID" value={server.id} />
          <CopyableValue
            label="Node"
            value={server.node?.name ?? server.nodeName ?? server.nodeId}
          />
          <CopyableValue
            label="Template"
            value={server.template?.name ?? server.templateId ?? '—'}
          />
          <CopyableValue label="Primary Port" value={String(server.primaryPort ?? '—')} />
          <CopyableValue label="Connection" value={`${server.connection?.host ?? '—'}:${server.connection?.port ?? '—'}`} />
          <CopyableValue label="Network Mode" value={server.networkMode ?? 'bridge'} />
        </div>

        {/* Environment Variables — collapsible */}
        <div className="mt-4">
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-lg border border-border/50 bg-surface-2/50 px-3 py-2 text-xs transition-colors hover:border-primary/30 dark:bg-surface-2/30"
            onClick={() => setEnvExpanded(!envExpanded)}
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <Database className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium text-foreground">Environment Variables</span>
              <span className="text-muted-foreground">({Object.keys(server.environment ?? {}).length})</span>
            </span>
            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${envExpanded ? 'rotate-180' : ''}`} />
          </button>

          {envExpanded && (
            <div className="mt-2 space-y-2">
              {canAdminWrite ? (
                <>
                  {envVars.length === 0 && (
                    <p className="py-3 text-center text-xs text-muted-foreground">
                      No environment variables. Click "+ Add" to begin.
                    </p>
                  )}
                  {envVars.map((row, idx) => (
                    <div key={idx} className="group flex items-center gap-2">
                      <input
                        className="w-[130px] shrink-0 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] uppercase text-foreground transition-colors focus:border-primary focus:bg-card focus:outline-none"
                        value={row.key}
                        onChange={(e) => {
                          const next = [...envVars];
                          next[idx] = { ...next[idx], key: e.target.value };
                          setEnvVars(next);
                          setEnvDirty(true);
                        }}
                        placeholder="KEY"
                        disabled={isSuspended}
                      />
                      <span className="text-[10px] text-foreground">=</span>
                      <input
                        className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-foreground transition-colors focus:border-primary focus:bg-card focus:outline-none"
                        value={row.value}
                        onChange={(e) => {
                          const next = [...envVars];
                          next[idx] = { ...next[idx], value: e.target.value };
                          setEnvVars(next);
                          setEnvDirty(true);
                        }}
                        placeholder="value"
                        disabled={isSuspended}
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-md p-1 text-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-danger"
                        onClick={() => {
                          setEnvVars(envVars.filter((_, i) => i !== idx));
                          setEnvDirty(true);
                        }}
                        disabled={isSuspended}
                        title="Remove"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary dark:hover:bg-primary/10 dark:hover:text-primary-400"
                      onClick={() => {
                        setEnvVars([...envVars, { key: '', value: '' }]);
                        setEnvDirty(true);
                      }}
                      disabled={isSuspended}
                    >
                      + Add
                    </button>
                    {envDirty && (
                      <button
                        type="button"
                        className="rounded-lg bg-primary px-3 py-1 text-[10px] font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
                        onClick={() => envMutation.mutate()}
                        disabled={isSuspended || envMutation.isPending}
                      >
                        {envMutation.isPending ? 'Saving…' : 'Save'}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="divide-y divide-border">
                  {server.environment && Object.keys(server.environment).length > 0 ? (
                    Object.entries(server.environment).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                        <span className="font-mono text-[11px] uppercase text-muted-foreground">{key}</span>
                        <span className="text-xs font-medium text-foreground">{String(value)}</span>
                      </div>
                    ))
                  ) : (
                    <p className="py-3 text-center text-xs text-muted-foreground">No environment variables set.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </ServerTabCard>

      {/* ── Docker & Container — two-column grid ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Image & Variant */}
        <ServerTabCard>
          <SectionHeader icon={Container} title="Container Image" description="Docker image used to run this server container." />

          <div className="space-y-3">
            <div className="rounded-lg border border-border/50 bg-surface-2/50 p-3 dark:bg-surface-2/30">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Current Image</div>
              <div className="mt-1 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-card px-2 py-1 font-mono text-[11px] text-foreground">
                  {currentResolvedImage}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(currentResolvedImage).then(() => notifySuccess('Copied')).catch(() => {});
                  }}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
                  title="Copy image"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              {currentImageVariant && (
                <div className="mt-2 text-[10px] text-muted-foreground">
                  Variant: <span className="font-medium text-foreground">{currentImageLabel}</span>
                </div>
              )}
            </div>

            {templateImages.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Available Variants</div>
                <div className="space-y-1">
                  {templateImages.map((img) => (
                    <div
                      key={img.name}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
                        img.name === currentImageVariant
                          ? 'border-primary/30 bg-primary-500/5'
                          : 'border-border/50 bg-surface-2/50 dark:bg-surface-2/30'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-foreground">{img.label ?? img.name}</div>
                        <div className="truncate font-mono text-[10px] text-muted-foreground">{img.image}</div>
                      </div>
                      {img.name === currentImageVariant && (
                        <span className="ml-2 rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Active</span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 flex items-start gap-1 text-[10px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Change the variant via the <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px]">IMAGE_VARIANT</code> env var, then rebuild.
                </p>
              </div>
            )}
          </div>
        </ServerTabCard>

        {/* Container Actions */}
        <ServerTabCard>
          <SectionHeader icon={Zap} title="Container Actions" description="Manage the server container lifecycle." />

          <div className="space-y-2">
            {/* Rebuild */}
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-2/50 p-3 dark:bg-surface-2/30">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">Rebuild Container</div>
                <div className="text-[10px] text-muted-foreground">Recreates from current image. Preserves all data.</div>
              </div>
              <button
                type="button"
                onClick={() => setRebuildConfirm(true)}
                disabled={!canEdit}
                className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-[10px] font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
              >
                Rebuild
              </button>
            </div>

            {/* Reinstall */}
            <div className="flex items-center justify-between rounded-lg border border-warning/20 bg-warning/5 p-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">Reinstall</div>
                <div className="text-[10px] text-muted-foreground">Wipes all data, re-runs install script.</div>
              </div>
              <button
                type="button"
                onClick={() => setReinstallConfirm(true)}
                disabled={!canEditWhenStopped}
                className="shrink-0 rounded-md bg-warning px-3 py-1.5 text-[10px] font-semibold text-foreground shadow-sm transition-all hover:bg-warning disabled:opacity-50"
              >
                Reinstall
              </button>
            </div>

            {/* Force Kill */}
            <div className="flex items-center justify-between rounded-lg border border-danger/20 bg-danger/5 p-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">Force Kill</div>
                <div className="text-[10px] text-muted-foreground">Terminates immediately, no graceful shutdown.</div>
              </div>
              <button
                type="button"
                onClick={() => setKillConfirm(true)}
                disabled={server.status !== 'running' && server.status !== 'starting' && server.status !== 'stopping'}
                className="shrink-0 rounded-md border border-danger/30 bg-danger px-3 py-1.5 text-[10px] font-semibold text-foreground shadow-sm transition-all hover:border-danger/50 disabled:opacity-50"
              >
                Kill
              </button>
            </div>
          </div>
        </ServerTabCard>
      </div>

      {/* ── Resources — two-column grid ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Allocated Resources */}
        <ServerTabCard>
          <SectionHeader icon={BarChart3} title="Allocated Resources" description="Hardware resources assigned to this server." />

          <div className="grid grid-cols-2 gap-2">
            <StatChip label="Memory" value={`${server.allocatedMemoryMb ?? 0} MB`} />
            <StatChip label="CPU" value={`${server.allocatedCpuCores ?? 0} core${(server.allocatedCpuCores ?? 0) === 1 ? '' : 's'}`} />
            <StatChip label="Disk" value={`${server.allocatedDiskMb ?? 0} MB`} />
            <StatChip label="Swap" value={`${server.allocatedSwapMb ?? 0} MB`} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <UpdateServerModal serverId={serverId} disabled={isSuspended} />
            <TransferServerModal serverId={serverId} disabled={isSuspended} />
          </div>
        </ServerTabCard>

        {/* Port Allocations */}
        <ServerTabCard>
          <SectionHeader icon={Network} title="Port Allocations" description="Host-to-container port bindings." />

          {allocationsError && (
            <div className="mb-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {allocationsError}
            </div>
          )}

          {/* Add form */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <input
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all focus:border-primary focus:outline-none"
              value={newContainerPort}
              onChange={(e) => onNewContainerPortChange(e.target.value)}
              placeholder="Container port"
              type="number"
              min={1}
              max={65535}
              disabled={!canEditWhenStopped}
            />
            <input
              className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all focus:border-primary focus:outline-none"
              value={newHostPort}
              onChange={(e) => onNewHostPortChange(e.target.value)}
              placeholder="Host port (optional)"
              type="number"
              min={1}
              max={65535}
              disabled={!canEditWhenStopped}
            />
          </div>
          <button
            type="button"
            className="mt-2 w-full rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
            onClick={onAddAllocation}
            disabled={!canEditWhenStopped || addAllocationPending}
          >
            Add allocation
          </button>

          {/* List */}
          <div className="mt-3 space-y-1.5">
            {allocations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/50 bg-surface-2/30 px-4 py-4 text-center text-[10px] text-muted-foreground">
                No allocations configured
              </div>
            ) : (
              allocations.map((alloc) => (
                <div
                  key={`${alloc.containerPort}-${alloc.hostPort}`}
                  className="flex items-center justify-between rounded-lg border border-border/50 bg-surface-2/50 px-3 py-2 transition-colors hover:border-primary/20 dark:bg-surface-2/30"
                >
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-foreground">{alloc.containerPort}</code>
                    <span className="text-muted-foreground">→</span>
                    <code className="text-xs font-mono text-foreground">{alloc.hostPort}</code>
                    {alloc.isPrimary && (
                      <span className="rounded-full bg-primary-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">Primary</span>
                    )}
                  </div>
                  {!alloc.isPrimary && (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onSetPrimary(alloc.containerPort)}
                        disabled={!canEditWhenStopped || setPrimaryPending}
                        className="rounded border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
                      >
                        Set primary
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveAllocation(alloc.containerPort)}
                        disabled={!canEditWhenStopped || removeAllocationPending}
                        className="rounded border border-danger/30 px-1.5 py-0.5 text-[9px] font-medium text-danger transition-colors hover:border-danger/50 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </ServerTabCard>
      </div>

      {/* ── Crash Recovery — single card ── */}
      <ServerTabCard>
        <SectionHeader icon={RotateCcw} title="Crash Recovery" description="Automatic restart behavior when the server process exits unexpectedly." />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatChip label="Crashes" value={`${crashCount} / ${maxCrashCountValue}`} mono />
          <StatChip label="Policy" value={restartPolicy.replace('-', ' ')} />
          <StatChip label="Last Crash" value={lastCrashAt ? new Date(lastCrashAt).toLocaleString() : 'Never'} />
          <StatChip label="Exit Code" value={lastExitCode !== null && lastExitCode !== undefined ? String(lastExitCode) : '—'} mono />
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Restart Policy</label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all focus:border-primary focus:outline-none"
              value={restartPolicy}
              onChange={(e) => onRestartPolicyChange(e.target.value as 'always' | 'on-failure' | 'never')}
              disabled={isSuspended}
            >
              <option value="always">Always restart</option>
              <option value="on-failure">Restart on failure</option>
              <option value="never">Never restart</option>
            </select>
          </div>
          <div className="min-w-[120px]">
            <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Max Crash Count</label>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all focus:border-primary focus:outline-none"
              type="number"
              min={0}
              max={100}
              value={maxCrashCount}
              onChange={(e) => onMaxCrashCountChange(e.target.value)}
              disabled={isSuspended}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
              onClick={onSaveRestartPolicy}
              disabled={isSuspended || restartPolicyPending}
            >
              Save
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-all hover:border-primary/30 hover:text-foreground disabled:opacity-50"
              onClick={onResetCrashCount}
              disabled={isSuspended || resetCrashCountPending}
            >
              Reset counter
            </button>
          </div>
        </div>
      </ServerTabCard>

      {/* ── Ownership & Suspension — two-column ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Transfer Ownership */}
        <ServerTabCard>
          <SectionHeader icon={UserRoundCog} title="Transfer Ownership" description="Transfer this server to another user." />

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] uppercase tracking-wide text-muted-foreground">New Owner User ID</label>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 font-mono text-xs text-foreground transition-all focus:border-primary focus:outline-none"
                value={newOwnerId}
                onChange={(e) => setNewOwnerId(e.target.value)}
                placeholder="Enter user ID"
                disabled={isSuspended}
              />
            </div>
            <button
              type="button"
              onClick={() => setTransferOwnerConfirm(true)}
              disabled={!newOwnerId.trim() || isSuspended}
              className="rounded-md border border-warning/30 bg-warning px-3 py-2 text-xs font-semibold text-foreground shadow-sm transition-all hover:bg-warning disabled:opacity-50"
            >
              Transfer
            </button>
          </div>

          {server.ownerId && (
            <div className="mt-3 rounded-lg border border-border/50 bg-surface-2/50 px-3 py-2 dark:bg-surface-2/30">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Current Owner</div>
              <div className="mt-0.5 font-mono text-xs text-foreground">{server.ownerId}</div>
            </div>
          )}
        </ServerTabCard>

        {/* Suspension */}
        <ServerTabCard>
          <SectionHeader icon={AlertTriangle} title="Server Suspension" accent="warning" description="Suspend or restore access to this server." />

          {server.status === 'suspended' ? (
            <div className="flex items-center justify-between rounded-lg border border-warning/20 bg-warning/5 p-3">
              <div>
                <div className="text-xs font-medium text-foreground">Server is suspended</div>
                {server.suspensionReason && (
                  <div className="mt-0.5 text-[10px] text-muted-foreground">Reason: {server.suspensionReason}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => onUnsuspend()}
                disabled={unsuspendPending}
                className="shrink-0 rounded-md border border-success/30 bg-success px-3 py-1.5 text-[10px] font-semibold text-foreground shadow-sm transition-all hover:bg-success disabled:opacity-50"
              >
                Unsuspend
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Suspension reason (optional)</label>
                <input
                  className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all focus:border-primary focus:outline-none"
                  value={suspendReason}
                  onChange={(e) => onSuspendReasonChange(e.target.value)}
                  placeholder="Billing, abuse, or admin notes"
                />
              </div>
              <button
                type="button"
                onClick={() => onSuspend(suspendReason.trim() || undefined)}
                disabled={suspendPending}
                className="rounded-md bg-danger px-3 py-2 text-xs font-semibold text-foreground shadow-lg shadow-danger/20 transition-all hover:bg-danger disabled:opacity-50"
              >
                Suspend
              </button>
            </div>
          )}
        </ServerTabCard>
      </div>

      {/* ── Danger Zone ── */}
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-5">
        <SectionHeader icon={Skull} title="Danger Zone" accent="danger" description="These actions are permanent and cannot be undone." />

        <DeleteServerDialog
          serverId={serverId}
          serverName={serverName}
          disabled={!canDelete}
          onDeleted={() => navigate('/servers')}
        />
      </div>

      {/* ── Confirm dialogs ── */}
      <ConfirmAction
        open={rebuildConfirm}
        title="Rebuild Container"
        description="This will stop the server (if running), remove the container, and recreate it from the current image. All server data will be preserved. The server will not automatically start after rebuilding."
        confirmLabel="Rebuild"
        variant="primary"
        pending={rebuildPending}
        onConfirm={handleRebuild}
        onCancel={() => setRebuildConfirm(false)}
      />
      <ConfirmAction
        open={killConfirm}
        title="Force Kill Server"
        description="This will immediately terminate the server process without a graceful shutdown. Players may lose unsaved progress. This cannot be undone."
        confirmLabel="Kill process"
        variant="danger"
        pending={killPending}
        onConfirm={handleKill}
        onCancel={() => setKillConfirm(false)}
      />
      <ConfirmAction
        open={reinstallConfirm}
        title="Reinstall Server"
        description="This will wipe ALL server data and re-run the template install script. World files, configurations, and plugins will be permanently deleted. This cannot be undone."
        confirmLabel="Reinstall"
        variant="warning"
        pending={reinstallPending}
        onConfirm={handleReinstall}
        onCancel={() => setReinstallConfirm(false)}
      />
      <ConfirmAction
        open={transferOwnerConfirm}
        title="Transfer Ownership"
        description={`Transfer ownership of "${serverName}" to user ID "${newOwnerId.trim()}". The new owner will receive full management access. You will retain your current access permissions.`}
        confirmLabel="Transfer ownership"
        variant="warning"
        pending={transferOwnerPending}
        onConfirm={handleTransferOwnership}
        onCancel={() => setTransferOwnerConfirm(false)}
      />
    </div>
  );
}
