import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Download, X, ArrowUpCircle, BellOff } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { useAuthStore } from '../../stores/authStore';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';

const LS_DISMISS_KEY = 'catalyst-update-dismissed';

function isPermanentlyDismissed(): boolean {
  try {
    return localStorage.getItem(LS_DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function setPermanentlyDismissed() {
  try {
    localStorage.setItem(LS_DISMISS_KEY, '1');
  } catch {
    // ignore
  }
}

function clearPermanentDismissal() {
  try {
    localStorage.removeItem(LS_DISMISS_KEY);
  } catch {
    // ignore
  }
}

type DismissScope = 'this' | 'all' | 'permanent' | null;

export default function UpdateNotification() {
  const { data: updateData } = useUpdateCheck();
  const user = useAuthStore((s) => s.user);
  const [sessionDismissVersion, setSessionDismissVersion] = useState<string | null>(null);
  const [sessionDismissAll, setSessionDismissAll] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const hasAdminWrite = user?.permissions?.includes('admin.write') || user?.permissions?.includes('*');
  const canUpdate = hasAdminWrite && updateData?.isDocker;

  const visible =
    updateData?.updateAvailable &&
    !isPermanentlyDismissed() &&
    !sessionDismissAll &&
    sessionDismissVersion !== updateData.latestVersion;

  const handleOpenDismissModal = useCallback(() => {
    setShowModal(true);
  }, []);

  const handleDismissChoice = useCallback((scope: DismissScope) => {
    setShowModal(false);
    if (scope === 'this') {
      setSessionDismissVersion(updateData?.latestVersion ?? null);
    } else if (scope === 'all') {
      setSessionDismissAll(true);
    } else if (scope === 'permanent') {
      setPermanentlyDismissed();
    }
  }, [updateData?.latestVersion]);

  const handleTriggerUpdate = useCallback(async () => {
    setTriggering(true);
    try {
      const result = await adminApi.triggerUpdate();
      if (result.success) {
        notifySuccess(result.message || 'Update triggered successfully');
      } else {
        notifyError(result.message || 'Failed to trigger update');
      }
    } catch (err: any) {
      notifyError(err?.message || 'Failed to trigger update');
    } finally {
      setTriggering(false);
    }
  }, []);

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: -32, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -32, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-0 right-0 top-0 z-[60] flex justify-center px-4 pt-3"
          >
            <Card className="flex w-full max-w-3xl items-center gap-3 border border-primary/20 bg-card/95 px-4 py-3 shadow-lg shadow-primary/10 backdrop-blur-md dark:bg-surface-1/95">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <ArrowUpCircle className="h-4 w-4 text-primary" />
              </div>

              <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2">
                <span className="text-sm font-medium text-foreground">
                  A new version is available
                </span>
                <span className="text-xs text-muted-foreground">
                  v{updateData.latestVersion} is out. You&apos;re running v{updateData.currentVersion}.
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {canUpdate && (
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 gap-1.5 text-xs"
                    disabled={triggering}
                    onClick={handleTriggerUpdate}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Update Now</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => window.location.reload()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <button
                  type="button"
                  onClick={handleOpenDismissModal}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  aria-label="Dismiss update notification"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <BellOff className="h-5 w-5 text-muted-foreground" />
              <DialogTitle>Dismiss update notification</DialogTitle>
            </div>
            <DialogDescription>
              Choose how long to hide the update banner for version{' '}
              <span className="font-medium text-foreground">v{updateData?.latestVersion}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <button
              type="button"
              onClick={() => handleDismissChoice('this')}
              className="flex flex-col items-start gap-0.5 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <span className="text-sm font-medium text-foreground">Dismiss this update</span>
              <span className="text-xs text-muted-foreground">
                Hide until you reload the page or sign back in. The next version will notify you again.
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleDismissChoice('all')}
              className="flex flex-col items-start gap-0.5 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <span className="text-sm font-medium text-foreground">Dismiss all updates</span>
              <span className="text-xs text-muted-foreground">
                Hide all update notifications until you reload the page or sign back in.
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleDismissChoice('permanent')}
              className="flex flex-col items-start gap-0.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left transition-colors hover:bg-amber-500/10"
            >
              <span className="text-sm font-medium text-foreground">Don&apos;t remind me again</span>
              <span className="text-xs text-muted-foreground">
                Permanently hide update notifications. You can re-enable them by clearing site data / localStorage.
              </span>
            </button>
          </div>

          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Utility to let callers clear the permanent dismissal (e.g. admin settings)
export { clearPermanentDismissal };
