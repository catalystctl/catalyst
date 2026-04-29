import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { motion, type Variants } from 'framer-motion';
import {
  Settings,
  Activity,
  Server,
  Mail,
  ShieldCheck,
  Lock,
  Key,
  Globe,
  Hash,
  User,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import { useAdminHealth, useAdminStats, useModManagerSettings, useSmtpSettings } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Input } from '../../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

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
            <h2 className="text-sm font-semibold text-foreground ">{title}</h2>
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

// ── Health Stat Card ──
function HealthStatCard({
  label,
  value,
  sub,
  icon,
  iconColor,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  iconColor: string;
}) {
  return (
    <motion.div
      variants={itemVariants}
      className="overflow-hidden rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md"
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-md ${iconColor}`}>
          {icon}
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </div>
      <div className="text-xl font-bold tabular-nums text-foreground dark:text-foreground">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </motion.div>
  );
}

// ── Main Page ──
function SystemPage() {
  const { data: stats } = useAdminStats();
  const { data: health } = useAdminHealth();
  const { data: smtpSettings } = useSmtpSettings();
  const { data: modManagerSettings } = useModManagerSettings();

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
      queryClient.invalidateQueries({ queryKey: qk.adminSmtp() });
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update SMTP settings'),
  });

  const updateModManagerMutation = useMutation({
    mutationFn: () =>
      adminApi.updateModManagerSettings({
        curseforgeApiKey: curseforgeApiKey.trim() || null,
        modrinthApiKey: modrinthApiKey.trim() || null,
      }),
    onSuccess: () => {
      notifySuccess('Mod manager settings updated');
      queryClient.invalidateQueries({ queryKey: qk.adminModManager() });
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update mod manager settings'),
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
        ? String(smtpSettings.maxConnections) : '',
    );
    setSmtpMaxMessages(
      smtpSettings.maxMessages !== null && smtpSettings.maxMessages !== undefined
        ? String(smtpSettings.maxMessages) : '',
    );
  }, [smtpSettings]);

  useEffect(() => {
    if (!modManagerSettings) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurseforgeApiKey(modManagerSettings.curseforgeApiKey ?? '');
    setModrinthApiKey(modManagerSettings.modrinthApiKey ?? '');
  }, [modManagerSettings]);

  const isHealthy = health?.status === 'healthy';
  const dbStatus = health?.database ?? 'checking';

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-indigo-500/8 to-violet-500/8 blur-3xl dark:from-indigo-500/15 dark:to-violet-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-teal-500/8 to-cyan-500/8 blur-3xl dark:from-teal-500/15 dark:to-cyan-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 opacity-20 blur-sm" />
                <Settings className="relative h-7 w-7 text-primary dark:text-indigo-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground ">
                System
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Monitor platform health and manage global integrations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {stats?.users ?? 0} users
            </Badge>
            <Badge variant="outline" className="text-xs">
              {stats?.activeServers ?? 0} active
            </Badge>
          </div>
        </motion.div>

        {/* ── Health Stats ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <HealthStatCard
            label="Status"
            value={health?.status ?? 'loading'}
            sub={`Database: ${dbStatus} · Checked ${health ? new Date(health.timestamp).toLocaleTimeString() : '…'}`}
            icon={isHealthy
              ? <CheckCircle className="h-4 w-4 text-success dark:text-success" />
              : <AlertTriangle className="h-4 w-4 text-warning dark:text-warning" />
            }
            iconColor={isHealthy ? 'bg-success/10 dark:bg-success/30' : 'bg-warning/10 dark:bg-warning/30'}
          />
          <HealthStatCard
            label="Nodes"
            value={`${health?.nodes.online ?? 0} / ${health?.nodes.total ?? 0}`}
            sub={`Offline: ${health?.nodes.offline ?? 0} · Stale: ${health?.nodes.stale ?? 0}`}
            icon={<Server className="h-4 w-4 text-info dark:text-info" />}
            iconColor="bg-info/10 dark:bg-blue-900/30"
          />
          <HealthStatCard
            label="System totals"
            value={stats?.servers ?? 0}
            sub={`Users: ${stats?.users ?? 0} · Active: ${stats?.activeServers ?? 0} · Nodes: ${stats?.nodes ?? 0}`}
            icon={<Activity className="h-4 w-4 text-violet-600 dark:text-violet-400" />}
            iconColor="bg-violet-100 dark:bg-violet-900/30"
          />
        </div>

        {/* ── SMTP Configuration ── */}
        <Section
          title="SMTP Configuration"
          subtitle="Configure outbound email for invites, alerts, and notifications."
          icon={<Mail className="h-4 w-4 text-destructive dark:text-destructive" />}
          iconColor="bg-destructive/10 dark:bg-destructive/30"
          footer={
            <Button size="sm" disabled={updateSmtpMutation.isPending} onClick={() => updateSmtpMutation.mutate()}>
              {updateSmtpMutation.isPending ? 'Saving…' : 'Save SMTP settings'}
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="block space-y-1">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Globe className="h-3 w-3" /> Host
                </span>
                <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.mailserver.com" />
              </label>
              <label className="block space-y-1">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Hash className="h-3 w-3" /> Port
                </span>
                <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
              </label>
              <label className="block space-y-1">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <User className="h-3 w-3" /> Username
                </span>
                <Input value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} placeholder="user@example.com" />
              </label>
              <label className="block space-y-1">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Lock className="h-3 w-3" /> Password
                </span>
                <Input type="password" value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} placeholder="••••••••" />
              </label>
              <label className="block space-y-1">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Mail className="h-3 w-3" /> From address
                </span>
                <Input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="no-reply@catalyst.local" />
              </label>
              <label className="block space-y-1">
                <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Mail className="h-3 w-3" /> Reply-to
                </span>
                <Input value={smtpReplyTo} onChange={(e) => setSmtpReplyTo(e.target.value)} placeholder="support@catalyst.local" />
              </label>
            </div>

            {/* Pool settings */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Max connections</span>
                <Input value={smtpMaxConnections} onChange={(e) => setSmtpMaxConnections(e.target.value)} placeholder="5" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Max messages</span>
                <Input value={smtpMaxMessages} onChange={(e) => setSmtpMaxMessages(e.target.value)} placeholder="100" />
              </label>
            </div>

            {/* Checkboxes */}
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={smtpSecure}
                  onChange={(e) => setSmtpSecure(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-card text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                />
                Use SSL/TLS
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={smtpRequireTls}
                  onChange={(e) => setSmtpRequireTls(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-card text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                />
                Require STARTTLS
              </label>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={smtpPool}
                  onChange={(e) => setSmtpPool(e.target.checked)}
                  className="h-4 w-4 rounded border-border bg-card text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                />
                Use connection pool
              </label>
            </div>
          </div>
        </Section>

        {/* ── Mod Manager API Keys ── */}
        <Section
          title="Mod Manager API Keys"
          subtitle="Provide API keys for CurseForge and Modrinth to enable mod downloads."
          icon={<Key className="h-4 w-4 text-warning dark:text-warning" />}
          iconColor="bg-warning/10 dark:bg-warning/30"
          footer={
            <Button size="sm" disabled={updateModManagerMutation.isPending} onClick={() => updateModManagerMutation.mutate()}>
              {updateModManagerMutation.isPending ? 'Saving…' : 'Save mod manager keys'}
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="h-3 w-3" /> CurseForge API Key
              </span>
              <Input type="password" value={curseforgeApiKey} onChange={(e) => setCurseforgeApiKey(e.target.value)} placeholder="••••••••" />
            </label>
            <label className="block space-y-1">
              <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <ShieldCheck className="h-3 w-3" /> Modrinth API Key
              </span>
              <Input type="password" value={modrinthApiKey} onChange={(e) => setModrinthApiKey(e.target.value)} placeholder="••••••••" />
            </label>
          </div>
        </Section>
      </div>
    </motion.div>
  );
}

export default SystemPage;
