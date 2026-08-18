import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient, useMutation, useQuery } from '@/csync';
import { qk } from '../../../lib/queryKeys';
import {
  AlertTriangle,
  BarChart3,
  Container,
  Network,
  RotateCcw,
  Server,
  Shield,
  Skull,
  Star,
  UserRoundCog,
  Zap,
  ChevronDown,
} from 'lucide-react';

import { serversApi } from '../../../services/api/servers';
import Combobox from '@/components/ui/combobox';
import { notifySuccess, notifyError } from '../../../utils/notify';
import { reportSystemError } from '../../../services/api/systemErrors';
import UpdateServerModal from '../UpdateServerModal';
import TransferServerModal from '../TransferServerModal';
import DeleteServerDialog from '../DeleteServerDialog';
import ConfirmDialog from '../../shared/ConfirmDialog';
import ServerTabCard from './ServerTabCard';
import TabHeader from './TabHeader';
import TabEmptyState from './TabEmptyState';
import SectionHeader from './SectionHeader';
import DataField from './DataField';
import SettingsRow from './SettingsRow';


// ── Types ──

interface Allocation {
 containerPort: number;
 hostPort: number;
 isPrimary: boolean;
 allocationId?: string | null;
 ip?: string | null;
 alias?: string | null;
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
 owner?: {
 id: string;
 username?: string | null;
 email?: string | null;
 name?: string | null;
 } | null;
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
 availableNodeAllocations: Array<{
 id: string;
 ip: string;
 port: number;
 alias?: string | null;
 }>;
 availableNodeAllocationsError: string | null;
 selectedAllocationId: string;
 onSelectedAllocationIdChange: (id: string) => void;
 newContainerPort: string;
 onNewContainerPortChange: (port: string) => void;
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
 availableNodeAllocations,
 availableNodeAllocationsError,
 selectedAllocationId,
 onSelectedAllocationIdChange,
 newContainerPort,
 onNewContainerPortChange,
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
 // Defensive: parent may pass non-array from cache/API shape mismatches.
 const safeAllocations = Array.isArray(allocations) ? allocations : [];
 const safeAvailableNodeAllocations = Array.isArray(availableNodeAllocations)
 ? availableNodeAllocations
 : [];
 // ── State ──
 const [rebuildConfirm, setRebuildConfirm] = useState(false);
 const [killConfirm, setKillConfirm] = useState(false);
 const [reinstallConfirm, setReinstallConfirm] = useState(false);
 const [rebuildPending, setRebuildPending] = useState(false);
 const [killPending, setKillPending] = useState(false);
 const [reinstallPending, setReinstallPending] = useState(false);
 const [newOwnerId, setNewOwnerId] = useState('');
 const [newOwnerLabel, setNewOwnerLabel] = useState('');
 const [ownerSearch, setOwnerSearch] = useState('');
 const [debouncedOwnerSearch, setDebouncedOwnerSearch] = useState('');
 const [transferOwnerPending, setTransferOwnerPending] = useState(false);
 const [transferOwnerConfirm, setTransferOwnerConfirm] = useState(false);
 const [envExpanded, setEnvExpanded] = useState(false);
 const [removeAllocationConfirm, setRemoveAllocationConfirm] = useState<{ open: boolean; containerPort: number | null }>({ open: false, containerPort: null });
 const [removeAllocationHotPending, setRemoveAllocationHotPending] = useState(false);
 const [imageVariantPending, setImageVariantPending] = useState(false);
 const [imageVariantConfirm, setImageVariantConfirm] = useState<{ open: boolean; variantName: string; label: string; image: string } | null>(null);
 const queryClient = useQueryClient();
 const navigate = useNavigate();

 // Transfer ownership candidates (owner or admin.write)
 useEffect(() => {
 const t = window.setTimeout(() => setDebouncedOwnerSearch(ownerSearch.trim()), 250);
 return () => window.clearTimeout(t);
 }, [ownerSearch]);

 const transferCandidatesQuery = useQuery({
 queryKey: ['servers', serverId, 'transfer-candidates', debouncedOwnerSearch] as const,
 queryFn: () =>
 serversApi.transferCandidates(serverId, {
 search: debouncedOwnerSearch || undefined,
 limit: 50,
 }),
 enabled: Boolean(serverId) && canAdminWrite && !isSuspended,
 staleTime: 30_000,
 });
 const transferCandidates = Array.isArray(transferCandidatesQuery.data)
 ? transferCandidatesQuery.data
 : [];

 const transferUserOptions = useMemo(() => {
 const toOption = (u: {
 id: string;
 username?: string | null;
 email?: string | null;
 name?: string | null;
 }) => ({
 value: u.id,
 label: (
 <div className="flex min-w-0 items-center gap-2">
 <span className="truncate font-medium">{u.username || u.email}</span>
 {u.username ? (
 <span className="truncate text-muted-foreground">({u.email})</span>
 ) : null}
 </div>
 ),
 keywords: [u.username || '', u.email || '', u.name || '', u.id],
 });

 const options = transferCandidates
 .filter((u) => u.id !== server.ownerId)
 .map(toOption);

 // Keep the currently selected owner visible even if a new search excludes them.
 if (
 newOwnerId &&
 !options.some((o) => o.value === newOwnerId) &&
 newOwnerLabel
 ) {
 options.unshift({
 value: newOwnerId,
 label: (
 <div className="flex min-w-0 items-center gap-2">
 <span className="truncate font-medium">{newOwnerLabel}</span>
 </div>
 ),
 keywords: [newOwnerLabel, newOwnerId],
 });
 }
 return options;
 }, [transferCandidates, server.ownerId, newOwnerId, newOwnerLabel]);

 const currentOwnerDisplay = useMemo(() => {
 const owner = server.owner;
 if (owner?.username || owner?.email) {
 const primary = owner.username || owner.email || owner.id;
 const secondary =
 owner.username && owner.email ? owner.email : owner.name || null;
 return { primary, secondary, id: owner.id || server.ownerId };
 }
 if (server.ownerId) {
 return { primary: server.ownerId, secondary: null as string | null, id: server.ownerId };
 }
 return null;
 }, [server.owner, server.ownerId]);

 // ── Environment variables state ──
 // Seed from server.environment on first render — the prev-ref sync below only
 // runs on *changes*, so without this the editor stays empty while the count badge
 // still shows Object.keys(server.environment).length.
 const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>(() => {
 const env = server?.environment;
 if (!env || typeof env !== 'object') return [];
 const entries = Object.entries(env).map(([key, value]) => ({
 key,
 value: String(value ?? ''),
 }));
 return entries;
 });
 const [envDirty, setEnvDirty] = useState(false);

 const prevEnvRef = useRef(server?.environment);
 if (server?.environment !== prevEnvRef.current) {
 prevEnvRef.current = server?.environment;
 // Don't clobber in-progress edits if the user has dirty local state.
 if (envDirty) {
 // still advance the ref so we don't loop; next clean load will pick up server values
 } else if (!server?.environment || typeof server.environment !== 'object') {
 setEnvVars([]);
 setEnvDirty(false);
 } else {
 const entries = Object.entries(server.environment).map(([key, value]) => ({
 key,
 value: String(value ?? ''),
 }));
 setEnvVars(entries);
 setEnvDirty(false);
 }
 }

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
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
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

 // When IMAGE_VARIANT is unset, treat the template default (or current image match) as active.
 const activeVariantName = (() => {
 if (currentImageVariant) return currentImageVariant;
 const byImage = templateImages.find((img) => img.image === currentResolvedImage);
 if (byImage) return byImage.name;
 const byDefault = templateImages.find(
 (img) => img.image === (server.template?.defaultImage ?? server.template?.image),
 );
 return byDefault?.name ?? '';
 })();

 const canEdit = !isSuspended && server.status !== 'archived';
 const canEditWhenStopped =
 canEdit && (server.status === 'stopped' || server.status === 'crashed' || server.status === 'error');
 const canEditAllocations =
 canEdit && (server.status === 'stopped' || server.status === 'running' || server.status === 'crashed' || server.status === 'error');
 const isRunning = server.status === 'running';

 // ── Handlers ──
 const handleRebuild = useCallback(async () => {
 try {
 setRebuildPending(true);
 await serversApi.rebuild(serverId);
 notifySuccess('Container rebuild initiated');
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
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 queryClient.invalidateQueries({ queryKey: qk.tasks(serverId) });
 }
 }, [serverId]);

 const handleChangeImageVariant = useCallback(async () => {
 if (!imageVariantConfirm) return;
 const variantName = imageVariantConfirm.variantName;
 try {
 setImageVariantPending(true);
 const nextEnv: Record<string, string> = { ...(server.environment ?? {}) };
 if (variantName) {
 nextEnv.IMAGE_VARIANT = variantName;
 } else {
 delete nextEnv.IMAGE_VARIANT;
 }
 // Drop stale resolved image so backend re-resolves from the new variant.
 delete nextEnv.TEMPLATE_IMAGE;
 await serversApi.update(serverId, { environment: nextEnv });
 await serversApi.rebuild(serverId);
 notifySuccess(
 variantName
 ? `Switched to ${imageVariantConfirm.label} and started rebuild`
 : 'Reset to default image and started rebuild',
 );
 setImageVariantConfirm(null);
 } catch (err: unknown) {
 reportSystemError({
 level: 'error',
 component: 'ServerAdminTab',
 message: err instanceof Error ? err.message : String(err),
 stack: err instanceof Error ? err.stack : undefined,
 metadata: { context: 'change image variant' },
 });
 notifyError(err instanceof Error ? err.message : 'Failed to change image variant');
 } finally {
 setImageVariantPending(false);
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 queryClient.invalidateQueries({ queryKey: qk.tasks(serverId) });
 }
 }, [imageVariantConfirm, server.environment, serverId, queryClient]);

 const handleKill = useCallback(async () => {
 try {
 setKillPending(true);
 await serversApi.kill(serverId);
 notifySuccess('Server process killed');
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
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 }
 }, [serverId]);

 const handleReinstall = useCallback(async () => {
 try {
 setReinstallPending(true);
 await serversApi.install(serverId);
 notifySuccess('Reinstall initiated');
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
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 }
 }, [serverId]);

 const handleTransferOwnership = useCallback(async () => {
 try {
 setTransferOwnerPending(true);
 await serversApi.transferOwnership(serverId, { newOwnerId: newOwnerId.trim() });
 notifySuccess('Ownership transferred');
 setNewOwnerId('');
 setNewOwnerLabel('');
 setOwnerSearch('');
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
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 queryClient.invalidateQueries({ queryKey: qk.serverPermissions(serverId) });
 }
 }, [serverId, newOwnerId, queryClient]);

 // ── Hot-remove allocation handler ──
 const handleRemoveAllocation = useCallback((containerPort: number) => {
 if (isRunning) {
 setRemoveAllocationConfirm({ open: true, containerPort });
 } else {
 onRemoveAllocation(containerPort);
 }
 }, [isRunning, onRemoveAllocation]);

 const confirmRemoveAllocation = useCallback(() => {
 if (removeAllocationConfirm.containerPort != null) {
 setRemoveAllocationHotPending(true);
 onRemoveAllocation(removeAllocationConfirm.containerPort);
 setRemoveAllocationConfirm({ open: false, containerPort: null });
 setRemoveAllocationHotPending(false);
 }
 }, [removeAllocationConfirm.containerPort, onRemoveAllocation]);

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
 {/* ── Tab Header ── */}
 <TabHeader
 icon={Shield}
 title="Administration"
 description="Server info, container management, resources, and danger zone actions."
 />

      <ServerTabCard>
        <SectionHeader icon={Server} title="Identity" />
        <DataField label="Server ID" value={server.id} copyable />
        <DataField label="Node" value={server.node?.name ?? server.nodeName ?? server.nodeId} copyable />
        <DataField label="Template" value={server.template?.name ?? server.templateId ?? '—'} copyable />
        <DataField label="Primary port" value={String(server.primaryPort ?? '—')} copyable />
        <DataField label="Connection" value={`${server.connection?.host ?? '—'}:${server.connection?.port ?? '—'}`} copyable />
        <DataField label="Network" value={server.networkMode ?? 'bridge'} copyable />


        <button
          type="button"
          className="mt-3 flex w-full items-center justify-between py-2 text-sm"
          onClick={() => setEnvExpanded(!envExpanded)}
        >
          <span className="text-sm font-medium text-foreground">
            Environment
            <span className="ml-2 type-meta">({Object.keys(server.environment ?? {}).length})</span>
          </span>
          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${envExpanded ? 'rotate-180' : ''}`} />
        </button>
        {envExpanded && (
          <div className="mt-2 space-y-2">
            {canAdminWrite ? (
              <>
                {envVars.length === 0 && (
                  <p className="type-meta py-2">No environment variables.</p>
                )}
                {envVars.map((row, idx) => (
                  <div key={idx} className="group flex items-center gap-2">
                    <input
                      className="w-[130px] shrink-0 rounded-md border border-border/40 bg-card px-2.5 py-1.5 font-mono text-[11px] uppercase text-foreground focus:border-primary focus:outline-none"
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
                    <span className="text-[10px] text-muted-foreground">=</span>
                    <input
                      className="min-w-0 flex-1 rounded-md border border-border/40 bg-card px-2.5 py-1.5 font-mono text-[11px] text-foreground focus:border-primary focus:outline-none"
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
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-danger"
                      onClick={() => {
                        setEnvVars(envVars.filter((_, i) => i !== idx));
                        setEnvDirty(true);
                      }}
                      disabled={isSuspended}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground"
                    onClick={() => {
                      setEnvVars([...envVars, { key: '', value: '' }]);
                      setEnvDirty(true);
                    }}
                    disabled={isSuspended}
                  >
                    Add
                  </button>
                  {envDirty && (
                    <button
                      type="button"
                      className="rounded-md bg-primary px-3 py-1 text-[10px] font-semibold text-primary-foreground disabled:opacity-50"
                      onClick={() => envMutation.mutate()}
                      disabled={isSuspended || envMutation.isPending}
                    >
                      {envMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div>
                {server.environment && Object.keys(server.environment).length > 0 ? (
                  Object.entries(server.environment).map(([key, value]) => (
                    <DataField key={key} label={key} value={String(value)} />
                  ))
                ) : (
                  <p className="type-meta py-2">No environment variables.</p>
                )}
              </div>
            )}
          </div>
        )}
      </ServerTabCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ServerTabCard>
          <SectionHeader icon={Container} title="Image" />
          <DataField label="Image" value={currentResolvedImage} copyable />
          {(currentImageVariant || activeVariantName) && (
            <DataField
              label="Variant"
              value={
                currentImageLabel !== 'Default'
                  ? currentImageLabel
                  : (templateImages.find((img) => img.name === activeVariantName)?.label ??
                    templateImages.find((img) => img.name === activeVariantName)?.name ??
                    'Default')
              }
            />
          )}
          {templateImages.length > 0 && (
            <div className="mt-2 space-y-1">
              {templateImages.map((img) => {
                const isActive = img.name === activeVariantName;
                return (
                  <button
                    type="button"
                    key={img.name}
                    disabled={!canEdit || imageVariantPending || isActive}
                    onClick={() =>
                      setImageVariantConfirm({
                        open: true,
                        variantName: img.name,
                        label: img.label ?? img.name,
                        image: img.image,
                      })
                    }
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left ${
                      isActive ? 'bg-primary/5' : 'hover:bg-surface-2'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">{img.label ?? img.name}</div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">{img.image}</div>
                    </div>
                    {isActive ? (
                      <span className="type-meta">Active</span>
                    ) : canEdit ? (
                      <span className="text-[10px] text-primary">Use</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </ServerTabCard>


        <ServerTabCard>
          <SectionHeader icon={Zap} title="Container" />
          <SettingsRow label="Rebuild" description="Recreate from the current image. Data is kept.">
            <button
              type="button"
              onClick={() => setRebuildConfirm(true)}
              disabled={!canEdit}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50"
            >
              Rebuild
            </button>
          </SettingsRow>
          <SettingsRow label="Reinstall" description="Wipe files and re-run the install script.">
            <button
              type="button"
              onClick={() => setReinstallConfirm(true)}
              disabled={!canEditWhenStopped}
              className="rounded-md border border-warning/30 px-3 py-1.5 text-xs font-semibold text-warning disabled:opacity-50"
            >
              Reinstall
            </button>
          </SettingsRow>
          <SettingsRow label="Force kill" description="Immediate terminate. No graceful shutdown.">
            <button
              type="button"
              onClick={() => setKillConfirm(true)}
              disabled={server.status !== 'running' && server.status !== 'starting' && server.status !== 'stopping'}
              className="rounded-md bg-danger px-3 py-1.5 text-xs font-semibold text-danger-foreground disabled:opacity-50"
            >
              Kill
            </button>
          </SettingsRow>
        </ServerTabCard>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ServerTabCard>
          <SectionHeader icon={BarChart3} title="Resources" />
          <DataField label="Memory" value={`${server.allocatedMemoryMb ?? 0} MB`} />
          <DataField label="CPU" value={`${server.allocatedCpuCores ?? 0} cores`} />
          <DataField label="Disk" value={`${server.allocatedDiskMb ?? 0} MB`} />
          <DataField label="Swap" value={`${server.allocatedSwapMb ?? 0} MB`} />
          <div className="mt-3 flex flex-wrap gap-2">
            <UpdateServerModal serverId={serverId} disabled={isSuspended} />
            <TransferServerModal serverId={serverId} disabled={isSuspended} />
          </div>
        </ServerTabCard>

        <ServerTabCard>
          <SectionHeader icon={Network} title="Ports" />
          {allocationsError && (
            <div className="mb-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-xs text-danger">
              {allocationsError}
            </div>
          )}


 {/* Add form — node allocation dropdown (same pattern as create server) */}
 <div className="space-y-2">
 <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] text-xs">
 <select
 className="rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-all focus:border-primary focus:outline-none disabled:opacity-50"
 value={selectedAllocationId}
 onChange={(e) => {
 const nextId = e.target.value;
 onSelectedAllocationIdChange(nextId);
 const selected = safeAvailableNodeAllocations.find((a) => a.id === nextId);
 if (selected) {
 onNewContainerPortChange(String(selected.port));
 }
 }}
 disabled={!canEditAllocations}
 >
 <option value="">Select allocation</option>
 {safeAvailableNodeAllocations
 .filter((a) => !safeAllocations.some((alloc) => alloc.hostPort === a.port && alloc.ip === a.ip))
 .map((allocation) => (
 <option key={allocation.id} value={allocation.id}>
 {allocation.ip}:{allocation.port}
 {allocation.alias ? ` (${allocation.alias})` : ''}
 </option>
 ))}
 </select>
 <input
 className="rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-all focus:border-primary focus:outline-none sm:w-28"
 value={newContainerPort}
 onChange={(e) => onNewContainerPortChange(e.target.value)}
 placeholder="Container port"
 type="number"
 min={1}
 max={65535}
 disabled={!canEditAllocations}
 />
 </div>
 {availableNodeAllocationsError ? (
 <p className="text-[10px] text-warning">{availableNodeAllocationsError}</p>
 ) : null}
 {!availableNodeAllocationsError && safeAvailableNodeAllocations.length === 0 ? (
 <p className="text-[10px] text-muted-foreground">
 No free node allocations.
 {server.nodeId ? (
 <>
 {' '}
 <a
 href={`/admin/nodes/${server.nodeId}/allocations`}
 target="_blank"
 rel="noopener noreferrer"
 className="font-medium text-primary hover:underline"
 >
 Create one →
 </a>
 </>
 ) : null}
 </p>
 ) : null}
 <button
 type="button"
 className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
 onClick={onAddAllocation}
 disabled={!canEditAllocations || addAllocationPending || !selectedAllocationId}
 >
 Add allocation
 </button>
 </div>

 {/* List */}
 <div className="mt-3 space-y-1.5">
 {safeAllocations.length === 0 ? (
 <TabEmptyState
 title="No allocations configured"
 description="Add a port binding to make the server reachable."
 />
 ) : (
 safeAllocations.map((alloc) => (
 <div
 key={`${alloc.containerPort}-${alloc.hostPort}-${alloc.allocationId ?? 'legacy'}`}
 className={`group relative flex items-center justify-between rounded-lg border px-3 py-2 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02] ${
 alloc.isPrimary
 ? 'border-primary/30 bg-primary/5'
 : 'border-border/30 bg-surface-2/20'
 }`}
 >
 <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />
 <div className="flex min-w-0 flex-wrap items-center gap-2">
 {alloc.isPrimary ? (
 <Star className="h-3 w-3 shrink-0 fill-primary text-primary" />
 ) : (
 <div className="h-3 w-3 shrink-0 rounded-full border border-muted-foreground/30" />
 )}
 <code className="text-xs font-mono text-foreground">
 {alloc.ip ? `${alloc.ip}:` : ''}
 {alloc.hostPort}
 </code>
 <span className="text-muted-foreground">→</span>
 <code className="text-xs font-mono text-foreground">{alloc.containerPort}</code>
 {alloc.alias ? (
 <span className="truncate text-[10px] text-muted-foreground">({alloc.alias})</span>
 ) : null}
 {alloc.isPrimary && (
 <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">Primary</span>
 )}
 {!alloc.isPrimary && (
 <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Secondary</span>
 )}
 </div>
 {!alloc.isPrimary && (
 <div className="flex shrink-0 items-center gap-1.5">
 <button
 type="button"
 onClick={() => onSetPrimary(alloc.containerPort)}
 disabled={!canEditAllocations || setPrimaryPending}
 className="rounded border border-border px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-50"
 >
 Set primary
 </button>
 <button
 type="button"
 onClick={() => handleRemoveAllocation(alloc.containerPort)}
 disabled={!canEditAllocations || removeAllocationPending || removeAllocationHotPending}
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

 {/* ── Crash Recovery ── */}
      <ServerTabCard>
        <SectionHeader icon={RotateCcw} title="Crash recovery" />
        <DataField label="Crashes" value={`${crashCount} / ${maxCrashCountValue}`} />
        <DataField label="Policy" value={restartPolicy.replace('-', ' ')} />
        <DataField label="Last crash" value={lastCrashAt ? new Date(lastCrashAt).toLocaleString() : 'Never'} />
        <DataField label="Exit code" value={lastExitCode !== null && lastExitCode !== undefined ? String(lastExitCode) : '—'} />
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[160px] flex-1">
            <label className="type-overline">Restart policy</label>
            <select
              className="mt-1 w-full rounded-md border border-border/40 bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
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
            <label className="type-overline">Max crashes</label>
            <input
              className="mt-1 w-full rounded-md border border-border/40 bg-card px-3 py-2 text-xs text-foreground focus:border-primary focus:outline-none"
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
              className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
              onClick={onSaveRestartPolicy}
              disabled={isSuspended || restartPolicyPending}
            >
              Save
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground disabled:opacity-50"
              onClick={onResetCrashCount}
              disabled={isSuspended || resetCrashCountPending}
            >
              Reset
            </button>
          </div>
        </div>
      </ServerTabCard>


 {/* ── Ownership & Suspension — two-column ── */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
 {/* Transfer Ownership */}
 <ServerTabCard>
 <SectionHeader icon={UserRoundCog} title="Transfer Ownership" description="Transfer this server to another user." />

 <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
 <div className="min-w-0 flex-1">
 <label className="text-[10px] uppercase tracking-wide text-muted-foreground">New owner</label>
 <div className="mt-1">
 <Combobox
 value={newOwnerId}
 onChange={(id) => {
 setNewOwnerId(id);
 const match = transferCandidates.find((u) => u.id === id);
 setNewOwnerLabel(
 match
 ? match.username
 ? `${match.username} (${match.email})`
 : match.email
 : id,
 );
 }}
 options={transferUserOptions}
 searchValue={ownerSearch}
 onSearchChange={setOwnerSearch}
 placeholder={
 transferCandidatesQuery.isLoading
 ? 'Loading users...'
 : 'Search by username or email...'
 }
 searchPlaceholder="Search username or email..."
 emptyMessage={
 transferCandidatesQuery.isLoading
 ? 'Searching…'
 : 'No users found.'
 }
 className="w-full"
 />
 </div>
 {transferCandidatesQuery.isError ? (
 <p className="mt-1 text-[10px] text-warning">
 Unable to load users. You may not have permission to search accounts.
 </p>
 ) : null}
 </div>
 <button
 type="button"
 onClick={() => setTransferOwnerConfirm(true)}
 disabled={!newOwnerId.trim() || isSuspended || newOwnerId === server.ownerId}
 className="rounded-md border border-warning/30 bg-warning px-3 py-2 text-xs font-semibold text-foreground transition-all hover:bg-warning disabled:opacity-50"
 >
 Transfer
 </button>
 </div>

 {currentOwnerDisplay && (
 <div className="mt-3 rounded-lg border border-border/30 bg-surface-2/20 px-3 py-2">
 <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Current Owner</div>
 <div className="mt-0.5 text-xs font-medium text-foreground">{currentOwnerDisplay.primary}</div>
 {currentOwnerDisplay.secondary ? (
 <div className="mt-0.5 text-[10px] text-muted-foreground">{currentOwnerDisplay.secondary}</div>
 ) : null}
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
 className="shrink-0 rounded-md border border-success/30 bg-success px-3 py-1.5 text-[10px] font-semibold text-foreground transition-all hover:bg-success disabled:opacity-50"
 >
 Unsuspend
 </button>
 </div>
 ) : (
 <div className="flex flex-wrap items-end gap-3">
 <div className="flex-1 min-w-[200px]">
 <label className="text-[10px] uppercase tracking-wide text-muted-foreground">Suspension reason (optional)</label>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-all focus:border-primary focus:outline-none"
 value={suspendReason}
 onChange={(e) => onSuspendReasonChange(e.target.value)}
 placeholder="Billing, abuse, or admin notes"
 />
 </div>
 <button
 type="button"
 onClick={() => onSuspend(suspendReason.trim() || undefined)}
 disabled={suspendPending}
 className="rounded-md bg-danger px-3 py-2 text-xs font-semibold text-foreground transition-all hover:bg-danger disabled:opacity-50"
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
 <ConfirmDialog
 open={rebuildConfirm}
 title="Rebuild container"
 message="This will stop the server if it is running, remove the container, and recreate it from the current image. Server data is preserved. The server will not start automatically after rebuilding."
 confirmText="Rebuild"
 variant="default"
 loading={rebuildPending}
 onConfirm={handleRebuild}
 onCancel={() => setRebuildConfirm(false)}
 />
 <ConfirmDialog
 open={Boolean(imageVariantConfirm?.open)}
 title="Change container image"
 message={
 imageVariantConfirm
 ? `Switch to "${imageVariantConfirm.label}" (${imageVariantConfirm.image})? This updates IMAGE_VARIANT and rebuilds the container. Server data is preserved; the server will not start automatically after rebuilding.`
 : ''
 }
 confirmText="Change and rebuild"
 variant="default"
 loading={imageVariantPending}
 onConfirm={handleChangeImageVariant}
 onCancel={() => setImageVariantConfirm(null)}
 />
 <ConfirmDialog
 open={killConfirm}
 title="Force kill server"
 message="This will immediately terminate the server process without a graceful shutdown. Players may lose unsaved progress. This cannot be undone."
 confirmText="Kill process"
 variant="danger"
 loading={killPending}
 onConfirm={handleKill}
 onCancel={() => setKillConfirm(false)}
 />
 <ConfirmDialog
 open={reinstallConfirm}
 title="Reinstall server"
 message="This will wipe all server data and re-run the template install script. World files, configurations, and plugins will be permanently deleted. This cannot be undone."
 confirmText="Reinstall"
 variant="warning"
 loading={reinstallPending}
 onConfirm={handleReinstall}
 onCancel={() => setReinstallConfirm(false)}
 />
 <ConfirmDialog
 open={transferOwnerConfirm}
 title="Transfer ownership"
 message={`Transfer ownership of "${serverName}" to ${newOwnerLabel || newOwnerId.trim()}. The new owner will receive full management access. You will retain your current access permissions.`}
 confirmText="Transfer ownership"
 variant="warning"
 loading={transferOwnerPending}
 onConfirm={handleTransferOwnership}
 onCancel={() => setTransferOwnerConfirm(false)}
 />
 <ConfirmDialog
 open={removeAllocationConfirm.open}
 title="Remove allocation from running server"
 message="This server is currently running. Removing an allocation will immediately close the firewall rule for this port, making it unreachable. Players connected through this port will be disconnected."
 confirmText="Remove allocation"
 variant="danger"
 loading={removeAllocationHotPending}
 onConfirm={confirmRemoveAllocation}
 onCancel={() => setRemoveAllocationConfirm({ open: false, containerPort: null })}
 />
 </div>
 );
}
