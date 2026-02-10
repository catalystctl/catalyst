import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import { useAuthLockouts, useSecuritySettings } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';

const MIN_CONSOLE_OUTPUT_BYTES_PER_SECOND = 64 * 1024;
const MAX_CONSOLE_OUTPUT_BYTES_PER_SECOND = 10 * 1024 * 1024;

function SecurityPage() {
  const queryClient = useQueryClient();
  const { data: settings } = useSecuritySettings();
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
  const [search, setSearch] = useState('');
  const [lockoutPage, setLockoutPage] = useState(1);
  const lockoutPageSize = 20;
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
      Number(maxBufferMb) >= 1,
    [
      authRateLimitMax,
      fileRateLimitMax,
      consoleRateLimitMax,
      consoleOutputLinesMax,
      consoleOutputByteLimitBytes,
      agentMessageMax,
      agentMetricsMax,
      serverMetricsMax,
      lockoutMaxAttempts,
      lockoutWindowMinutes,
      lockoutDurationMinutes,
      auditRetentionDays,
      maxBufferMb,
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
      }),
    onSuccess: () => {
      notifySuccess('Security settings updated');
      queryClient.invalidateQueries({ queryKey: ['admin-security-settings'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update security settings';
      notifyError(message);
    },
  });

  const clearMutation = useMutation({
    mutationFn: (lockoutId: string) => adminApi.clearAuthLockout(lockoutId),
    onSuccess: () => {
      notifySuccess('Lockout cleared');
      queryClient.invalidateQueries({ queryKey: ['admin-auth-lockouts'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to clear lockout';
      notifyError(message);
    },
  });

  const lockouts = lockoutResponse?.lockouts ?? [];
  const lockoutPagination = lockoutResponse?.pagination;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:shadow-surface-dark dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Security</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Configure rate limits, lockout policy, and audit retention.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {lockouts.length} lockouts
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              Page {lockoutPagination?.page ?? lockoutPage}
            </span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Security settings</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Rate limits apply per minute unless noted. Lockouts apply per email + IP.
            </p>
          </div>
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={() => updateMutation.mutate()}
            disabled={!canSubmit || updateMutation.isPending}
          >
            Save settings
          </button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Auth requests / min
            <input
              value={authRateLimitMax}
              onChange={(event) => setAuthRateLimitMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            File ops / min
            <input
              value={fileRateLimitMax}
              onChange={(event) => setFileRateLimitMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Console input / min
            <input
              value={consoleRateLimitMax}
              onChange={(event) => setConsoleRateLimitMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            <span className="flex items-center gap-1">
              Console output lines / sec
              <span className="group relative">
                <Info className="h-3.5 w-3.5 cursor-help text-slate-400 dark:text-slate-500" />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Maximum lines per second from server console output. Increase for servers with large startup logs.
                </span>
              </span>
            </span>
            <input
              value={consoleOutputLinesMax}
              onChange={(event) => setConsoleOutputLinesMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            <span className="flex items-center gap-1">
              Console output bytes / sec
              <span className="group relative">
                <Info className="h-3.5 w-3.5 cursor-help text-slate-400 dark:text-slate-500" />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Per-server websocket console output cap. Allowed range is 65,536 to 10,485,760 bytes per second.
                </span>
              </span>
            </span>
            <input
              value={consoleOutputByteLimitBytes}
              onChange={(event) => setConsoleOutputByteLimitBytes(event.target.value)}
              type="number"
              min={String(MIN_CONSOLE_OUTPUT_BYTES_PER_SECOND)}
              max={String(MAX_CONSOLE_OUTPUT_BYTES_PER_SECOND)}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            <span className="flex items-center gap-1">
              Agent messages / sec
              <span className="group relative">
                <Info className="h-3.5 w-3.5 cursor-help text-slate-400 dark:text-slate-500" />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Maximum WebSocket messages per second from each agent node.
                </span>
              </span>
            </span>
            <input
              value={agentMessageMax}
              onChange={(event) => setAgentMessageMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            <span className="flex items-center gap-1">
              Agent metrics / sec
              <span className="group relative">
                <Info className="h-3.5 w-3.5 cursor-help text-slate-400 dark:text-slate-500" />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Maximum agent-level metric messages per second from each agent node.
                </span>
              </span>
            </span>
            <input
              value={agentMetricsMax}
              onChange={(event) => setAgentMetricsMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            <span className="flex items-center gap-1">
              Server metrics / sec
              <span className="group relative">
                <Info className="h-3.5 w-3.5 cursor-help text-slate-400 dark:text-slate-500" />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Maximum server-level metric messages per second per server.
                </span>
              </span>
            </span>
            <input
              value={serverMetricsMax}
              onChange={(event) => setServerMetricsMax(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Lockout attempts
            <input
              value={lockoutMaxAttempts}
              onChange={(event) => setLockoutMaxAttempts(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Lockout window (min)
            <input
              value={lockoutWindowMinutes}
              onChange={(event) => setLockoutWindowMinutes(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Lockout duration (min)
            <input
              value={lockoutDurationMinutes}
              onChange={(event) => setLockoutDurationMinutes(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Audit retention (days)
            <input
              value={auditRetentionDays}
              onChange={(event) => setAuditRetentionDays(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            <span className="flex items-center gap-1">
              Max buffer (MB)
              <span className="group relative">
                <Info className="h-3.5 w-3.5 cursor-help text-slate-400 dark:text-slate-500" />
                <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs leading-relaxed text-slate-600 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  Maximum output buffer for server file operations such as compressing, decompressing, and browsing archive contents. Increase this if large archives fail with buffer errors. Default is 50 MB.
                </span>
              </span>
            </span>
            <input
              value={maxBufferMb}
              onChange={(event) => setMaxBufferMb(event.target.value)}
              type="number"
              min="1"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Auth lockouts</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Track recent lockout entries.</p>
          </div>
          <label className="text-xs text-slate-500 dark:text-slate-300">
            Search
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setLockoutPage(1);
              }}
              placeholder="Search lockouts"
              className="mt-1 w-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
            />
          </label>
        </div>

        {lockoutsLoading ? (
          <div className="px-6 py-6 text-sm text-slate-600 dark:text-slate-300">Loading lockouts...</div>
        ) : lockouts.length ? (
          <div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {lockouts.map((lockout) => (
                <div
                  key={lockout.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 text-sm text-slate-600 dark:text-slate-300"
                >
                  <div>
                    <div className="text-slate-900 dark:text-slate-100">{lockout.email}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">{lockout.ipAddress}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                      Attempts: {lockout.failureCount} · Last failed:{' '}
                      {new Date(lockout.lastFailedAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                    {lockout.lockedUntil
                      ? `Locked until ${new Date(lockout.lockedUntil).toLocaleString()}`
                      : 'Active'}
                  </div>
                  <button
                    className="rounded-md border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 disabled:opacity-60 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() => clearMutation.mutate(lockout.id)}
                    disabled={clearMutation.isPending}
                  >
                    Clear
                  </button>
                </div>
              ))}
            </div>
            {lockoutPagination ? (
              <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 text-xs text-slate-500 dark:text-slate-400 dark:border-slate-800 dark:text-slate-500">
                <span>
                  Page {lockoutPagination.page} of {lockoutPagination.totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() => setLockoutPage((prev) => Math.max(1, prev - 1))}
                    disabled={lockoutPage <= 1}
                  >
                    Previous
                  </button>
                  <button
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() =>
                      setLockoutPage((prev) =>
                        lockoutPagination.page < lockoutPagination.totalPages ? prev + 1 : prev,
                      )
                    }
                    disabled={lockoutPagination.page >= lockoutPagination.totalPages}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No lockouts" description="Failed login attempts will show here." />
        )}
      </div>
    </div>
  );
}

export default SecurityPage;
