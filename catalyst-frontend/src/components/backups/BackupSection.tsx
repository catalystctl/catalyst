import { useMemo, useState, useEffect } from 'react';
import { useBackups } from '../../hooks/useBackups';
import { notifyError, notifyInfo } from '../../utils/notify';
import LoadingSpinner from '../shared/LoadingSpinner';
import BackupList from './BackupList';
import CreateBackupModal from './CreateBackupModal';
import { backupsApi } from '../../services/api/backups';
import { serversApi } from '../../services/api/servers';
import type { BackupStorageMode } from '../../types/server';
import { useServer } from '../../hooks/useServer';
import { notifySuccess } from '../../utils/notify';
import { formatBytes, formatPercent } from '../../utils/formatters';
import { useBackupDownloadStore } from '../../stores/backupDownloadStore';
import { useAuthStore } from '../../stores/authStore';

const formatProgress = (progress?: { loaded: number; total?: number }) => {
  if (!progress) return undefined;
  if (progress.total) {
    const percent = (progress.loaded / progress.total) * 100;
    return `${formatPercent(Math.min(100, percent))} (${formatBytes(progress.loaded)}/${formatBytes(
      progress.total,
    )})`;
  }
  return `Downloading ${formatBytes(progress.loaded)}`;
};

function BackupSection({
  serverId,
  serverStatus,
  isSuspended = false,
}: {
  serverId: string;
  serverStatus: string;
  isSuspended?: boolean;
}) {
  const [page, setPage] = useState(1);
  const { data: server } = useServer(serverId);
  const { user } = useAuthStore();
  const [storageMode, setStorageMode] = useState<BackupStorageMode>('local');
  const [retentionCount, setRetentionCount] = useState('');
  const [retentionDays, setRetentionDays] = useState('');
  const [s3Bucket, setS3Bucket] = useState('');
  const [s3Region, setS3Region] = useState('');
  const [s3Endpoint, setS3Endpoint] = useState('');
  const [s3AccessKeyId, setS3AccessKeyId] = useState('');
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState('');
  const [s3PathStyle, setS3PathStyle] = useState(false);
  const [sftpHost, setSftpHost] = useState('');
  const [sftpPort, setSftpPort] = useState('22');
  const [sftpUsername, setSftpUsername] = useState('');
  const [sftpPassword, setSftpPassword] = useState('');
  const [sftpPrivateKey, setSftpPrivateKey] = useState('');
  const [sftpPrivateKeyPassphrase, setSftpPrivateKeyPassphrase] = useState('');
  const [sftpBasePath, setSftpBasePath] = useState('');
  const { progressByBackup, setProgress, clearProgress } = useBackupDownloadStore();
  const { data, isLoading, isError } = useBackups(serverId, { page, limit: 10 });
  const progressKeyPrefix = useMemo(() => `server:${serverId}:backup:`, [serverId]);
  const backupAllocationMb = server?.backupAllocationMb ?? 0;
  const backupBlocked = backupAllocationMb <= 0 && storageMode === 'local';
  const localDisabled = backupAllocationMb <= 0;
  const canWrite =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('file.write') ||
    Boolean(server && user?.id && server.ownerId === user.id);
  const canRead =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.read') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('file.read') ||
    Boolean(server && user?.id && server.ownerId === user.id);

  useEffect(() => {
    if (!server) return;
    setStorageMode(server.backupStorageMode ?? 'local');
    setRetentionCount(
      server.backupRetentionCount !== undefined && server.backupRetentionCount !== null
        ? String(server.backupRetentionCount)
        : '',
    );
    setRetentionDays(
      server.backupRetentionDays !== undefined && server.backupRetentionDays !== null
        ? String(server.backupRetentionDays)
        : '',
    );
    setS3Bucket(server.backupS3Config?.bucket ?? '');
    setS3Region(server.backupS3Config?.region ?? '');
    setS3Endpoint(server.backupS3Config?.endpoint ?? '');
    setS3AccessKeyId(server.backupS3Config?.accessKeyId ?? '');
    setS3SecretAccessKey(server.backupS3Config?.secretAccessKey ?? '');
    setS3PathStyle(Boolean(server.backupS3Config?.pathStyle));
    setSftpHost(server.backupSftpConfig?.host ?? '');
    setSftpPort(
      server.backupSftpConfig?.port ? String(server.backupSftpConfig.port) : '22',
    );
    setSftpUsername(server.backupSftpConfig?.username ?? '');
    setSftpPassword(server.backupSftpConfig?.password ?? '');
    setSftpPrivateKey(server.backupSftpConfig?.privateKey ?? '');
    setSftpPrivateKeyPassphrase(server.backupSftpConfig?.privateKeyPassphrase ?? '');
    setSftpBasePath(server.backupSftpConfig?.basePath ?? '');
  }, [server?.id, server?.backupStorageMode, server?.backupRetentionCount, server?.backupRetentionDays]);

  const handleDownload = async (backupId: string, name: string) => {
    try {
      setProgress(`${progressKeyPrefix}${backupId}`, { loaded: 0 });
      const blob = await backupsApi.download(serverId, backupId, (progress) => {
        setProgress(`${progressKeyPrefix}${backupId}`, progress);
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name}.tar.gz`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      clearProgress(`${progressKeyPrefix}${backupId}`);
      notifyInfo('Backup download started');
    } catch (error: any) {
      clearProgress(`${progressKeyPrefix}${backupId}`);
      const message = error?.response?.data?.error || 'Failed to download backup';
      notifyError(message);
    }
  };

  const backups = data?.backups ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Backups</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Create, restore, and manage server backups.
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Allocation: {backupAllocationMb > 0 ? `${backupAllocationMb} MB` : 'Disabled'}
          </p>
        </div>
        <CreateBackupModal serverId={serverId} disabled={isSuspended || backupBlocked || !canWrite} />
      </div>
      {backupAllocationMb <= 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 shadow-surface-light dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          Provider backup allocation is not available for this server. Configure your own S3 or SFTP
          storage to enable backups.
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">Backup settings</div>
            <div className="text-xs text-slate-600 dark:text-slate-400">
              Storage mode and retention rules.
            </div>
            {backupBlocked ? (
              <div className="text-xs text-amber-600 dark:text-amber-300">
                Local backups disabled. Configure S3 or SFTP to enable backups.
              </div>
            ) : null}
          </div>
        </div>
          <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-3">
            <div>
              <label className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Storage mode
              </label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={storageMode}
                onChange={(event) => setStorageMode(event.target.value as BackupStorageMode)}
                disabled={isSuspended || !canWrite}
              >
                {!localDisabled ? <option value="local">Local</option> : null}
                <option value="s3">S3</option>
                <option value="sftp">SFTP</option>
                {!localDisabled ? <option value="stream">Stream</option> : null}
              </select>
            </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Keep last N
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
              type="number"
              min={0}
              max={1000}
              value={retentionCount}
                onChange={(event) => setRetentionCount(event.target.value)}
                disabled={isSuspended || !canWrite}
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Max age (days)
            </label>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
              type="number"
              min={0}
              max={3650}
              value={retentionDays}
                onChange={(event) => setRetentionDays(event.target.value)}
                disabled={isSuspended || !canWrite}
            />
          </div>
        </div>
        {storageMode === 's3' ? (
          <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Bucket
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={s3Bucket}
                onChange={(event) => setS3Bucket(event.target.value)}
                placeholder="catalyst-backups"
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Region
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={s3Region}
                onChange={(event) => setS3Region(event.target.value)}
                placeholder="us-east-1"
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Endpoint (optional)
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={s3Endpoint}
                onChange={(event) => setS3Endpoint(event.target.value)}
                placeholder="https://s3.amazonaws.com"
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Access key ID
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={s3AccessKeyId}
                onChange={(event) => setS3AccessKeyId(event.target.value)}
                placeholder="AKIA..."
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Secret access key
              </span>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={s3SecretAccessKey}
                onChange={(event) => setS3SecretAccessKey(event.target.value)}
                placeholder="••••••••"
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                checked={s3PathStyle}
                onChange={(event) => setS3PathStyle(event.target.checked)}
                disabled={isSuspended || !canWrite}
              />
              Force path-style addressing
            </label>
          </div>
        ) : null}
        {storageMode === 'sftp' ? (
          <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Host
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={sftpHost}
                onChange={(event) => setSftpHost(event.target.value)}
                placeholder="sftp.example.com"
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Port
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={sftpPort}
                onChange={(event) => setSftpPort(event.target.value)}
                type="number"
                min={1}
                max={65535}
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Username
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={sftpUsername}
                onChange={(event) => setSftpUsername(event.target.value)}
                placeholder="backup-user"
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Password
              </span>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={sftpPassword}
                onChange={(event) => setSftpPassword(event.target.value)}
                placeholder="••••••••"
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Private key (optional)
              </span>
              <textarea
                className="mt-1 min-h-[88px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={sftpPrivateKey}
                onChange={(event) => setSftpPrivateKey(event.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Private key passphrase (optional)
              </span>
              <input
                type="password"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={sftpPrivateKeyPassphrase}
                onChange={(event) => setSftpPrivateKeyPassphrase(event.target.value)}
                placeholder="••••••••"
                disabled={isSuspended || !canWrite}
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Base path
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                value={sftpBasePath}
                onChange={(event) => setSftpBasePath(event.target.value)}
                placeholder="/backups"
                disabled={isSuspended || !canWrite}
              />
            </label>
          </div>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            className="rounded-md bg-primary-600 px-3 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={async () => {
              try {
                const parsedCount = retentionCount.trim() === '' ? undefined : Number(retentionCount);
                const parsedDays = retentionDays.trim() === '' ? undefined : Number(retentionDays);
                if (parsedCount !== undefined && (!Number.isFinite(parsedCount) || parsedCount < 0)) {
                  throw new Error('Retention count must be 0 or more');
                }
                if (parsedDays !== undefined && (!Number.isFinite(parsedDays) || parsedDays < 0)) {
                  throw new Error('Retention days must be 0 or more');
                }
                if (storageMode === 's3') {
                  if (!s3Bucket.trim()) {
                    throw new Error('S3 bucket is required');
                  }
                  if (!s3Region.trim()) {
                    throw new Error('S3 region is required');
                  }
                  if (!s3AccessKeyId.trim()) {
                    throw new Error('S3 access key ID is required');
                  }
                  if (!s3SecretAccessKey.trim()) {
                    throw new Error('S3 secret access key is required');
                  }
                }
                const s3Config =
                  storageMode === 's3'
                    ? {
                        bucket: s3Bucket.trim() || null,
                        region: s3Region.trim() || null,
                        endpoint: s3Endpoint.trim() || null,
                        accessKeyId: s3AccessKeyId.trim() || null,
                        secretAccessKey: s3SecretAccessKey || null,
                        pathStyle: s3PathStyle,
                      }
                    : undefined;
                const sftpPortValue =
                  sftpPort.trim() === '' ? undefined : Number(sftpPort);
                if (
                  storageMode === 'sftp' &&
                  sftpPortValue !== undefined &&
                  (!Number.isFinite(sftpPortValue) || sftpPortValue <= 0 || sftpPortValue > 65535)
                ) {
                  throw new Error('SFTP port must be between 1 and 65535');
                }
                const sftpConfig =
                  storageMode === 'sftp'
                    ? {
                        host: sftpHost.trim() || null,
                        port: sftpPortValue ?? null,
                        username: sftpUsername.trim() || null,
                        password: sftpPassword || null,
                        privateKey: sftpPrivateKey.trim() || null,
                        privateKeyPassphrase: sftpPrivateKeyPassphrase || null,
                        basePath: sftpBasePath.trim() || null,
                      }
                    : undefined;
                if (storageMode === 'sftp') {
                  if (!sftpHost.trim()) {
                    throw new Error('SFTP host is required');
                  }
                  if (!sftpUsername.trim()) {
                    throw new Error('SFTP username is required');
                  }
                  if (!sftpPassword.trim() && !sftpPrivateKey.trim()) {
                    throw new Error('SFTP password or private key is required');
                  }
                }
                await serversApi.updateBackupSettings(serverId, {
                  storageMode,
                  retentionCount: parsedCount,
                  retentionDays: parsedDays,
                  s3Config,
                  sftpConfig,
                });
                notifySuccess('Backup settings updated');
              } catch (error: any) {
                const message = error?.response?.data?.error || error?.message || 'Failed to update settings';
                notifyError(message);
              }
            }}
            disabled={isSuspended || !canWrite}
          >
            Save settings
          </button>
        </div>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : isError ? (
        <div className="rounded-xl border border-rose-800 bg-rose-950/40 px-4 py-4 text-sm text-rose-200">
          Unable to load backups.
        </div>
      ) : backups.length ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span>{data?.total ?? backups.length} backups</span>
            <div className="flex items-center gap-2">
              <button
                className="rounded-md border border-slate-200 dark:border-slate-800 px-2 py-1 text-xs text-slate-600 dark:text-slate-200 hover:border-slate-200 dark:border-slate-700 disabled:opacity-60"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
              >
                Previous
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                className="rounded-md border border-slate-200 dark:border-slate-800 px-2 py-1 text-xs text-slate-600 dark:text-slate-200 hover:border-slate-200 dark:border-slate-700 disabled:opacity-60"
                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                disabled={page >= totalPages}
              >
                Next
              </button>
            </div>
          </div>
          <BackupList
            serverId={serverId}
            backups={backups.map((backup) => ({
              ...backup,
                download: isSuspended || !canRead ? undefined : () => handleDownload(backup.id, backup.name),
                downloadProgress: formatProgress(progressByBackup[`${progressKeyPrefix}${backup.id}`]),
              }))}
              serverStatus={serverStatus}
              isSuspended={isSuspended}
              canWrite={canWrite}
            />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 px-6 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          No backups yet. Create a backup to protect your server data.
        </div>
      )}
    </div>
  );
}

export default BackupSection;
