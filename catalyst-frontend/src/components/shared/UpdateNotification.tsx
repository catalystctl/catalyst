import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Download, X, ArrowUpCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import { useAuthStore } from '../../stores/authStore';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';

const DISMISS_KEY = 'catalyst-update-dismissed';
const DISMISS_TTL_MS = 60 * 60 * 1000; // 1 hour

function isDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const timestamp = Number(raw);
    if (Number.isNaN(timestamp)) return false;
    return Date.now() - timestamp < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function setDismissed() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

export default function UpdateNotification() {
  const { data: updateData } = useUpdateCheck();
  const user = useAuthStore((s) => s.user);
  const [dismissed, setDismissedLocal] = useState(() => isDismissed());
  const [triggering, setTriggering] = useState(false);

  const hasAdminWrite = user?.permissions?.includes('admin.write') || user?.permissions?.includes('*');
  const canUpdate = hasAdminWrite && updateData?.isDocker;

  useEffect(() => {
    // Re-check dismissal on mount and when update data changes
    setDismissedLocal(isDismissed());
  }, [updateData?.latestVersion]);

  const handleDismiss = useCallback(() => {
    setDismissed();
    setDismissedLocal(true);
  }, []);

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

  const visible = updateData?.updateAvailable && !dismissed;

  return (
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
                onClick={handleDismiss}
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
  );
}
