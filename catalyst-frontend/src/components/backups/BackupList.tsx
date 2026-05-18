import { useMemo } from 'react';
import type { Backup } from '../../types/backup';
import { formatBackupSize } from '../../utils/formatters';
import { getBackupStatus } from '../../utils/backupStatus';
import BackupStatusBadge from './BackupStatusBadge';
import RestoreBackupDialog from './RestoreBackupDialog';
import DeleteBackupDialog from './DeleteBackupDialog';

const formatDateTime = (value: string) => new Date(value).toLocaleString();
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
}: {
  serverId: string;
  backups: BackupWithDownload[];
  serverStatus: string;
  isSuspended?: boolean;
  canWrite?: boolean;
}) {
  const sorted = useMemo(() => {
    const next = [...backups];
    next.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return next;
  }, [backups]);

  if (!sorted.length) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
        No backups yet. Create a backup to protect your server data.
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
            className="group relative rounded-lg border border-border/30 px-4 py-3 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
          >
            <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-sm font-semibold font-mono tabular-nums text-foreground">{backup.name}</div>
                  <BackupStatusBadge status={status} />
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Created {formatDateTime(backup.createdAt)}
                  {backup.restoredAt ? ` · Restored ${formatDateTime(backup.restoredAt)}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {backup.download ? (
                  <button
                    className="rounded-md border border-border/40 px-3 py-1 text-xs font-semibold text-muted-foreground hover:border-border disabled:opacity-60"
                    onClick={backup.download}
                    disabled={Boolean(backup.downloadProgress) || isSuspended}
                  >
                    {backup.downloadProgress ?? 'Download'}
                  </button>
                ) : null}
                <RestoreBackupDialog
                  serverId={serverId}
                  backup={backup}
                  disabled={serverStatus !== 'stopped' || isSuspended || !canWrite}
                />
                <DeleteBackupDialog serverId={serverId} backup={backup} disabled={isSuspended || !canWrite} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground sm:grid-cols-5">
              <div className="rounded-md border border-border/30 bg-surface-2/30 px-3 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Size</div>
                <div className="text-sm font-semibold font-mono tabular-nums text-foreground">
                  {formatBackupSize(toNumber(backup.sizeMb))}
                </div>
              </div>
              <div className="rounded-md border border-border/30 bg-surface-2/30 px-3 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Storage</div>
                <div className="text-sm font-semibold font-mono tabular-nums text-foreground">
                  {backup.storageMode ?? 'local'}
                </div>
              </div>
              <div className="rounded-md border border-border/30 bg-surface-2/30 px-3 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Compressed</div>
                <div className="text-sm font-semibold font-mono tabular-nums text-foreground">
                  {backup.compressed === false ? 'No' : 'Yes'}
                </div>
              </div>
              <div className="rounded-md border border-border/30 bg-surface-2/30 px-3 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Checksum</div>
                <div className="text-[11px] font-mono text-muted-foreground/50">
                  {backup.checksum ? `${backup.checksum.slice(0, 12)}...` : 'n/a'}
                </div>
              </div>
              <div className="rounded-md border border-border/30 bg-surface-2/30 px-3 py-2">
                <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Path</div>
                <div className="text-[11px] text-muted-foreground truncate">{backup.path}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default BackupList;
