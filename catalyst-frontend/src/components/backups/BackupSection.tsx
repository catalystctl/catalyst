import { useMemo, useState } from 'react';
import { useQueryClient } from '@/csync';
import { qk } from '../../lib/queryKeys';
import { useBackups } from '../../hooks/useBackups';
import { notifyError, notifyInfo } from '../../utils/notify';
import { getErrorMessage } from '../../utils/errors';
import TabHeader from '../servers/tabs/TabHeader';
import SectionHeader from '../servers/tabs/SectionHeader';
import ServerTabCard from '../servers/tabs/ServerTabCard';
import TabLoadingState from '../servers/tabs/TabLoadingState';
import TabErrorState from '../servers/tabs/TabErrorState';
import TabEmptyState from '../servers/tabs/TabEmptyState';
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
import { Shield, HardDrive } from 'lucide-react';
import { reportSystemError } from '../../services/api/systemErrors';

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
 const user = useAuthStore((s) => s.user);
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
 const queryClient = useQueryClient();
 const progressByBackup = useBackupDownloadStore((s) => s.progressByBackup);
 const setProgress = useBackupDownloadStore((s) => s.setProgress);
 const clearProgress = useBackupDownloadStore((s) => s.clearProgress);
 const { data, isLoading, isError } = useBackups(serverId, { page, limit: 10 });
 const progressKeyPrefix = useMemo(() => `server:${serverId}:backup:`, [serverId]);
 const backupAllocationMb = server?.backupAllocationMb ?? 0;
 const backupBlocked = backupAllocationMb <= 0 && (storageMode === 'local' || storageMode === 'stream');
 const localDisabled = backupAllocationMb <= 0;
 const isOwner = Boolean(server && user?.id && server.ownerId === user.id);
 const globalPerms = user?.permissions ?? [];
 const serverPerms = server?.effectivePermissions ?? [];
 const hasPerm = (perm: string) =>
 globalPerms.includes('*') ||
 globalPerms.includes(perm) ||
 serverPerms.includes(perm) ||
 isOwner;

 // Backup ACL — never treat file.* as backup privileges
 const canCreate = hasPerm('backup.create') || globalPerms.includes('admin.write');
 const canRestore = hasPerm('backup.restore') || globalPerms.includes('admin.write');
 const canDelete = hasPerm('backup.delete') || globalPerms.includes('admin.write');
 const canRead =
 hasPerm('backup.read') ||
 canCreate ||
 canRestore ||
 canDelete ||
 globalPerms.includes('admin.read') ||
 globalPerms.includes('admin.write');
 // Settings / create use create; list actions split restore vs delete
 const canWrite = canCreate;

 const [prevServer, setPrevServer] = useState(server);
 if (server !== prevServer) {
 setPrevServer(server);
 if (server) {
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
 }
 }

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
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'BackupSection',
 message: error instanceof Error ? error.message : String(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'download backup' },
 });
 clearProgress(`${progressKeyPrefix}${backupId}`);
 notifyError(getErrorMessage(error, 'Failed to download backup'));
 }
 };

 const backups = data?.backups ?? [];
 const totalPages = data?.totalPages ?? 1;

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Shield}
 title="Backups"
 description={`Create, restore, and manage server backups. Allocation: ${backupAllocationMb > 0 ? `${backupAllocationMb} MB` : 'Disabled'}`}
 actions={<CreateBackupModal serverId={serverId} disabled={isSuspended || backupBlocked || !canWrite} />}
 />
 {backupAllocationMb <= 0 ? (
 <div className="rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs text-warning">
 Provider backup allocation is not available for this server. Local and Stream storage modes require an allocation. Configure your own S3 or SFTP
 storage to enable backups.
 </div>
 ) : null}

 <ServerTabCard>
 <SectionHeader icon={HardDrive} title="Backup settings" description="Storage mode and retention rules." />
 <div className="grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-3">
 <div>
 <label className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Storage mode
 </label>
 <select
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={storageMode}
 onChange={(event) => setStorageMode(event.target.value as BackupStorageMode)}
 disabled={isSuspended || !canWrite}
 >
 {!localDisabled ? <option value="local">Local</option> : null}
 <option value="s3">S3</option>
 <option value="sftp">SFTP</option>
 {!localDisabled ? <option value="stream">Stream (backend-local)</option> : null}
 </select>
 </div>
 <div>
 <label className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Keep last N
 </label>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 type="number"
 min={0}
 max={1000}
 value={retentionCount}
 onChange={(event) => setRetentionCount(event.target.value)}
 disabled={isSuspended || !canWrite}
 />
 </div>
 <div>
 <label className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Max age (days)
 </label>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
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
 <div className="grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-2">
 <label className="block">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Bucket
 </span>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={s3Bucket}
 onChange={(event) => setS3Bucket(event.target.value)}
 placeholder="catalyst-backups"
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="block">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Region
 </span>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={s3Region}
 onChange={(event) => setS3Region(event.target.value)}
 placeholder="us-east-1"
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="block sm:col-span-2">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Endpoint (optional)
 </span>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={s3Endpoint}
 onChange={(event) => setS3Endpoint(event.target.value)}
 placeholder="https://s3.amazonaws.com"
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="block">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Access key ID
 </span>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={s3AccessKeyId}
 onChange={(event) => setS3AccessKeyId(event.target.value)}
 placeholder="AKIA..."
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="block">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Secret access key
 </span>
 <input
 type="password"
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={s3SecretAccessKey}
 onChange={(event) => setS3SecretAccessKey(event.target.value)}
 placeholder="••••••••"
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="flex items-center gap-2 text-xs text-muted-foreground">
 <input
 type="checkbox"
 className="h-4 w-4 rounded border-border text-primary-600 focus:ring-primary"
 checked={s3PathStyle}
 onChange={(event) => setS3PathStyle(event.target.checked)}
 disabled={isSuspended || !canWrite}
 />
 Force path-style addressing
 </label>
 </div>
 ) : null}
 {storageMode === 'sftp' ? (
 <div className="grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-2">
 <label className="block">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Host
 </span>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={sftpHost}
 onChange={(event) => setSftpHost(event.target.value)}
 placeholder="sftp.example.com"
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="block">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Port
 </span>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={sftpPort}
 onChange={(event) => setSftpPort(event.target.value)}
 type="number"
 min={1}
 max={65535}
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="block">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Username
 </span>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={sftpUsername}
 onChange={(event) => setSftpUsername(event.target.value)}
 placeholder="backup-user"
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="block">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Password
 </span>
 <input
 type="password"
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={sftpPassword}
 onChange={(event) => setSftpPassword(event.target.value)}
 placeholder="••••••••"
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="block sm:col-span-2">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Private key (optional)
 </span>
  {/* sphinx:ignore secret:private-key - UI placeholder, not a credential */}
  <textarea
  className="mt-1 min-h-[88px] w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
  value={sftpPrivateKey}
  onChange={(event) => setSftpPrivateKey(event.target.value)}
  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
  disabled={isSuspended || !canWrite}
  />
  </label>
  <label className="block sm:col-span-2">
  <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
  Private key passphrase (optional)
 </span>
 <input
 type="password"
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={sftpPrivateKeyPassphrase}
 onChange={(event) => setSftpPrivateKeyPassphrase(event.target.value)}
 placeholder="••••••••"
 disabled={isSuspended || !canWrite}
 />
 </label>
 <label className="block sm:col-span-2">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 Base path
 </span>
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
 value={sftpBasePath}
 onChange={(event) => setSftpBasePath(event.target.value)}
 placeholder="/backups"
 disabled={isSuspended || !canWrite}
 />
 </label>
 </div>
 ) : null}
 <div className="flex flex-wrap items-center gap-2 text-xs">
 <button
 type="button"
 className="rounded-md bg-primary px-3 py-2 font-semibold text-primary-foreground transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
 onClick={async () => {
 try {
 const parsedCount = retentionCount.trim() === '' ? undefined : Number(retentionCount);
 const parsedDays = retentionDays.trim() === '' ? undefined : Number(retentionDays);
 if (parsedCount !== undefined && (!Number.isFinite(parsedCount) || parsedCount < 0)) {
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'Retention count must be 0 or more', metadata: { context: 'save settings' } });
 throw new Error('Retention count must be 0 or more');
 }
 if (parsedDays !== undefined && (!Number.isFinite(parsedDays) || parsedDays < 0)) {
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'Retention days must be 0 or more', metadata: { context: 'save settings' } });
 throw new Error('Retention days must be 0 or more');
 }
 if (storageMode === 's3') {
 if (!s3Bucket.trim()) {
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'S3 bucket is required', metadata: { context: 'save settings' } });
 throw new Error('S3 bucket is required');
 }
 if (!s3Region.trim()) {
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'S3 region is required', metadata: { context: 'save settings' } });
 throw new Error('S3 region is required');
 }
 if (!s3AccessKeyId.trim()) {
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'S3 access key ID is required', metadata: { context: 'save settings' } });
 throw new Error('S3 access key ID is required');
 }
 if (!s3SecretAccessKey.trim()) {
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'S3 secret access key is required', metadata: { context: 'save settings' } });
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
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'SFTP port must be between 1 and 65535', metadata: { context: 'save settings' } });
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
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'SFTP host is required', metadata: { context: 'save settings' } });
 throw new Error('SFTP host is required');
 }
 if (!sftpUsername.trim()) {
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'SFTP username is required', metadata: { context: 'save settings' } });
 throw new Error('SFTP username is required');
 }
 if (!sftpPassword.trim() && !sftpPrivateKey.trim()) {
 reportSystemError({ level: 'error', component: 'BackupSection', message: 'SFTP password or private key is required', metadata: { context: 'save settings' } });
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
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'BackupSection',
 message: error instanceof Error ? error.message : String(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'update backup settings' },
 });
 notifyError(getErrorMessage(error, 'Failed to update settings'));
 }
 }}
 disabled={isSuspended || !canWrite}
 >
 Save settings
 </button>
 </div>
 </ServerTabCard>

 {isLoading ? (
 <TabLoadingState rows={5} />
 ) : isError ? (
 <TabErrorState message="Unable to load backups." />
 ) : backups.length ? (
 <div className="space-y-3">
 <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
 <span>{data?.total ?? backups.length} backups</span>
 <div className="flex items-center gap-2">
 <button
 className="rounded-md border border-border/40 px-2 py-1 text-xs text-muted-foreground hover:border-primary/30 disabled:opacity-60"
 onClick={() => setPage((prev) => Math.max(1, prev - 1))}
 disabled={page === 1}
 >
 Previous
 </button>
 <span>
 Page {page} of {totalPages}
 </span>
 <button
 className="rounded-md border border-border/40 px-2 py-1 text-xs text-muted-foreground hover:border-primary/30 disabled:opacity-60"
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
 canRestore={canRestore}
 canDelete={canDelete}
 />
 </div>
 ) : (
 <TabEmptyState
 title="No backups yet"
 description="Create a backup to protect your server data."
 action={<CreateBackupModal serverId={serverId} disabled={isSuspended || backupBlocked || !canWrite} />}
 />
 )}
 </div>
 );
}

export default BackupSection;
