import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@/csync';
import { motion } from 'framer-motion';
import {
  ArrowUpCircle,
  CheckCircle2,
  Download,
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

  const prevPhaseRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const phase = state?.state;
    if (prevPhaseRef.current && prevPhaseRef.current !== phase) {
      // Invalidate the update-check cache so "update available" badges clear
      // as soon as the new version is live (or after a failed attempt).
      queryClient.invalidateQueries({ queryKey: qk.updateCheck() });
      queryClient.invalidateQueries({ queryKey: qk.adminUpdateStatus() });
    }
    prevPhaseRef.current = phase;
  }, [state?.state, queryClient]);

  const phase = state?.state ?? 'idle';
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
          {phase === 'idle' ? (
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

              {phase === 'restarting' && (
                <div className="flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2.5 text-xs text-warning">
                  <Download className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    The panel will be briefly unavailable while containers are
                    recreated. Refresh the page once it comes back to load the
                    new version.
                  </span>
                </div>
              )}

              {state?.startedAt && (
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
            disabled={phase === 'pulling' || phase === 'restarting'}
            onClick={onClose}
          >
            {phase === 'pulling' || phase === 'restarting' ? 'Update in progress…' : 'Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
