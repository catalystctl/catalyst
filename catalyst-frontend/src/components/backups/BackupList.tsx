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
        <div className="rounded-md border border-dashed border-border/50 bg-card px-6 py-10 text-center type-meta">
          {t('backups.list.empty')}
        </div>
 );
 }

 return (
 <div className="space-y-3">
 {sorted.map((backup) => {
 const status = getBackupStatus(backup);
 return (
 <div
 key={backup.id}
 className="rounded-md border border-border/50 bg-card px-4 py-3 transition-colors duration-150 hover:border-primary/30"
 >
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div>
 <div className="flex items-center gap-2">
 <div className="type-numeric truncate text-sm text-foreground">{backup.name}</div>
 <BackupStatusBadge status={status} />
 </div>
 <div className="type-meta mt-1">
 {t('backups.list.created', { date: formatDateTime(backup.createdAt) })}
 {backup.restoredAt ? ` · ${t('backups.list.restored', { date: formatDateTime(backup.restoredAt) })}` : ''}
 </div>
 </div>
 <div className="flex flex-wrap items-center gap-2 text-xs">
 {backup.download ? (
 <button
 className="rounded-md border border-border/50 px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground disabled:opacity-60"
 onClick={backup.download}
 disabled={Boolean(backup.downloadProgress) || isSuspended}
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
 </div>
 </div>
 <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
 <div className="rounded-md border border-border/50 bg-surface-2/30 px-3 py-2">
 <div className="type-overline">{t('backups.list.size')}</div>
 <div className="type-numeric text-sm text-foreground">
 {formatBackupSize(toNumber(backup.sizeMb))}
 </div>
 </div>
 <div className="rounded-md border border-border/50 bg-surface-2/30 px-3 py-2">
 <div className="type-overline">{t('backups.list.storage')}</div>
 <div className="type-numeric text-sm text-foreground">
 {backup.storageMode ?? 'local'}
 </div>
 </div>
 <div className="rounded-md border border-border/50 bg-surface-2/30 px-3 py-2">
 <div className="type-overline">{t('backups.list.compressed')}</div>
 <div className="type-numeric text-sm text-foreground">
 {backup.compressed === false ? t('common:actions.no') : t('common:actions.yes')}
 </div>
 </div>
 <div className="rounded-md border border-border/50 bg-surface-2/30 px-3 py-2">
 <div className="type-overline">{t('backups.list.checksum')}</div>
 <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
 {backup.checksum ? `${backup.checksum.slice(0, 12)}...` : t('backups.list.notAvailable')}
 </div>
 </div>
 <div className="rounded-md border border-border/50 bg-surface-2/30 px-3 py-2">
 <div className="type-overline">{t('backups.list.path')}</div>
 <div className="truncate font-mono text-[11px] text-muted-foreground">{backup.path}</div>
 </div>
 </div>
 </div>
 );
 })}
 </div>
 );
}

export default BackupList;
