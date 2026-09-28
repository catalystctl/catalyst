import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAuth } from '../../hooks/useAuth';
import { useEnvRestartStatus, useRestartPanel } from '../../hooks/useAdmin';
import type { PanelRestartStrategy } from '../../types/admin';

const HEALTH_POLL_INTERVAL_MS = 2_000;
const HEALTH_POLL_TIMEOUT_MS = 120_000;

/** API origin without the trailing `/api`, matching services/api/client.ts. */
function apiOrigin(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  if (!raw || raw === '/api') return '';
  return raw.replace(/\/api\/?$/, '');
}

/**
 * Panel-wide prompt shown to admins when an environment change is waiting for a
 * restart. Polls the cheap restart-status endpoint; once the admin confirms,
 * it polls `/health` and reloads the page when the panel is back.
 */
export default function EnvRestartNotice() {
  const { t } = useTranslation('admin-environment');
  const { user } = useAuth();
  const isAdmin = Boolean(
    user?.permissions?.some(
      (permission) => permission === '*' || permission === 'admin.read' || permission === 'admin.write',
    ),
  );

  const { data: status } = useEnvRestartStatus(isAdmin);
  const restartMutation = useRestartPanel();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const pollRef = useRef<number | null>(null);

  const signature = useMemo(
    () => (status?.changedKeys ?? []).slice().sort().join(','),
    [status?.changedKeys],
  );

  useEffect(() => {
    if (!restarting) return;
    const startedAt = Date.now();
    const tick = async () => {
      try {
        // /api/health, not /health: the panel's nginx only proxies /api, so a
        // bare /health would hit the SPA fallback and report "healthy" while
        // the backend is still down.
        const response = await fetch(`${apiOrigin()}/api/health`, { cache: 'no-store' });
        if (response.ok) {
          window.clearInterval(pollRef.current ?? undefined);
          window.location.reload();
          return;
        }
      } catch {
        /* still down */
      }
      if (Date.now() - startedAt > HEALTH_POLL_TIMEOUT_MS) {
        window.clearInterval(pollRef.current ?? undefined);
        setTimedOut(true);
      }
    };
    pollRef.current = window.setInterval(tick, HEALTH_POLL_INTERVAL_MS);
    void tick();
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [restarting]);

  if (!isAdmin || !status?.restartRequired) return null;
  if (dismissedFor === signature) return null;

  const strategy: PanelRestartStrategy = status.strategy;
  const open = true;

  const confirm = () => {
    restartMutation.mutate(undefined, {
      onSuccess: () => setRestarting(true),
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && setDismissedFor(signature)}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{t('restart.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {restarting
              ? timedOut
                ? t('restart.timedOut')
                : t('restart.restartingDescription')
              : strategy === 'standalone'
                ? t('restart.standaloneHint')
                : t('restart.description')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={restarting} onClick={() => setDismissedFor(signature)}>
            {t('restart.later')}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={restarting || restartMutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            {restarting ? t('restart.restarting') : t('restart.button')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
