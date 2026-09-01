import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@/csync';
import { motion } from 'framer-motion';
import {
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { qk } from '@/lib/queryKeys';
import { adminApi } from '../../services/api/admin';
import { formatRelativeTime } from '../../utils/formatters';

type Phase = 'pulling' | 'restarting' | 'failed';

/** localStorage flag: show a completion toast after the post-update reload. */
const LS_UPDATE_RELOADED = 'catalyst-update-completed-toast';

/** How long to wait in `restarting` before probing the panel again. */
const RESTART_GRACE_MS = 15_000;
/** Probe interval while waiting for the panel to come back. */
const RESTART_PROBE_MS = 3_000;
/** How long the success state stays before the page reloads. */
const SUCCESS_LINGER_MS = 2_500;

export function consumePostUpdateReloadToast(): boolean {
  try {
    if (localStorage.getItem(LS_UPDATE_RELOADED) !== '1') return false;
    localStorage.removeItem(LS_UPDATE_RELOADED);
    return true;
  } catch {
    return false;
  }
}

/**
 * After the backend swaps containers the old process (and this page's
 * queries) are gone — the state endpoint can no longer report completion.
 * Instead, once `restarting` has held for RESTART_GRACE_MS, probe the
 * unauthenticated /api/update/check endpoint until the panel answers;
 * the first response means the new version is up. Reload shortly after.
 */
function usePanelRestartWatch(active: boolean) {
  const [panelBack, setPanelBack] = useState(false);
  useEffect(() => {
    if (!active) return;
    let probeTimer: number | undefined;
    let cancelled = false;
    const graceTimeout = window.setTimeout(() => {
      const probe = () => {
        fetch('/api/update/check', { credentials: 'include' })
          .then((res) => {
            if (!cancelled && res.ok) {
              setPanelBack(true);
            } else if (!cancelled) {
              probeTimer = window.setTimeout(probe, RESTART_PROBE_MS);
            }
          })
          .catch(() => {
            if (!cancelled) probeTimer = window.setTimeout(probe, RESTART_PROBE_MS);
          });
      };
      probe();
    }, RESTART_GRACE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(graceTimeout);
      if (probeTimer) window.clearTimeout(probeTimer);
    };
  }, [active]);
  return panelBack;
}

const PHASE_STEPS: Array<{ phase: Phase; label: string; description: string }> = [
  {
    phase: 'pulling',
    label: 'Downloading update',
    description: 'Pulling the latest images from the registry. Depending on your connection this can take several minutes.',
  },
  {
    phase: 'restarting',
    label: 'Restarting services',
    description: 'Images downloaded. Containers are being recreated — the panel will go down briefly and come back automatically.',
  },
];

function PhaseStep({
  label,
  description,
  status,
}: {
  label: string;
  description: string;
  status: 'done' | 'active' | 'pending' | 'failed';
}) {
  const icon =
    status === 'done' ? (
      <CheckCircle2 className="h-4 w-4 text-success" />
    ) : status === 'active' ? (
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
    ) : status === 'failed' ? (
      <XCircle className="h-4 w-4 text-danger" />
    ) : (
      <span className="h-2 w-2 rounded-full bg-surface-3" />
    );

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">{icon}</div>
      <div className="min-w-0">
        <div
          className={`text-sm font-medium ${
            status === 'pending' ? 'text-muted-foreground' : status === 'failed' ? 'text-danger' : 'text-foreground'
          }`}
        >
          {label}
          {status === 'done' && <span className="ml-2 text-xs font-normal text-success">Done</span>}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
    </div>
  );
}

/**
 * Modal shown while a panel update runs. Polls GET /api/admin/update/state
 * (admin.write only) and renders a step list of what the backend is doing:
 * pulling images → restarting containers. Survives the flyout disappearing;
 * also mounted on the admin System page.
 */
export default function UpdateProgressModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: state } = useQuery({
    queryKey: qk.adminUpdateState(),
    queryFn: adminApi.updateState,
    enabled: open,
    refetchInterval: open ? 3_000 : false,
  });

  const phase = state?.state ?? 'idle';
  const restarting = phase === 'restarting';
  const panelBack = usePanelRestartWatch(open && restarting);

  // When the panel answers again after a restart: persist the completion
  // toast flag, show "Update complete", then reload into the new version.
  const reloadScheduledRef = useRef(false);
  useEffect(() => {
    if (!panelBack || reloadScheduledRef.current) return;
    reloadScheduledRef.current = true;
    try {
      localStorage.setItem(LS_UPDATE_RELOADED, '1');
    } catch {
      // ignore
    }
    const t = window.setTimeout(() => window.location.reload(), SUCCESS_LINGER_MS);
    return () => window.clearTimeout(t);
  }, [panelBack]);

  const prevPhaseRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const current = state?.state;
    if (prevPhaseRef.current && prevPhaseRef.current !== current) {
      // Invalidate the update-check cache so "update available" badges clear
      // as soon as the new version is live (or after a failed attempt).
      queryClient.invalidateQueries({ queryKey: qk.updateCheck() });
      queryClient.invalidateQueries({ queryKey: qk.adminUpdateStatus() });
    }
    prevPhaseRef.current = current;
  }, [state?.state, queryClient]);

  const pullingStatus =
    phase === 'pulling'
      ? 'active'
      : phase === 'restarting'
        ? 'done'
        : phase === 'failed'
          ? 'failed'
          : 'pending';
  const restartingStatus =
    phase === 'restarting' ? 'active' : phase === 'failed' ? 'pending' : 'pending';

  const active =
    phase === 'pulling' || phase === 'restarting' || phase === 'failed';

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && active) return; onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader icon={<ArrowUpCircle className="h-4 w-4 text-primary" />}>
          <DialogTitle>Panel update</DialogTitle>
          <DialogDescription>
            Live progress of the panel update. You can keep working — we&apos;ll keep this open.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {panelBack ? (
            <div className="flex items-center gap-3 rounded-lg border border-success/20 bg-success-muted/30 px-3 py-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
              <div>
                <div className="text-sm font-medium text-foreground">
                  Update complete
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  The panel is back online. Reloading into the new version…
                </div>
              </div>
            </div>
          ) : phase === 'idle' ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-1 px-3 py-2.5 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 shrink-0" />
              Waiting for the update to start…
            </div>
          ) : (
            <motion.div layout className="space-y-4">
              <div className="space-y-4">
                <PhaseStep
                  label={PHASE_STEPS[0].label}
                  description={PHASE_STEPS[0].description}
                  status={pullingStatus}
                />
                {phase !== 'failed' && (
                  <PhaseStep
                    label={PHASE_STEPS[1].label}
                    description={PHASE_STEPS[1].description}
                    status={restartingStatus}
                  />
                )}
              </div>

              {phase === 'failed' && (
                <div className="flex items-start gap-2 rounded-lg border border-danger/20 bg-danger-muted/40 px-3 py-2.5 text-xs text-danger">
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <div className="font-medium">Update failed</div>
                    <div className="mt-0.5 break-words">
                      {state?.message || 'The update could not be completed. Check the System Errors page for details.'}
                    </div>
                  </div>
                </div>
              )}

              {restarting && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2.5 text-xs text-warning">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Containers are restarting. This page will reload
                    automatically as soon as the panel is back (checking every
                    few seconds).
                  </span>
                </div>
              )}

              {state?.startedAt && !panelBack && (
                <div className="text-[11px] text-muted-foreground">
                  Started {formatRelativeTime(state.startedAt)}
                  {state.message && phase === 'pulling' ? ` — ${state.message}` : ''}
                </div>
              )}
            </motion.div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            size="sm"
            variant="outline"
            disabled={active && !panelBack}
            onClick={onClose}
          >
            {active && !panelBack ? 'Update in progress…' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
