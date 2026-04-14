import { useEffect, useState } from 'react';
import { Copy, Check, Eye, EyeOff, RefreshCw, AlertTriangle, Info, Trash2, Shield, Users } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import { notifySuccess, notifyError } from '../../utils/notify';

interface SftpConnectionInfoProps {
  serverId: string;
  isOwner: boolean;
}

/** Time until we consider the token "expiring soon" and show a warning (1 minute) */
const EXPIRY_WARNING_MS = 60 * 1000;

function formatExpiry(expiresAt: number): string {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'Expired';

  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s remaining`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s remaining`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${hours}h ${mins}m remaining`;

  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  if (days < 365) return `${days}d ${hrs}h remaining`;

  const years = Math.floor(days / 365);
  const remDays = days % 365;
  return `${years}y ${remDays}d remaining`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return 'just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function SftpConnectionInfo({ serverId, isOwner }: SftpConnectionInfoProps) {
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [selectedTtl, setSelectedTtl] = useState<number | undefined>(undefined);
  const [now, setNow] = useState(Date.now());

  const { data: sftpInfo, isLoading } = useQuery({
    queryKey: ['sftp-connection-info', serverId],
    queryFn: () => serversApi.getSftpConnectionInfo(serverId, selectedTtl),
    staleTime: 30 * 1000,
  });

  const { data: tokens = [], isLoading: tokensLoading } = useQuery({
    queryKey: ['sftp-tokens', serverId],
    queryFn: () => serversApi.listSftpTokens(serverId),
    staleTime: 5000,
    refetchInterval: 5000,
  });

  const rotateMutation = useMutation({
    mutationFn: (ttlMs?: number) => serversApi.rotateSftpToken(serverId, ttlMs),
    onSuccess: () => {
      notifySuccess('SFTP password rotated');
      queryClient.invalidateQueries({ queryKey: ['sftp-connection-info', serverId] });
      queryClient.invalidateQueries({ queryKey: ['sftp-tokens', serverId] });
      setShowPassword(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to rotate SFTP token';
      notifyError(message);
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (targetUserId: string) => serversApi.revokeSftpToken(serverId, targetUserId),
    onSuccess: (_data, targetUserId) => {
      notifySuccess('SFTP session revoked');
      queryClient.invalidateQueries({ queryKey: ['sftp-tokens', serverId] });
      queryClient.invalidateQueries({ queryKey: ['sftp-connection-info', serverId] });
      if (tokens.some(t => t.userId === targetUserId && t.isSelf)) {
        setShowPassword(false);
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to revoke token';
      notifyError(message);
    },
  });

  const revokeAllMutation = useMutation({
    mutationFn: () => serversApi.revokeAllSftpTokens(serverId),
    onSuccess: (data) => {
      notifySuccess(`Revoked ${data.revoked} SFTP session${data.revoked !== 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['sftp-tokens', serverId] });
      queryClient.invalidateQueries({ queryKey: ['sftp-connection-info', serverId] });
      setShowPassword(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to revoke all tokens';
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

  const copyToClipboard = (value: string, field: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      notifySuccess(`${field} copied to clipboard`);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground dark:text-muted-foreground">Loading SFTP info…</div>
    );
  }

  if (!sftpInfo) {
    return (
      <div className="text-sm text-muted-foreground dark:text-muted-foreground">
        Unable to load SFTP connection details.
      </div>
    );
  }

  if (!sftpInfo.enabled) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          SFTP is disabled on this server.
        </div>
      </div>
    );
  }

  const fields = [
    { label: 'Host', value: sftpInfo.host, key: 'Host' },
    { label: 'Port', value: String(sftpInfo.port), key: 'Port' },
    { label: 'Username', value: serverId, key: 'Username' },
  ];

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground dark:text-muted-foreground">
        Connect using any SFTP client (FileZilla, WinSCP, Cyberduck, etc.). The password is a
        single-purpose token that expires automatically. Each user gets their own unique credentials.
      </p>

      {/* Expiry status banner */}
      {isExpired ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium">SFTP password has expired.</span>
          <button
            type="button"
            onClick={() => rotateMutation.mutate(selectedTtl)}
            disabled={rotateMutation.isPending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-rose-500/20 px-2.5 py-1 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/30 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${rotateMutation.isPending ? 'animate-spin' : ''}`} />
            Rotate now
          </button>
        </div>
      ) : isExpiringSoon ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span className="font-medium">SFTP password expires soon — {formatExpiry(sftpInfo.expiresAt)}</span>
          <button
            type="button"
            onClick={() => rotateMutation.mutate(selectedTtl)}
            disabled={rotateMutation.isPending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-300 transition-colors hover:bg-amber-500/30 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${rotateMutation.isPending ? 'animate-spin' : ''}`} />
            Rotate
          </button>
        </div>
      ) : sftpInfo.expiresAt ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">
          <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" />
          Active — {formatExpiry(sftpInfo.expiresAt)}
        </div>
      ) : null}

      {/* TTL selector + Rotate */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs text-muted-foreground dark:text-zinc-300">
          <span className="flex items-center gap-1">
            Token lifetime
            <span className="group relative">
              <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground" />
              <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded-lg border border-border bg-white px-3 py-2 text-xs leading-relaxed text-muted-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-border dark:bg-surface-2 dark:text-zinc-300">
                How long your SFTP password is valid. Rotating generates a new token.
              </span>
            </span>
          </span>
          <select
            value={selectedTtl ?? ''}
            onChange={(e) => setSelectedTtl(Number(e.target.value) || undefined)}
            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
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
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${rotateMutation.isPending ? 'animate-spin' : ''}`} />
          {isExpired ? 'Generate new' : 'Rotate password'}
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
              <p className="truncate font-mono text-sm text-foreground dark:text-zinc-100">
                {value}
              </p>
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(value, key)}
              className="ml-2 flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-muted-foreground dark:hover:bg-surface-2 dark:hover:text-zinc-300"
              title={`Copy ${label}`}
            >
              {copiedField === key ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
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
              Password
            </span>
            <p className="truncate font-mono text-sm text-foreground dark:text-zinc-100">
              {password && !isExpired
                ? (showPassword ? password : '••••••••••••••••')
                : isExpired
                  ? 'Expired — rotate to generate a new one'
                  : 'No token available'}
            </p>
          </div>
          <div className="ml-2 flex flex-shrink-0 items-center gap-1">
            {password && !isExpired && (
              <>
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-muted-foreground dark:hover:bg-surface-2 dark:hover:text-zinc-300"
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => copyToClipboard(password, 'Password')}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-muted-foreground dark:hover:bg-surface-2 dark:hover:text-zinc-300"
                  title="Copy password"
                >
                  {copiedField === 'Password' ? (
                    <Check className="h-3.5 w-3.5 text-green-500" />
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
            Quick Connect URI
          </span>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate text-xs text-foreground dark:text-zinc-300">
              sftp://{serverId}@{sftpInfo.host}:{sftpInfo.port}
            </code>
            <button
              type="button"
              onClick={() =>
                copyToClipboard(
                  `sftp://${serverId}@${sftpInfo.host}:${sftpInfo.port}`,
                  'URI',
                )
              }
              className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-muted-foreground dark:hover:bg-surface-2 dark:hover:text-zinc-300"
              title="Copy URI"
            >
              {copiedField === 'URI' ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
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
              <h3 className="text-sm font-semibold text-foreground dark:text-white">
                Active SFTP Sessions
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
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/5 px-3 py-1.5 text-xs font-medium text-rose-500 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
              >
                <Trash2 className={`h-3 w-3 ${revokeAllMutation.isPending ? 'animate-pulse' : ''}`} />
                Revoke all sessions
              </button>
            )}
          </div>

          {tokensLoading ? (
            <div className="px-1 text-xs text-muted-foreground">Loading sessions…</div>
          ) : tokens.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground dark:text-zinc-400">
              No active SFTP sessions for this server.
            </div>
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-lg border border-border">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 bg-surface-2/80 px-3 py-2 text-xs font-medium text-muted-foreground dark:bg-surface-2/40">
                <span>User</span>
                <span className="w-28 text-right">Expires</span>
                <span className="w-24 text-right">Created</span>
                <span className="w-16 text-right">Actions</span>
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
                        <span className="truncate font-medium text-foreground dark:text-zinc-100">
                          {token.username || token.email}
                        </span>
                        {token.isSelf && (
                          <span className="rounded bg-primary-500/10 px-1.5 py-0.5 text-[10px] font-medium text-primary-600 dark:text-primary-400">
                            You
                          </span>
                        )}
                      </div>
                      <span className="truncate text-xs text-muted-foreground">{token.email}</span>
                    </div>

                    {/* Expires */}
                    <span className={`w-28 text-right text-xs ${expired ? 'text-rose-400' : 'text-muted-foreground'}`}>
                      {expired ? 'Expired' : formatExpiry(token.expiresAt)}
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
                        className="rounded p-1 text-muted-foreground transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"
                        title={token.isSelf ? 'Revoke your session' : `Revoke session for ${token.email}`}
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
            Removing a user from this server instantly revokes their SFTP sessions. You can also
            manually revoke sessions here.
          </p>
        </div>
      ) : tokens.length > 0 ? (
        /* Non-owner: show only their own session in a compact row */
        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            <span>
              {tokens.length} active session{tokens.length !== 1 ? 's' : ''} on this server
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
