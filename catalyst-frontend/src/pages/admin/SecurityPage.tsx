import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
import {
  ShieldCheck,
  Search,
  Lock,
  Zap,
  Unlock,
  Info,
  FolderSync,
} from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '../../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuthLockouts, useSecuritySettings } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import Pagination from '../../components/shared/Pagination';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

// ── Tooltip Helper ──
function Tooltip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/60" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-muted-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:text-zinc-300">
        {text}
      </span>
    </span>
  );
}

// ── Number Field ──
function NumberField({
  label,
  value,
  onChange,
  tooltip,
  min = '1',
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tooltip?: string;
  min?: string;
  max?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {label}
        {tooltip && <Tooltip text={tooltip} />}
      </span>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
      />
    </label>
  );
}

// ── Section Wrapper ──
function Section({
  title,
  subtitle,
  icon,
  iconColor,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  iconColor?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <motion.div
      variants={itemVariants}
      className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm"
    >
      <div className="border-b border-border/50 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${iconColor || 'bg-primary-100 dark:bg-primary-900/30'}`}>
            {icon}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground dark:text-white">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && (
        <div className="flex items-center justify-end border-t border-border/50 px-5 py-3">
          {footer}
        </div>
      )}
    </motion.div>
  );
}

// ── Lockout Row ──
function LockoutRow({
  lockout,
  onClear,
  isClearing,
  index,
}: {
  lockout: any;
  onClear: () => void;
  isClearing: boolean;
  index: number;
}) {
  const isActive = !lockout.lockedUntil;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.02 }}
      className="group flex flex-wrap items-center gap-4 border-b border-border/30 px-5 py-3.5 last:border-b-0 transition-colors hover:bg-surface-2/30"
    >
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isActive ? 'bg-rose-100 dark:bg-rose-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
          {isActive ? (
            <Lock className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
          ) : (
            <Unlock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
          )}
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground dark:text-zinc-100">{lockout.email}</div>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{lockout.ipAddress}</span>
            <span>·</span>
            <span>{lockout.failureCount} attempts</span>
            <span>·</span>
            <span>Last: {new Date(lockout.lastFailedAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Badge variant={isActive ? 'destructive' : 'secondary'} className="text-[10px] shrink-0">
          {isActive ? 'Locked' : 'Expired'}
        </Badge>
        {lockout.lockedUntil && (
          <span className="hidden text-[11px] text-muted-foreground sm:block">
            Until {new Date(lockout.lockedUntil).toLocaleString()}
          </span>
        )}
        <button
          className="rounded-md p-1.5 text-muted-foreground opacity-100 transition-colors hover:bg-primary/5 hover:text-primary sm:opacity-0 sm:group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
          onClick={onClear}
          disabled={isClearing}
          title="Clear lockout"
        >
          <Unlock className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

// ── Constants ──
const MIN_CONSOLE_OUTPUT_BYTES_PER_SECOND = 64 * 1024;
const MAX_CONSOLE_OUTPUT_BYTES_PER_SECOND = 10 * 1024 * 1024;

// ── Main Page ──
function SecurityPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSecuritySettings();
  const [search, setSearch] = useState('');
  const [lockoutPage, setLockoutPage] = useState(1);
  const lockoutPageSize = 20;

  // Security settings state
  const [authRateLimitMax, setAuthRateLimitMax] = useState('5');
  const [fileRateLimitMax, setFileRateLimitMax] = useState('30');
  const [consoleRateLimitMax, setConsoleRateLimitMax] = useState('60');
  const [consoleOutputLinesMax, setConsoleOutputLinesMax] = useState('2000');
  const [consoleOutputByteLimitBytes, setConsoleOutputByteLimitBytes] = useState('2097152');
  const [agentMessageMax, setAgentMessageMax] = useState('10000');
  const [agentMetricsMax, setAgentMetricsMax] = useState('10000');
  const [serverMetricsMax, setServerMetricsMax] = useState('60');
  const [lockoutMaxAttempts, setLockoutMaxAttempts] = useState('5');
  const [lockoutWindowMinutes, setLockoutWindowMinutes] = useState('15');
  const [lockoutDurationMinutes, setLockoutDurationMinutes] = useState('15');
  const [auditRetentionDays, setAuditRetentionDays] = useState('90');
  const [maxBufferMb, setMaxBufferMb] = useState('50');
  // File tunnel settings
  const [fileTunnelRateLimitMax, setFileTunnelRateLimitMax] = useState('100');
  const [fileTunnelMaxUploadMb, setFileTunnelMaxUploadMb] = useState('100');
  const [fileTunnelMaxPendingPerNode, setFileTunnelMaxPendingPerNode] = useState('50');
  const [fileTunnelConcurrentMax, setFileTunnelConcurrentMax] = useState('10');

  const { data: lockoutResponse, isLoading: lockoutsLoading } = useAuthLockouts({
    page: lockoutPage,
    limit: lockoutPageSize,
    search: search.trim() || undefined,
  });

  useEffect(() => {
    if (!settings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAuthRateLimitMax(String(settings.authRateLimitMax));
    setFileRateLimitMax(String(settings.fileRateLimitMax));
    setConsoleRateLimitMax(String(settings.consoleRateLimitMax));
    setConsoleOutputLinesMax(String(settings.consoleOutputLinesMax));
    setConsoleOutputByteLimitBytes(String(settings.consoleOutputByteLimitBytes));
    setAgentMessageMax(String(settings.agentMessageMax));
    setAgentMetricsMax(String(settings.agentMetricsMax));
    setServerMetricsMax(String(settings.serverMetricsMax));
    setLockoutMaxAttempts(String(settings.lockoutMaxAttempts));
    setLockoutWindowMinutes(String(settings.lockoutWindowMinutes));
    setLockoutDurationMinutes(String(settings.lockoutDurationMinutes));
    setAuditRetentionDays(String(settings.auditRetentionDays));
    setMaxBufferMb(String(settings.maxBufferMb));
    setFileTunnelRateLimitMax(String(settings.fileTunnelRateLimitMax ?? 100));
    setFileTunnelMaxUploadMb(String(settings.fileTunnelMaxUploadMb ?? 100));
    setFileTunnelMaxPendingPerNode(String(settings.fileTunnelMaxPendingPerNode ?? 50));
    setFileTunnelConcurrentMax(String(settings.fileTunnelConcurrentMax ?? 10));
  }, [settings]);

  const canSubmit = useMemo(
    () =>
      Number(authRateLimitMax) > 0 &&
      Number(fileRateLimitMax) > 0 &&
      Number(consoleRateLimitMax) > 0 &&
      Number(consoleOutputLinesMax) > 0 &&
      Number(consoleOutputByteLimitBytes) >= MIN_CONSOLE_OUTPUT_BYTES_PER_SECOND &&
      Number(consoleOutputByteLimitBytes) <= MAX_CONSOLE_OUTPUT_BYTES_PER_SECOND &&
      Number(agentMessageMax) > 0 &&
      Number(agentMetricsMax) > 0 &&
      Number(serverMetricsMax) > 0 &&
      Number(lockoutMaxAttempts) > 0 &&
      Number(lockoutWindowMinutes) > 0 &&
      Number(lockoutDurationMinutes) > 0 &&
      Number(auditRetentionDays) > 0 &&
      Number(maxBufferMb) >= 1 &&
      Number(fileTunnelRateLimitMax) > 0 &&
      Number(fileTunnelMaxUploadMb) > 0 &&
      Number(fileTunnelMaxPendingPerNode) > 0 &&
      Number(fileTunnelConcurrentMax) > 0,
    [
      authRateLimitMax, fileRateLimitMax, consoleRateLimitMax, consoleOutputLinesMax,
      consoleOutputByteLimitBytes, agentMessageMax, agentMetricsMax, serverMetricsMax,
      lockoutMaxAttempts, lockoutWindowMinutes, lockoutDurationMinutes, auditRetentionDays,
      maxBufferMb, fileTunnelRateLimitMax, fileTunnelMaxUploadMb, fileTunnelMaxPendingPerNode,
      fileTunnelConcurrentMax,
    ],
  );

  const updateMutation = useMutation({
    mutationFn: () =>
      adminApi.updateSecuritySettings({
        authRateLimitMax: Number(authRateLimitMax),
        fileRateLimitMax: Number(fileRateLimitMax),
        consoleRateLimitMax: Number(consoleRateLimitMax),
        consoleOutputLinesMax: Number(consoleOutputLinesMax),
        consoleOutputByteLimitBytes: Number(consoleOutputByteLimitBytes),
        agentMessageMax: Number(agentMessageMax),
        agentMetricsMax: Number(agentMetricsMax),
        serverMetricsMax: Number(serverMetricsMax),
        lockoutMaxAttempts: Number(lockoutMaxAttempts),
        lockoutWindowMinutes: Number(lockoutWindowMinutes),
        lockoutDurationMinutes: Number(lockoutDurationMinutes),
        auditRetentionDays: Number(auditRetentionDays),
        maxBufferMb: Number(maxBufferMb),
        fileTunnelRateLimitMax: Number(fileTunnelRateLimitMax),
        fileTunnelMaxUploadMb: Number(fileTunnelMaxUploadMb),
        fileTunnelMaxPendingPerNode: Number(fileTunnelMaxPendingPerNode),
        fileTunnelConcurrentMax: Number(fileTunnelConcurrentMax),
      }),
    onSuccess: () => {
      notifySuccess('Security settings updated');
      queryClient.invalidateQueries({ queryKey: ['admin-security-settings'] });
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update security settings'),
  });

  const clearMutation = useMutation({
    mutationFn: (lockoutId: string) => adminApi.clearAuthLockout(lockoutId),
    onSuccess: () => {
      notifySuccess('Lockout cleared');
      queryClient.invalidateQueries({ queryKey: ['admin-auth-lockouts'] });
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to clear lockout'),
  });

  const lockouts = lockoutResponse?.lockouts ?? [];
  const lockoutPagination = lockoutResponse?.pagination;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-rose-500/8 to-red-500/8 blur-3xl dark:from-rose-500/15 dark:to-red-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-slate-500/8 to-zinc-500/8 blur-3xl dark:from-slate-500/15 dark:to-zinc-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-rose-500 to-red-500 opacity-20 blur-sm" />
                <ShieldCheck className="relative h-7 w-7 text-rose-600 dark:text-rose-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                Security
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Configure rate limits, lockout policy, and audit retention.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {lockoutResponse?.pagination?.total ?? lockouts.length} lockouts
            </Badge>
          </div>
        </motion.div>

        {/* ── Rate Limits Section ── */}
        <Section
          title="Rate Limits"
          subtitle="Requests per minute unless noted. Adjust to prevent abuse while allowing normal usage."
          icon={<Zap className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
          iconColor="bg-amber-100 dark:bg-amber-900/30"
          footer={
            <Button size="sm" disabled={!canSubmit || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
              {updateMutation.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <NumberField
                label="Auth requests / min"
                value={authRateLimitMax}
                onChange={setAuthRateLimitMax}
              />
              <NumberField
                label="File operations / min"
                value={fileRateLimitMax}
                onChange={setFileRateLimitMax}
              />
              <NumberField
                label="Console input / min"
                value={consoleRateLimitMax}
                onChange={setConsoleRateLimitMax}
              />
              <NumberField
                label="Console output lines / sec"
                value={consoleOutputLinesMax}
                onChange={setConsoleOutputLinesMax}
                tooltip="Maximum lines per second from server console output. Increase for servers with large startup logs."
              />
              <NumberField
                label="Console output bytes / sec"
                value={consoleOutputByteLimitBytes}
                onChange={setConsoleOutputByteLimitBytes}
                min={String(MIN_CONSOLE_OUTPUT_BYTES_PER_SECOND)}
                max={String(MAX_CONSOLE_OUTPUT_BYTES_PER_SECOND)}
                tooltip="Per-server websocket console output cap. Allowed range is 65,536 to 10,485,760 bytes per second."
              />
              <NumberField
                label="Agent messages / sec"
                value={agentMessageMax}
                onChange={setAgentMessageMax}
                tooltip="Maximum WebSocket messages per second from each agent node."
              />
              <NumberField
                label="Agent metrics / sec"
                value={agentMetricsMax}
                onChange={setAgentMetricsMax}
                tooltip="Maximum agent-level metric messages per second from each agent node."
              />
              <NumberField
                label="Server metrics / sec"
                value={serverMetricsMax}
                onChange={setServerMetricsMax}
                tooltip="Maximum server-level metric messages per second per server."
              />
              <NumberField
                label="Max buffer (MB)"
                value={maxBufferMb}
                onChange={setMaxBufferMb}
                min="1"
                tooltip="Maximum output buffer for file operations (compress, decompress, archive browsing). Increase if large archives fail with buffer errors."
              />
            </div>
          </div>
        </Section>

        {/* ── Lockout Policy ── */}
        <Section
          title="Lockout Policy"
          subtitle="Failed login attempts trigger temporary lockouts per email + IP combination."
          icon={<Lock className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
          iconColor="bg-rose-100 dark:bg-rose-900/30"
          footer={
            <Button size="sm" disabled={!canSubmit || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
              {updateMutation.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <NumberField
              label="Max attempts"
              value={lockoutMaxAttempts}
              onChange={setLockoutMaxAttempts}
            />
            <NumberField
              label="Window (minutes)"
              value={lockoutWindowMinutes}
              onChange={setLockoutWindowMinutes}
            />
            <NumberField
              label="Duration (minutes)"
              value={lockoutDurationMinutes}
              onChange={setLockoutDurationMinutes}
            />
            <NumberField
              label="Audit retention (days)"
              value={auditRetentionDays}
              onChange={setAuditRetentionDays}
            />
          </div>
        </Section>

        {/* ── File Tunnel Settings ── */}
        <Section
          title="File Tunnel"
          subtitle="Limits for the agent file tunnel used for file operations."
          icon={<FolderSync className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
          iconColor="bg-blue-100 dark:bg-blue-900/30"
          footer={
            <Button size="sm" disabled={!canSubmit || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
              {updateMutation.isPending ? 'Saving…' : 'Save settings'}
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NumberField
              label="Tunnel requests / min"
              value={fileTunnelRateLimitMax}
              onChange={setFileTunnelRateLimitMax}
              tooltip="Maximum file tunnel requests per minute per agent node."
            />
            <NumberField
              label="Max upload size (MB)"
              value={fileTunnelMaxUploadMb}
              onChange={setFileTunnelMaxUploadMb}
              tooltip="Maximum file upload size in megabytes for file tunnel operations."
            />
            <NumberField
              label="Max pending per node"
              value={fileTunnelMaxPendingPerNode}
              onChange={setFileTunnelMaxPendingPerNode}
              tooltip="Maximum pending file operations queued per agent node."
            />
            <NumberField
              label="Max concurrent (agent)"
              value={fileTunnelConcurrentMax}
              onChange={setFileTunnelConcurrentMax}
              tooltip="Maximum concurrent file operations processed by each agent. Requires agent restart to take effect."
            />
          </div>
        </Section>

        {/* ── Auth Lockouts ── */}
        <motion.div
          variants={itemVariants}
          className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm"
        >
          <div className="border-b border-border/50 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
                  <Lock className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground dark:text-white">Auth Lockouts</h2>
                  <p className="text-xs text-muted-foreground">Track recent lockout entries.</p>
                </div>
              </div>
              <div className="relative min-w-[180px] max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setLockoutPage(1); }}
                  placeholder="Search lockouts…"
                  className="pl-9"
                />
              </div>
            </div>
          </div>

          {lockoutsLoading ? (
            <div className="space-y-1 px-5 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3 py-3">
                  <div className="h-8 w-8 animate-pulse rounded-lg bg-surface-3" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-36 animate-pulse rounded bg-surface-3" />
                    <div className="h-3 w-48 animate-pulse rounded bg-surface-2" />
                  </div>
                </div>
              ))}
            </div>
          ) : lockouts.length > 0 ? (
            <>
              <div>
                {lockouts.map((lockout: any, i: number) => (
                  <LockoutRow
                    key={lockout.id}
                    lockout={lockout}
                    index={i}
                    onClear={() => clearMutation.mutate(lockout.id)}
                    isClearing={clearMutation.isPending}
                  />
                ))}
              </div>
              {lockoutPagination && lockoutPagination.totalPages > 1 && (
                <div className="flex justify-center border-t border-border/50 pt-3">
                  <Pagination
                    page={lockoutPagination.page}
                    totalPages={lockoutPagination.totalPages}
                    onPageChange={setLockoutPage}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="px-5 py-8">
              <EmptyState
                title="No lockouts"
                description="Failed login attempts will show here."
              />
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

export default SecurityPage;
