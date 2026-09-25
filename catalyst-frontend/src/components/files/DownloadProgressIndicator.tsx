import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { StatusLed } from '../deck/primitives';
import { useDownloadStore, COMPLETED_DOWNLOAD_TTL_MS } from '../../stores/downloadStore';
import { formatBytes } from '../../utils/formatters';

/**
 * Global download progress indicator.
 *
 * Renders one collapsible widget per tracked download session in the
 * bottom-right corner. Sessions stay visible across page navigation —
 * starting a download no longer leaves the user guessing about progress.
 * Supports canceling in-flight sessions via the store's abort registry.
 */
function DownloadProgressIndicator() {
  const { t } = useTranslation('server-tabs');
  const sessions = useDownloadStore((s) => s.sessions);
  const cancelSession = useDownloadStore((s) => s.cancelSession);
  const dismissSession = useDownloadStore((s) => s.dismissSession);

  // Auto-dismiss terminal sessions after a short delay so the widget
  // doesn't accumulate.
  useEffect(() => {
    const timers = sessions
      .filter((s) => s.status !== 'active')
      .map((s) => {
        const finishedAt = s.finishedAt ?? Date.now();
        const wait = Math.max(COMPLETED_DOWNLOAD_TTL_MS - (Date.now() - finishedAt), 0);
        return window.setTimeout(() => dismissSession(s.id), wait);
      });
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [sessions, dismissSession]);

  if (sessions.length === 0) return null;

  return (
    <div className="pointer-events-none flex flex-col gap-2">
      <AnimatePresence initial={false}>
        {sessions.map((session) => {
          const totals = session.files.reduce(
            (acc, f) => ({
              loaded: acc.loaded + (f.loaded || 0),
              total: acc.total + (f.total || 0),
            }),
            { loaded: 0, total: 0 },
          );
          const doneCount = session.files.filter((f) => f.status === 'done').length;
          const overall =
            totals.total > 0 ? Math.round((totals.loaded / totals.total) * 100) : 0;
          const isActive = session.status === 'active';
          const isCanceled = session.status === 'canceled';
          const hasError = session.status === 'error';
          const title = isCanceled
            ? t('files.download.canceled')
            : hasError
              ? t('files.download.failed')
              : isActive
                ? t('files.download.downloading', {
                    current: doneCount + 1,
                    total: session.files.length,
                  })
                : t('files.download.complete');

          return (
            <motion.div
              key={session.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.96 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="deck-panel pointer-events-auto w-[min(20rem,calc(100vw-2rem))] px-3 py-2"
              role="status"
              aria-live="polite"
              aria-label={`${title} — ${session.files.map((f) => f.name).join(', ')}`}
            >
              <div className="flex items-start gap-2">
                <StatusLed
                  tone={hasError ? 'alarm' : isCanceled ? 'idle' : isActive ? 'info' : 'go'}
                  pulse={isActive}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-mini font-semibold text-foreground">
                      {title}
                    </span>
                    {isActive && totals.total > 0 && (
                      <span className="shrink-0 font-mono text-micro tabular-nums text-info">
                        {overall}%
                      </span>
                    )}
                  </div>
                  <div className="truncate text-micro text-muted-foreground">
                    {session.files.length === 1
                      ? session.files[0].name
                      : t('files.download.fileCount', { count: session.files.length })}
                  </div>
                  {isActive && (
                    <div className="mt-1 h-1 overflow-hidden rounded-sm bg-surface-3">
                      <motion.div
                        className="h-full rounded-sm bg-info"
                        initial={false}
                        animate={{ width: `${overall}%` }}
                        transition={{ duration: 0.2 }}
                      />
                    </div>
                  )}
                  {isActive && totals.total > 0 && (
                    <div className="mt-1 font-mono text-micro tabular-nums text-muted-foreground">
                      {t('files.download.of', {
                        loaded: formatBytes(totals.loaded),
                        total: formatBytes(totals.total),
                      })}
                    </div>
                  )}
                  {hasError && (
                    <div className="mt-0.5 truncate text-micro text-danger">
                      {session.files.find((f) => f.errorMessage)?.errorMessage ??
                        t('files.download.filesFailed')}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-1 hover:text-foreground"
                  aria-label={
                    isActive ? t('files.download.cancel') : t('files.progress.dismiss')
                  }
                  onClick={() =>
                    isActive ? cancelSession(session.id) : dismissSession(session.id)
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default DownloadProgressIndicator;
