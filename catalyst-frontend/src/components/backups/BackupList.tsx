import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, HardDrive, Loader2, Pin } from 'lucide-react';
import { useMutation, useVirtualizer } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import type { Backup } from '../../types/backup';
import { formatBackupSize } from '../../utils/formatters';
import { formatDateTime } from '@/i18n/format';
import { getBackupStatus } from '../../utils/backupStatus';
import { backupsApi } from '../../services/api/backups';
import { notifyError, notifySuccess } from '../../utils/notify';
import BackupStatusBadge from './BackupStatusBadge';
import RestoreBackupDialog from './RestoreBackupDialog';
import DeleteBackupDialog from './DeleteBackupDialog';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type BackupWithDownload = Backup & { download?: () => void; downloadProgress?: string };

/**
 * One grid template shared by the column header and every row, so columns line
 * up exactly at each breakpoint. Hidden cells drop out of grid placement.
 *   base : select · identity · actions
 *   md   : select · identity · size · actions
 *   xl   : select · identity · size · storage · compressed · checksum · path · actions
 */
const GRID =
 'grid grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 ' +
 'md:grid-cols-[1.5rem_minmax(0,1fr)_6rem_11rem] ' +
 'xl:grid-cols-[1.5rem_minmax(0,1fr)_6rem_5.5rem_5.5rem_9rem_minmax(0,1fr)_11rem]';

function BackupList({
 serverId,
 backups,
 serverStatus,
 isSuspended = false,
 canWrite = true,
 canRestore,
 canDelete,
 canPin = false,
 onCancelDownload,
}: {
 serverId: string;
 backups: BackupWithDownload[];
 serverStatus: string;
 isSuspended?: boolean;
 /** @deprecated prefer canRestore/canDelete */
 canWrite?: boolean;
 canRestore?: boolean;
 canDelete?: boolean;
 /** Whether the user holds backup.pin (pin/unpin controls). */
 canPin?: boolean;
 /** Aborts an in-flight archive download for that backup. */
 onCancelDownload?: (backupId: string) => void;
}) {
 const { t } = useTranslation('server-tabs');
 const allowRestore = canRestore ?? canWrite;
 const allowDelete = canDelete ?? canWrite;
 const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
 const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
 const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
 const pinMutation = useMutation({
   mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
     backupsApi.setPinned(serverId, id, pinned),
   onSuccess: (_data, variables) => {
     notifySuccess(
       variables.pinned ? t('backups.pin.pinned') : t('backups.pin.unpinned'),
     );
   },
   onError: (error: any) => notifyError(error),
   onSettled: () => {
     queryClient.invalidateQueries({ queryKey: qk.backups(serverId) });
   },
 });
 const sorted = useMemo(() => {
 const next = [...backups];
 next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
 return next;
 }, [backups]);

 // A page change drops rows; keep the selection to what is on screen.
 useEffect(() => {
   const present = new Set(sorted.map((backup) => backup.id));
   setSelectedIds((prev) => {
     const next = new Set([...prev].filter((id) => present.has(id)));
     return next.size === prev.size ? prev : next;
   });
 }, [sorted]);

 const selectableAll = sorted.length > 0 && selectedIds.size === sorted.length;
 const someSelected = selectedIds.size > 0 && !selectableAll;
 const bulkBusy = bulkProgress !== null;

 const toggleOne = (id: string) => {
   setSelectedIds((prev) => {
     const next = new Set(prev);
     if (next.has(id)) next.delete(id);
     else next.add(id);
     return next;
   });
 };
 const toggleAll = () => {
   setSelectedIds((prev) =>
     prev.size === sorted.length ? new Set() : new Set(sorted.map((backup) => backup.id)),
   );
 };

 // Sequential, one existing endpoint per row: the backend backup worker is
 // serialized anyway, and this keeps per-row errors attributable.
  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBulkDeleteOpen(false);
    setBulkProgress({ done: 0, total: ids.length });
    const deleted = new Set<string>();
    let failed = 0;
    for (const [index, id] of ids.entries()) {
      try {
        await backupsApi.remove(serverId, id);
        deleted.add(id);
      } catch {
        failed += 1;
      }
      setBulkProgress({ done: index + 1, total: ids.length });
    }
    setBulkProgress(null);
    setSelectedIds((prev) => new Set([...prev].filter((id) => !deleted.has(id))));
    if (failed) {
      notifyError(t('backups.bulkDelete.partialFailed', { count: failed }));
    } else {
      notifySuccess(t('backups.bulkDelete.success', { count: deleted.size }));
    }
    queryClient.invalidateQueries({ queryKey: qk.backups(serverId) });
  };

 // ── Virtualization setup ──
 const backupsListRef = useRef<HTMLDivElement>(null);
 const backupsVirtualizer = useVirtualizer({
   count: sorted.length,
   getScrollElement: () => backupsListRef.current,
   estimateSize: () => 72,
   overscan: 5,
   getItemKey: (index) => sorted[index]?.id ?? index,
 });

 if (!sorted.length) {
 return (
 <div className="deck-panel px-3 py-10 text-center type-meta">
 {t('backups.list.empty')}
 </div>
 );
 }

 const selectBox = (selected: boolean) =>
   `flex h-4 w-4 items-center justify-center rounded-sm border transition-colors ${
     selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border/60 bg-card'
   }`;

 return (
 <div className="flex flex-col gap-2">
 {/* Bulk selection bar — appears only with a selection, like the files list. */}
 {selectedIds.size > 0 ? (
   <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border/60 bg-surface-1/50 px-3 py-1.5 text-micro">
     <span className="font-mono tabular-nums text-foreground">
       {t('backups.list.selected', { count: selectedIds.size })}
     </span>
     <div className="flex items-center gap-1.5">
       {allowDelete ? (
         <button
           type="button"
           className="inline-flex h-7 items-center gap-1 rounded-sm border border-danger/30 px-2 text-mini font-medium text-danger transition-colors hover:border-danger/50 hover:bg-danger/5 disabled:opacity-60"
           onClick={() => setBulkDeleteOpen(true)}
           disabled={bulkBusy || isSuspended}
         >
           {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
           {bulkProgress
             ? t('backups.bulkDelete.progress', { done: bulkProgress.done, total: bulkProgress.total })
             : t('backups.bulkDelete.action', { count: selectedIds.size })}
         </button>
       ) : null}
       <button
         type="button"
         className="inline-flex h-7 items-center rounded-sm border border-border/60 px-2 text-mini font-medium text-muted-foreground transition-colors hover:bg-surface-1/40 hover:text-foreground disabled:opacity-60"
         onClick={() => setSelectedIds(new Set())}
         disabled={bulkBusy}
       >
         {t('backups.list.clearSelection')}
       </button>
     </div>
   </div>
 ) : null}

 <div className="deck-panel flex flex-col overflow-hidden">
 {/* Column header — same grid template as the rows */}
 <div className={`${GRID} sticky top-0 z-10 hidden border-b border-border/50 bg-surface-1 px-3 py-1.5 text-muted-foreground/70 md:grid`}>
 <button
   type="button"
   role="checkbox"
   aria-label={t('backups.list.selectAll')}
   aria-checked={selectableAll ? true : someSelected ? 'mixed' : false}
   onClick={toggleAll}
   className="flex h-8 min-h-8 items-center"
 >
   <span className={selectBox(selectableAll || someSelected)}>
     {selectableAll ? <Check className="h-3 w-3" /> : null}
   </span>
 </button>
 <span className="type-overline">{t('files.list.name')}</span>
 <span className="type-overline hidden justify-end md:inline-flex">{t('backups.list.size')}</span>
 <span className="type-overline hidden justify-end xl:inline-flex">{t('backups.list.storage')}</span>
 <span className="type-overline hidden justify-end xl:inline-flex">{t('backups.list.compressed')}</span>
 <span className="type-overline hidden justify-end xl:inline-flex">{t('backups.list.checksum')}</span>
 <span className="type-overline hidden xl:inline-flex">{t('backups.list.path')}</span>
 <span className="type-overline justify-self-end">{t('files.sftp.actions')}</span>
 </div>

 {/* Virtualized rows */}
 <div ref={backupsListRef} className="min-h-0 flex-1 overflow-y-auto">
 <div className="relative" style={{ height: backupsVirtualizer.getTotalSize() }}>
 {backupsVirtualizer.getVirtualItems().map((item) => {
 const backup = sorted[item.index];
 if (!backup) return null;
 const status = getBackupStatus(backup);
 const downloading = Boolean(backup.downloadProgress);
 const selected = selectedIds.has(backup.id);
 return (
 <div
 key={item.key}
 ref={backupsVirtualizer.measureElement}
 data-index={item.index}
 className="absolute left-0 right-0"
 style={{ transform: `translateY(${item.start}px)` }}
 >
 <div
 className={`${GRID} px-3 py-2 transition-colors ${
 selected ? 'bg-primary/10' : 'hover:bg-surface-1/40'
 } ${item.index > 0 ? 'border-t border-border/40' : ''}`}
 >
 {/* selection */}
 <button
   type="button"
   role="checkbox"
   aria-label={backup.name}
   aria-checked={selected}
   onClick={() => toggleOne(backup.id)}
   className="flex h-9 min-h-9 items-center"
 >
   <span className={selectBox(selected)}>
     {selected ? <Check className="h-3 w-3" /> : null}
   </span>
 </button>

 {/* identity + timestamps */}
 <div className="flex min-w-0 flex-col leading-tight">
 <span className="flex min-w-0 items-center gap-2">
 <span className="truncate text-data font-semibold text-foreground">{backup.name}</span>
 <BackupStatusBadge status={status} />
 {backup.pinned ? (
 <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-micro font-medium text-primary">
 <Pin className="h-3 w-3" aria-hidden="true" />
 {t('backups.list.pinned')}
 </span>
 ) : null}
 {typeof backup.metadata?.secondaryPath === 'string' ? (
 <span
 className={
 backup.metadata?.secondaryStatus === 'failed'
 ? 'inline-flex shrink-0 items-center gap-1 rounded-sm border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-micro font-medium text-warning'
 : 'inline-flex shrink-0 items-center gap-1 rounded-sm border border-border/60 bg-surface-1/60 px-1.5 py-0.5 text-micro font-medium text-muted-foreground'
 }
 title={
 backup.metadata?.secondaryStatus === 'failed'
 ? String(backup.metadata?.secondaryError ?? '')
 : undefined
 }
 >
 <HardDrive className="h-3 w-3" aria-hidden="true" />
 {backup.metadata?.secondaryStatus === 'failed'
 ? t('backups.list.secondaryCopyFailed')
 : t('backups.list.secondaryCopy')}
 </span>
 ) : null}
 </span>
 <span className="font-mono text-micro tabular-nums text-muted-foreground/70 md:hidden">
 {formatBackupSize(toNumber(backup.sizeMb))} · {backup.storageMode ?? 'local'}
 </span>
 <span className="flex flex-wrap items-center gap-x-3 font-mono text-micro tabular-nums text-muted-foreground/70">
 <span>{t('backups.list.created', { date: formatDateTime(backup.createdAt) })}</span>
 {backup.restoredAt ? (
 <span>{t('backups.list.restored', { date: formatDateTime(backup.restoredAt) })}</span>
 ) : null}
 </span>
 </div>

 {/* size */}
 <span className="hidden justify-end md:flex">
 <span className="font-mono text-micro tabular-nums text-foreground">
 {formatBackupSize(toNumber(backup.sizeMb))}
 </span>
 </span>

 {/* storage */}
 <span className="hidden justify-end xl:flex">
 <span className="truncate font-mono text-micro text-muted-foreground">
 {backup.storageMode ?? 'local'}
 </span>
 </span>

 {/* compressed */}
 <span className="hidden justify-end xl:flex">
 <span className="text-micro text-muted-foreground">
 {backup.compressed === false ? t('common:actions.no') : t('common:actions.yes')}
 </span>
 </span>

 {/* checksum */}
 <span className="hidden justify-end xl:flex">
 <span className="truncate font-mono text-micro tabular-nums text-muted-foreground">
 {backup.checksum ? `${backup.checksum.slice(0, 12)}...` : t('backups.list.notAvailable')}
 </span>
 </span>

 {/* path */}
 <span className="hidden min-w-0 xl:flex">
 <span className="truncate font-mono text-micro text-muted-foreground">{backup.path}</span>
 </span>

 {/* actions */}
 <span className="col-span-full flex shrink-0 flex-wrap items-center justify-start gap-1 md:col-auto md:justify-end">
 {backup.download ? (
 <button
 type="button"
 className={`inline-flex h-8 min-h-8 items-center rounded-sm border px-2 text-mini font-medium transition-colors disabled:opacity-60 ${
 downloading
 ? 'border-info/30 font-mono tabular-nums text-info'
 : 'border-border/60 text-muted-foreground hover:bg-surface-1/40 hover:text-foreground'
 }`}
 onClick={backup.download}
 disabled={downloading || isSuspended}
 >
 {backup.downloadProgress ?? t('common:actions.download')}
 </button>
 ) : null}
 {downloading && onCancelDownload ? (
 <button
 type="button"
 className="inline-flex h-8 min-h-8 items-center rounded-sm border border-danger/30 px-2 text-mini font-medium text-danger transition-colors hover:border-danger/50 hover:bg-danger/5"
 onClick={() => onCancelDownload(backup.id)}
 >
 {t('backups.download.cancel')}
 </button>
 ) : null}
 {canPin ? (
 <button
 type="button"
 className={`inline-flex h-8 min-h-8 items-center rounded-sm border px-2 text-mini font-medium transition-colors disabled:opacity-60 ${
 backup.pinned
 ? 'border-primary/40 text-primary hover:bg-primary/10'
 : 'border-border/60 text-muted-foreground hover:bg-surface-1/40 hover:text-foreground'
 }`}
 onClick={() => pinMutation.mutate({ id: backup.id, pinned: !backup.pinned })}
 disabled={isSuspended || pinMutation.isPending}
 >
 {backup.pinned ? t('backups.pin.unpin') : t('backups.pin.action')}
 </button>
 ) : null}
 {allowRestore ? (
 <RestoreBackupDialog
 serverId={serverId}
 backup={backup}
 isSuspended={isSuspended}
 serverStatus={serverStatus}
 />
 ) : null}
 {allowDelete ? (
 <DeleteBackupDialog serverId={serverId} backup={backup} disabled={isSuspended} />
 ) : null}
 </span>
 </div>
 </div>
 );
 })}
 </div>
 </div>
 </div>

 <ConfirmDialog
   open={bulkDeleteOpen}
   title={t('backups.bulkDelete.title')}
   message={t('backups.bulkDelete.confirm', { count: selectedIds.size })}
   confirmText={t('backups.bulkDelete.action', { count: selectedIds.size })}
   cancelText={t('common:actions.cancel')}
   variant="danger"
   onConfirm={() => void handleBulkDelete()}
   onCancel={() => setBulkDeleteOpen(false)}
 />
 </div>
 );
}

export default BackupList;