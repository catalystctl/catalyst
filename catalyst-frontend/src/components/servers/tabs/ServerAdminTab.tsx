import UpdateServerModal from '../UpdateServerModal';
import TransferServerModal from '../TransferServerModal';
import DeleteServerDialog from '../DeleteServerDialog';
import ServerTabCard from './ServerTabCard';

interface Allocation {
  containerPort: number;
  hostPort: number;
  isPrimary: boolean;
}

interface Props {
  serverId: string;
  serverName: string;
  ownerId: string;
  serverStatus: string;
  isSuspended: boolean;
  suspensionReason?: string;
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

export default function ServerAdminTab({
  serverId,
  serverName,
  ownerId,
  serverStatus,
  isSuspended,
  suspensionReason,
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
  if (!canAdminWrite) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger-muted px-4 py-6 text-danger">
        Admin access required.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Suspension */}
      <ServerTabCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Suspension</div>
            <div className="text-xs text-muted-foreground">
              Suspend or restore access to the server.
            </div>
          </div>
          {serverStatus === 'suspended' ? (
            <button
              type="button"
              className="rounded-md border border-success/30 px-3 py-1 text-xs font-semibold text-success transition-all duration-300 hover:border-success/50 disabled:opacity-60"
              onClick={() => onUnsuspend()}
              disabled={unsuspendPending}
            >
              Unsuspend
            </button>
          ) : null}
        </div>
        {serverStatus !== 'suspended' ? (
          <div className="mt-3 flex flex-wrap items-end gap-3 text-xs">
            <div className="flex-1">
              <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Reason (optional)
              </label>
              <input
                className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                value={suspendReason}
                onChange={(event) => onSuspendReasonChange(event.target.value)}
                placeholder="Billing, abuse, or other admin notes"
              />
            </div>
            <button
              type="button"
              className="rounded-md bg-danger px-3 py-2 font-semibold text-white shadow-lg shadow-danger/20 transition-all duration-300 hover:bg-danger disabled:opacity-60"
              onClick={() =>
                onSuspend(suspendReason.trim() || undefined)
              }
              disabled={suspendPending}
            >
              Suspend
            </button>
          </div>
        ) : null}
      </ServerTabCard>

      {/* Port allocations */}
      <ServerTabCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Port allocations
            </div>
            <div className="text-xs text-muted-foreground">
              Add or remove host-to-container bindings.
            </div>
          </div>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {serverStatus === 'stopped'
              ? 'Stopped'
              : 'Stop server to edit'}
          </span>
        </div>
        {allocationsError ? (
          <div className="mt-3 rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
            {allocationsError}
          </div>
        ) : null}
        <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-2">
          <input
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
            value={newContainerPort}
            onChange={(event) => onNewContainerPortChange(event.target.value)}
            placeholder="Container port"
            type="number"
            min={1}
            max={65535}
            disabled={serverStatus !== 'stopped' || isSuspended}
          />
          <input
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
            value={newHostPort}
            onChange={(event) => onNewHostPortChange(event.target.value)}
            placeholder="Host port (optional)"
            type="number"
            min={1}
            max={65535}
            disabled={serverStatus !== 'stopped' || isSuspended}
          />
          <button
            type="button"
            className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={onAddAllocation}
            disabled={
              serverStatus !== 'stopped' ||
              isSuspended ||
              addAllocationPending
            }
          >
            Add allocation
          </button>
        </div>
        <div className="mt-4 space-y-2 text-xs">
          {allocations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-4 text-center text-muted-foreground/50">
              No allocations configured.
            </div>
          ) : (
            allocations.map((allocation) => (
              <div
                key={`${allocation.containerPort}-${allocation.hostPort}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 transition-all duration-300 hover:border-primary/30"
              >
                <div className="flex items-center gap-3">
                  <span className="text-foreground">
                    {allocation.containerPort} → {allocation.hostPort}
                  </span>
                  {allocation.isPrimary ? (
                    <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                      Primary
                    </span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground disabled:opacity-60"
                    onClick={() => onSetPrimary(allocation.containerPort)}
                    disabled={
                      allocation.isPrimary ||
                      serverStatus !== 'stopped' ||
                      isSuspended ||
                      setPrimaryPending
                    }
                  >
                    Make primary
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-danger/30 px-2 py-1 text-[10px] font-semibold text-danger transition-all duration-300 hover:border-danger/50 disabled:opacity-60"
                    onClick={() =>
                      onRemoveAllocation(allocation.containerPort)
                    }
                    disabled={
                      allocation.isPrimary ||
                      serverStatus !== 'stopped' ||
                      isSuspended ||
                      removeAllocationPending
                    }
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </ServerTabCard>

      {/* Crash recovery */}
      <ServerTabCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">
              Crash recovery
            </div>
            <div className="text-xs text-muted-foreground">
              Configure automatic restart behavior for crashes.
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-2">
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Restart policy
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
              value={restartPolicy}
              onChange={(event) =>
                onRestartPolicyChange(
                  event.target.value as 'always' | 'on-failure' | 'never',
                )
              }
              disabled={isSuspended}
            >
              <option value="always">Always</option>
              <option value="on-failure">On failure</option>
              <option value="never">Never</option>
            </select>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Max crash count
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
              type="number"
              min={0}
              max={100}
              value={maxCrashCount}
              onChange={(event) => onMaxCrashCountChange(event.target.value)}
              disabled={isSuspended}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            className="rounded-md bg-primary-600 px-3 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={onSaveRestartPolicy}
            disabled={isSuspended || restartPolicyPending}
          >
            Save policy
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-2 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground disabled:opacity-60"
            onClick={onResetCrashCount}
            disabled={isSuspended || resetCrashCountPending}
          >
            Reset crash count
          </button>
          <div className="text-[11px] text-muted-foreground">
            Crashes: {crashCount} / {maxCrashCountValue}
            {lastCrashAt
              ? ` · Last crash ${new Date(lastCrashAt).toLocaleString()}`
              : ''}
            {lastExitCode !== null && lastExitCode !== undefined
              ? ` · Exit ${lastExitCode}`
              : ''}
          </div>
        </div>
      </ServerTabCard>

      {/* Resource allocation */}
      <ServerTabCard>
        <div className="text-sm font-semibold text-foreground">
          Resource allocation
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Adjust memory, CPU, disk, or primary IP assignments.
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <UpdateServerModal serverId={serverId} disabled={isSuspended} />
          <TransferServerModal serverId={serverId} disabled={isSuspended} />
        </div>
      </ServerTabCard>

      {/* Danger zone */}
      <div className="rounded-xl border border-danger/30 bg-danger-muted px-4 py-4">
        <div className="text-sm font-semibold text-danger">Danger zone</div>
        <p className="mt-2 text-xs text-danger">
          Deleting the server removes all data and cannot be undone.
        </p>
        <div className="mt-3">
          <DeleteServerDialog
            serverId={serverId}
            serverName={serverName}
            disabled={isSuspended || !canDelete}
          />
        </div>
      </div>
    </div>
  );
}
