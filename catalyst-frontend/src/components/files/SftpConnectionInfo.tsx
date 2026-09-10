import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Check, Eye, EyeOff, RefreshCw, AlertTriangle, Info, Trash2, Shield, Users } from 'lucide-react';
import { useQuery, useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import { notifySuccess, notifyError } from '../../utils/notify';
import i18n from '@/i18n';

interface SftpConnectionInfoProps {
 serverId: string;
 isOwner: boolean;
}

/** Time until we consider the token "expiring soon" and show a warning (1 minute) */
const EXPIRY_WARNING_MS = 60 * 1000;

function formatExpiry(expiresAt: number): string {
 const remaining = expiresAt - Date.now();
 if (remaining <= 0) return i18n.t('files.sftp.expired', { ns: 'server-tabs' });

 const totalSeconds = Math.floor(remaining / 1000);
 if (totalSeconds < 60) {
 return i18n.t('files.sftp.remainingSeconds', { ns: 'server-tabs', seconds: totalSeconds });
 }

 const minutes = Math.floor(totalSeconds / 60);
 const seconds = totalSeconds % 60;
 if (minutes < 60) {
 return i18n.t('files.sftp.remainingMinutes', {
 ns: 'server-tabs',
 minutes,
 seconds,
 });
 }

 const hours = Math.floor(minutes / 60);
 const mins = minutes % 60;
 if (hours < 24) {
 return i18n.t('files.sftp.remainingHours', { ns: 'server-tabs', hours, minutes: mins });
 }

 const days = Math.floor(hours / 24);
 const hrs = hours % 24;
 if (days < 365) {
 return i18n.t('files.sftp.remainingDays', { ns: 'server-tabs', days, hours: hrs });
 }

 const years = Math.floor(days / 365);
 const remDays = days % 365;
 return i18n.t('files.sftp.remainingYears', { ns: 'server-tabs', years, days: remDays });
}

function formatTimeAgo(timestamp: number): string {
 const diff = Date.now() - timestamp;
 if (diff < 60 * 1000) return i18n.t('files.sftp.justNow', { ns: 'server-tabs' });
 if (diff < 60 * 60 * 1000) {
 return i18n.t('files.sftp.minutesAgo', {
 ns: 'server-tabs',
 minutes: Math.floor(diff / 60000),
 });
 }
 if (diff < 24 * 60 * 60 * 1000) {
 return i18n.t('files.sftp.hoursAgo', {
 ns: 'server-tabs',
 hours: Math.floor(diff / 3600000),
 });
 }
 return i18n.t('files.sftp.daysAgo', {
 ns: 'server-tabs',
 days: Math.floor(diff / 86400000),
 });
}

export default function SftpConnectionInfo({ serverId, isOwner }: SftpConnectionInfoProps) {
 const { t } = useTranslation('server-tabs');
 const [showPassword, setShowPassword] = useState(false);
 const [copiedField, setCopiedField] = useState<string | null>(null);
 const [selectedTtl, setSelectedTtl] = useState<number | undefined>(undefined);
 const [now, setNow] = useState(() => Date.now());

 const { data: sftpInfo, isLoading } = useQuery({
 queryKey: qk.sftpConnectionInfo(serverId, selectedTtl),
 queryFn: () => serversApi.getSftpConnectionInfo(serverId, selectedTtl),
 staleTime: 30_000,
 refetchInterval: 15_000,
 refetchIntervalInBackground: false,
 });

 const { data: tokens = [], isLoading: tokensLoading } = useQuery({
 queryKey: qk.sftpTokens(serverId),
 queryFn: () => serversApi.listSftpTokens(serverId),
 staleTime: 30_000,
 });

 const rotateMutation = useMutation({
 mutationFn: (ttlMs?: number) => serversApi.rotateSftpToken(serverId, ttlMs),
 onSuccess: () => {
 notifySuccess(t('files.sftp.rotated'));
 setShowPassword(false);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.sftpConnectionInfo(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.sftpTokens(serverId) });
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || t('files.sftp.rotateFailed');
 notifyError(message);
 },
 });

 const revokeMutation = useMutation({
 mutationFn: (targetUserId: string) => serversApi.revokeSftpToken(serverId, targetUserId),
 onSuccess: (_data, targetUserId) => {
 notifySuccess(t('files.sftp.sessionRevoked'));
 if (tokens.some(t => t.userId === targetUserId && t.isSelf)) {
 setShowPassword(false);
 }
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.sftpTokens(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.sftpConnectionInfo(serverId) });
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || t('files.sftp.revokeFailed');
 notifyError(message);
 },
 });

 const revokeAllMutation = useMutation({
 mutationFn: () => serversApi.revokeAllSftpTokens(serverId),
 onSuccess: (data) => {
 const count = data?.revoked ?? 0;
 notifySuccess(t('files.sftp.revokedCount', { count }));
 setShowPassword(false);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.sftpTokens(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.sftpConnectionInfo(serverId) });
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || t('files.sftp.revokeAllFailed');
 notifyError(message);
 },
 });

 // Tick every second for live countdown
 useEffect(() => {
 const interval = setInterval(() => setNow(Date.now()), 1000);
 return () => clearInterval(interval);
 }, []);

 // Sync selected TTL from server response
 useEffect(() => {
 if (sftpInfo?.ttlMs && !selectedTtl) {
 setSelectedTtl(sftpInfo.ttlMs);
 }
 }, [sftpInfo?.ttlMs, selectedTtl]);

 const isExpired = sftpInfo?.expiresAt ? sftpInfo.expiresAt <= now : false;
 const isExpiringSoon = sftpInfo?.expiresAt
 ? sftpInfo.expiresAt - now > 0 && sftpInfo.expiresAt - now <= EXPIRY_WARNING_MS
 : false;
 const ttlOptions = sftpInfo?.ttlOptions ?? [];
 const password = sftpInfo?.sftpPassword || '';

 const copyToClipboard = (value: string, field: string, label: string) => {
 navigator.clipboard.writeText(value).then(() => {
 setCopiedField(field);
 notifySuccess(t('files.sftp.copied', { field: label }));
 setTimeout(() => setCopiedField(null), 2000);
 });
 };

 if (isLoading) {
 return (
 <div className="text-sm text-muted-foreground dark:text-muted-foreground">{t('files.sftp.loading')}</div>
 );
 }

 if (!sftpInfo) {
 return (
 <div className="text-sm text-muted-foreground dark:text-muted-foreground">
 {t('files.sftp.loadFailed')}
 </div>
 );
 }

 if (!sftpInfo.enabled) {
 return (
 <div className="space-y-3">
 <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/50/10 px-3 py-2 text-sm text-warning">
 <AlertTriangle className="h-4 w-4 flex-shrink-0" />
 {t('files.sftp.disabled')}
 </div>
 </div>
 );
 }

 const fields = [
 { label: t('files.sftp.host'), value: sftpInfo.host, key: 'Host' },
 { label: t('files.sftp.port'), value: String(sftpInfo.port), key: 'Port' },
 {
 label: t('files.sftp.username'),
 value: (sftpInfo.username && String(sftpInfo.username).trim()) || serverId,
 key: 'Username',
 },
 ];

 return (
 <div className="space-y-5">
 <p className="text-xs text-muted-foreground dark:text-muted-foreground">
 {t('files.sftp.description')}
 </p>

 {/* Expiry status banner */}
 {isExpired ? (
 <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/50/10 px-3 py-2.5 text-sm text-destructive">
 <AlertTriangle className="h-4 w-4 flex-shrink-0" />
 <span className="font-medium">{t('files.sftp.expiredBanner')}</span>
 <button
 type="button"
 onClick={() => rotateMutation.mutate(selectedTtl)}
 disabled={rotateMutation.isPending}
 className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-destructive/50/20 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/50/30 disabled:opacity-50"
 >
 <RefreshCw className={`h-3 w-3 ${rotateMutation.isPending ? 'animate-spin' : ''}`} />
 {t('files.sftp.rotateNow')}
 </button>
 </div>
 ) : isExpiringSoon ? (
 <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/50/10 px-3 py-2.5 text-sm text-warning">
 <AlertTriangle className="h-4 w-4 flex-shrink-0" />
 <span className="font-medium">{t('files.sftp.expiresSoon', { time: formatExpiry(sftpInfo.expiresAt) })}</span>
 <button
 type="button"
 onClick={() => rotateMutation.mutate(selectedTtl)}
 disabled={rotateMutation.isPending}
 className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-warning/50/20 px-2.5 py-1 text-xs font-medium text-warning transition-colors hover:bg-warning/50/30 disabled:opacity-50"
 >
 <RefreshCw className={`h-3 w-3 ${rotateMutation.isPending ? 'animate-spin' : ''}`} />
 {t('files.sftp.rotate')}
 </button>
 </div>
 ) : sftpInfo.expiresAt ? (
 <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/50/5 px-3 py-2 text-xs text-success dark:text-success">
 <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-success/50" />
 {t('files.sftp.activeWithTime', { time: formatExpiry(sftpInfo.expiresAt) })}
 </div>
 ) : null}

 {/* TTL selector + Rotate */}
 <div className="flex flex-wrap items-end gap-3">
 <label className="block text-xs text-muted-foreground">
 <span className="flex items-center gap-1">
 {t('files.sftp.tokenLifetime')}
 <span className="group relative">
 <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
 <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 dark:border-border dark:bg-surface-2">
 {t('files.sftp.tokenLifetimeHelp')}
 </span>
 </span>
 </span>
 <select
 value={selectedTtl ?? ''}
 onChange={(e) => setSelectedTtl(Number(e.target.value) || undefined)}
 className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:bg-surface-1 dark:hover:border-primary/30"
 >
 {ttlOptions.map((opt) => (
 <option key={opt.value} value={opt.value}>
 {opt.label}
 </option>
 ))}
 </select>
 </label>
 <button
 type="button"
 onClick={() => rotateMutation.mutate(selectedTtl)}
 disabled={rotateMutation.isPending}
 className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
 >
 <RefreshCw className={`h-3.5 w-3.5 ${rotateMutation.isPending ? 'animate-spin' : ''}`} />
 {isExpired ? t('files.sftp.generateNew') : t('files.sftp.rotatePassword')}
 </button>
 </div>

 {/* Connection fields */}
 <div className="grid gap-2">
 {fields.map(({ label, value, key }) => (
 <div
 key={key}
 className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 dark:bg-surface-2/50"
 >
 <div className="min-w-0">
 <span className="text-xs font-medium text-muted-foreground dark:text-muted-foreground">
 {label}
 </span>
 <p className="truncate font-mono text-sm text-foreground">
 {value}
 </p>
 </div>
 <button
 type="button"
 onClick={() => copyToClipboard(value, key, label)}
 className="ml-2 flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-muted-foreground dark:hover:bg-surface-2 dark:hover:text-foreground"
 title={t('files.sftp.copyLabel', { label })}
 >
 {copiedField === key ? (
 <Check className="h-3.5 w-3.5 text-success" />
 ) : (
 <Copy className="h-3.5 w-3.5" />
 )}
 </button>
 </div>
 ))}

 {/* Password field */}
 <div className="flex items-center justify-between rounded-lg bg-surface-2 px-3 py-2 dark:bg-surface-2/50">
 <div className="min-w-0 flex-1">
 <span className="text-xs font-medium text-muted-foreground dark:text-muted-foreground">
 {t('files.sftp.password')}
 </span>
 <p className="truncate font-mono text-sm text-foreground">
 {password && !isExpired
 ? (showPassword ? password : '••••••••••••••••')
 : isExpired
 ? t('files.sftp.expiredRotate')
 : t('files.sftp.noToken')}
 </p>
 </div>
 <div className="ml-2 flex flex-shrink-0 items-center gap-1">
 {password && !isExpired && (
 <>
 <button
 type="button"
 onClick={() => setShowPassword(!showPassword)}
 className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-muted-foreground dark:hover:bg-surface-2 dark:hover:text-foreground"
 title={showPassword ? t('files.sftp.hidePassword') : t('files.sftp.showPassword')}
 >
 {showPassword ? (
 <EyeOff className="h-3.5 w-3.5" />
 ) : (
 <Eye className="h-3.5 w-3.5" />
 )}
 </button>
 <button
 type="button"
 onClick={() => copyToClipboard(password, 'Password', t('files.sftp.password'))}
 className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-muted-foreground dark:hover:bg-surface-2 dark:hover:text-foreground"
 title={t('files.sftp.copyPassword')}
 >
 {copiedField === 'Password' ? (
 <Check className="h-3.5 w-3.5 text-success" />
 ) : (
 <Copy className="h-3.5 w-3.5" />
 )}
 </button>
 </>
 )}
 </div>
 </div>
 </div>

 {/* Quick connect URI */}
 {password && !isExpired && (
 <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 dark:border-border dark:bg-surface-2/50">
 <span className="text-xs font-medium text-muted-foreground dark:text-muted-foreground">
 {t('files.sftp.quickConnectUri')}
 </span>
 <div className="flex items-center gap-2">
 <code className="flex-1 truncate text-xs text-foreground">
 sftp://{serverId}@{sftpInfo.host}:{sftpInfo.port}
 </code>
 <button
 type="button"
 onClick={() =>
 copyToClipboard(
 `sftp://${serverId}@${sftpInfo.host}:${sftpInfo.port}`,
 'URI',
 t('files.sftp.uri'),
 )
 }
 className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-muted-foreground dark:hover:bg-surface-2 dark:hover:text-foreground"
 title={t('files.sftp.copyUri')}
 >
 {copiedField === 'URI' ? (
 <Check className="h-3.5 w-3.5 text-success" />
 ) : (
 <Copy className="h-3.5 w-3.5" />
 )}
 </button>
 </div>
 </div>
 )}

 {/* Active SFTP connections (owner can see all, non-owners see only their own) */}
 {isOwner ? (
 <div className="space-y-3 pt-2">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-2">
 <Users className="h-4 w-4 text-muted-foreground" />
 <h3 className="text-sm font-semibold text-foreground dark:text-foreground">
 {t('files.sftp.activeSessions')}
 </h3>
 <span className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-xs text-muted-foreground dark:bg-surface-2/50">
 {tokens.length}
 </span>
 </div>
 {tokens.length > 0 && (
 <button
 type="button"
 onClick={() => revokeAllMutation.mutate()}
 disabled={revokeAllMutation.isPending}
 className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/50/5 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/50/10 disabled:opacity-50"
 >
 <Trash2 className={`h-3 w-3 ${revokeAllMutation.isPending ? 'animate-pulse' : ''}`} />
 {t('files.sftp.revokeAll')}
 </button>
 )}
 </div>

 {tokensLoading ? (
 <div className="px-1 text-xs text-muted-foreground">{t('files.sftp.loadingSessions')}</div>
 ) : tokens.length === 0 ? (
 <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
 {t('files.sftp.noSessions')}
 </div>
 ) : (
 <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
 {/* Table header */}
 <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 bg-surface-2/80 px-3 py-2 text-xs font-medium text-muted-foreground dark:bg-surface-2/40">
 <span>{t('files.sftp.user')}</span>
 <span className="w-28 text-right">{t('files.sftp.expires')}</span>
 <span className="w-24 text-right">{t('files.sftp.created')}</span>
 <span className="w-16 text-right">{t('files.sftp.actions')}</span>
 </div>
 {tokens.map((token) => {
 const expired = token.expiresAt <= now;
 return (
 <div
 key={token.userId}
 className={`grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-surface-2/50 dark:hover:bg-surface-2/30 ${
 expired ? 'opacity-50' : ''
 }`}
 >
 {/* User */}
 <div className="min-w-0">
 <div className="flex items-center gap-1.5">
 <span className="truncate font-medium text-foreground">
 {token.username || token.email}
 </span>
 {token.isSelf && (
 <span className="rounded bg-primary-500/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-600 dark:text-primary-400">
 {t('files.sftp.you')}
 </span>
 )}
 </div>
 <span className="truncate text-xs text-muted-foreground">{token.email}</span>
 </div>

 {/* Expires */}
 <span className={`w-28 text-right text-xs ${expired ? 'text-destructive' : 'text-muted-foreground'}`}>
 {expired ? t('files.sftp.expired') : formatExpiry(token.expiresAt)}
 </span>

 {/* Created */}
 <span className="w-24 text-right text-xs text-muted-foreground">
 {formatTimeAgo(token.createdAt)}
 </span>

 {/* Actions */}
 <div className="flex w-16 justify-end gap-1">
 <button
 type="button"
 onClick={() => revokeMutation.mutate(token.userId)}
 disabled={revokeMutation.isPending}
 className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/50/10 hover:text-destructive disabled:opacity-50"
 title={token.isSelf ? t('files.sftp.revokeOwn') : t('files.sftp.revokeFor', { email: token.email })}
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </div>
 </div>
 );
 })}
 </div>
 )}

 <p className="text-[11px] text-muted-foreground">
 <Shield className="mr-1 inline h-3 w-3" />
 {t('files.sftp.footerNote')}
 </p>
 </div>
 ) : tokens.length > 0 ? (
 /* Non-owner: show only their own session in a compact row */
 <div className="space-y-3 pt-2">
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <Users className="h-3.5 w-3.5" />
 <span>
 {t('files.sftp.activeSessionCount', { count: tokens.length })}
 </span>
 </div>
 </div>
 ) : null}
 </div>
 );
}
