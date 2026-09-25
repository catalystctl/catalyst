import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { RefreshCw, X, ArrowUpCircle, BellOff, Clock, BellRing, Ban } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
import { PANEL_VERSION } from '../../utils/version';
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
 const { t } = useTranslation('common');
 const { data: updateData } = useUpdateCheck();
 const user = useAuthStore((s) => s.user);
 const [sessionDismissed, setSessionDismissed] = useState(false);
 const [showDismissModal, setShowDismissModal] = useState(false);
 const [showProgressModal, setShowProgressModal] = useState(false);
 const [triggering, setTriggering] = useState(false);

 const hasAdminWrite = user?.permissions?.includes('admin.write') || user?.permissions?.includes('*');
 const canUpdate = hasAdminWrite && updateData?.isDocker;
 const latestVersion = updateData?.latestVersion ?? '';

 // Dev preview: `?update=1` forces the flyout, which otherwise cannot appear
 // locally because canUpdate requires a Docker deployment.
 const previewUpdate =
   import.meta.env.DEV &&
   typeof window !== 'undefined' &&
   new URLSearchParams(window.location.search).has('update');

 // Post-update reload: greet the admin with a completion toast exactly once.
 // This component lives in AppLayout so it re-runs after the auto-reload.
 const reloadedRef = useRef(false);
 useEffect(() => {
   if (reloadedRef.current || !hasAdminWrite) return;
   reloadedRef.current = true;
   if (consumePostUpdateReloadToast()) {
     notifySuccess(t('updateNotification.completeToast'));
   }
 }, [hasAdminWrite, t]);

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
 setShowProgressModal(true);
 setTriggering(true);
 try {
 const result = await adminApi.triggerUpdate();
 if (!result.success) {
 notifyError(result.message || t('updateNotification.triggerFailed'));
 }
 } catch (err: any) {
 notifyError(err);
 } finally {
 setTriggering(false);
 }
 }, [t]);

 // Permission gate: no admin.write, no banner at all. Update checks are
 // admin.write-gated server-side, so anyone else would just see a
 // notification they can neither act on nor legitimately query. Kept
 // below all hooks to satisfy the rules of hooks.
 if (!hasAdminWrite) return null;

 const visible =
   (canUpdate || previewUpdate) &&
   (updateData?.updateAvailable || previewUpdate) &&
   (previewUpdate ||
     (!sessionDismissed && !isGloballyDismissed() && !isVersionDismissed(latestVersion)));

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
 <div className="deck-panel pointer-events-auto flex w-[min(24rem,calc(100vw-1.5rem))] items-start gap-3 px-3 py-2.5 shadow-elevated lg:items-center">
 <ArrowUpCircle className="mt-0.5 h-4 w-4 shrink-0 text-primary lg:mt-0" />

 <div className="flex min-w-0 flex-1 flex-col">
 <span className="text-sm font-medium leading-tight text-foreground">
 {t('updateNotification.available', { version: String(updateData?.latestVersion ?? updateData?.currentVersion ?? PANEL_VERSION).replace(/^v/i, '') })}
 </span>
 <span className="type-meta mt-0.5">
 {t('updateNotification.currentVersion', { version: String(updateData?.currentVersion ?? PANEL_VERSION).replace(/^v/i, '') })}
 </span>
 </div>

 <div className="flex shrink-0 items-center gap-1.5">
 <Button
 size="sm"
 variant="default"
 className="h-7 gap-1.5 text-mini"
 disabled={triggering}
 onClick={handleTriggerUpdate}
 >
 <RefreshCw className={`h-3.5 w-3.5 ${triggering ? 'animate-spin' : ''}`} />
 <span className="hidden sm:inline">{triggering ? t('updateNotification.starting') : t('actions.update')}</span>
 </Button>
 <button
 type="button"
 onClick={handleQuickDismiss}
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 title={t('updateNotification.dismissForNow')}
 aria-label={t('updateNotification.dismissTitle')}
 >
 <X className="h-4 w-4" />
 </button>
 <button
 type="button"
 onClick={handleOpenModal}
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 title={t('updateNotification.dismissOptions')}
 aria-label={t('updateNotification.openDismissOptions')}
 >
 <BellOff className="h-3.5 w-3.5" />
 </button>
 </div>
 </div>
 </motion.div>
 )}
 </AnimatePresence>

 <UpdateProgressModal open={showProgressModal} onClose={() => setShowProgressModal(false)} />

 <Dialog open={showDismissModal} onOpenChange={setShowDismissModal}>
 <DialogContent size="sm">
 <DialogHeader icon={<BellOff className="h-4 w-4" />}>
 <DialogTitle>{t('updateNotification.dismissTitle')}</DialogTitle>
 <DialogDescription>
 {t('updateNotification.dismissDescription', {
 version: `v${updateData?.latestVersion}`,
 })}
 </DialogDescription>
 </DialogHeader>

 <DialogBody className="grid gap-3">
 {/* 1. Dismiss — just for a bit */}
 <button
 type="button"
 onClick={() => handleDismissChoice('session')}
 className="flex items-start gap-3 rounded-sm border border-border/60 bg-surface-1/40 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
 >
 <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
 <div className="flex flex-col gap-0.5">
 <span className="text-sm font-medium text-foreground">{t('updateNotification.dismissSessionTitle')}</span>
 <span className="type-meta">
 {t('updateNotification.dismissSessionDescription')}
 </span>
 </div>
 </button>

 {/* 2. Dismiss this update — stored per version */}
 <button
 type="button"
 onClick={() => handleDismissChoice('version')}
 className="flex items-start gap-3 rounded-sm border border-border/60 bg-surface-1/40 px-3 py-2.5 text-left transition-colors hover:bg-surface-2"
 >
 <BellRing className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
 <div className="flex flex-col gap-0.5">
 <span className="text-sm font-medium text-foreground">{t('updateNotification.dismissVersionTitle')}</span>
 <span className="type-meta">
 {t('updateNotification.dismissVersionDescription', {
 version: `v${updateData?.latestVersion}`,
 })}
 </span>
 </div>
 </button>

 {/* 3. Don't remind me again — global */}
 <button
 type="button"
 onClick={() => handleDismissChoice('global')}
 className="flex items-start gap-3 rounded-sm border border-warning/25 bg-warning/5 px-3 py-2.5 text-left transition-colors hover:bg-warning/10"
 >
 <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
 <div className="flex flex-col gap-0.5">
 <span className="text-sm font-medium text-foreground">{t('updateNotification.dismissGlobalTitle')}</span>
 <span className="type-meta">
 {t('updateNotification.dismissGlobalDescription')}
 </span>
 </div>
 </button>
 </DialogBody>

 <DialogFooter>
 <Button size="sm" variant="outline" onClick={() => setShowDismissModal(false)}>
 {t('actions.cancel')}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}
