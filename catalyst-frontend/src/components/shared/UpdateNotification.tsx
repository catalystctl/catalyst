import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, X, ArrowUpCircle, BellOff, Clock, BellRing, Ban } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
 Dialog,
 DialogBody,
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
import UpdateProgressModal, { consumePostUpdateReloadToast } from '../admin/UpdateProgressModal';

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

type DismissScope = 'session' | 'version' | 'global' | null;

/**
 * Update-available flyout.
 *
 * Only users who are actually allowed to run an update (admin.write) can
 * see it — update checks require that permission server-side anyway, so
 * everyone else would just get 403s and a notification they cannot act on.
 *
 * Positioned under the header on the right edge, offset clear of the
 * breadcrumb row so it never overlaps page content.
 */
export default function UpdateNotification() {
 const { data: updateData } = useUpdateCheck();
 const user = useAuthStore((s) => s.user);
 const [sessionDismissed, setSessionDismissed] = useState(false);
 const [showDismissModal, setShowDismissModal] = useState(false);
 const [showProgressModal, setShowProgressModal] = useState(false);
 const [triggering, setTriggering] = useState(false);

 const hasAdminWrite = user?.permissions?.includes('admin.write') || user?.permissions?.includes('*');
 const canUpdate = hasAdminWrite && updateData?.isDocker;
 const latestVersion = updateData?.latestVersion ?? '';

 // Post-update reload: greet the admin with a completion toast exactly once.
 // This component lives in AppLayout so it re-runs after the auto-reload.
 const reloadedRef = useRef(false);
 useEffect(() => {
   if (reloadedRef.current || !hasAdminWrite) return;
   reloadedRef.current = true;
   if (consumePostUpdateReloadToast()) {
     notifySuccess('Panel update complete — you are now on the latest version.');
   }
 }, [hasAdminWrite]);

 const handleQuickDismiss = useCallback(() => {
 // X button — just dismiss for this session (no modal, no localStorage)
 setSessionDismissed(true);
 }, []);

 const handleOpenModal = useCallback(() => {
 setShowDismissModal(true);
 }, []);

 const handleDismissChoice = useCallback((scope: DismissScope) => {
 setShowDismissModal(false);
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
 setShowProgressModal(true);
 if (!result.success) {
 notifyError(result.message || 'Failed to trigger update');
 }
 } catch (err: any) {
 notifyError(err?.message || 'Failed to trigger update');
 } finally {
 setTriggering(false);
 }
 }, []);

 // Permission gate: no admin.write, no banner at all. Update checks are
 // admin.write-gated server-side, so anyone else would just see a
 // notification they can neither act on nor legitimately query. Kept
 // below all hooks to satisfy the rules of hooks.
 if (!hasAdminWrite) return null;

 const visible =
 canUpdate &&
 updateData?.updateAvailable &&
 !sessionDismissed &&
 !isGloballyDismissed() &&
 !isVersionDismissed(latestVersion);

 return (
 <>
 <AnimatePresence>
 {visible && (
 <motion.div
 initial={{ opacity: 0, y: -16, scale: 0.98 }}
 animate={{ opacity: 1, y: 0, scale: 1 }}
 exit={{ opacity: 0, y: -16, scale: 0.98 }}
 transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
 className="pointer-events-none fixed right-3 top-14 z-40 flex justify-end lg:right-5 lg:top-16"
 >
 <Card className="pointer-events-auto flex w-[min(24rem,calc(100vw-1.5rem))] items-start gap-3 border border-border/70 bg-card px-3 py-2.5 shadow-elevated lg:items-center">
 <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
 <ArrowUpCircle className="h-4 w-4 text-primary" />
 </div>

 <div className="flex min-w-0 flex-1 flex-col">
 <span className="text-sm font-medium leading-tight text-foreground">
 Update available: v{String(updateData.latestVersion).replace(/^v/i, '')}
 </span>
 <span className="mt-0.5 text-xs text-muted-foreground">
 You&apos;re running v{String(updateData.currentVersion).replace(/^v/i, '')}.
 </span>
 </div>

 <div className="flex shrink-0 items-center gap-1.5">
 <Button
 size="sm"
 variant="default"
 className="h-7 gap-1.5 text-xs"
 disabled={triggering}
 onClick={handleTriggerUpdate}
 >
 <RefreshCw className={`h-3.5 w-3.5 ${triggering ? 'animate-spin' : ''}`} />
 <span className="hidden sm:inline">{triggering ? 'Starting…' : 'Update'}</span>
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

 <UpdateProgressModal open={showProgressModal} onClose={() => setShowProgressModal(false)} />

 <Dialog open={showDismissModal} onOpenChange={setShowDismissModal}>
 <DialogContent size="sm">
 <DialogHeader icon={<BellOff className="h-4 w-4" />}>
 <DialogTitle>Dismiss update notification</DialogTitle>
 <DialogDescription>
 Choose how to handle the update banner for version{' '}
 <span className="font-medium text-foreground">v{updateData?.latestVersion}</span>.
 </DialogDescription>
 </DialogHeader>

 <DialogBody className="grid gap-3">
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
 className="flex items-start gap-3 rounded-lg border border-warning/20 bg-warning/5 px-4 py-3 text-left transition-colors hover:bg-warning/10"
 >
 <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-warning/10 text-warning">
 <Ban className="h-3.5 w-3.5" />
 </div>
 <div className="flex flex-col gap-0.5">
 <span className="text-sm font-medium text-foreground">Don&apos;t remind me again</span>
 <span className="text-xs text-muted-foreground">
 Permanently hide all update notifications. Re-enable by clearing site data / localStorage.
 </span>
 </div>
 </button>
 </DialogBody>

 <DialogFooter>
 <Button size="sm" variant="outline" onClick={() => setShowDismissModal(false)}>
 Cancel
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}
