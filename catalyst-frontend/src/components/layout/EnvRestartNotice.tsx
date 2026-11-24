import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusLed } from '@/components/deck/primitives';
import { useAuth } from '../../hooks/useAuth';
import { useEnvRestartStatus, useRestartPanel } from '../../hooks/useAdmin';
import type { PanelRestartStrategy } from '../../types/admin';

const HEALTH_POLL_INTERVAL_MS = 2_000;
const HEALTH_POLL_TIMEOUT_MS = 120_000;
/** Remembers "Later" across reloads, but only for the exact pending set. */
const DISMISS_STORAGE_KEY = 'catalyst.env-restart-dismissed';
const MAX_LISTED_KEYS = 5;

/** API origin without the trailing `/api`, matching services/api/client.ts. */
function apiOrigin(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined;
  if (!raw || raw === '/api') return '';
  return raw.replace(/\/api\/?$/, '');
}

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISS_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Panel-wide prompt shown to admins when an environment change is waiting for a
 * restart. Polls the cheap restart-status endpoint; once the admin confirms,
 * it polls `/api/health` and reloads the page when the panel is back.
 *
 * "Later" is remembered for the exact pending set, so a genuine pending change
 * never blocks the panel — it reappears only when a different change is made.
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
  const [dismissedFor, setDismissedFor] = useState<string | null>(readDismissed);
  const [restarting, setRestarting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const pollRef = useRef<number | null>(null);

  const changedKeys = status?.changedKeys ?? [];
  const signature = useMemo(() => changedKeys.slice().sort().join(','), [changedKeys]);

  // Once nothing is pending, forget the dismissal so the same change shows
  // again if it is ever made a second time.
  useEffect(() => {
    if (status && !status.restartRequired) {
      try {
        window.localStorage.removeItem(DISMISS_STORAGE_KEY);
      } catch {
        /* storage unavailable */
      }
    }
  }, [status]);

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

  if (!isAdmin || !status?.restartRequired || changedKeys.length === 0) return null;
  if (dismissedFor === signature) return null;

  const strategy: PanelRestartStrategy = status.strategy;

  const dismiss = () => {
    setDismissedFor(signature);
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, signature);
    } catch {
      /* storage unavailable */
    }
  };

  const listed = changedKeys.slice(0, MAX_LISTED_KEYS).join(', ');
  const pendingLabel =
    changedKeys.length > MAX_LISTED_KEYS
      ? t('restart.pendingKeysTruncated', { keys: listed })
      : t('restart.pendingKeys', { keys: listed });

  const confirm = () => {
    restartMutation.mutate(undefined, {
      onSuccess: () => setRestarting(true),
    });
  };

  return (
    // Non-blocking banner (was a focus-trapping AlertDialog): an environment
    // change waiting for a restart must never hold the panel hostage. "Later"
    // is remembered for the exact pending set, so it returns only for a new
    // change; the restart itself still polls /api/health until the panel is back.
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-3 left-3 right-3 z-40 sm:bottom-6 sm:left-6 sm:right-auto sm:w-[24rem]"
    >
      <div className="deck-panel overflow-hidden border-warning/40 shadow-elevated">
        <div className="flex items-start gap-2.5 border-b border-border/50 bg-warning/10 px-3 py-2.5">
          <StatusLed tone="hazard" className="mt-1" pulse={!restarting} />
          <div className="min-w-0 flex-1">
            <p className="font-display text-mini font-semibold text-foreground">{t('restart.title')}</p>
            <p className="type-meta mt-1">
              {restarting
                ? timedOut
                  ? t('restart.timedOut')
                  : t('restart.restartingDescription')
                : strategy === 'standalone'
                  ? t('restart.standaloneHint')
                  : t('restart.description')}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('common:actions.close')}
            className="relative -mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="px-3 py-2.5">
          {!restarting && (
            <p className="mb-2 line-clamp-3 break-all font-mono text-micro text-muted-foreground">{pendingLabel}</p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" disabled={restarting} onClick={dismiss}>
              {t('restart.later')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={restarting || restartMutation.isPending}
              onClick={confirm}
            >
              {restarting ? <RotateCw className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
              {restarting ? t('restart.restarting') : t('restart.button')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
