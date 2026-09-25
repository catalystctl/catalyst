import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/i18n/format';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';

import {
 Bell,
 Plus,
 Settings,
 Trash2,
 CheckCircle,
 X,
 ChevronRight,
} from 'lucide-react';
import { Input } from '../../components/ui/input';
import { Button } from '@/components/ui/button';
import { alertsApi } from '../../services/api/alerts';
import { useNodes } from '../../hooks/useNodes';
import { useServers } from '../../hooks/useServers';
import { useAlertRules } from '../../hooks/useAlertRules';
import { useAuthStore } from '../../stores/authStore';
import type { AlertRule, AlertType } from '../../types/alert';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { BracketLabel, Segmented, StatusLed } from '../../components/deck/primitives';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogToolbar,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

type LedTone = 'go' | 'hazard' | 'alarm' | 'idle' | 'info';

/** Severity reads as state: LED plus a letter-spaced label, never a badge. */
function severityTone(severity: string): LedTone {
 if (severity === 'critical') return 'alarm';
 if (severity === 'warning') return 'hazard';
 return 'go';
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
}: {
 rule: AlertRule;
 showAdminTargets: boolean;
 user: any;
 onToggle: () => void;
 onEdit: () => void;
 onDelete: () => void;
 isPending: boolean;
}) {
 const { t } = useTranslation('alerts');
 const isOwner = !rule.userId || !user?.id || rule.userId === user.id;
 return (
 <div className="group flex flex-wrap items-center justify-between gap-2 px-3 py-2 transition-colors hover:bg-surface-1/40">
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <StatusLed tone={rule.enabled ? 'go' : 'idle'} />
 <span className="truncate font-display text-data font-semibold text-foreground">{rule.name}</span>
 <span className="type-overline">{rule.enabled ? t('common:actions.enabled') : t('common:actions.disabled')}</span>
 {showAdminTargets && (
 <span className="type-overline">{rule.target}</span>
 )}
 </div>
 <div className="mt-0.5 type-meta">
 {rule.description || rule.type.replace('_', ' ')}
 </div>
 </div>
 <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 {isOwner && (
 <>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-primary disabled:pointer-events-none disabled:opacity-30"
 onClick={onToggle}
 disabled={isPending}
 title={rule.enabled ? t('common:actions.disable') : t('common:actions.enable')}
 >
 {rule.enabled ? <X className="h-3.5 w-3.5" /> : <CheckCircle className="h-3.5 w-3.5" />}
 </button>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-primary"
 onClick={onEdit}
 title={t('common:actions.edit')}
 >
 <Settings className="h-3.5 w-3.5" />
 </button>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:pointer-events-none disabled:opacity-30"
 onClick={onDelete}
 disabled={isPending}
 title={t('common:actions.delete')}
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </>
 )}
 {!isOwner && (
 <span className="type-overline">{t('ruleRow.readOnly')}</span>
 )}
 </div>
 </div>
 );
}

// ── Alert Row ──
function AlertRow({ alert, showAdminTargets, onResolve, isPending }: {
 alert: any; showAdminTargets: boolean; onResolve: () => void; isPending: boolean;
}) {
 const { t } = useTranslation('alerts');

 return (
 <div className="group px-3 py-2 transition-colors hover:bg-surface-1/40">
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <StatusLed tone={severityTone(alert.severity)} />
 <span className="type-overline">{alert.severity}</span>
 <span className="font-display text-data font-semibold text-foreground">{alert.title}</span>
 {alert.resolved && (
 <span className="type-overline">{t('alertRow.resolved')}</span>
 )}
 </div>
 <p className="mt-1 type-meta">{alert.message}</p>
 <div className="mt-1 flex flex-wrap items-center gap-2 type-meta">
 <Segmented muted className="text-micro">{formatDateTime(alert.createdAt)}</Segmented>
 {showAdminTargets && (
 <span className="type-overline">
 {alert.nodeId ? t('target.node') : alert.serverId ? t('target.server') : t('target.global')}
 </span>
 )}
 {showAdminTargets && alert.server?.name && <span>{t('alertRow.server', { name: alert.server.name })}</span>}
 {showAdminTargets && alert.node?.name && <span>{t('alertRow.node', { name: alert.node.name })}</span>}
 {alert.rule?.name && <span>{t('alertRow.rule', { name: alert.rule.name })}</span>}
 </div>
 </div>
 {!alert.resolved && (
 <Button
 variant="outline"
 size="sm"
 className="h-7 shrink-0 px-2.5 text-mini opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
 onClick={onResolve}
 disabled={isPending}
 >
 {t('alertRow.resolve')}
 </Button>
 )}
 </div>

 {/* Delivery info */}
 {alert.deliveries?.length > 0 && (
 <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
 {alert.deliveries.map((delivery: any) => (
 <div key={delivery.id} className="rounded-sm border border-border/40 bg-surface-1/30 px-3 py-2">
 <div className="flex items-center justify-between text-micro">
 <span className="font-mono text-muted-foreground">{delivery.channel}</span>
 <span className={cn(
 'font-mono',
 delivery.status === 'failed' ? 'text-danger' :
 delivery.status === 'sent' ? 'text-success' : 'text-muted-foreground'
 )}>
 {delivery.status}
 </span>
 </div>
 <div className="mt-0.5 type-meta">{delivery.target}</div>
 {delivery.lastError && (
 <div className="mt-0.5 font-mono text-micro text-danger">{delivery.lastError}</div>
 )}
 </div>
 ))}
 </div>
 )}
 </div>
 );
}

// ── Main Page ──
type Props = {
 scope?: 'mine' | 'all';
 serverId?: string;
 showAdminTargets?: boolean;
};

function AlertsPage({ scope = 'mine', serverId, showAdminTargets = false }: Props) {
 const { t } = useTranslation('alerts');
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
 queryKey: qk.alerts({ filterResolved, serverId, scope }),
 queryFn: () => alertsApi.list({
 resolved: filterResolved === 'all' ? undefined : filterResolved === 'true',
 serverId,
 scope,
 }),
 staleTime: 30_000,
 refetchInterval: false as const, // alert SSE via admin/server streams
 });
 const { data: alertStats } = useQuery({
 queryKey: qk.alertStats({ scope, serverId }),
 queryFn: () => alertsApi.statsScoped({ scope }),
 enabled: !serverId,
 staleTime: 30_000,
 refetchInterval: false as const, // alert SSE via admin/server streams
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
 { value: 'resource_threshold', label: t('ruleModal.typeResourceThreshold') },
 { value: 'node_offline', label: t('ruleModal.typeNodeOffline') },
 { value: 'server_crashed', label: t('ruleModal.typeServerCrashed') },
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
  notifySuccess(t('ruleModal.created'));
 setShowRuleModal(false);
 resetRuleForm();
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.alertRules() });
 },
 onError: (error: unknown) => notifyError(error, 'alerts:errors.createRule'),
 });

 const updateRuleMutation = useMutation({
 mutationFn: (payload: { rule: AlertRule; updates: any }) => alertsApi.updateRule(payload.rule.id, payload.updates),
 onSuccess: () => {
 notifySuccess(t('ruleModal.updated'));
 setShowRuleModal(false);
 setEditingRule(null);
 resetRuleForm();
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.alertRules() });
 },
 onError: (error: unknown) => notifyError(error, 'alerts:errors.updateRule'),
 });

 const deleteRuleMutation = useMutation({
 mutationFn: (ruleId: string) => alertsApi.deleteRule(ruleId),
 onSuccess: () => {
 notifySuccess(t('ruleModal.deleted'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.alertRules() });
 },
 onError: (error: unknown) => notifyError(error, 'alerts:errors.deleteRule'),
 });

 const invalidateAlerts = () => {
 queryClient.invalidateQueries({ queryKey: qk.alerts() });
 queryClient.invalidateQueries({ queryKey: qk.alertStats() });
 queryClient.invalidateQueries({ queryKey: qk.alertRules() });
 };

 const resolveAlertMutation = useMutation({
 mutationFn: (alertId: string) => alertsApi.resolve(alertId),
 onSuccess: () => { notifySuccess(t('toast.resolved')); },
 onSettled: () => { invalidateAlerts(); },
 onError: (error: unknown) => notifyError(error, 'alerts:errors.resolve'),
 });

 const bulkResolveMutation = useMutation({
 mutationFn: (alertIds: string[]) => alertsApi.bulkResolve(alertIds),
 onSuccess: () => { notifySuccess(t('toast.resolvedAll')); },
 onSettled: () => { invalidateAlerts(); },
 onError: (error: unknown) => notifyError(error, 'alerts:errors.bulkResolve'),
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

 const unresolvedCount = alerts.filter((a) => !a.resolved).length;
 const hasRules = alertRules.length > 0;
 const openCreateRule = () => {
 setEditingRule(null);
 resetRuleForm();
 setShowRuleModal(true);
 };

 return (
 <div className="flex min-h-0 flex-1 flex-col gap-3">
 {/* ── Deck header ── */}
 <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
 <div className="flex min-w-0 flex-col gap-1">
 <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
 {showAdminTargets ? t('page.titleAll') : t('page.titleMine')}
 </h1>
 <p className="type-meta">
 {showAdminTargets ? t('page.descriptionAll') : t('page.descriptionMine')}
 </p>
 </div>
 <Button size="sm" onClick={openCreateRule} className="h-8 px-3 text-mini">
 <Plus className="h-3.5 w-3.5" />
 {t('page.createRule')}
 </Button>
 </header>

 {/* ── Stats (admin overview only; header no longer duplicates badges) ── */}
 {alertStats && (
 <section className="deck-panel overflow-hidden">
 <div className="border-b border-border/50 bg-surface-1/40 px-3 py-2">
 <BracketLabel>{t('page.overview')}</BracketLabel>
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-3">
 {[
 { label: t('page.activeAlerts'), value: alertStats?.unresolved ?? unresolvedCount },
 { label: t('page.totalAlerts'), value: alertStats?.total ?? alerts.length },
 { label: t('page.critical'), value: alertStats?.bySeverity?.critical ?? 0 },
 ].map((item, i) => (
 <div
 key={item.label}
 className={cn(
 'flex items-baseline justify-between gap-3 px-3 py-2',
 i > 0 && 'border-t border-border/40 sm:border-l sm:border-t-0',
 )}
 >
 <span className="type-overline">{item.label}</span>
 <span className="font-mono text-sm font-semibold tabular-nums text-foreground">{item.value}</span>
 </div>
 ))}
 </div>
 </section>
 )}

 {/* ── Alert Rules ── */}
 <section className="deck-panel overflow-hidden">
 <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-2">
 <div className="min-w-0 flex-1">
 <BracketLabel>{t('page.rulesTitle')}</BracketLabel>
 <p className="type-meta mt-1">
 {hasRules
   ? t('page.rulesDescription')
   : t('page.rulesDescriptionEmpty')}
 </p>
 </div>
 {hasRules ? (
 <Segmented muted className="text-micro">
 {t('page.ruleCount', { count: alertRules.length })}
 </Segmented>
 ) : null}
 </div>
 {hasRules ? (
 <div>
 {alertRules.map((rule, index) => (
 <div key={rule.id} className={cn(index > 0 && 'border-t border-border/40')}>
 <RuleRow
 rule={rule}
 showAdminTargets={showAdminTargets}
 user={user}
 onToggle={() => updateRuleMutation.mutate({ rule, updates: { enabled: !rule.enabled } })}
 onEdit={() => openEditRule(rule)}
 onDelete={() => setDeletingRule(rule)}
 isPending={updateRuleMutation.isPending || deleteRuleMutation.isPending}
 />
 </div>
 ))}
 </div>
 ) : (
 <div className="px-3 py-5 text-center">
 <p className="type-overline">{t('page.noRulesTitle')}</p>
 <p className="type-meta mx-auto mt-1 max-w-md">{t('page.noRulesDescription')}</p>
 </div>
 )}
 </section>

 {/* ── Alert History ── */}
 <section className="deck-panel flex min-h-0 flex-col overflow-hidden">
 <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 bg-surface-1/40 px-3 py-2">
 <div className="min-w-0 flex-1">
 <BracketLabel>{t('page.historyTitle')}</BracketLabel>
 <p className="type-meta mt-1">{t('page.historyDescription')}</p>
 </div>
 <div className="flex flex-wrap items-center gap-2">
 <select
 value={filterResolved}
 onChange={(e) => setFilterResolved(e.target.value as 'false' | 'true' | 'all')}
 className="h-7 rounded-sm border border-border/60 bg-background/40 pl-2 pr-7 text-mini text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40"
 aria-label={t('page.filterAria')}
 >
 <option value="false">{t('page.filterUnresolved')}</option>
 <option value="true">{t('page.filterResolved')}</option>
 <option value="all">{t('page.filterAll')}</option>
 </select>
 <Button
 variant="outline"
 size="sm"
 className="h-7 px-2.5 text-mini"
 disabled={!canBulkResolve}
 onClick={() => bulkResolveMutation.mutate(unresolvedAlertIds)}
 >
 {t('page.resolveAll')}{unresolvedCount > 0 ? ` (${unresolvedCount})` : ''}
 </Button>
 </div>
 </div>
 {alertsLoading ? (
 <div className="space-y-2 px-3 py-3">
 {Array.from({ length: 3 }).map((_, i) => (
 <div key={i} className="h-8 animate-pulse bg-surface-3/60" />
 ))}
 </div>
 ) : hasAlerts ? (
 <div>
 {alerts.map((alert, index) => (
 <div key={alert.id} className={cn(index > 0 && 'border-t border-border/40')}>
 <AlertRow
 alert={alert}
 showAdminTargets={showAdminTargets}
 onResolve={() => resolveAlertMutation.mutate(alert.id)}
 isPending={resolveAlertMutation.isPending}
 />
 </div>
 ))}
 </div>
 ) : (
 <div className="px-3 py-5 text-center">
 <p className="type-overline">
 {filterResolved === 'false' ? t('page.noUnresolved') : filterResolved === 'true' ? t('page.noResolved') : t('page.noAlerts')}
 </p>
 <p className="type-meta mx-auto mt-1 max-w-md">
 {!hasRules
 ? t('page.emptyNoRules')
 : filterResolved === 'false'
 ? t('page.emptyNothing')
 : t('page.emptyFilter')}
 </p>
 </div>
 )}
 </section>

  {/* ── Rule Create/Edit Modal ── */}
<Dialog
 open={showRuleModal}
 onOpenChange={(open) => {
 if (!open) {
 setShowRuleModal(false);
 setEditingRule(null);
 resetRuleForm();
 }
 }}
>
 <DialogContent size="2xl">
 <DialogHeader icon={<Bell className="h-4 w-4" />}>
 <DialogTitle>{editingRule ? t('ruleModal.editTitle') : t('ruleModal.createTitle')}</DialogTitle>
 <DialogDescription>{t('ruleModal.description')}</DialogDescription>
 </DialogHeader>

 <DialogToolbar>
 <div className="flex gap-1 rounded-sm border border-border/50 bg-surface-1/40 p-0.5">
 {ruleStepOrder.map((key, index) => {
 const isActive = ruleStep === key;
 const canNav = canNavigateRuleStep(index);
 const labels = {
   details: t('ruleModal.stepDetails'),
   conditions: t('ruleModal.stepConditions'),
   notifications: t('ruleModal.stepNotifications'),
 };
 return (
 <button
 key={key}
 type="button"
 disabled={!canNav}
 onClick={() => canNav && setRuleStep(key)}
 className={`flex flex-1 items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-mini font-medium transition-colors ${
 isActive
 ? 'bg-primary text-primary-foreground '
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
 </DialogToolbar>

 <DialogBody>
 {ruleStep === 'details' && (
 <div className="space-y-4">
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <label className="block space-y-1">
 <span className="type-overline">{t('ruleModal.ruleName')}</span>
 <Input value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder={t('ruleModal.namePlaceholder')} />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('ruleModal.descriptionLabel')}</span>
 <Input value={ruleDescription} onChange={(e) => setRuleDescription(e.target.value)} placeholder={t('ruleModal.descriptionPlaceholder')} />
 </label>
 </div>
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
 <label className="block space-y-1">
 <span className="type-overline">{t('ruleModal.ruleType')}</span>
 <select
 value={ruleType}
 onChange={(e) => setRuleType(e.target.value as AlertType)}
 className="w-full rounded-sm border border-border/60 bg-background/40 px-2.5 py-1.5 text-mini text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40"
 >
 {ruleTypeOptions.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
 </select>
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('ruleModal.target')}</span>
 <select
 value={ruleTarget}
 onChange={(e) => setRuleTarget(e.target.value as 'global' | 'server' | 'node')}
 disabled={!showAdminTargets}
 className="w-full rounded-sm border border-border/60 bg-background/40 px-2.5 py-1.5 text-mini text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
 >
 <option value="global">{t('target.global')}</option>
 <option value="server">{t('target.server')}</option>
 <option value="node">{t('target.node')}</option>
 </select>
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('ruleModal.targetId')}</span>
 <select
 value={ruleTargetId}
 onChange={(e) => setRuleTargetId(e.target.value)}
 disabled={!showAdminTargets || ruleTarget === 'global'}
 className="w-full rounded-sm border border-border/60 bg-background/40 px-2.5 py-1.5 text-mini text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40 disabled:opacity-60"
 >
 <option value="">{ruleTarget === 'global' ? t('ruleModal.notRequired') : selectedTargetLabel || t('ruleModal.selectTarget')}</option>
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
 <span className="type-overline">{t('ruleModal.cpuThreshold')}</span>
 <Input type="number" min={1} max={100} value={cpuThreshold} onChange={(e) => setCpuThreshold(e.target.value)} />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('ruleModal.memoryThreshold')}</span>
 <Input type="number" min={1} max={100} value={memoryThreshold} onChange={(e) => setMemoryThreshold(e.target.value)} />
 </label>
 <label className="block space-y-1">
 <span className="type-overline">{t('ruleModal.diskThreshold')}</span>
 <Input type="number" min={1} max={100} value={diskThreshold} onChange={(e) => setDiskThreshold(e.target.value)} />
 </label>
 </div>
 )}
 {ruleType === 'node_offline' && (
 <label className="block space-y-1">
 <span className="type-overline">{t('ruleModal.offlineThreshold')}</span>
 <Input type="number" min={1} value={offlineThreshold} onChange={(e) => setOfflineThreshold(e.target.value)} />
 </label>
 )}
 {ruleType === 'server_crashed' && (
 <div className="rounded-sm border border-border/50 bg-surface-1/40 px-3 py-2 type-meta">
 {t('ruleModal.serverCrashedHint')}
 </div>
 )}
 </div>
 )}

 {ruleStep === 'notifications' && (
 <div className="space-y-4">
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <span className="type-overline">{t('ruleModal.webhookUrls')}</span>
 <button type="button" className="text-mini text-primary hover:underline" onClick={() => setWebhookTargets((c) => [...c, ''])}>{t('ruleModal.add')}</button>
 </div>
 {webhookTargets.map((value, i) => (
 <div key={`w-${i}`} className="flex items-center gap-2">
 <Input value={value} onChange={(e) => setWebhookTargets((c) => updateTargetValue(c, i, e.target.value))} placeholder="https://discord.com/api/webhooks/..." />
 {webhookTargets.length > 1 && (
 <button type="button" className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-danger" onClick={() => setWebhookTargets((c) => c.filter((_, j) => j !== i))}>
 <X className="h-3.5 w-3.5" />
 </button>
 )}
 </div>
 ))}
 </div>
 <div className="space-y-2">
 <div className="flex items-center justify-between">
 <span className="type-overline">{t('ruleModal.emailRecipients')}</span>
 <button type="button" className="text-mini text-primary hover:underline" onClick={() => setEmailTargets((c) => [...c, ''])}>{t('ruleModal.add')}</button>
 </div>
 {emailTargets.map((value, i) => (
 <div key={`e-${i}`} className="flex items-center gap-2">
 <Input value={value} onChange={(e) => setEmailTargets((c) => updateTargetValue(c, i, e.target.value))} placeholder="alerts@example.com" />
 {emailTargets.length > 1 && (
 <button type="button" className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-danger" onClick={() => setEmailTargets((c) => c.filter((_, j) => j !== i))}>
 <X className="h-3.5 w-3.5" />
 </button>
 )}
 </div>
 ))}
 </div>
 </div>
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
 <label className="flex items-center gap-2 type-overline cursor-pointer">
 <input type="checkbox" checked={notifyOwner} onChange={(e) => setNotifyOwner(e.target.checked)} className="h-4 w-4 rounded border-border bg-card text-primary" />
 {t('ruleModal.notifyOwner')}
 </label>
 <label className="block space-y-1 sm:col-span-2">
 <span className="type-overline">{t('ruleModal.cooldown')}</span>
 <Input type="number" min={1} value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} />
 </label>
 </div>
 </div>
 )}
 </DialogBody>

 <DialogFooter className="sm:justify-between">
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => { setShowRuleModal(false); setEditingRule(null); resetRuleForm(); }}>
 {t('common:actions.cancel')}
 </Button>
 <div className="flex items-center gap-2">
 {ruleStepIndex > 0 && (
 <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => setRuleStep(ruleStepOrder[ruleStepIndex - 1])}>
 {t('common:actions.back')}
 </Button>
 )}
 {ruleStepIndex < ruleStepOrder.length - 1 ? (
 <Button size="sm" className="h-8 px-3 text-mini" disabled={!ruleStepValidMap[ruleStep]} onClick={() => setRuleStep(ruleStepOrder[ruleStepIndex + 1])}>
 {t('common:actions.next')}
 </Button>
 ) : (
 <Button
 size="sm"
 className="h-8 px-3 text-mini"
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
        ? updateRuleMutation.isPending ? t('ruleModal.saving') : t('ruleModal.save')
        : createRuleMutation.isPending ? t('ruleModal.creating') : t('ruleModal.create')}
 </Button>
 )}
 </div>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* ── Delete Rule Confirmation ── */}
 <ConfirmDialog
 open={!!deletingRule}
 title={t('ruleModal.deleteTitle')}
 message={t('ruleModal.deleteConfirm', { name: deletingRule?.name })}
 confirmText={t('common:actions.delete')}
 cancelText={t('common:actions.cancel')}
 variant="danger"
 loading={deleteRuleMutation.isPending}
 onConfirm={() => {
 if (deletingRule) {
 deleteRuleMutation.mutate(deletingRule.id, { onSuccess: () => setDeletingRule(null) });
 }
 }}
 onCancel={() => setDeletingRule(null)}
 />
 </div>
 );
}

export default AlertsPage;
