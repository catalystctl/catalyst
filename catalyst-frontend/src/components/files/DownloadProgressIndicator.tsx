import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Download, X, AlertTriangle } from 'lucide-react';
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
              className="pointer-events-auto w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border/70 bg-card shadow-elevated"
              role="status"
              aria-live="polite"
              aria-label={`${title} — ${session.files.map((f) => f.name).join(', ')}`}
            >
              <div className="flex items-center gap-2.5 px-3 py-2.5">
                <div
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    hasError
                      ? 'bg-danger-muted text-danger'
                      : isCanceled
                        ? 'bg-surface-2 text-muted-foreground'
                        : isActive
                          ? 'bg-primary/10 text-primary'
                          : 'bg-success-muted text-success'
                  }`}
                >
                  {hasError ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : isCanceled ? (
                    <X className="h-4 w-4" />
                  ) : isActive ? (
                    <Download className="h-4 w-4" />
                  ) : (
                    <Check className="h-4 w-4" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-foreground">
                      {title}
                    </span>
                    {isActive && totals.total > 0 && (
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {overall}%
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {session.files.length === 1
                      ? session.files[0].name
                      : t('files.download.fileCount', { count: session.files.length })}
                  </div>
                  {isActive && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <motion.div
                        className={`h-full rounded-full ${hasError ? 'bg-danger' : 'bg-primary'}`}
                        initial={false}
                        animate={{ width: `${overall}%` }}
                        transition={{ duration: 0.2 }}
                      />
                    </div>
                  )}
                  {isActive && totals.total > 0 && (
                    <div className="mt-1 text-[10px] tabular-nums text-muted-foreground">
                      {t('files.download.of', {
                        loaded: formatBytes(totals.loaded),
                        total: formatBytes(totals.total),
                      })}
                    </div>
                  )}
                  {hasError && (
                    <div className="mt-0.5 truncate text-[11px] text-danger">
                      {session.files.find((f) => f.errorMessage)?.errorMessage ??
                        t('files.download.filesFailed')}
                    </div>
                  )}
                </div>

                {isActive ? (
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                    aria-label={t('files.download.cancel')}
                    onClick={() => cancelSession(session.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                    aria-label={t('files.progress.dismiss')}
                    onClick={() => dismissSession(session.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default DownloadProgressIndicator;
