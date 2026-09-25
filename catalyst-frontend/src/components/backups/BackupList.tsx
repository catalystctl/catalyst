import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Backup } from '../../types/backup';
import { formatBackupSize } from '../../utils/formatters';
import { formatDateTime } from '@/i18n/format';
import { getBackupStatus } from '../../utils/backupStatus';
import BackupStatusBadge from './BackupStatusBadge';
import RestoreBackupDialog from './RestoreBackupDialog';
import DeleteBackupDialog from './DeleteBackupDialog';

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

type BackupWithDownload = Backup & { download?: () => void; downloadProgress?: string };

/**
 * One grid template shared by the column header and every row, so columns line
 * up exactly at each breakpoint. Hidden cells drop out of grid placement.
 *   base : identity · actions
 *   md   : identity · size · actions
 *   xl   : identity · size · storage · compressed · checksum · path · actions
 */
const GRID =
 'grid grid-cols-1 items-center gap-x-3 gap-y-1 ' +
 'md:grid-cols-[minmax(0,1fr)_6rem_11rem] ' +
 'xl:grid-cols-[minmax(0,1fr)_6rem_5.5rem_5.5rem_9rem_minmax(0,1fr)_11rem]';

function BackupList({
 serverId,
 backups,
 serverStatus,
 isSuspended = false,
 canWrite = true,
 canRestore,
 canDelete,
}: {
 serverId: string;
 backups: BackupWithDownload[];
 serverStatus: string;
 isSuspended?: boolean;
 /** @deprecated prefer canRestore/canDelete */
 canWrite?: boolean;
 canRestore?: boolean;
 canDelete?: boolean;
}) {
 const { t } = useTranslation('server-tabs');
 const allowRestore = canRestore ?? canWrite;
 const allowDelete = canDelete ?? canWrite;
 const sorted = useMemo(() => {
 const next = [...backups];
 next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
 return next;
 }, [backups]);

 if (!sorted.length) {
 return (
 <div className="deck-panel px-3 py-10 text-center type-meta">
 {t('backups.list.empty')}
 </div>
 );
 }

 return (
 <div className="deck-panel overflow-hidden">
 {/* Column header — same grid template as the rows */}
 <div className={`${GRID} sticky top-0 z-10 hidden border-b border-border/50 bg-surface-1 px-3 py-1.5 text-muted-foreground/70 md:grid`}>
 <span className="type-overline">{t('files.list.name')}</span>
 <span className="type-overline hidden justify-end md:inline-flex">{t('backups.list.size')}</span>
 <span className="type-overline hidden justify-end xl:inline-flex">{t('backups.list.storage')}</span>
 <span className="type-overline hidden justify-end xl:inline-flex">{t('backups.list.compressed')}</span>
 <span className="type-overline hidden justify-end xl:inline-flex">{t('backups.list.checksum')}</span>
 <span className="type-overline hidden xl:inline-flex">{t('backups.list.path')}</span>
 <span className="type-overline justify-self-end">{t('files.sftp.actions')}</span>
 </div>

 {sorted.map((backup, index) => {
 const status = getBackupStatus(backup);
 const downloading = Boolean(backup.downloadProgress);
 return (
 <div
 key={backup.id}
 className={`${GRID} px-3 py-2 transition-colors hover:bg-surface-1/40 ${
 index > 0 ? 'border-t border-border/40' : ''
 }`}
 >
 {/* identity + timestamps */}
 <div className="flex min-w-0 flex-col leading-tight">
 <span className="flex min-w-0 items-center gap-2">
 <span className="truncate text-data font-semibold text-foreground">{backup.name}</span>
 <BackupStatusBadge status={status} />
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
 className={`inline-flex h-7 items-center rounded-sm border px-2 text-mini font-medium transition-colors disabled:opacity-60 ${
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
 {allowRestore ? (
 <RestoreBackupDialog
 serverId={serverId}
 backup={backup}
 disabled={serverStatus !== 'stopped' || isSuspended}
 />
 ) : null}
 {allowDelete ? (
 <DeleteBackupDialog serverId={serverId} backup={backup} disabled={isSuspended} />
 ) : null}
 </span>
 </div>
 );
 })}
 </div>
 );
}

export default BackupList;
