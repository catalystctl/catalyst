/**
 * Fleet bulk power bar (audit D9).
 *
 * The fleet list had no selection model, so putting several servers away meant
 * one trip through each row's controls. This bar appears once rows are ticked
 * and drives `adminApi.bulkServerAction` — the wrapper that already existed for
 * `POST /api/admin/servers/actions`.
 *
 * Which ticked servers an action may actually reach is decided by
 * `serverBulk.ts` with the same permission/status rules as the per-row
 * controls; the backend repeats the check, and a mismatched id would fail the
 * whole batch. Stop and Restart ask for confirmation and name the count, since
 * they interrupt players and the backend offers no single-level undo.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@/csync';
import { Play, RotateCw, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { qk } from '@/lib/queryKeys';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getLocalizedErrorMessage } from '../../i18n/api-errors';
import type { Server } from '../../types/server';
import type { AdminServerActionResponse } from '../../types/admin';
import { bulkActionPlan, type BulkServerAction } from './serverBulk';

type Props = {
  /** The ticked servers themselves (not just ids) so eligibility can be judged. */
  selected: Server[];
  onClear: () => void;
};

/** Literal `t()` calls per action: the extractor cannot see a built key. */
const actionLabel = (
  t: (key: 'bulk.actions.start' | 'bulk.actions.stop' | 'bulk.actions.restart') => string,
  action: BulkServerAction,
): string => {
  switch (action) {
    case 'start':
      return t('bulk.actions.start');
    case 'stop':
      return t('bulk.actions.stop');
    case 'restart':
      return t('bulk.actions.restart');
  }
};

const ACTIONS: { action: BulkServerAction; icon: typeof Play; confirm: boolean }[] = [
  { action: 'start', icon: Play, confirm: false },
  { action: 'stop', icon: Square, confirm: true },
  { action: 'restart', icon: RotateCw, confirm: true },
];

function summariseLabels(response: AdminServerActionResponse | undefined): {
  ok: number;
  failed: number;
} {
  const results = response?.results ?? [];
  return {
    ok: results.filter((result) => result.status === 'success').length,
    failed: results.filter((result) => result.status === 'failed').length,
  };
}

export default function ServerBulkBar({ selected, onClear }: Props) {
  const { t } = useTranslation('servers');
  const queryClient = useQueryClient();
  const [pendingConfirm, setPendingConfirm] = useState<BulkServerAction | null>(null);

  const plan = bulkActionPlan(selected);

  const mutation = useMutation({
    mutationFn: (action: BulkServerAction) =>
      adminApi.bulkServerAction({ serverIds: plan[action], action }),
    onSuccess: (response: AdminServerActionResponse, action) => {
      const { ok, failed } = summariseLabels(response);
      if (failed === 0) {
        notifySuccess(t('bulk.done', { count: ok, action: actionLabel(t, action) }));
      } else {
        // Partial success is still worth reporting as an error: some servers
        // did not move, and the operator needs to know which count.
        notifyError(t('bulk.partial', { count: ok, failed }));
      }
      onClear();
    },
    onError: (error) => notifyError(getLocalizedErrorMessage(error)),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.servers() });
      queryClient.invalidateQueries({ queryKey: qk.adminServers() });
      queryClient.invalidateQueries({ queryKey: qk.dashboardStats() });
      queryClient.invalidateQueries({ queryKey: qk.adminStats() });
    },
  });

  if (selected.length === 0) return null;

  const run = (action: BulkServerAction) => {
    const definition = ACTIONS.find((entry) => entry.action === action);
    if (definition?.confirm) {
      setPendingConfirm(action);
      return;
    }
    mutation.mutate(action);
  };

  const confirmTargets = pendingConfirm ? plan[pendingConfirm] : [];

  return (
    <>
      <div
        role="region"
        aria-label={t('bulk.regionLabel')}
        className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-primary/30 bg-primary/5 px-3 py-1.5"
      >
        <span className="text-mini font-medium text-foreground">
          {t('bulk.selected', { count: selected.length })}
        </span>
        <span className="mx-1 h-4 w-px bg-border/60" aria-hidden />
        {ACTIONS.map(({ action, icon: Icon }) => {
          const label = actionLabel(t, action);
          const targets = plan[action];
          return (
            <Button
              key={action}
              size="sm"
              variant="outline"
              className="h-7 rounded-sm px-2 text-mini"
              disabled={targets.length === 0 || mutation.isPending}
              title={targets.length === 0 ? t('bulk.noEligible', { action: label }) : undefined}
              onClick={() => run(action)}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Button>
          );
        })}
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 rounded-sm px-2 text-mini text-muted-foreground"
          onClick={onClear}
        >
          <X className="h-3 w-3" />
          {t('bulk.clear')}
        </Button>
      </div>

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={
          pendingConfirm === 'restart'
            ? t('bulk.restartConfirmTitle', { count: confirmTargets.length })
            : t('bulk.stopConfirmTitle', { count: confirmTargets.length })
        }
        message={
          pendingConfirm === 'restart'
            ? t('bulk.restartConfirmMessage', { count: confirmTargets.length })
            : t('bulk.stopConfirmMessage', { count: confirmTargets.length })
        }
        confirmText={
          pendingConfirm === 'restart' ? t('bulk.actions.restart') : t('bulk.actions.stop')
        }
        cancelText={t('common:actions.cancel')}
        variant="warning"
        loading={mutation.isPending}
        onConfirm={() => {
          const action = pendingConfirm;
          setPendingConfirm(null);
          if (action) mutation.mutate(action);
        }}
        onCancel={() => setPendingConfirm(null)}
      />
    </>
  );
}