import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { motion, type Variants } from 'framer-motion';
import {
  Bell,
  Plus,
  Settings,
  Trash2,
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  CircleDot,
  X,
  ChevronRight,
} from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '../../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { alertsApi } from '../../services/api/alerts';
import { useNodes } from '../../hooks/useNodes';
import { useServers } from '../../hooks/useServers';
import { useAlertRules } from '../../hooks/useAlertRules';
import { useAuthStore } from '../../stores/authStore';
import type { AlertRule, AlertSeverity, AlertType } from '../../types/alert';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { ModalPortal } from '@/components/ui/modal-portal';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

// ── Severity Helpers ──
function severityIcon(severity: AlertSeverity) {
  if (severity === 'critical') return <AlertTriangle className="h-3.5 w-3.5" />;
  if (severity === 'warning') return <AlertCircle className="h-3.5 w-3.5" />;
  return <CheckCircle className="h-3.5 w-3.5" />;
}

function severityBadgeVariant(severity: AlertSeverity): 'destructive' | 'outline' | 'secondary' {
  if (severity === 'critical') return 'destructive';
  if (severity === 'warning') return 'outline';
  return 'secondary';
}

// ── Stat Card ──
function StatCard({ label, value, icon, iconColor, accent }: {
  label: string; value: number; icon: React.ReactNode;
  iconColor: string; accent?: string;
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
      <div className={`text-2xl font-bold tabular-nums ${accent || 'text-foreground dark:text-zinc-100'}`}>{value}</div>
    </motion.div>
  );
}

// ── Alert Rule Row ──
function RuleRow({
  rule,
  showAdminTargets,
  user,
  onToggle,
  onEdit,
  onDelete,
  isPending,
  index,
}: {
  rule: AlertRule;
  showAdminTargets: boolean;
  user: any;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isPending: boolean;
  index: number;
}) {
  const isOwner = !rule.userId || !user?.id || rule.userId === user.id;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="group flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/50 bg-surface-2/40 px-4 py-3 transition-colors hover:bg-surface-2/70"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground dark:text-zinc-100">{rule.name}</span>
          <Badge variant={rule.enabled ? 'outline' : 'secondary'} className="text-[10px] border-emerald-400/40 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400">
            {rule.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          {showAdminTargets && (
            <Badge variant="secondary" className="text-[10px]">{rule.target}</Badge>
          )}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {rule.description || rule.type.replace('_', ' ')}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        {isOwner && (
          <>
            <button
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-30"
              onClick={onToggle}
              disabled={isPending}
              title={rule.enabled ? 'Disable' : 'Enable'}
            >
              {rule.enabled ? <X className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
            </button>
            <button
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              onClick={onEdit}
              title="Edit"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
            <button
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-30"
              onClick={onDelete}
              disabled={isPending}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        {!isOwner && (
          <span className="text-[10px] text-muted-foreground">Read only</span>
        )}
      </div>
    </motion.div>
  );
}

// ── Alert Row ──
function AlertRow({ alert, showAdminTargets, onResolve, isPending, index }: {
  alert: any; showAdminTargets: boolean; onResolve: () => void; isPending: boolean; index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      className="group rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severityBadgeVariant(alert.severity)} className="gap-1 text-[10px]">
              {severityIcon(alert.severity)}
              {alert.severity}
            </Badge>
            <span className="text-sm font-semibold text-foreground dark:text-zinc-100">{alert.title}</span>
            {alert.resolved && (
              <Badge variant="secondary" className="text-[10px]">Resolved</Badge>
            )}
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">{alert.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            <span>{new Date(alert.createdAt).toLocaleString()}</span>
            {showAdminTargets && (
              <Badge variant="secondary" className="text-[10px]">
                {alert.nodeId ? 'Node' : alert.serverId ? 'Server' : 'Global'}
              </Badge>
            )}
            {showAdminTargets && alert.server?.name && <span>Server: {alert.server.name}</span>}
            {showAdminTargets && alert.node?.name && <span>Node: {alert.node.name}</span>}
            {alert.rule?.name && <span>Rule: {alert.rule.name}</span>}
          </div>
        </div>
        {!alert.resolved && (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-[11px] opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            onClick={onResolve}
            disabled={isPending}
          >
            Resolve
          </Button>
        )}
      </div>

      {/* Delivery info */}
      {alert.deliveries?.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {alert.deliveries.map((delivery: any) => (
            <div key={delivery.id} className="rounded-lg border border-border/50 bg-surface-2/40 px-3 py-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">{delivery.channel}</span>
                <span className={
                  delivery.status === 'failed' ? 'text-rose-500' :
                  delivery.status === 'sent' ? 'text-emerald-500' : 'text-muted-foreground'
                }>
                  {delivery.status}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{delivery.target}</div>
              {delivery.lastError && (
                <div className="mt-0.5 text-[10px] text-rose-500">{delivery.lastError}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

// ── Main Page ──
type Props = {
  scope?: 'mine' | 'all';
  serverId?: string;
  showAdminTargets?: boolean;
};

function AlertsPage({ scope = 'mine', serverId, showAdminTargets = false }: Props) {
  const user = useAuthStore((s) => s.user);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [filterResolved, setFilterResolved] = useState<'false' | 'true' | 'all'>('false');
  const [deletingRule, setDeletingRule] = useState<AlertRule | null>(null);

  // Rule form state
  const [ruleName, setRuleName] = useState('');
  const [ruleDescription, setRuleDescription] = useState('');
  const [ruleType, setRuleType] = useState<AlertType>('resource_threshold');
  const [ruleTarget, setRuleTarget] = useState<'global' | 'server' | 'node'>(
    showAdminTargets ? 'global' : 'server',
  );
  const [ruleTargetId, setRuleTargetId] = useState(serverId ?? '');
  const [cpuThreshold, setCpuThreshold] = useState('85');
  const [memoryThreshold, setMemoryThreshold] = useState('90');
  const [diskThreshold, setDiskThreshold] = useState('90');
  const [offlineThreshold, setOfflineThreshold] = useState('5');
  const [webhookTargets, setWebhookTargets] = useState<string[]>(['']);
  const [emailTargets, setEmailTargets] = useState<string[]>(['']);
  const [notifyOwner, setNotifyOwner] = useState(false);
  const [cooldownMinutes, setCooldownMinutes] = useState('5');
  const [ruleStep, setRuleStep] = useState<'details' | 'conditions' | 'notifications'>('details');

  const resetRuleForm = () => {
    setRuleName('');
    setRuleDescription('');
    setRuleType('resource_threshold');
    setRuleTarget(showAdminTargets ? 'global' : 'server');
    setRuleTargetId(showAdminTargets ? '' : serverId ?? '');
    setCpuThreshold('85');
    setMemoryThreshold('90');
    setDiskThreshold('90');
    setOfflineThreshold('5');
    setWebhookTargets(['']);
    setEmailTargets(['']);
    setNotifyOwner(false);
    setCooldownMinutes('5');
    setRuleStep('details');
  };

  // Queries
  const { data: alertData, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts', filterResolved, serverId, scope],
    queryFn: () => alertsApi.list({
      resolved: filterResolved === 'all' ? undefined : filterResolved === 'true',
      serverId,
      scope,
    }),
  });
  const { data: alertStats } = useQuery({
    queryKey: ['alerts-stats', scope, serverId],
    queryFn: () => alertsApi.statsScoped({ scope }),
    enabled: !serverId,
  });
  const { data: alertRules = [] } = useAlertRules({
    scope,
    target: serverId ? 'server' : undefined,
    targetId: serverId,
  });
  const { data: nodes = [] } = useNodes();
  const { data: serversData = [] } = useServers();

  const alerts = alertData?.alerts ?? [];
  const hasAlerts = alerts.length > 0;

  const ruleTypeOptions: Array<{ value: AlertType; label: string }> = [
    { value: 'resource_threshold', label: 'Resource threshold' },
    { value: 'node_offline', label: 'Node offline' },
    { value: 'server_crashed', label: 'Server crashed' },
  ];

  const targetOptions = useMemo(() => {
    if (!showAdminTargets) {
      return serversData.filter((s) => s.id === serverId).map((s) => ({ id: s.id, label: s.name }));
    }
    if (ruleTarget === 'server') return serversData.map((s) => ({ id: s.id, label: s.name }));
    if (ruleTarget === 'node') return nodes.map((n) => ({ id: n.id, label: n.name }));
    return [];
  }, [nodes, ruleTarget, serversData, serverId, showAdminTargets]);

  const selectedTargetLabel = targetOptions.find((o) => o.id === ruleTargetId)?.label;
  const ruleStepOrder = ['details', 'conditions', 'notifications'] as const;
  const ruleStepIndex = ruleStepOrder.indexOf(ruleStep);
  const detailsValid = Boolean(ruleName.trim() && (ruleTarget === 'global' || ruleTargetId));
  const conditionsValid =
    ruleType === 'resource_threshold'
      ? Boolean(cpuThreshold || memoryThreshold || diskThreshold)
      : ruleType === 'node_offline' ? Boolean(offlineThreshold) : true;
  const ruleStepValidMap = { details: detailsValid, conditions: conditionsValid, notifications: true } as const;
  const canNavigateRuleStep = (targetIndex: number) =>
    targetIndex <= ruleStepIndex || ruleStepOrder.slice(0, targetIndex).every((key) => ruleStepValidMap[key]);

  const updateTargetValue = (values: string[], index: number, value: string) =>
    values.map((entry, i) => (i === index ? value : entry));

  const buildRulePayload = () => {
    const conditions: Record<string, number> = {};
    if (ruleType === 'resource_threshold') {
      if (cpuThreshold) conditions.cpuThreshold = Number(cpuThreshold);
      if (memoryThreshold) conditions.memoryThreshold = Number(memoryThreshold);
      if (diskThreshold) conditions.diskThreshold = Number(diskThreshold);
    }
    if (ruleType === 'node_offline') conditions.offlineThreshold = Number(offlineThreshold);
    return {
      conditions,
      actions: {
        webhooks: webhookTargets.map((e) => e.trim()).filter(Boolean),
        emails: emailTargets.map((e) => e.trim()).filter(Boolean),
        notifyOwner,
        cooldownMinutes: Number(cooldownMinutes),
      },
    };
  };

  // Mutations
  const createRuleMutation = useMutation({
    mutationFn: () => {
      const { conditions, actions } = buildRulePayload();
      return alertsApi.createRule({
        name: ruleName.trim(),
        description: ruleDescription.trim() || undefined,
        type: ruleType,
        target: showAdminTargets ? ruleTarget : 'server',
        targetId: showAdminTargets ? (ruleTarget === 'global' ? null : ruleTargetId || null) : serverId || null,
        conditions,
        actions,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'alert-rules' });
      notifySuccess('Alert rule created');
      setShowRuleModal(false);
      resetRuleForm();
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to create alert rule'),
  });

  const updateRuleMutation = useMutation({
    mutationFn: (payload: { rule: AlertRule; updates: any }) => alertsApi.updateRule(payload.rule.id, payload.updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'alert-rules' });
      notifySuccess('Alert rule updated');
      setShowRuleModal(false);
      setEditingRule(null);
      resetRuleForm();
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update alert rule'),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (ruleId: string) => alertsApi.deleteRule(ruleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'alert-rules' });
      notifySuccess('Alert rule deleted');
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to delete alert rule'),
  });

  const invalidateAlerts = () => {
    queryClient.invalidateQueries({ queryKey: qk.alerts() });
    queryClient.invalidateQueries({ queryKey: qk.alertStats() });
    queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'alert-rules' });
  };

  const resolveAlertMutation = useMutation({
    mutationFn: (alertId: string) => alertsApi.resolve(alertId),
    onSuccess: () => { invalidateAlerts(); notifySuccess('Alert resolved'); },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to resolve alert'),
  });

  const bulkResolveMutation = useMutation({
    mutationFn: (alertIds: string[]) => alertsApi.bulkResolve(alertIds),
    onSuccess: () => { invalidateAlerts(); notifySuccess('Alerts resolved'); },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to resolve alerts'),
  });

  const unresolvedAlertIds = alerts.filter((a) => !a.resolved).map((a) => a.id);
  const canBulkResolve = unresolvedAlertIds.length > 0 && !bulkResolveMutation.isPending;

  const openEditRule = (rule: AlertRule) => {
    setEditingRule(rule);
    setShowRuleModal(true);
    setRuleStep('details');
    setRuleName(rule.name);
    setRuleDescription(rule.description ?? '');
    setRuleType(rule.type);
    setRuleTarget(rule.target);
    setRuleTargetId(rule.targetId ?? '');
    const conditions = rule.conditions as Record<string, number>;
    setCpuThreshold(String(conditions.cpuThreshold ?? ''));
    setMemoryThreshold(String(conditions.memoryThreshold ?? ''));
    setDiskThreshold(String(conditions.diskThreshold ?? ''));
    setOfflineThreshold(String(conditions.offlineThreshold ?? ''));
    const actions = rule.actions as Record<string, unknown>;
    const webhooks = (actions.webhooks as string[] | undefined) ?? [];
    const emails = (actions.emails as string[] | undefined) ?? [];
    setWebhookTargets(webhooks.length ? webhooks : ['']);
    setEmailTargets(emails.length ? emails : ['']);
    setNotifyOwner(Boolean(actions.notifyOwner));
    setCooldownMinutes(String((actions.cooldownMinutes as number | undefined) ?? 5));
  };

  const emptyState = (
    <EmptyState
      title="All clear"
      description={showAdminTargets
        ? 'No active alerts. Create rules to get notified when something breaks.'
        : 'No active alerts for this server.'}
      action={
        <Button size="sm" onClick={() => setShowRuleModal(true)} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Create alert rule
        </Button>
      }
    />
  );

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-amber-500/8 to-orange-500/8 blur-3xl dark:from-amber-500/15 dark:to-orange-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-rose-500/8 to-pink-500/8 blur-3xl dark:from-rose-500/15 dark:to-pink-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 opacity-20 blur-sm" />
                <Bell className="relative h-7 w-7 text-amber-600 dark:text-amber-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                {showAdminTargets ? 'Alerts' : 'Server alerts'}
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              {showAdminTargets
                ? 'Monitor incidents and resolve alerts in real time.'
                : 'Manage alert rules and incidents for this server.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {alerts.filter((a) => !a.resolved).length} active
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {alerts.length} total
            </Badge>
            <Button size="sm" onClick={() => setShowRuleModal(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Create Rule
            </Button>
          </div>
        </motion.div>

        {/* ── Filter Bar ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-2">
          <select
            value={filterResolved}
            onChange={(e) => setFilterResolved(e.target.value as 'false' | 'true' | 'all')}
            className="rounded-lg border border-border bg-white px-3 py-2 text-xs text-foreground transition-colors focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200"
          >
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
            <option value="all">All</option>
          </select>
          <Button variant="outline" size="sm" disabled={!canBulkResolve} onClick={() => bulkResolveMutation.mutate(unresolvedAlertIds)}>
            Resolve all
          </Button>
        </motion.div>

        {/* ── Stats ── */}
        {alertStats && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Active alerts"
              value={alertStats?.unresolved ?? 0}
              icon={<AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />}
              iconColor="bg-amber-100 dark:bg-amber-900/30"
            />
            <StatCard
              label="Total alerts"
              value={alertStats?.total ?? 0}
              icon={<Bell className="h-4 w-4 text-blue-600 dark:text-blue-400" />}
              iconColor="bg-blue-100 dark:bg-blue-900/30"
            />
            <StatCard
              label="Critical"
              value={alertStats?.bySeverity?.critical ?? 0}
              icon={<AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />}
              iconColor="bg-rose-100 dark:bg-rose-900/30"
              accent="text-rose-600 dark:text-rose-400"
            />
          </div>
        )}

        {/* ── Alert Rules ── */}
        <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm">
          <div className="border-b border-border/50 px-5 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
                <Settings className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground dark:text-white">Alert rules</h2>
                <p className="text-xs text-muted-foreground">Manage thresholds and notification targets.</p>
              </div>
            </div>
          </div>
          <div className="space-y-2 p-4">
            {alertRules.length > 0 ? (
              alertRules.map((rule, i) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  index={i}
                  showAdminTargets={showAdminTargets}
                  user={user}
                  onToggle={() => updateRuleMutation.mutate({ rule, updates: { enabled: !rule.enabled } })}
                  onEdit={() => openEditRule(rule)}
                  onDelete={() => setDeletingRule(rule)}
                  isPending={updateRuleMutation.isPending || deleteRuleMutation.isPending}
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border/50 bg-surface-2/20 px-6 py-8 text-center">
                <p className="text-sm text-muted-foreground">No alert rules created yet.</p>
                <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setShowRuleModal(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  Create rule
                </Button>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Alert History ── */}
        <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm">
          <div className="border-b border-border/50 px-5 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <CircleDot className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-foreground dark:text-white">Alert history</h2>
                <p className="text-xs text-muted-foreground">Latest triggered alerts and delivery status.</p>
              </div>
            </div>
          </div>
          <div className="space-y-3 p-4">
            {alertsLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="rounded-xl border border-border bg-card/60 p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-7 w-7 animate-pulse rounded bg-surface-3" />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 w-32 animate-pulse rounded bg-surface-3" />
                        <div className="h-3 w-64 animate-pulse rounded bg-surface-2" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : hasAlerts ? (
              alerts.map((alert, i) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  index={i}
                  showAdminTargets={showAdminTargets}
                  onResolve={() => resolveAlertMutation.mutate(alert.id)}
                  isPending={resolveAlertMutation.isPending}
                />
              ))
            ) : (
              emptyState
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Rule Create/Edit Modal ── */}
      {showRuleModal && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="mx-4 w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl"
          >
            <div className="border-b border-border px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground dark:text-white">
                {editingRule ? 'Edit alert rule' : 'Create alert rule'}
              </h2>
              <p className="text-xs text-muted-foreground">Configure thresholds and notification targets.</p>
            </div>

            <div className="px-6 py-5">
              {/* Step navigation */}
              <div className="mb-5 flex gap-1 rounded-lg border border-border/50 bg-surface-2/30 p-1">
                {ruleStepOrder.map((key, index) => {
                  const isActive = ruleStep === key;
                  const canNav = canNavigateRuleStep(index);
                  const labels = { details: 'Details', conditions: 'Conditions', notifications: 'Notifications' };
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={!canNav}
                      onClick={() => canNav && setRuleStep(key)}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-all ${
                        isActive
                          ? 'bg-primary-600 text-white shadow-sm'
                          : 'text-muted-foreground hover:text-foreground disabled:opacity-40'
                      }`}
                    >
                      {labels[key]}
                      {index < ruleStepOrder.length - 1 && (
                        <ChevronRight className="h-3 w-3 opacity-40" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Step content */}
              {ruleStep === 'details' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Rule name</span>
                      <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="High CPU usage" />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Description</span>
                      <Input value={ruleDescription} onChange={(e) => setRuleDescription(e.target.value)} placeholder="Notify when CPU stays high" />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Rule type</span>
                      <select
                        value={ruleType}
                        onChange={(e) => setRuleType(e.target.value as AlertType)}
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200"
                      >
                        {ruleTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Target</span>
                      <select
                        value={ruleTarget}
                        onChange={(e) => setRuleTarget(e.target.value as 'global' | 'server' | 'node')}
                        disabled={!showAdminTargets}
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200 disabled:opacity-60"
                      >
                        <option value="global">Global</option>
                        <option value="server">Server</option>
                        <option value="node">Node</option>
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Target ID</span>
                      <select
                        value={ruleTargetId}
                        onChange={(e) => setRuleTargetId(e.target.value)}
                        disabled={!showAdminTargets || ruleTarget === 'global'}
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200 disabled:opacity-60"
                      >
                        <option value="">{ruleTarget === 'global' ? 'Not required' : selectedTargetLabel || 'Select target'}</option>
                        {targetOptions.map((opt) => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                      </select>
                    </label>
                  </div>
                </div>
              )}

              {ruleStep === 'conditions' && (
                <div className="space-y-4">
                  {ruleType === 'resource_threshold' && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">CPU threshold (%)</span>
                        <Input type="number" min={1} max={100} value={cpuThreshold} onChange={(e) => setCpuThreshold(e.target.value)} />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Memory threshold (%)</span>
                        <Input type="number" min={1} max={100} value={memoryThreshold} onChange={(e) => setMemoryThreshold(e.target.value)} />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-muted-foreground">Disk threshold (%)</span>
                        <Input type="number" min={1} max={100} value={diskThreshold} onChange={(e) => setDiskThreshold(e.target.value)} />
                      </label>
                    </div>
                  )}
                  {ruleType === 'node_offline' && (
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Offline threshold (minutes)</span>
                      <Input type="number" min={1} value={offlineThreshold} onChange={(e) => setOfflineThreshold(e.target.value)} />
                    </label>
                  )}
                  {ruleType === 'server_crashed' && (
                    <div className="rounded-lg border border-border/50 bg-surface-2/40 px-4 py-3 text-xs text-muted-foreground">
                      This rule triggers when the server reports a crash event.
                    </div>
                  )}
                </div>
              )}

              {ruleStep === 'notifications' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Webhook URLs</span>
                        <button type="button" className="text-[11px] text-primary-600 hover:underline" onClick={() => setWebhookTargets((c) => [...c, ''])}>+ Add</button>
                      </div>
                      {webhookTargets.map((value, i) => (
                        <div key={`w-${i}`} className="flex items-center gap-2">
                          <Input value={value} onChange={(e) => setWebhookTargets((c) => updateTargetValue(c, i, e.target.value))} placeholder="https://discord.com/api/webhooks/..." />
                          {webhookTargets.length > 1 && (
                            <button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500" onClick={() => setWebhookTargets((c) => c.filter((_, j) => j !== i))}>
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">Email recipients</span>
                        <button type="button" className="text-[11px] text-primary-600 hover:underline" onClick={() => setEmailTargets((c) => [...c, ''])}>+ Add</button>
                      </div>
                      {emailTargets.map((value, i) => (
                        <div key={`e-${i}`} className="flex items-center gap-2">
                          <Input value={value} onChange={(e) => setEmailTargets((c) => updateTargetValue(c, i, e.target.value))} placeholder="alerts@example.com" />
                          {emailTargets.length > 1 && (
                            <button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500" onClick={() => setEmailTargets((c) => c.filter((_, j) => j !== i))}>
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <input type="checkbox" checked={notifyOwner} onChange={(e) => setNotifyOwner(e.target.checked)} className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-zinc-600 dark:bg-surface-1 dark:text-primary-400" />
                      Notify server owner
                    </label>
                    <label className="block space-y-1 sm:col-span-2">
                      <span className="text-xs font-medium text-muted-foreground">Cooldown (minutes)</span>
                      <Input type="number" min={1} value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border px-6 py-4">
              <Button variant="outline" size="sm" onClick={() => { setShowRuleModal(false); setEditingRule(null); resetRuleForm(); }}>
                Cancel
              </Button>
              <div className="flex items-center gap-2">
                {ruleStepIndex > 0 && (
                  <Button variant="outline" size="sm" onClick={() => setRuleStep(ruleStepOrder[ruleStepIndex - 1])}>
                    Back
                  </Button>
                )}
                {ruleStepIndex < ruleStepOrder.length - 1 ? (
                  <Button size="sm" disabled={!ruleStepValidMap[ruleStep]} onClick={() => setRuleStep(ruleStepOrder[ruleStepIndex + 1])}>
                    Next
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={!detailsValid || !conditionsValid || createRuleMutation.isPending || updateRuleMutation.isPending}
                    onClick={() => {
                      if (editingRule) {
                        const { conditions, actions } = buildRulePayload();
                        updateRuleMutation.mutate({
                          rule: editingRule,
                          updates: { name: ruleName.trim(), description: ruleDescription.trim() || undefined, conditions, actions, enabled: editingRule.enabled },
                        });
                      } else {
                        createRuleMutation.mutate();
                      }
                    }}
                  >
                    {editingRule
                      ? updateRuleMutation.isPending ? 'Saving…' : 'Save changes'
                      : createRuleMutation.isPending ? 'Creating…' : 'Create rule'}
                  </Button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
        </ModalPortal>
      )}

      {/* ── Delete Rule Confirmation ── */}
      <ConfirmDialog
        open={!!deletingRule}
        title="Delete alert rule?"
        message={`Are you sure you want to delete "${deletingRule?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={deleteRuleMutation.isPending}
        onConfirm={() => {
          if (deletingRule) {
            deleteRuleMutation.mutate(deletingRule.id, { onSuccess: () => setDeletingRule(null) });
          }
        }}
        onCancel={() => setDeletingRule(null)}
      />
    </motion.div>
  );
}

export default AlertsPage;
