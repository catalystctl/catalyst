import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, Download, X, ArrowUpCircle, BellOff, Clock, BellRing, Ban } from 'lucide-react';
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

// ── localStorage keys ──
const LS_DISMISS_VERSION_PREFIX = 'catalyst-update-dismissed-v';
const LS_DISMISS_GLOBAL = 'catalyst-update-dismissed';

function getVersionDismissKey(version: string): string {
  return `${LS_DISMISS_VERSION_PREFIX}${version}`;
}

function isVersionDismissed(version: string): boolean {
  try {
    return localStorage.getItem(getVersionDismissKey(version)) === '1';
  } catch {
    return false;
  }
}

function setVersionDismissed(version: string) {
  try {
    localStorage.setItem(getVersionDismissKey(version), '1');
  } catch {
    // ignore
  }
}

function isGloballyDismissed(): boolean {
  try {
    return localStorage.getItem(LS_DISMISS_GLOBAL) === '1';
  } catch {
    return false;
  }
}

function setGloballyDismissed() {
  try {
    localStorage.setItem(LS_DISMISS_GLOBAL, '1');
  } catch {
    // ignore
  }
}

export function clearGlobalDismissal() {
  try {
    localStorage.removeItem(LS_DISMISS_GLOBAL);
  } catch {
    // ignore
  }
}

export function clearVersionDismissal(version: string) {
  try {
    localStorage.removeItem(getVersionDismissKey(version));
  } catch {
    // ignore
  }
}

type DismissScope = 'session' | 'version' | 'global' | null;

export default function UpdateNotification() {
  const { data: updateData } = useUpdateCheck();
  const user = useAuthStore((s) => s.user);
  const [sessionDismissed, setSessionDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const hasAdminWrite = user?.permissions?.includes('admin.write') || user?.permissions?.includes('*');
  const canUpdate = hasAdminWrite && updateData?.isDocker;
  const latestVersion = updateData?.latestVersion ?? '';

  const visible =
    updateData?.updateAvailable &&
    !sessionDismissed &&
    !isGloballyDismissed() &&
    !isVersionDismissed(latestVersion);

  const handleQuickDismiss = useCallback(() => {
    // X button — just dismiss for this session (no modal, no localStorage)
    setSessionDismissed(true);
  }, []);

  const handleOpenModal = useCallback(() => {
    setShowModal(true);
  }, []);

  const handleDismissChoice = useCallback((scope: DismissScope) => {
    setShowModal(false);
    if (scope === 'session') {
      setSessionDismissed(true);
    } else if (scope === 'version') {
      setVersionDismissed(latestVersion);
    } else if (scope === 'global') {
      setGloballyDismissed();
    }
  }, [latestVersion]);

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
                  onClick={handleQuickDismiss}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  title="Dismiss for now"
                  aria-label="Dismiss update notification"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleOpenModal}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  title="Dismiss options"
                  aria-label="Open dismiss options"
                >
                  <BellOff className="h-3.5 w-3.5" />
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
              Choose how to handle the update banner for version{' '}
              <span className="font-medium text-foreground">v{updateData?.latestVersion}</span>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            {/* 1. Dismiss — just for a bit */}
            <button
              type="button"
              onClick={() => handleDismissChoice('session')}
              className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">Dismiss</span>
                <span className="text-xs text-muted-foreground">
                  Hide for now. The banner will reappear on the next page reload or sign-in.
                </span>
              </div>
            </button>

            {/* 2. Dismiss this update — stored per version */}
            <button
              type="button"
              onClick={() => handleDismissChoice('version')}
              className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
            >
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted-foreground">
                <BellRing className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">Dismiss this update</span>
                <span className="text-xs text-muted-foreground">
                  Remember my choice for v{updateData?.latestVersion}. You&apos;ll be notified again
                  when the next version is released.
                </span>
              </div>
            </button>

            {/* 3. Don't remind me again — global */}
            <button
              type="button"
              onClick={() => handleDismissChoice('global')}
              className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-left transition-colors hover:bg-amber-500/10"
            >
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600">
                <Ban className="h-3.5 w-3.5" />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">Don&apos;t remind me again</span>
                <span className="text-xs text-muted-foreground">
                  Permanently hide all update notifications. Re-enable by clearing site data / localStorage.
                </span>
              </div>
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
