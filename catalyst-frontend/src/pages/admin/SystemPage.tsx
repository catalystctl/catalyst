import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAdminHealth, useAdminStats, useModManagerSettings, useSmtpSettings } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';

function SystemPage() {
  const { data: stats } = useAdminStats();
  const { data: health } = useAdminHealth();
  const { data: smtpSettings } = useSmtpSettings();
  const { data: modManagerSettings } = useModManagerSettings();
  const queryClient = useQueryClient();
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUsername, setSmtpUsername] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpReplyTo, setSmtpReplyTo] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpRequireTls, setSmtpRequireTls] = useState(false);
  const [smtpPool, setSmtpPool] = useState(false);
  const [smtpMaxConnections, setSmtpMaxConnections] = useState('');
  const [smtpMaxMessages, setSmtpMaxMessages] = useState('');
  const [curseforgeApiKey, setCurseforgeApiKey] = useState('');
  const [modrinthApiKey, setModrinthApiKey] = useState('');

  const updateSmtpMutation = useMutation({
    mutationFn: () =>
      adminApi.updateSmtpSettings({
        host: smtpHost.trim() || null,
        port: smtpPort.trim() ? Number(smtpPort) : null,
        username: smtpUsername.trim() || null,
        password: smtpPassword || null,
        from: smtpFrom.trim() || null,
        replyTo: smtpReplyTo.trim() || null,
        secure: smtpSecure,
        requireTls: smtpRequireTls,
        pool: smtpPool,
        maxConnections: smtpMaxConnections.trim() ? Number(smtpMaxConnections) : null,
        maxMessages: smtpMaxMessages.trim() ? Number(smtpMaxMessages) : null,
      }),
    onSuccess: () => {
      notifySuccess('SMTP settings updated');
      queryClient.invalidateQueries({ queryKey: ['admin-smtp'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update SMTP settings';
      notifyError(message);
    },
  });

  const updateModManagerMutation = useMutation({
    mutationFn: () =>
      adminApi.updateModManagerSettings({
        curseforgeApiKey: curseforgeApiKey.trim() || null,
        modrinthApiKey: modrinthApiKey.trim() || null,
      }),
    onSuccess: () => {
      notifySuccess('Mod manager settings updated');
      queryClient.invalidateQueries({ queryKey: ['admin-mod-manager'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update mod manager settings';
      notifyError(message);
    },
  });

  useEffect(() => {
    if (!smtpSettings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSmtpHost(smtpSettings.host ?? '');
    setSmtpPort(smtpSettings.port ? String(smtpSettings.port) : '587');
    setSmtpUsername(smtpSettings.username ?? '');
    setSmtpPassword(smtpSettings.password ?? '');
    setSmtpFrom(smtpSettings.from ?? '');
    setSmtpReplyTo(smtpSettings.replyTo ?? '');
    setSmtpSecure(Boolean(smtpSettings.secure));
    setSmtpRequireTls(Boolean(smtpSettings.requireTls));
    setSmtpPool(Boolean(smtpSettings.pool));
    setSmtpMaxConnections(
      smtpSettings.maxConnections !== null && smtpSettings.maxConnections !== undefined
        ? String(smtpSettings.maxConnections)
        : '',
    );
    setSmtpMaxMessages(
      smtpSettings.maxMessages !== null && smtpSettings.maxMessages !== undefined
        ? String(smtpSettings.maxMessages)
        : '',
    );
  }, [smtpSettings]);

  useEffect(() => {
    if (!modManagerSettings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurseforgeApiKey(modManagerSettings.curseforgeApiKey ?? '');
    setModrinthApiKey(modManagerSettings.modrinthApiKey ?? '');
  }, [modManagerSettings]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">System</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Monitor platform health and manage global integrations.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {stats?.users ?? 0} users
            </span>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
              {stats?.activeServers ?? 0} active
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:hover:border-primary-500/30">
          <div className="text-xs uppercase text-slate-500 dark:text-slate-500">Status</div>
          <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {health?.status ?? 'loading'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Database: {health?.database ?? 'checking'}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Checked {health ? new Date(health.timestamp).toLocaleTimeString() : '...'}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:hover:border-primary-500/30">
          <div className="text-xs uppercase text-slate-500 dark:text-slate-500">Nodes</div>
          <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {health?.nodes.online ?? 0} online / {health?.nodes.total ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Offline: {health?.nodes.offline ?? 0} · Stale: {health?.nodes.stale ?? 0}
          </div>
        </div>
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-5 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:hover:border-primary-500/30">
          <div className="text-xs uppercase text-slate-500 dark:text-slate-500">System totals</div>
          <div className="mt-2 text-lg font-semibold text-slate-900 dark:text-slate-100">
            {stats?.servers ?? 0} servers
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Users: {stats?.users ?? 0} · Active: {stats?.activeServers ?? 0}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Nodes: {stats?.nodes ?? 0}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              SMTP Configuration
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Configure outbound email for invites, alerts, and system notifications.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Host
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpHost}
              onChange={(event) => setSmtpHost(event.target.value)}
              placeholder="smtp.mailserver.com"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Port
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpPort}
              onChange={(event) => setSmtpPort(event.target.value)}
              placeholder="587"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Username
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpUsername}
              onChange={(event) => setSmtpUsername(event.target.value)}
              placeholder="user@example.com"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Password
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpPassword}
              onChange={(event) => setSmtpPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            From address
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpFrom}
              onChange={(event) => setSmtpFrom(event.target.value)}
              placeholder="no-reply@catalyst.local"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Reply-to
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpReplyTo}
              onChange={(event) => setSmtpReplyTo(event.target.value)}
              placeholder="support@catalyst.local"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Max connections
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpMaxConnections}
              onChange={(event) => setSmtpMaxConnections(event.target.value)}
              placeholder="5"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Max messages
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={smtpMaxMessages}
              onChange={(event) => setSmtpMaxMessages(event.target.value)}
              placeholder="100"
            />
          </label>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
              checked={smtpSecure}
              onChange={(event) => setSmtpSecure(event.target.checked)}
            />
            Use SSL/TLS
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
              checked={smtpRequireTls}
              onChange={(event) => setSmtpRequireTls(event.target.checked)}
            />
            Require STARTTLS
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
              checked={smtpPool}
              onChange={(event) => setSmtpPool(event.target.checked)}
            />
            Use connection pool
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={() => updateSmtpMutation.mutate()}
            disabled={updateSmtpMutation.isPending}
          >
            Save SMTP settings
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Mod Manager API Keys
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Provide API keys for CurseForge and Modrinth to enable mod downloads.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            CurseForge API Key
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={curseforgeApiKey}
              onChange={(event) => setCurseforgeApiKey(event.target.value)}
              placeholder="••••••••"
            />
          </label>
          <label className="block text-xs text-slate-500 dark:text-slate-300">
            Modrinth API Key
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={modrinthApiKey}
              onChange={(event) => setModrinthApiKey(event.target.value)}
              placeholder="••••••••"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={() => updateModManagerMutation.mutate()}
            disabled={updateModManagerMutation.isPending}
          >
            Save mod manager keys
          </button>
        </div>
      </div>
    </div>
  );
}

export default SystemPage;
