import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
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
 Bot,
} from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import { Input } from '../../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAuthLockouts, useMcpSettings, useSecuritySettings } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import type { AuthLockout } from '../../types/admin';
import Pagination from '../../components/shared/Pagination';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '../../components/ui/select';
import TabHeader from '../../components/servers/tabs/TabHeader';
import { BracketLabel, StatusLed } from '../../components/deck/primitives';
import { formatDateTime } from '../../i18n/format';

// ── Time Window Constants ──
const TIME_WINDOWS = ['1000', '60000', '3600000', '86400000', '2592000000'] as const;

/** Display label for a rate-limit time window value (milliseconds). */
function timeWindowLabel(t: TFunction<'admin-access'>, value: string): string {
 switch (value) {
 case '1000': return t('security.timeUnitSecond');
 case '60000': return t('security.timeUnitMinute');
 case '3600000': return t('security.timeUnitHour');
 case '86400000': return t('security.timeUnitDay');
 case '2592000000': return t('security.timeUnitMonth');
 default: return value;
 }
}


// ── Tooltip Helper ──
// Radix portal tooltip: the previous custom absolute tooltip was clipped by
// the panel's overflow-hidden and rendered unreadable underneath content.
// The portal escapes the panel so the text stays visible.
function Tooltip({ text }: { text: string }) {
 return (
 <TooltipProvider>
 <UiTooltip>
 <TooltipTrigger asChild>
 <span className="inline-flex" tabIndex={0} aria-label={text}>
 <Info className="h-3.5 w-3.5 cursor-help text-muted-foreground/60" />
 </span>
 </TooltipTrigger>
 <TooltipContent side="top" className="max-w-xs text-mini leading-relaxed">
 {text}
 </TooltipContent>
 </UiTooltip>
 </TooltipProvider>
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
 <span className="type-overline flex items-center gap-1.5">
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
 const { t } = useTranslation('admin-access');
 return (
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1.5">
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
 <span className="shrink-0 text-mini text-muted-foreground">{t('security.per')}</span>
 <Select value={windowValue} onValueChange={onWindowChange}>
 <SelectTrigger className="h-7 w-[100px] shrink-0 rounded-sm text-mini">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {TIME_WINDOWS.map((value) => (
 <SelectItem key={value} value={value}>
 {timeWindowLabel(t, value)}
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
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="deck-panel">
      <div className="border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {icon ? <span className="text-muted-foreground">{icon}</span> : null}
          <BracketLabel>{title}</BracketLabel>
        </div>
        {subtitle ? <p className="mt-0.5 text-micro text-muted-foreground">{subtitle}</p> : null}
      </div>
      <div className="p-3">
        {children}
        {footer ? <div className="mt-3 flex justify-end border-t border-border/40 pt-2">{footer}</div> : null}
      </div>
    </div>
  );
}


// ── Panel-hosted MCP (Streamable HTTP) ──
// Self-contained card: own query + mutation so the toggle saves instantly
// and takes effect without a panel restart.
function McpSettingsCard() {
  const { t } = useTranslation('admin-access');
  const { data: mcp } = useMcpSettings();
  const [enabled, setEnabled] = useState(false);
  const [budget, setBudget] = useState('300');
  const [riskOpen, setRiskOpen] = useState(false);

  const [prevMcp, setPrevMcp] = useState<typeof mcp | undefined>(undefined);
  if (mcp !== prevMcp) {
    setPrevMcp(mcp);
    if (mcp) {
      setEnabled(mcp.enabled);
      setBudget(String(mcp.toolRateLimitMax));
    }
  }

  const canSubmit = Number.isFinite(Number(budget)) && Number(budget) >= 10 && Number(budget) <= 5000;

  const saveMutation = useMutation({
    mutationFn: () => adminApi.updateMcpSettings({ enabled, toolRateLimitMax: Number(budget) }),
    onSuccess: () => notifySuccess(t('security.mcpSaved')),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminMcpSettings() });
    },
    onError: (error: unknown) => notifyError(error),
  });

  // Enabling is gated behind an explicit risk acknowledgment: flipping the
  // switch on opens the dialog, and the switch only engages on confirm.
  const handleToggle = (next: boolean) => {
    if (next && !enabled) {
      setRiskOpen(true);
      return;
    }
    setEnabled(next);
  };

  const endpoint = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp';

  return (
    <Section
      title={t('security.mcpTitle')}
      subtitle={t('security.mcpDescription')}
      icon={<Bot className="h-3.5 w-3.5 text-info" />}
      footer={
        <Button size="sm" disabled={!canSubmit || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? t('saving') : t('common:actions.save')}
        </Button>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-foreground">{t('security.mcpEnable')}</p>
          <p className="text-micro text-muted-foreground">{t('security.mcpEnableDescription')}</p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={handleToggle}
          aria-label={t('security.mcpEnableAria')}
        />
      </div>
      <ConfirmDialog
        open={riskOpen}
        variant="danger"
        title={t('security.mcpRiskTitle')}
        message={
          <div className="space-y-2">
            <p>{t('security.mcpRiskIntro')}</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>{t('security.mcpRiskInjection')}</li>
              <li>{t('security.mcpRiskScope')}</li>
              <li>{t('security.mcpRiskConfirm')}</li>
            </ul>
          </div>
        }
        confirmText={t('security.mcpRiskEnable')}
        onConfirm={() => {
          setRiskOpen(false);
          setEnabled(true);
        }}
        onCancel={() => setRiskOpen(false)}
      />
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <NumberField
          label={t('security.mcpBudget')}
          value={budget}
          onChange={setBudget}
          min="10"
          max="5000"
          tooltip={t('security.mcpBudgetTooltip')}
        />
        <label className="block space-y-1">
          <span className="type-overline flex items-center gap-1.5">
            {t('security.mcpEndpoint')}
          </span>
          <Input value={endpoint} readOnly onFocus={(e) => e.target.select()} className="h-7 rounded-sm font-mono text-mini" />
        </label>
      </div>
      <p className="mt-3 text-micro leading-relaxed text-muted-foreground">{t('security.mcpKeyHint')}</p>
      <p className="mt-1 text-micro leading-relaxed text-muted-foreground">{t('security.mcpConfirmHint')}</p>
    </Section>
  );
}


// ── Lockout Row ──
function LockoutRow({
 lockout,
 onClear,
 isClearing,
}: {
 lockout: AuthLockout;
 onClear: () => void;
 isClearing: boolean;
}) {
 const { t } = useTranslation('admin-access');
 const isActive = !lockout.lockedUntil;
 const isIpLockout = lockout.email.startsWith('__ip__:');
 const displayEmail = isIpLockout ? t('security.ipRateLimit') : lockout.email;
 return (
 <div className="group flex flex-wrap items-center gap-4 px-3 py-1.5 transition-colors hover:bg-surface-1/40">
 <div className="flex min-w-0 flex-1 items-center gap-2.5">
 <StatusLed tone={isActive ? 'alarm' : 'hazard'} />
 <div className="min-w-0">
 <div className="truncate text-data font-medium text-foreground">{displayEmail}</div>
 <div className="flex flex-wrap items-center gap-2 text-micro text-muted-foreground">
 <span className="font-mono tabular-nums">{lockout.ipAddress}</span>
 <span>·</span>
 <span>{t('security.attempts', { count: lockout.failureCount })}</span>
 <span>·</span>
 <span className="font-mono tabular-nums">{t('security.lastFailedAt', { date: formatDateTime(lockout.lastFailedAt) })}</span>
 </div>
 </div>
 </div>

 <div className="flex items-center gap-3">
 <Badge variant={isActive ? 'destructive' : 'secondary'} className="shrink-0 text-micro">
 {isActive ? t('security.locked') : t('security.expired')}
 </Badge>
 {lockout.lockedUntil && (
 <span className="hidden font-mono text-micro tabular-nums text-muted-foreground sm:block">
 {t('security.until', { date: formatDateTime(lockout.lockedUntil) })}
 </span>
 )}
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground opacity-100 transition-colors hover:bg-surface-2 hover:text-primary sm:opacity-0 sm:group-hover:opacity-100 disabled:pointer-events-none disabled:opacity-30"
 onClick={onClear}
 disabled={isClearing}
 title={t('security.clearLockout')}
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
 const { t } = useTranslation('admin-access');
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
 const [fileTunnelMaxUploadMb, setFileTunnelMaxUploadMb] = useState('500');
 const [fileTunnelMaxPendingPerNode, setFileTunnelMaxPendingPerNode] = useState('50');
 const [fileTunnelConcurrentMax, setFileTunnelConcurrentMax] = useState('10');
 const [requireEmailVerification, setRequireEmailVerification] = useState(true);

 const { data: lockoutResponse, isLoading: lockoutsLoading } = useAuthLockouts({
 page: lockoutPage,
 limit: lockoutPageSize,
 search: search.trim() || undefined,
 });

 // prev must start as undefined — NOT as `settings` — so the sync always runs
 // on the first render after mount. When the query cache already holds data
 // (navigating away and back within staleTime), the remount receives the same
 // cached object reference and `useState(settings)` would skip the sync,
 // leaving the form on its useState defaults.
 const [prevSettings, setPrevSettings] = useState<typeof settings | undefined>(undefined);
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
 setFileTunnelMaxUploadMb(String(settings.fileTunnelMaxUploadMb ?? 500));
 setFileTunnelMaxPendingPerNode(String(settings.fileTunnelMaxPendingPerNode ?? 50));
 setFileTunnelConcurrentMax(String(settings.fileTunnelConcurrentMax ?? 10));
 setRequireEmailVerification(settings.requireEmailVerification ?? true);
 }
 }

 // ── Validate time window values ──
 const validTimeWindows = useMemo(() => new Set(TIME_WINDOWS.map((value) => Number(value))), []);

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
 onSuccess: () => notifySuccess(t('security.toastUpdated')),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminSecuritySettings() });
 },
 onError: (error: unknown) => notifyError(error),
 });

 const clearMutation = useMutation({
 mutationFn: (lockoutId: string) => adminApi.clearAuthLockout(lockoutId),
 onSuccess: () => notifySuccess(t('security.toastLockoutCleared')),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminAuthLockouts() });
 },
 onError: (error: unknown) => notifyError(error),
 });

 const lockouts = lockoutResponse?.lockouts ?? [];
 const lockoutPagination = lockoutResponse?.pagination;

 return (
 <div className="space-y-5">
 {/* ── Header ── */}
    <TabHeader
      icon={ShieldCheck}
      title={t('security.title')}
      description={t('security.description')}
      actions={
        <Button size="sm" className="h-8 px-3 text-mini" disabled={!canSubmit || updateMutation.isPending} onClick={() => updateMutation.mutate()}>
          {updateMutation.isPending ? t('saving') : t('common:actions.save')}
        </Button>
      }
    />


 {/* ── Rate Limits Section ── */}
 <Section
 title={t('security.rateLimits')}
 subtitle={t('security.rateLimitsDescription')}
 icon={<Zap className="h-3.5 w-3.5 text-warning" />}
 >
 <div className="space-y-4">
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
 <RateLimitField
 label={t('security.authRequests')}
 countValue={authRateLimitMax}
 onCountChange={setAuthRateLimitMax}
 windowValue={authRateLimitWindowMs}
 onWindowChange={setAuthRateLimitWindowMs}
 tooltip={t('security.authRequestsTooltip')}
 />
 <RateLimitField
 label={t('security.fileOperations')}
 countValue={fileRateLimitMax}
 onCountChange={setFileRateLimitMax}
 windowValue={fileRateLimitWindowMs}
 onWindowChange={setFileRateLimitWindowMs}
 tooltip={t('security.fileOperationsTooltip')}
 />
 <RateLimitField
 label={t('security.consoleInput')}
 countValue={consoleRateLimitMax}
 onCountChange={setConsoleRateLimitMax}
 windowValue={consoleRateLimitWindowMs}
 onWindowChange={setConsoleRateLimitWindowMs}
 tooltip={t('security.consoleInputTooltip')}
 />
 <NumberField
 label={t('security.consoleOutputLines')}
 value={consoleOutputLinesMax}
 onChange={setConsoleOutputLinesMax}
 tooltip={t('security.consoleOutputLinesTooltip')}
 />
 <NumberField
 label={t('security.consoleOutputBytes')}
 value={consoleOutputByteLimitBytes}
 onChange={setConsoleOutputByteLimitBytes}
 min={String(MIN_CONSOLE_OUTPUT_BYTES_PER_SECOND)}
 max={String(MAX_CONSOLE_OUTPUT_BYTES_PER_SECOND)}
 tooltip={t('security.consoleOutputBytesTooltip')}
 />
 <NumberField
 label={t('security.agentMessages')}
 value={agentMessageMax}
 onChange={setAgentMessageMax}
 tooltip={t('security.agentMessagesTooltip')}
 />
 <NumberField
 label={t('security.agentMetrics')}
 value={agentMetricsMax}
 onChange={setAgentMetricsMax}
 tooltip={t('security.agentMetricsTooltip')}
 />
 <NumberField
 label={t('security.serverMetrics')}
 value={serverMetricsMax}
 onChange={setServerMetricsMax}
 tooltip={t('security.serverMetricsTooltip')}
 />
 <NumberField
 label={t('security.maxBuffer')}
 value={maxBufferMb}
 onChange={setMaxBufferMb}
 min="1"
 tooltip={t('security.maxBufferTooltip')}
 />
 </div>
 </div>
 </Section>

 {/* ── Email Verification Section ── */}
 <Section
 title={t('security.emailVerification')}
 subtitle={t('security.emailVerificationDescription')}
 icon={<MailCheck className="h-3.5 w-3.5 text-success" />}
 >
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-foreground">{t('security.requireEmailVerification')}</p>
        <Switch
          checked={requireEmailVerification}
          onCheckedChange={setRequireEmailVerification}
          aria-label={t('security.requireEmailVerificationAria')}
        />
      </div>

 </Section>

 {/* ── Lockout Policy ── */}
 <Section
 title={t('security.lockoutPolicy')}
 subtitle={t('security.lockoutPolicyDescription')}
 icon={<Lock className="h-3.5 w-3.5 text-destructive" />}
 >
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
 <NumberField
 label={t('security.maxAttempts')}
 value={lockoutMaxAttempts}
 onChange={setLockoutMaxAttempts}
 />
 <NumberField
 label={t('security.windowMinutes')}
 value={lockoutWindowMinutes}
 onChange={setLockoutWindowMinutes}
 />
 <NumberField
 label={t('security.durationMinutes')}
 value={lockoutDurationMinutes}
 onChange={setLockoutDurationMinutes}
 />
 <NumberField
 label={t('security.auditRetention')}
 value={auditRetentionDays}
 onChange={setAuditRetentionDays}
 />
 </div>
 </Section>

 <Section
 title={t('security.fileUploads')}
 subtitle={t('security.fileUploadsDescription')}
 icon={<FolderSync className="h-3.5 w-3.5 text-info" />}
 >
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <RateLimitField
 label={t('security.tunnelRequests')}
 countValue={fileTunnelRateLimitMax}
 onCountChange={setFileTunnelRateLimitMax}
 windowValue={fileTunnelRateLimitWindowMs}
 onWindowChange={setFileTunnelRateLimitWindowMs}
 tooltip={t('security.tunnelRequestsTooltip')}
 />
 <NumberField
 label={t('security.maxUploadSize')}
 value={fileTunnelMaxUploadMb}
 onChange={setFileTunnelMaxUploadMb}
 tooltip={t('security.maxUploadSizeTooltip')}
 max="10240"
 />
 <NumberField
 label={t('security.maxPendingPerNode')}
 value={fileTunnelMaxPendingPerNode}
 onChange={setFileTunnelMaxPendingPerNode}
 tooltip={t('security.maxPendingPerNodeTooltip')}
 />
 <NumberField
 label={t('security.maxConcurrent')}
 value={fileTunnelConcurrentMax}
 onChange={setFileTunnelConcurrentMax}
 tooltip={t('security.maxConcurrentTooltip')}
 />
 </div>
 </Section>

 {/* ── Panel-hosted MCP ── */}
 <McpSettingsCard />

 {/* ── Auth Lockouts ── */}
 <div className="deck-panel">
 <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
 <div className="flex items-center gap-2">
 <Lock className="h-3.5 w-3.5 shrink-0 text-destructive" />
 <div>
 <BracketLabel tone="alarm">{t('security.authLockouts')}</BracketLabel>
 <p className="text-micro text-muted-foreground">{t('security.authLockoutsDescription')}</p>
 </div>
 </div>
 <div className="relative min-w-[180px] max-w-xs">
 <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => { setSearch(e.target.value); setLockoutPage(1); }}
 placeholder={t('security.searchLockouts')}
 className="h-7 rounded-sm pl-9 text-mini"
 />
 </div>
 </div>

 {lockoutsLoading ? (
 <div className="space-y-1 p-3">
 {[1, 2, 3].map((i) => (
 <div key={i} className="flex items-center gap-3 py-1.5">
 <div className="h-2 w-2 animate-pulse rounded-sm bg-surface-3" />
 <div className="flex-1 space-y-1.5">
 <div className="h-3.5 w-36 animate-pulse rounded-sm bg-surface-3" />
 <div className="h-3 w-48 animate-pulse rounded-sm bg-surface-2" />
 </div>
 </div>
 ))}
 </div>
 ) : lockouts.length > 0 ? (
 <>
 <div className="divide-y divide-border/40">
 {lockouts.map((lockout) => (
 <LockoutRow
 key={lockout.id}
 lockout={lockout}
 onClear={() => clearMutation.mutate(lockout.id)}
 isClearing={clearMutation.isPending}
 />
 ))}
 </div>
 {lockoutPagination && lockoutPagination.totalPages > 1 && (
 <div className="flex justify-center border-t border-border/40 py-2">
 <Pagination
 page={lockoutPagination.page}
 totalPages={lockoutPagination.totalPages}
 onPageChange={setLockoutPage}
 />
 </div>
 )}
 </>
 ) : (
 <div className="p-3">
 <EmptyState
 title={t('security.emptyTitle')}
 description={t('security.emptyDescription')}
 />
 </div>
 )}
 </div>
 </div>
 );
}

export default SecurityPage;
