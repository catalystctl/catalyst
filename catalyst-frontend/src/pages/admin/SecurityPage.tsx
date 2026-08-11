import { useMemo, useState } from 'react';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 ShieldCheck,
 Search,
 Lock,
 Zap,
 Unlock,
 Info,
 FolderSync,
 MailCheck,
} from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '../../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuthLockouts, useSecuritySettings } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import Pagination from '../../components/shared/Pagination';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '../../components/ui/select';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';

// ── Time Window Constants ──
const TIME_WINDOWS = [
 { value: '1000', label: 'second' },
 { value: '60000', label: 'minute' },
 { value: '3600000', label: 'hour' },
 { value: '86400000', label: 'day' },
 { value: '2592000000', label: 'month' },
] as const;

// ── Tooltip Helper ──
function Tooltip({ text }: { text: string }) {
 return (
 <span className="group relative inline-flex">
 <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/60" />
 <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
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
 <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
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

// ── Rate Limit Field (count + time unit dropdown) ──
function RateLimitField({
 label,
 countValue,
 onCountChange,
 windowValue,
 onWindowChange,
 tooltip,
 min = '1',
 max,
}: {
 label: string;
 countValue: string;
 onCountChange: (v: string) => void;
 windowValue: string;
 onWindowChange: (v: string) => void;
 tooltip?: string;
 min?: string;
 max?: string;
}) {
 return (
 <label className="block space-y-1">
 <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">
 {label}
 {tooltip && <Tooltip text={tooltip} />}
 </span>
 <div className="flex items-center gap-1.5">
 <Input
 type="number"
 value={countValue}
 onChange={(e) => onCountChange(e.target.value)}
 min={min}
 max={max}
 className="flex-1"
 />
 <span className="text-xs text-muted-foreground shrink-0">per</span>
 <Select value={windowValue} onValueChange={onWindowChange}>
 <SelectTrigger className="w-[100px] shrink-0">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {TIME_WINDOWS.map((w) => (
 <SelectItem key={w.value} value={w.value}>
 {w.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </label>
 );
}

// ── Section Wrapper ──
function Section({
 title,
 subtitle,
 icon,
 children,
 footer,
}: {
 title: string;
 subtitle?: string;
 icon: React.ReactNode;
 children: React.ReactNode;
 footer?: React.ReactNode;
}) {
 return (
 <ServerTabCard>
 <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />
 <div className="flex items-center gap-2.5">
 <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
 {icon}
 </div>
 <div>
 <SectionHeader icon={Info} title={title} />
 {subtitle && <p className="text-[11px] text-muted-foreground/60 -mt-2">{subtitle}</p>}
 </div>
 </div>
 <div className="mt-3">{children}</div>
 {footer && (
 <div className="mt-4 flex items-center justify-end border-t border-border/30 pt-3">
 {footer}
 </div>
 )}
 </ServerTabCard>
 );
}

// ── Lockout Row ──
function LockoutRow({
 lockout,
 onClear,
 isClearing,
}: {
 lockout: any;
 onClear: () => void;
 isClearing: boolean;
}) {
 const isActive = !lockout.lockedUntil;
 return (
 <div className="group flex flex-wrap items-center gap-4 border-b border-border/30 px-5 py-3.5 last:border-b-0 transition-colors hover:bg-surface-2/30">
 <div className="flex items-center gap-2.5 min-w-0 flex-1">
 <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isActive ? 'bg-destructive/10' : 'bg-warning/10'}`}>
 {isActive ? (
 <Lock className="h-3.5 w-3.5 text-destructive" />
 ) : (
 <Unlock className="h-3.5 w-3.5 text-warning" />
 )}
 </div>
 <div className="min-w-0">
 <div className="truncate text-sm font-medium text-foreground">{lockout.email}</div>
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
 </div>
 );
}

// ── Constants ──
const MIN_CONSOLE_OUTPUT_BYTES_PER_SECOND = 64 * 1024;
const MAX_CONSOLE_OUTPUT_BYTES_PER_SECOND = 10 * 1024 * 1024;

// ── Main Page ──
function SecurityPage() {
 const { data: settings } = useSecuritySettings();
 const [search, setSearch] = useState('');
 const [lockoutPage, setLockoutPage] = useState(1);
 const lockoutPageSize = 20;

 // ── Rate limit state (count + time window) ──
 const [authRateLimitMax, setAuthRateLimitMax] = useState('60');
 const [authRateLimitWindowMs, setAuthRateLimitWindowMs] = useState('60000');
 const [fileRateLimitMax, setFileRateLimitMax] = useState('180');
 const [fileRateLimitWindowMs, setFileRateLimitWindowMs] = useState('60000');
 const [consoleRateLimitMax, setConsoleRateLimitMax] = useState('120');
 const [consoleRateLimitWindowMs, setConsoleRateLimitWindowMs] = useState('60000');

 // ── Per-second throughput limits (no time window selector) ──
 const [consoleOutputLinesMax, setConsoleOutputLinesMax] = useState('2000');
 const [consoleOutputByteLimitBytes, setConsoleOutputByteLimitBytes] = useState('2097152');
 const [agentMessageMax, setAgentMessageMax] = useState('10000');
 const [agentMetricsMax, setAgentMetricsMax] = useState('10000');
 const [serverMetricsMax, setServerMetricsMax] = useState('60');
 const [maxBufferMb, setMaxBufferMb] = useState('50');

 // ── Lockout policy ──
 const [lockoutMaxAttempts, setLockoutMaxAttempts] = useState('5');
 const [lockoutWindowMinutes, setLockoutWindowMinutes] = useState('15');
 const [lockoutDurationMinutes, setLockoutDurationMinutes] = useState('15');
 const [auditRetentionDays, setAuditRetentionDays] = useState('90');

 // ── File tunnel settings ──
 const [fileTunnelRateLimitMax, setFileTunnelRateLimitMax] = useState('100');
 const [fileTunnelRateLimitWindowMs, setFileTunnelRateLimitWindowMs] = useState('60000');
 const [fileTunnelMaxUploadMb, setFileTunnelMaxUploadMb] = useState('100');
 const [fileTunnelMaxPendingPerNode, setFileTunnelMaxPendingPerNode] = useState('50');
 const [fileTunnelConcurrentMax, setFileTunnelConcurrentMax] = useState('10');
 const [requireEmailVerification, setRequireEmailVerification] = useState(true);

 const { data: lockoutResponse, isLoading: lockoutsLoading } = useAuthLockouts({
 page: lockoutPage,
 limit: lockoutPageSize,
 search: search.trim() || undefined,
 });

 const [prevSettings, setPrevSettings] = useState(settings);
 if (settings !== prevSettings) {
 setPrevSettings(settings);
 if (settings) {
 setAuthRateLimitMax(String(settings.authRateLimitMax));
 setAuthRateLimitWindowMs(String(settings.authRateLimitWindowMs ?? 60000));
 setFileRateLimitMax(String(settings.fileRateLimitMax));
 setFileRateLimitWindowMs(String(settings.fileRateLimitWindowMs ?? 60000));
 setConsoleRateLimitMax(String(settings.consoleRateLimitMax));
 setConsoleRateLimitWindowMs(String(settings.consoleRateLimitWindowMs ?? 60000));
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
 setFileTunnelRateLimitWindowMs(String(settings.fileTunnelRateLimitWindowMs ?? 60000));
 setFileTunnelMaxUploadMb(String(settings.fileTunnelMaxUploadMb ?? 100));
 setFileTunnelMaxPendingPerNode(String(settings.fileTunnelMaxPendingPerNode ?? 50));
 setFileTunnelConcurrentMax(String(settings.fileTunnelConcurrentMax ?? 10));
 setRequireEmailVerification(settings.requireEmailVerification ?? true);
 }
 }

 // ── Validate time window values ──
 const validTimeWindows = useMemo(() => new Set(TIME_WINDOWS.map((w) => Number(w.value))), []);

 const canSubmit = useMemo(
 () =>
 Number(authRateLimitMax) > 0 &&
 validTimeWindows.has(Number(authRateLimitWindowMs)) &&
 Number(fileRateLimitMax) > 0 &&
 validTimeWindows.has(Number(fileRateLimitWindowMs)) &&
 Number(consoleRateLimitMax) > 0 &&
 validTimeWindows.has(Number(consoleRateLimitWindowMs)) &&
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
 validTimeWindows.has(Number(fileTunnelRateLimitWindowMs)) &&
 Number(fileTunnelMaxUploadMb) > 0 &&
 Number(fileTunnelMaxPendingPerNode) > 0 &&
 Number(fileTunnelConcurrentMax) > 0
 ,
 [
 authRateLimitMax, authRateLimitWindowMs,
 fileRateLimitMax, fileRateLimitWindowMs,
 consoleRateLimitMax, consoleRateLimitWindowMs,
 consoleOutputLinesMax, consoleOutputByteLimitBytes,
 agentMessageMax, agentMetricsMax, serverMetricsMax,
 lockoutMaxAttempts, lockoutWindowMinutes, lockoutDurationMinutes,
 auditRetentionDays, maxBufferMb,
 fileTunnelRateLimitMax, fileTunnelRateLimitWindowMs,
 fileTunnelMaxUploadMb, fileTunnelMaxPendingPerNode,
 fileTunnelConcurrentMax,
 validTimeWindows,
 ],
 );

 const updateMutation = useMutation({
 mutationFn: () =>
 adminApi.updateSecuritySettings({
 authRateLimitMax: Number(authRateLimitMax),
 authRateLimitWindowMs: Number(authRateLimitWindowMs),
 fileRateLimitMax: Number(fileRateLimitMax),
 fileRateLimitWindowMs: Number(fileRateLimitWindowMs),
 consoleRateLimitMax: Number(consoleRateLimitMax),
 consoleRateLimitWindowMs: Number(consoleRateLimitWindowMs),
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
 fileTunnelRateLimitWindowMs: Number(fileTunnelRateLimitWindowMs),
 fileTunnelMaxUploadMb: Number(fileTunnelMaxUploadMb),
 fileTunnelMaxPendingPerNode: Number(fileTunnelMaxPendingPerNode),
 fileTunnelConcurrentMax: Number(fileTunnelConcurrentMax),
 requireEmailVerification,
 }),
 onSuccess: () => notifySuccess('Security settings updated'),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminSecuritySettings() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update security settings'),
 });

 const clearMutation = useMutation({
 mutationFn: (lockoutId: string) => adminApi.clearAuthLockout(lockoutId),
 onSuccess: () => notifySuccess('Lockout cleared'),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminAuthLockouts() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to clear lockout'),
 });

 const lockouts = lockoutResponse?.lockouts ?? [];
 const lockoutPagination = lockoutResponse?.pagination;

 return (
 <div className="space-y-5">
 {/* ── Header ── */}
 <TabHeader
 icon={ShieldCheck}
 title="Security"
 description="Configure rate limits, lockout policy, and audit retention"
 variant="danger"
 actions={
 <Badge variant="outline" className="text-[11px]">
 {lockoutResponse?.pagination?.total ?? lockouts.length} lockouts
 </Badge>
 }
 />

 {/* ── Rate Limits Section ── */}
 <Section
 title="Rate Limits"
 subtitle="Adjust request counts and time windows to prevent abuse while allowing normal usage."
 icon={<Zap className="h-4 w-4 text-warning" />}
 footer={
 <Button size="sm" disabled={!canSubmit || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
 {updateMutation.isPending ? 'Saving…' : 'Save settings'}
 </Button>
 }
 >
 <div className="space-y-4">
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
 <RateLimitField
 label="Auth requests"
 countValue={authRateLimitMax}
 onCountChange={setAuthRateLimitMax}
 windowValue={authRateLimitWindowMs}
 onWindowChange={setAuthRateLimitWindowMs}
 tooltip="Maximum authentication API requests (login, register, etc.) per time window."
 />
 <RateLimitField
 label="File operations"
 countValue={fileRateLimitMax}
 onCountChange={setFileRateLimitMax}
 windowValue={fileRateLimitWindowMs}
 onWindowChange={setFileRateLimitWindowMs}
 tooltip="Maximum file and mod/plugin API requests per time window. Applies to list, read, write, upload, compress, decompress, download, and delete operations."
 />
 <RateLimitField
 label="Console input"
 countValue={consoleRateLimitMax}
 onCountChange={setConsoleRateLimitMax}
 windowValue={consoleRateLimitWindowMs}
 onWindowChange={setConsoleRateLimitWindowMs}
 tooltip="Maximum console command submissions per time window via WebSocket."
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

 {/* ── Email Verification Section ── */}
 <Section
 title="Email Verification"
 subtitle="Control whether new users must verify their email before signing in."
 icon={<MailCheck className="h-4 w-4 text-success" />}
 footer={
 <Button size="sm" disabled={!canSubmit || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
 {updateMutation.isPending ? 'Saving…' : 'Save settings'}
 </Button>
 }
 >
 <div className="flex items-center justify-between gap-4">
 <div className="space-y-1">
 <p className="text-sm font-medium text-foreground">
 Require email verification
 </p>
 <p className="text-xs text-muted-foreground">
 When enabled, new users must click a verification link in their email before they can sign in.
 When disabled, users can sign in immediately after registration without verifying their email.
 </p>
 </div>
 <button
 role="switch"
 aria-checked={requireEmailVerification}
 onClick={() => setRequireEmailVerification(!requireEmailVerification)}
 className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${requireEmailVerification ? 'bg-primary' : 'bg-surface-3'}`}
 >
 <span
 aria-hidden="true"
 className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white ring-0 transition-transform duration-200 ease-in-out ${requireEmailVerification ? 'translate-x-5' : 'translate-x-0'}`}
 />
 </button>
 </div>
 {!requireEmailVerification && (
 <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/20 bg-warning/5 px-3 py-2">
 <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
 <p className="text-xs text-warning">
 Disabling email verification allows anyone to register with unverified email addresses. This may increase spam and abuse risk.
 </p>
 </div>
 )}
 </Section>

 {/* ── Lockout Policy ── */}
 <Section
 title="Lockout Policy"
 subtitle="Failed login attempts trigger temporary lockouts per email + IP combination."
 icon={<Lock className="h-4 w-4 text-destructive" />}
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
 icon={<FolderSync className="h-4 w-4 text-info" />}
 footer={
 <Button size="sm" disabled={!canSubmit || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
 {updateMutation.isPending ? 'Saving…' : 'Save settings'}
 </Button>
 }
 >
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <RateLimitField
 label="Tunnel requests"
 countValue={fileTunnelRateLimitMax}
 onCountChange={setFileTunnelRateLimitMax}
 windowValue={fileTunnelRateLimitWindowMs}
 onWindowChange={setFileTunnelRateLimitWindowMs}
 tooltip="Maximum file tunnel requests per time window per agent node."
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
 <ServerTabCard>
 <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-2.5">
 <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
 <Lock className="h-4 w-4 text-destructive" />
 </div>
 <div>
 <h2 className="text-sm font-semibold text-foreground">Auth Lockouts</h2>
 <p className="text-[11px] text-muted-foreground">Track recent lockout entries.</p>
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

 <div className="mt-3 -mx-5 -mb-4">
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
 {lockouts.map((lockout: any) => (
 <LockoutRow
 key={lockout.id}
 lockout={lockout}
 onClear={() => clearMutation.mutate(lockout.id)}
 isClearing={clearMutation.isPending}
 />
 ))}
 </div>
 {lockoutPagination && lockoutPagination.totalPages > 1 && (
 <div className="flex justify-center border-t border-border/30 pt-3 pb-3">
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
 </div>
 </ServerTabCard>
 </div>
 );
}

export default SecurityPage;
