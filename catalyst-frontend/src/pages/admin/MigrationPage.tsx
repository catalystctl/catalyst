import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useQuery, useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import {
 ArrowRightLeft,
 Play,
 Pause,
 X,
 CheckCircle2,
 XCircle,
 Clock,
 Loader2,
 ChevronRight,
 ChevronDown,
 RefreshCw,
 Eye,
 AlertTriangle,
 ExternalLink,
 Server,
 MapPin,
 Users,
 Database,
 HardDrive,
 Shield,
 ArrowRight,
 Wifi,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';

import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '../../components/ui/select';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import StatGrid from '../../components/servers/tabs/StatGrid';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import TabErrorState from '../../components/servers/tabs/TabErrorState';
import { migrationApi } from '../../services/api/migration';
import { notifySuccess, notifyError, notifyInfo } from '../../utils/notify';
import { formatDate, formatDateTime } from '@/i18n/format';
import type {
 MigrationJob,
 MigrationStep,
 PterodactylTestResult,
 MigrationScope,
 CatalystNodeOption,
 PterodactylNodeInfo,
 PterodactylServerInfo,
} from '../../types/migration';
import { MIGRATION_PHASES } from '../../types/migration';

// Stable empty default — inline `[]` creates a new array every render and
// trips the React 19 prev-state sync into an infinite loop while jobs load.
const EMPTY_MIGRATION_JOBS: MigrationJob[] = [];

// ── Status helpers ──
const statusConfig: Record<string, { variant: 'default' | 'success' | 'destructive' | 'secondary' | 'outline'; icon: any }> = {
  pending: { variant: 'secondary', icon: Clock },
  validating: { variant: 'outline', icon: Loader2 },
  running: { variant: 'default', icon: Loader2 },
  paused: { variant: 'outline', icon: Pause },
  completed: { variant: 'success', icon: CheckCircle2 },
  failed: { variant: 'destructive', icon: XCircle },
  cancelled: { variant: 'secondary', icon: X },
};

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation('admin-infra');
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1.5">
      {status === 'running' || status === 'validating' ? (
        <Icon className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {statusLabel(t, status)}
    </Badge>
  );
}

function statusLabel(t: TFunction, status: string): string {
  switch (status) {
    case 'pending':
      return t('migration.status.pending');
    case 'validating':
      return t('migration.status.validating');
    case 'running':
      return t('migration.status.running');
    case 'paused':
      return t('migration.status.paused');
    case 'completed':
      return t('migration.status.completed');
    case 'failed':
      return t('migration.status.failed');
    case 'cancelled':
      return t('migration.status.cancelled');
    default:
      return status;
  }
}

const stepStatusConfig: Record<string, { color: string; icon: any; bg: string }> = {
  pending: { color: 'text-muted-foreground', icon: Clock, bg: '' },
  running: { color: 'text-primary', icon: Loader2, bg: 'bg-primary/10' },
  completed: { color: 'text-success', icon: CheckCircle2, bg: '' },
  failed: { color: 'text-destructive', icon: XCircle, bg: 'bg-destructive/10' },
  skipped: { color: 'text-muted-foreground', icon: Clock, bg: '' },
};

function stepStatusLabel(t: TFunction, status: string): string {
  switch (status) {
    case 'pending':
      return t('migration.stepStatus.pending');
    case 'running':
      return t('migration.stepStatus.running');
    case 'completed':
      return t('migration.stepStatus.completed');
    case 'failed':
      return t('migration.stepStatus.failed');
    case 'skipped':
      return t('migration.stepStatus.skipped');
    default:
      return status;
  }
}

/** Localized label for a migration phase id (see MIGRATION_PHASES). */
function phaseLabel(t: TFunction, phaseId: string): string {
  switch (phaseId) {
    case 'validate':
      return t('migration.phases.validate');
    case 'locations':
      return t('migration.phases.locations');
    case 'templates':
      return t('migration.phases.templates');
    case 'users':
      return t('migration.phases.users');
    case 'servers':
      return t('migration.phases.servers');
    case 'databases':
      return t('migration.phases.databases');
    case 'schedules':
      return t('migration.phases.schedules');
    case 'backups':
      return t('migration.phases.backups');
    case 'files':
      return t('migration.phases.files');
    default:
      return phaseId;
  }
}

// Human-readable step labels
function stepLabel(t: TFunction, action: string, metadata?: Record<string, unknown>): string {
  const base = (() => {
    switch (action) {
      case 'validate_connection':
        return t('migration.steps.validateConnection');
      case 'import_location':
        return t('migration.steps.importLocation');
      case 'import_nest':
        return t('migration.steps.importNest');
      case 'import_template':
        return t('migration.steps.importTemplate');
      case 'import_user':
        return t('migration.steps.importUser');
      case 'import_server':
        return t('migration.steps.importServer');
      case 'import_database_host':
        return t('migration.steps.importDatabaseHost');
      case 'import_database':
        return t('migration.steps.importDatabase');
      case 'import_schedule':
        return t('migration.steps.importSchedule');
      case 'import_backup':
        return t('migration.steps.importBackup');
      case 'download_files':
        return t('migration.steps.downloadFiles');
      default:
        return action.replace(/_/g, ' ');
    }
  })();
  if (metadata?.name) return `${base}: ${metadata.name as string}`;
  return base;
}

// Derive a human-readable skip reason from step metadata
function skipReason(t: TFunction, status: string, metadata?: Record<string, unknown> | null): string | null {
  if (status !== 'skipped' && status !== 'completed') return null;
  if (!metadata?.skipped && !metadata?.reason) return null;
  const reason = (metadata.reason as string) || '';
  if (reason.includes('already exists') || reason.includes('already done')) return t('migration.skipReasons.alreadyExists');
  if (reason.includes('not migrated') || reason.includes('User not migrated')) return t('migration.skipReasons.notApplicable');
  if (reason.includes('server owner') || reason.includes('is server owner')) return t('migration.skipReasons.notApplicable');
  if (reason.includes('No client API key')) return t('migration.skipReasons.noClientApiKey');
  if (reason.includes('backup limit') || reason.includes('backup slot')) return t('migration.skipReasons.noBackupSlots');
  if (reason.includes('No schedules') || reason.includes('no schedules')) return t('migration.skipReasons.noSchedules');
  if (reason.includes('not accessible') || reason.includes('404')) return t('migration.skipReasons.notAvailable');
  return reason || t('migration.skipReasons.skipped');
}

// ── Phase icon mapping ──
function PhaseIcon({ phaseId }: { phaseId: string }) {
 const iconMap: Record<string, any> = {
 validate: CheckCircle2,
 locations: MapPin,
 nodes: Server,
 templates: Shield,
 users: Users,
 servers: Server,
 databases: Database,
 schedules: Clock,
 backups: HardDrive,
 files: HardDrive,
 };
 const Icon = iconMap[phaseId] || CheckCircle2;
 return <Icon className="h-4 w-4" />;
}

// ── Duration formatter ──
function formatDuration(ms?: number | null) {
 if (!ms) return '—';
 if (ms < 1000) return `${ms}ms`;
 if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
 return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

// ── Progress Bar ──
function ProgressBar({ progress }: { progress: { total: number; completed: number; failed: number; skipped: number } }) {
 const { t } = useTranslation('admin-infra');
 const pct = progress.total > 0 ? Math.round(((progress.completed + progress.failed + progress.skipped) / progress.total) * 100) : 0;
 const completedPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
 const failedPct = progress.total > 0 ? (progress.failed / progress.total) * 100 : 0;

 return (
 <div className="space-y-1">
 <div className="flex justify-between text-xs text-muted-foreground">
 <span>{t('migration.progress.completed', { value: progress.completed })}</span>
 <span>{t('migration.progress.failed', { value: progress.failed })}</span>
 <span>{pct}%</span>
 </div>
 <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
 <div className="flex h-full">
 <div
 className="h-full bg-success/50 transition-all duration-500"
 style={{ width: `${completedPct}%` }}
 />
 <div
 className="h-full bg-destructive/50 transition-all duration-500"
 style={{ width: `${failedPct}%` }}
 />
 </div>
 </div>
 </div>
 );
}

// ── Phase Step List ──
function PhaseSteps({ steps, onRetry }: { steps: MigrationStep[]; onRetry: (stepId: string) => void }) {
  const { t } = useTranslation('admin-infra');
  const [expanded, setExpanded] = useState(false);
 const [errorStepId, setErrorStepId] = useState<string | null>(null);

 if (steps.length === 0) return null;

 const failedSteps = steps.filter(s => s.status === 'failed');
 // Auto-expand if there are failures
 const showExpanded = expanded || failedSteps.length > 0;

 return (
 <div className="mt-2 ml-6 border-l border-border/50 pl-3 space-y-0.5">
 {(showExpanded ? steps : steps.slice(0, 5)).map((step) => {
 const sc = stepStatusConfig[step.status] || stepStatusConfig.pending;
 const StepIcon = sc.icon;
 const showError = step.status === 'failed' && errorStepId === step.id;
 return (
 <div
 key={step.id}
 className={`${sc.bg} rounded px-2 py-1 -mx-2`}
 >
 <div className="flex items-center gap-2">
 <StepIcon className={`h-3 w-3 flex-shrink-0 ${sc.color} ${step.status === 'running' ? 'animate-spin' : ''}`} />
 <span className="text-xs text-foreground flex-1 truncate">
 {stepLabel(t, step.action, step.metadata as Record<string, unknown>)}
 {step.sourceId && (
 <span className="text-muted-foreground"> #{step.sourceId}</span>
 )}
 {skipReason(t, step.status, step.metadata as Record<string, unknown>) && (
 <span className="text-muted-foreground ml-1.5">
 — {skipReason(t, step.status, step.metadata as Record<string, unknown>)}
 </span>
 )}
 </span>
 <span className="text-xs text-muted-foreground flex-shrink-0">{formatDuration(step.durationMs)}</span>
 {step.status === 'failed' && (
 <div className="flex items-center gap-1.5 flex-shrink-0">
 <button
 onClick={() => setErrorStepId(showError ? null : step.id)}
 className="text-xs text-muted-foreground hover:text-foreground"
 title={t('migration.steps.toggleErrorDetails')}
 >
 {showError ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
 </button>
 <button
 onClick={() => onRetry(step.id)}
 className="text-xs text-primary hover:text-primary/80"
 title={t('common:actions.retry')}
 >
 <RefreshCw className="h-3 w-3" />
 </button>
 </div>
 )}
 {step.status === 'completed' && step.metadata && (
 <CheckCircle2 className="h-3 w-3 text-success/50 flex-shrink-0" />
 )}
 </div>
 {showError && step.error && (
 <div className="mt-1 pl-5">
 <p className="text-xs text-destructive bg-danger/5 border border-danger/20 rounded px-2 py-1.5 break-all">
 {step.error}
 </p>
 </div>
 )}
 </div>
 );
 })}
 {steps.length > 5 && failedSteps.length === 0 && (
 <button
 onClick={() => setExpanded(!expanded)}
 className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-0.5"
 >
 {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
 {expanded ? t('migration.steps.showLess') : t('migration.steps.more', { value: steps.length - 5 })}
 </button>
 )}
 </div>
 );
}


// ── Server Import Summary ──
function ServerImportSummary({ server }: { server: PterodactylServerInfo }) {
 const { t } = useTranslation('admin-infra');
 const items: Array<{ label: string; value: number | string | boolean; icon: any }> = [
 { label: t('migration.serverResources.memory'), value: `${server.memory} MB`, icon: HardDrive },
 { label: t('migration.serverResources.disk'), value: `${server.disk} MB`, icon: HardDrive },
 { label: t('migration.serverResources.cpu'), value: `${server.cpu}%`, icon: Server },
 ];

 const imports: Array<{ label: string; count: number; icon: any; zeroLabel?: string }> = [
 { label: t('migration.imports.schedules'), count: server.schedules, icon: Clock },
 { label: t('migration.imports.subusers'), count: server.subusers, icon: Users },
 { label: t('migration.imports.databases'), count: server.databases, icon: Database },
 { label: t('migration.imports.serverFiles'), count: server.backupSlots > 0 ? 1 : 0, icon: HardDrive, zeroLabel: t('migration.imports.noBackupSlots') },
 ];

 return (
 <div className="mt-2 ml-1 space-y-2">
 {/* Server resources */}
 <div className="flex flex-wrap gap-x-4 gap-y-1">
 {items.map(item => (
 <span key={item.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <item.icon className="h-3 w-3 text-muted-foreground" />
 <span className="text-muted-foreground">{item.label}:</span>
 <span className="text-foreground font-medium">{item.value}</span>
 </span>
 ))}
 {server.suspended && (
 <span className="flex items-center gap-1.5 text-xs text-warning">
 <Pause className="h-3 w-3" />
 {t('common:status.suspended')}
 </span>
 )}
 </div>

 {/* What gets imported */}
 <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{t('migration.sections.allocations')}</div>
 {server.allocations && server.allocations.length > 0 ? (
 <div className="flex flex-wrap gap-1.5">
 {server.allocations.map(allocation => (
 <span
 key={allocation.id}
 className="inline-flex max-w-full items-center gap-1 rounded border border-border/50 bg-surface-2 px-2 py-1 font-mono text-[11px] text-foreground"
 >
 <span className="truncate">{allocation.alias || allocation.ip}:{allocation.port}</span>
 {allocation.primary && (
 <span className="font-sans text-[10px] text-muted-foreground">{t('migration.primary')}</span>
 )}
 </span>
 ))}
 </div>
 ) : (
 <div className="flex items-center gap-1.5 text-xs text-warning">
 <AlertTriangle className="h-3 w-3" />
 {t('migration.noAllocations')}
 </div>
 )}

 <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">{t('migration.sections.imports')}</div>
 <div className="grid grid-cols-2 gap-x-4 gap-y-1">
 {/* Always imported */}
 <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <CheckCircle2 className="h-3 w-3 text-success/60" />
 {t('migration.alwaysImported.serverConfig')}
 </span>
 <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <CheckCircle2 className="h-3 w-3 text-success/60" />
 {t('migration.alwaysImported.portAllocations')}
 </span>
 <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <CheckCircle2 className="h-3 w-3 text-success/60" />
 {t('migration.alwaysImported.startupCommand')}
 </span>
 <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <CheckCircle2 className="h-3 w-3 text-success/60" />
 {t('migration.alwaysImported.dockerImageOverride')}
 </span>
 <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <CheckCircle2 className="h-3 w-3 text-success/60" />
 {t('migration.alwaysImported.configFileEditor')}
 </span>
 <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
 <CheckCircle2 className="h-3 w-3 text-success/60" />
 {t('migration.alwaysImported.swapIoWeight')}
 </span>
 {/* Conditional imports */}
 {imports.map(item => (
 <span
 key={item.label}
 className={`flex items-center gap-1.5 text-xs ${
 item.count > 0
 ? 'text-muted-foreground'
 : 'text-muted-foreground'
 }`}
 >
 {item.count > 0 ? (
 <CheckCircle2 className="h-3 w-3 text-success/60" />
 ) : (
 <XCircle className="h-3 w-3 text-muted-foreground" />
 )}
 {item.label}
 {item.count > 0 && (
 <span className="text-muted-foreground font-medium">({item.count})</span>
 )}
 {item.count === 0 && item.zeroLabel && (
 <span className="text-muted-foreground text-[10px]">
 — {item.zeroLabel}
 </span>
 )}
 </span>
 ))}
 </div>
 </div>
 );
}

// ── Node Mapping Section (full / node scope) ──
function NodeMappingSection({
 nodes,
 servers,
 nodeMappings,
 setNodeMappings,
 onlineNodes,
 scope,
}: {
 nodes: PterodactylNodeInfo[];
 servers: PterodactylServerInfo[];
 nodeMappings: Record<string, string>;
 setNodeMappings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
 onlineNodes: CatalystNodeOption[];
 scope: MigrationScope;
}) {
 const { t } = useTranslation('admin-infra');
 const [expandedNodeId, setExpandedNodeId] = useState<number | null>(null);

 const serversByNode = useMemo(() => {
 const map = new Map<number, PterodactylServerInfo[]>();
 for (const s of servers) {
 const list = map.get(s.nodeId) || [];
 list.push(s);
 map.set(s.nodeId, list);
 }
 return map;
 }, [servers]);

 return (
 <div className="space-y-2">
 <label className="text-sm font-medium text-foreground">
 {t('migration.nodeMapping.title')}
 </label>
 <p className="text-xs text-muted-foreground">
 {scope === 'full'
 ? t('migration.nodeMapping.helpFull')
 : t('migration.nodeMapping.helpSelect')}
 </p>
 <div className="max-h-80 overflow-y-auto rounded-lg border border-border bg-surface-1 divide-y divide-border">
 {nodes.map(node => {
 const expanded = expandedNodeId === node.id;
 const nodeServers = serversByNode.get(node.id) || [];
 return (
 <div key={node.id}>
 <div
 className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-2/50 transition-colors"
 onClick={() => setExpandedNodeId(expanded ? null : node.id)}
 >
 <div className="flex-1 min-w-0">
 <div className="text-sm text-foreground truncate flex items-center gap-2">
 {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
 {node.name}
 <span className="text-xs text-muted-foreground font-normal">{t('migration.nodeServerCount', { value: node.serverCount })}</span>
 </div>
 <div className="text-xs text-muted-foreground">{node.fqdn} · {node.memory} MB</div>
 </div>
 <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <div onClick={e => e.stopPropagation()}>
 <Select
 value={nodeMappings[String(node.id)] || ''}
 onValueChange={(v) =>
 setNodeMappings(prev => ({ ...prev, [String(node.id)]: v }))
 }
 >
 <SelectTrigger className="w-48 bg-card border-border/40 text-foreground text-xs h-8">
 <SelectValue placeholder={t('migration.selectTargetNode')} />
 </SelectTrigger>
 <SelectContent>
 {onlineNodes.map(cn => (
 <SelectItem key={cn.id} value={cn.id}>
 <span className="flex items-center gap-1.5">
 <Wifi className="h-3 w-3 text-success" />
 {cn.name}
 <span className="text-muted-foreground">({cn.locationName})</span>
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 {expanded && (
 <div className="border-t border-border/50 bg-surface-1/50">
 <div className="px-4 py-2 space-y-3">
 <div>
 <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">
 {t('migration.nodeMapping.configuration')}
 </div>
 <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
 <div><dt className="inline text-muted-foreground">{t('migration.nodeConfig.endpoint')}{' '}</dt><dd className="inline text-foreground">{node.scheme || 'https'}://{node.fqdn}:{node.daemonListen ?? 'unknown'}</dd></div>
 <div><dt className="inline text-muted-foreground">{t('migration.nodeConfig.location')}{' '}</dt><dd className="inline text-foreground">{node.locationName || t('common:actions.unknown')}</dd></div>
 <div><dt className="inline text-muted-foreground">{t('migration.nodeConfig.sftpPort')}{' '}</dt><dd className="inline text-foreground">{node.daemonSftp ?? 'unknown'}</dd></div>
 <div><dt className="inline text-muted-foreground">{t('migration.nodeConfig.dataDirectory')}{' '}</dt><dd className="inline break-all text-foreground">{node.daemonBase || 'unknown'}</dd></div>
 <div><dt className="inline text-muted-foreground">{t('migration.nodeConfig.memory')}{' '}</dt><dd className="inline text-foreground">{t('migration.nodeConfig.memoryValue', { memory: node.memory, overallocation: node.memoryOverallocate ?? 0 })}</dd></div>
 <div><dt className="inline text-muted-foreground">{t('migration.nodeConfig.disk')}{' '}</dt><dd className="inline text-foreground">{t('migration.nodeConfig.diskValue', { disk: node.disk ?? 0, overallocation: node.diskOverallocate ?? 0 })}</dd></div>
 <div><dt className="inline text-muted-foreground">{t('migration.nodeConfig.uploadLimit')}{' '}</dt><dd className="inline text-foreground">{t('migration.nodeConfig.uploadLimitValue', { value: node.uploadSize ?? 0 })}</dd></div>
 <div><dt className="inline text-muted-foreground">{t('migration.nodeConfig.proxy')}{' '}</dt><dd className="inline text-foreground">{node.behindProxy ? t('migration.nodeConfig.behindProxy') : t('migration.nodeConfig.direct')}</dd></div>
 <div><dt className="inline text-muted-foreground">{t('migration.nodeConfig.maintenance')}{' '}</dt><dd className="inline text-foreground">{node.maintenanceMode ? t('common:actions.enabled') : t('common:actions.disabled')}</dd></div>
 </dl>
 {node.allocations && node.allocations.length > 0 && (
 <div className="mt-3">
 <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">
 {t('migration.nodeConfig.allocations', { value: node.allocations.length })}
 </div>
 <div className="flex flex-wrap gap-1.5">
 {node.allocations.map(allocation => (
 <span
 key={allocation.id}
 className="inline-flex max-w-full items-center gap-1 rounded border border-border/50 bg-surface-2 px-2 py-1 font-mono text-[11px] text-foreground"
 >
 <span className="truncate">{allocation.alias || allocation.ip}:{allocation.port}</span>
 <span className="font-sans text-[10px] text-muted-foreground">{allocation.assigned ? t('migration.assigned') : t('migration.free')}</span>
 </span>
 ))}
 </div>
 </div>
 )}
 </div>
 <div>
 <div className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-2">
 {t('migration.nodeMapping.serversOnNode', { value: nodeServers.length })}
 </div>
 {nodeServers.length > 0 ? (
 <div className="space-y-3">
 {nodeServers.map(s => (
 <div key={s.id} className="rounded-md border border-border/50 bg-surface-1 px-3 py-2">
 <div className="text-xs text-foreground font-medium">{s.name}</div>
 <div className="text-[11px] text-muted-foreground">
 {s.nestName}/{s.eggName}
 {s.suspended && (
 <span className="text-warning ml-2">{t('migration.suspendedParen')}</span>
 )}
 </div>
 <ServerImportSummary server={s} />
 </div>
 ))}
 </div>
 ) : (
 <p className="text-xs text-muted-foreground">{t('migration.nodeMapping.noServers')}</p>
 )}
 </div>
 </div>
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>
 );
}

// ── Server Mapping List (server scope) ──
function ServerMappingList({
 servers,
 serverMappings,
 setServerMappings,
 onlineNodes,
}: {
 servers: PterodactylServerInfo[];
 serverMappings: Record<string, string>;
 setServerMappings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
 onlineNodes: CatalystNodeOption[];
}) {
 const { t } = useTranslation('admin-infra');
 const [expandedId, setExpandedId] = useState<number | null>(null);

 return (
 <div className="space-y-2">
 <label className="text-sm font-medium text-foreground">
 {t('migration.serverMapping.title')}
 </label>
 <p className="text-xs text-muted-foreground">
 {t('migration.serverMapping.help')}
 </p>
 <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-surface-1 divide-y divide-border">
 {servers.map(server => {
 const expanded = expandedId === server.id;
 return (
 <div key={server.id}>
 <div
 className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-surface-2/50 transition-colors"
 onClick={() => setExpandedId(expanded ? null : server.id)}
 >
 <div className="flex-1 min-w-0">
 <div className="text-sm text-foreground truncate flex items-center gap-2">
 {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
 {server.name}
 {server.backupSlots === 0 && (
 <span className="inline-flex items-center gap-1 text-[10px] text-warning bg-warning/50 border border-warning/30 rounded px-1.5 py-0">
 <AlertTriangle className="h-2.5 w-2.5" />
 {t('migration.noBackups')}
 </span>
 )}
 {server.backupSlots > 0 && server.currentBackups >= server.backupSlots && (
 <span className="inline-flex items-center gap-1 text-[10px] text-warning/80 bg-warning/30 border border-warning/20 rounded px-1.5 py-0">
 <AlertTriangle className="h-2.5 w-2.5" />
 {t('migration.slotsFull')}
 </span>
 )}
 {server.suspended && (
 <span className="inline-flex items-center gap-1 text-[10px] text-warning bg-warning/30 border border-warning/20 rounded px-1.5 py-0">
 {t('common:status.suspended')}
 </span>
 )}
 </div>
 <div className="text-xs text-muted-foreground">
 {server.nestName}/{server.eggName} · {server.nodeName}
 <span className="text-muted-foreground ml-2">
 {server.memory} MB · {server.disk} MB · {server.cpu}% CPU
 </span>
 </div>
 </div>
 <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 <div onClick={e => e.stopPropagation()}>
 <Select
 value={serverMappings[String(server.id)] || ''}
 onValueChange={(v) =>
 setServerMappings(prev => ({ ...prev, [String(server.id)]: v }))
 }
 >
 <SelectTrigger className="w-48 bg-card border-border/40 text-foreground text-xs h-8">
 <SelectValue placeholder={t('migration.selectTargetNode')} />
 </SelectTrigger>
 <SelectContent>
 {onlineNodes.map(cn => (
 <SelectItem key={cn.id} value={cn.id}>
 <span className="flex items-center gap-1.5">
 <Wifi className="h-3 w-3 text-success" />
 {cn.name}
 <span className="text-muted-foreground">({cn.locationName})</span>
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 {expanded && (
 <div className="px-4 pb-3 border-t border-border/50 bg-surface-1/50">
 <ServerImportSummary server={server} />
 </div>
 )}
 </div>
 );
 })}
 </div>
 </div>
 );
}

// ── Backup Slot Warnings ──
function BackupSlotWarnings({ serversList }: { serversList?: Array<{ id: number; name: string; backupSlots: number; currentBackups: number }> }) {
 const { t } = useTranslation('admin-infra');
 if (!serversList) return null;
 const noSlotServers = serversList.filter(s => s.backupSlots === 0);
 const fullSlotServers = serversList.filter(s => s.backupSlots > 0 && s.currentBackups >= s.backupSlots);
 if (noSlotServers.length === 0 && fullSlotServers.length === 0) return null;

 return (
 <div className="space-y-2">
 {noSlotServers.length > 0 && (
 <div className="rounded-lg border border-warning/50 bg-warning/30 p-3">
 <div className="flex items-center gap-2 text-warning">
 <AlertTriangle className="h-4 w-4" />
 <span className="text-sm font-medium">{t('migration.backupWarnings.noSlots', { count: noSlotServers.length })}</span>
 </div>
 <p className="text-sm text-warning/80 mt-1">
 {t('migration.backupWarnings.noSlotsDescription')}
 </p>
 <ul className="text-xs text-warning/70 mt-1 space-y-0.5 ml-4 list-disc">
 {noSlotServers.slice(0, 5).map(s => (
 <li key={s.id}>{s.name}</li>
 ))}
 {noSlotServers.length > 5 && (
 <li className="text-muted-foreground">{t('migration.moreCount', { value: noSlotServers.length - 5 })}</li>
 )}
 </ul>
 </div>
 )}
 {fullSlotServers.length > 0 && (
 <div className="rounded-lg border border-warning/50 bg-warning/20 p-3">
 <div className="flex items-center gap-2 text-warning/80">
 <AlertTriangle className="h-4 w-4" />
 <span className="text-sm font-medium">{t('migration.backupWarnings.slotsFull', { count: fullSlotServers.length })}</span>
 </div>
 <p className="text-xs text-warning/60 mt-1">
 {t('migration.backupWarnings.slotsFullDescription')}
 </p>
 </div>
 )}
 </div>
 );
}

// ── Main Component ──
export default function MigrationPage() {
 const { t } = useTranslation('admin-infra');

 // State
 const [activeTab, setActiveTab] = useState<'new' | 'progress' | 'history'>('new');
 const [panelUrl, setPanelUrl] = useState('');
 const [apiKey, setApiKey] = useState('');
 const [showKey, setShowKey] = useState(false);
 const [clientApiKey, setClientApiKey] = useState('');
 const [showClientKey, setShowClientKey] = useState(false);
 const [migrationScope, setMigrationScope] = useState<MigrationScope>('full');
 const [nodeMappings, setNodeMappings] = useState<Record<string, string>>({});
 const [serverMappings, setServerMappings] = useState<Record<string, string>>({});
 const [testResult, setTestResult] = useState<PterodactylTestResult | null>(null);
 const [testing, setTesting] = useState(false);
 const [activeJobId, setActiveJobId] = useState<string | null>(null);

 // Fetch Catalyst nodes (migration targets)
 const { data: catalystNodes = [] } = useQuery<CatalystNodeOption[]>({
 queryKey: qk.catalystNodes(),
 queryFn: migrationApi.getCatalystNodes,
 staleTime: 5 * 60 * 1000,
 });

 const onlineNodes = catalystNodes.filter(n => n.isOnline);

 // Fetch migration jobs
 const { data: jobs, isLoading: loadingJobs } = useQuery<MigrationJob[]>({
 queryKey: qk.migrationJobs(),
 queryFn: migrationApi.listJobs,
 staleTime: 30_000,
 // Primary: migration_job_updated admin SSE. Safety poll while any job is active.
 refetchInterval: (query) => {
 const data = query.state.data;
 if (!Array.isArray(data)) return false;
 const hasActive = data.some(j => ['running', 'validating', 'paused'].includes(j.status));
 return hasActive ? 10_000 : false;
 },
 });

 // Ensure jobs is always an array for safe usage.
 const safeJobs = Array.isArray(jobs) ? jobs : EMPTY_MIGRATION_JOBS;

 // Fetch active job
 const { data: activeJob } = useQuery({
 queryKey: qk.migrationJob(activeJobId!),
 queryFn: () => migrationApi.getStatus(activeJobId!),
 enabled: !!activeJobId,
 staleTime: 5_000,
 // Primary: migration_job_updated SSE patches/invalidates this key.
 refetchInterval: (query) => {
 const job = query.state.data;
 if (!job) return false;
 return ['running', 'validating', 'paused'].includes(job.status) ? 10_000 : false;
 },
 });

 // Fetch steps for active job
 const { data: activeSteps } = useQuery({
 queryKey: qk.migrationSteps(activeJobId!),
 queryFn: () => migrationApi.getSteps(activeJobId!, { limit: 500 }),
 enabled: !!activeJobId,
 staleTime: 5_000,
 // Primary: migration_step_updated SSE. Safety poll while job active.
 refetchInterval: (_query) => {
 const job = activeJob;
 if (!job) return false;
 return ['running', 'validating', 'paused'].includes(job.status) ? 10_000 : false;
 },
 });

 // Notify on job completion/failure
 const prevJobStatusRef = useRef<string | null>(null);
 const jobStatus = activeJob?.status;
 const jobError = activeJob?.error;
 useEffect(() => {
 if (!jobStatus) return;
 const prev = prevJobStatusRef.current;
 if (prev && prev === 'running' && jobStatus === 'completed') {
 notifySuccess(t('migration.toast.completed'));
 }
 if (prev && prev === 'running' && jobStatus === 'failed') {
 notifyError(t('migration.toast.failed', { error: jobError || t('migration.unknownError') }));
 }
 prevJobStatusRef.current = jobStatus;
 }, [jobStatus, jobError, t]);

 // Auto-detect active job via state sync during render
 const [prevSafeJobs, setPrevSafeJobs] = useState(safeJobs);
 if (safeJobs !== prevSafeJobs) {
 setPrevSafeJobs(safeJobs);
 if (safeJobs) {
 const active = safeJobs.find(j => j.status === 'running' || j.status === 'validating' || j.status === 'paused');
 if (active && active.id !== activeJobId) {
 setActiveJobId(active.id);
 setActiveTab('progress');
 }
 }
 }

 // Mutations
 const testMutation = useMutation({
 mutationFn: () => migrationApi.testConnection(panelUrl, apiKey, clientApiKey || undefined),
 onMutate: () => { setTesting(true); setTestResult(null); },
 onSettled: () => { setTesting(false); },
 onSuccess: (data) => {
 setTestResult(data);
 if (data.success) {
 notifySuccess(t('migration.toast.connected'));
 } else {
 notifyError(data.error || t('migration.toast.connectionFailed'));
 }
 },
 onError: (err: any) => {
 setTestResult({ success: false, error: err.response?.data?.error || err.message });
 notifyError(t('migration.toast.connectionTestFailed'));
 },
 });

 const startMutation = useMutation({
 mutationFn: () => migrationApi.start({
 url: panelUrl,
 key: apiKey,
 clientApiKey: clientApiKey || undefined,
 scope: migrationScope,
 nodeMappings,
 serverMappings,
 }),
 onSuccess: (data) => {
 setActiveJobId(data.jobId);
 setActiveTab('progress');
 notifySuccess(t('migration.toast.started'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.migrationJobs() });
 },
 onError: (err: any) => {
 notifyError(err);
 },
 });

 const pauseMutation = useMutation({
 mutationFn: () => migrationApi.pause(activeJobId!),
 onSuccess: () => {
 notifyInfo(t('migration.toast.paused'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.migrationJob(activeJobId!) });
 queryClient.invalidateQueries({ queryKey: qk.migrationJobs() });
 },
 onError: (err: any) => notifyError(err),
 });

 const resumeMutation = useMutation({
 mutationFn: () => migrationApi.resume(activeJobId!),
 onSuccess: () => {
 notifySuccess(t('migration.toast.resumed'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.migrationJob(activeJobId!) });
 queryClient.invalidateQueries({ queryKey: qk.migrationJobs() });
 },
 onError: (err: any) => notifyError(err),
 });

 const cancelMutation = useMutation({
 mutationFn: () => migrationApi.cancel(activeJobId!),
 onSuccess: () => {
 notifyInfo(t('migration.toast.cancelled'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.migrationJob(activeJobId!) });
 queryClient.invalidateQueries({ queryKey: qk.migrationJobs() });
 },
 onError: (err: any) => notifyError(err),
 });

 const retryMutation = useMutation({
 mutationFn: (stepId: string) => migrationApi.retryStep(activeJobId!, stepId),
 onSuccess: () => {
 notifySuccess(t('migration.toast.stepQueued'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.migrationJob(activeJobId!) });
 queryClient.invalidateQueries({ queryKey: qk.migrationSteps(activeJobId!) });
 },
 onError: (err: any) => notifyError(err),
 });

 const handleRetryStep = useCallback((stepId: string) => {
 retryMutation.mutate(stepId);
 }, [retryMutation]);

 // Group steps by phase
 const stepsByPhase = useMemo(() => {
 if (!activeSteps?.steps) return {};
 const grouped: Record<string, MigrationStep[]> = {};
 for (const step of activeSteps.steps) {
 if (!grouped[step.phase]) grouped[step.phase] = [];
 grouped[step.phase].push(step);
 }
 return grouped;
 }, [activeSteps]);

 // Calculate phase statuses from steps
 const phaseStatuses = useMemo(() => {
 const statuses: Record<string, 'pending' | 'running' | 'completed' | 'failed' | 'skipped'> = {};
 for (const phase of MIGRATION_PHASES) {
 const steps = stepsByPhase[phase.id] || [];
 if (steps.length === 0) {
 statuses[phase.id] = 'pending';
 } else if (steps.some(s => s.status === 'running')) {
 statuses[phase.id] = 'running';
 } else if (steps.every(s => s.status === 'completed' || s.status === 'skipped')) {
 statuses[phase.id] = 'completed';
 } else if (steps.some(s => s.status === 'failed')) {
 statuses[phase.id] = 'failed';
 } else if (steps.every(s => s.status === 'skipped')) {
 statuses[phase.id] = 'skipped';
 } else {
 statuses[phase.id] = 'pending';
 }
 }
 return statuses;
 }, [stepsByPhase]);

 // Ref to scroll active phase into view
 const activePhaseRef = useRef<HTMLDivElement>(null);
 useEffect(() => {
 if (activePhaseRef.current) {
 activePhaseRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
 }
 }, [activeJob?.currentPhase]);

 // Elapsed time counter for running jobs
 const startedAt = activeJob?.startedAt;
 const status = activeJob?.status;
 const shouldRun = Boolean(startedAt) && status !== undefined && ['running', 'validating'].includes(status);
 const [elapsed, setElapsed] = useState(() => {
 if (!shouldRun || !startedAt) return 0;
 return Date.now() - new Date(startedAt).getTime();
 });
 const [prevShouldRun, setPrevShouldRun] = useState(shouldRun);
 if (shouldRun !== prevShouldRun) {
 setPrevShouldRun(shouldRun);
 if (!shouldRun) setElapsed(0);
 }
 useEffect(() => {
 if (!shouldRun || !startedAt) return;
 const startTime = new Date(startedAt).getTime();
 const timer = setInterval(() => setElapsed(Date.now() - startTime), 1000);
 return () => clearInterval(timer);
 }, [shouldRun, startedAt]);

 const tabs = [
 { id: 'new' as const, label: t('migration.tabs.new') },
 { id: 'progress' as const, label: t('migration.tabs.active'), show: !!activeJobId },
 { id: 'history' as const, label: t('migration.tabs.history') },
 ].filter((tab) => tab.show !== false);

 return (
 <div className="space-y-5">
 {/* Page Header */}
 <TabHeader
 icon={ArrowRightLeft}
 title={t('migration.title')}
 description={t('migration.description')}
 />

 {/* Tab Bar */}
 <div className="inline-flex gap-1 rounded-xl border border-border/40 bg-surface-2/40 p-1.5 ">
 {tabs.map(tab => (
 <button
 key={tab.id}
 onClick={() => setActiveTab(tab.id)}
 className={cn(
 'px-3 py-1.5 text-sm font-medium rounded-lg transition-all',
 activeTab === tab.id
 ? 'bg-primary text-primary-foreground '
 : 'text-muted-foreground hover:text-foreground'
 )}
 >
 {tab.label}
 </button>
 ))}
 </div>

 {/* TAB: New Migration */}
 {activeTab === 'new' && (
      <div>
      <ServerTabCard>
        <h2 className="font-display text-sm font-semibold text-foreground">{t('migration.connect.title')}</h2>
        <p className="type-meta mb-4 mt-1">
          {t('migration.connect.description')}
        </p>


 <div className="space-y-4">
 {/* Panel URL */}
 <div className="space-y-1.5">
 <label className="text-sm font-medium text-foreground">{t('migration.connect.panelUrl')}</label>
 <Input
 value={panelUrl}
 onChange={(e) => setPanelUrl(e.target.value)}
 placeholder="http://panel.example.com"
 className="border-border/40 bg-card"
 />
 </div>

 {/* API Key */}
 <div className="space-y-1.5">
 <label className="text-sm font-medium text-foreground">{t('migration.connect.apiKey')}</label>
 <div className="relative">
 <Input
 value={apiKey}
 onChange={(e) => setApiKey(e.target.value)}
 type={showKey ? 'text' : 'password'}
 placeholder="ptla_..."
 className="border-border/40 bg-card pr-10"
 />
 <button
 onClick={() => setShowKey(!showKey)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
 >
 <Eye className="h-4 w-4" />
 </button>
 </div>
 </div>

 {/* Client API Key */}
 <div className="space-y-1.5">
 <label className="text-sm font-medium text-foreground">
 {t('migration.connect.clientApiKey')}{" "}
 <span className="text-muted-foreground font-normal">{t('migration.connect.clientApiKeyHint')}</span>
 </label>
 <div className="relative">
 <Input
 value={clientApiKey}
 onChange={(e) => setClientApiKey(e.target.value)}
 type={showClientKey ? 'text' : 'password'}
 placeholder="ptlc_..."
 className="border-border/40 bg-card pr-10"
 />
 <button
 onClick={() => setShowClientKey(!showClientKey)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
 >
 <Eye className="h-4 w-4" />
 </button>
 </div>
 <p className="text-xs text-muted-foreground">
 {t('migration.connect.clientApiKeyNote')}
 </p>
 </div>

 {/* Test Result */}
 {testResult && (
 <div className={`rounded-lg border p-4 ${
 testResult.success
 ? 'border-success/30 bg-success/5'
 : 'border-danger/30 bg-danger/5'
 }`}>
 <div className="flex items-center gap-2 mb-2">
 {testResult.success ? (
 <CheckCircle2 className="h-4 w-4 text-success" />
 ) : (
 <XCircle className="h-4 w-4 text-destructive" />
 )}
 <span className={`text-sm font-medium ${testResult.success ? 'text-success' : 'text-destructive'}`}>
 {testResult.success ? t('migration.test.connected', { version: testResult.version || '1.x' }) : t('migration.test.failed')}
 </span>
 </div>
 {!testResult.success ? (
 <p className="text-sm text-destructive">{testResult.error}</p>
 ) : testResult.stats ? (
 <StatGrid
 items={[
 { label: t('migration.test.locations'), value: testResult.stats.locations },
 { label: t('migration.test.nodes'), value: testResult.stats.nodes },
 { label: t('migration.test.nests'), value: testResult.stats.nests },
 { label: t('migration.test.users'), value: testResult.stats.users },
 { label: t('migration.test.servers'), value: testResult.stats.servers },
 ]}
 columns={3}
 className="mt-2"
 />
 ) : null}
 </div>
 )}

 {/* Backup slot warnings */}
 <BackupSlotWarnings serversList={testResult?.serversList} />

 {/* Migration Scope (only shown after successful test) */}
 {testResult?.success && (
 <div className="space-y-3">
 <label className="text-sm font-medium text-foreground">{t('migration.scope.title')}</label>
 <div className="grid grid-cols-3 gap-2">
 {([
 { value: 'full' as const, label: t('migration.scope.full'), desc: t('migration.scope.fullDescription') },
 { value: 'node' as const, label: t('migration.scope.node'), desc: t('migration.scope.nodeDescription') },
 { value: 'server' as const, label: t('migration.scope.server'), desc: t('migration.scope.serverDescription') },
 ]).map(opt => (
 <button
 key={opt.value}
 onClick={() => {
 setMigrationScope(opt.value);
 setNodeMappings({});
 setServerMappings({});
 }}
 className={`rounded-lg border p-3 text-left transition-colors ${
 migrationScope === opt.value
 ? 'border-primary bg-primary/10'
 : 'border-border bg-surface-1 hover:border-border'
 }`}
 >
 <div className="text-sm font-medium text-foreground">
 {opt.label}
 </div>
 <div className="text-xs text-muted-foreground mt-0.5">{opt.desc}</div>
 </button>
 ))}
 </div>
 </div>
 )}

 {/* Online nodes warning */}
 {testResult?.success && onlineNodes.length === 0 && (
 <TabErrorState
 message={t('migration.noOnlineNodes')}
 />
 )}

 {/* Node Mapping (full / node scope) */}
 {testResult?.success && (migrationScope === 'full' || migrationScope === 'node')
 && testResult.nodesList && testResult.nodesList.length > 0 && onlineNodes.length > 0 && (
 <NodeMappingSection
 nodes={testResult.nodesList}
 servers={testResult.serversList || []}
 nodeMappings={nodeMappings}
 setNodeMappings={setNodeMappings}
 onlineNodes={onlineNodes}
 scope={migrationScope}
 />
 )}

 {/* Server Mapping (server scope) */}
 {testResult?.success && migrationScope === 'server'
 && testResult.serversList && testResult.serversList.length > 0 && onlineNodes.length > 0 && (
 <ServerMappingList
 servers={testResult.serversList}
 serverMappings={serverMappings}
 setServerMappings={setServerMappings}
 onlineNodes={onlineNodes}
 />
 )}

 {/* Mapping summary */}
 {testResult?.success && onlineNodes.length > 0 && (
 <div className="text-xs text-muted-foreground space-y-1">
 {migrationScope === 'server' && (
 <p>{t('migration.summary.serversMapped', { mapped: Object.keys(serverMappings).length, total: testResult.serversList?.length || 0 })}</p>
 )}
 {(migrationScope === 'full' || migrationScope === 'node') && (
 <p>{t('migration.summary.nodesMapped', {
 mapped: Object.keys(nodeMappings).length,
 total: migrationScope === 'full' ? testResult.nodesList?.length || 0 : t('migration.summary.selected'),
 })}</p>
 )}
 </div>
 )}

 {/* Actions */}
 <div className="flex gap-3 pt-2">
 <Button
 onClick={() => testMutation.mutate()}
 disabled={!panelUrl || !apiKey || testing}
 variant="outline"
 className="gap-2"
 >
 {testing ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <ExternalLink className="h-4 w-4" />
 )}
 {t('migration.testConnection')}
 </Button>
 <Button
 onClick={() => startMutation.mutate()}
 disabled={
 !testResult?.success ||
 startMutation.isPending ||
 onlineNodes.length === 0 ||
 (migrationScope === 'server' && Object.keys(serverMappings).length === 0) ||
 ((migrationScope === 'full') && Object.keys(nodeMappings).length !== (testResult.nodesList?.length || 0)) ||
 (migrationScope === 'node' && Object.keys(nodeMappings).length === 0)
 }
 className="gap-2"
 >
 {startMutation.isPending ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Play className="h-4 w-4" />
 )}
 {t('migration.startMigration')}
 </Button>
 </div>
 </div>
 </ServerTabCard>
 </div>
 )}

 {/* TAB: Active Migration Progress */}
 {activeTab === 'progress' && activeJob && (
 <div className="space-y-5">
 {/* Status Header */}
 <ServerTabCard>
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-3">
 <StatusBadge status={activeJob.status} />
 <div>
 <h2 className="text-lg font-semibold text-foreground">{t('migration.progress.title')}</h2>
 <p className="text-sm text-muted-foreground">
 {activeJob.sourceUrl}
 {activeJob.currentPhase && (
 <span className="text-muted-foreground">
 {' '}— {t('migration.progress.phase')} <span className="text-foreground">{phaseLabel(t, activeJob.currentPhase)}</span>
 </span>
 )}
 </p>
 </div>
 </div>
 <div className="flex gap-2">
 {activeJob.status === 'running' && (
 <Button
 onClick={() => pauseMutation.mutate()}
 disabled={pauseMutation.isPending}
 variant="outline"
 size="sm"
 className="gap-1.5"
 >
 <Pause className="h-3.5 w-3.5" />
 {t('migration.actions.pause')}
 </Button>
 )}
 {activeJob.status === 'paused' && (
 <Button
 onClick={() => resumeMutation.mutate()}
 disabled={resumeMutation.isPending}
 size="sm"
 className="gap-1.5"
 >
 <Play className="h-3.5 w-3.5" />
 {t('migration.actions.resume')}
 </Button>
 )}
 {(activeJob.status === 'running' || activeJob.status === 'paused') && (
 <Button
 onClick={() => cancelMutation.mutate()}
 disabled={cancelMutation.isPending}
 variant="destructive"
 size="sm"
 className="gap-1.5"
 >
 <X className="h-3.5 w-3.5" />
 {t('common:actions.cancel')}
 </Button>
 )}
 </div>
 </div>

 {/* Progress Bar */}
 <ProgressBar progress={activeJob.progress} />

 {/* Current step detail */}
 {['running', 'validating'].includes(activeJob.status) && activeJob.currentPhase && (() => {
 const phaseSteps = stepsByPhase[activeJob.currentPhase] || [];
 const runningStep = phaseSteps.find(s => s.status === 'running');
 if (!runningStep) return null;
 return (
 <div className="mt-3 flex items-center gap-2 text-xs text-primary">
 <Loader2 className="h-3 w-3 animate-spin" />
 <span>
 {stepLabel(t, runningStep.action, runningStep.metadata as Record<string, unknown>)}
 {runningStep.sourceId && <span className="text-primary/60"> #{runningStep.sourceId}</span>}
 </span>
 </div>
 );
 })()}
 {activeJob.error && (
 <div className="mt-4 rounded-lg border border-danger/25 bg-danger/5 p-3">
 <div className="flex items-center gap-2 text-destructive">
 <AlertTriangle className="h-4 w-4" />
 <span className="text-sm font-medium">{t('common:status.error')}</span>
 </div>
 <p className="text-sm text-destructive/80 mt-1">{activeJob.error}</p>
 </div>
 )}

 {/* Timing & Stats */}
 <div className="flex gap-6 mt-4 text-xs text-muted-foreground">
 <span>{t('migration.progress.started', { date: activeJob.startedAt ? formatDateTime(activeJob.startedAt) : '—' })}</span>
 {['running', 'validating'].includes(activeJob.status) && elapsed > 0 && (
 <span className="text-muted-foreground font-medium">{t('migration.progress.elapsed', { duration: formatDuration(elapsed) })}</span>
 )}
 {activeJob.completedAt && activeJob.startedAt && (
 <span className="text-muted-foreground">
 {t('migration.progress.duration', { duration: formatDuration(new Date(activeJob.completedAt).getTime() - new Date(activeJob.startedAt).getTime()) })}
 </span>
 )}
 </div>
 </ServerTabCard>

 {/* Phase List */}
 <ServerTabCard className="overflow-hidden">
 <div className="pb-3">
 <h3 className="text-sm font-semibold text-foreground">{t('migration.phases.title')}</h3>
 </div>
 <div>
 {MIGRATION_PHASES.map((phase) => {
 const status = phaseStatuses[phase.id] || 'pending';
 const steps = stepsByPhase[phase.id] || [];
 const sc = stepStatusConfig[status];
 const PhaseIconComp = PhaseIcon;
 const isCurrentPhase = activeJob.currentPhase === phase.id;

 const failedInPhase = steps.filter(s => s.status === 'failed').length;

 return (
 <div
 key={phase.id}
 ref={isCurrentPhase ? activePhaseRef : undefined}
 className={`border-b border-border/50 last:border-0 ${
 isCurrentPhase ? 'bg-surface-2/30' : ''
 }`}
 >
 <div className="flex items-center gap-3 px-4 py-3">
 <div className={`flex-shrink-0 ${sc.color}`}>
 {status === 'running' ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <PhaseIconComp phaseId={phase.id} />
 )}
 </div>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium text-foreground">{phaseLabel(t, phase.id)}</span>
 {isCurrentPhase && (
 <Badge variant="default" className="text-[10px] px-1.5 py-0">{t('migration.phases.current')}</Badge>
 )}
 </div>
 <div className="text-xs text-muted-foreground mt-0.5">
 {(() => {
 if (steps.length === 0) {
 return t('migration.phases.waiting');
 }
 const skippedInPhase = steps.filter(s => s.status === 'skipped' || (s.status === 'completed' && skipReason(t, s.status, s.metadata as Record<string, unknown>)));
 const realCompleted = steps.filter(s => s.status === 'completed' && !skipReason(t, s.status, s.metadata as Record<string, unknown>));
 const parts: string[] = [];
 if (realCompleted.length > 0) parts.push(t('migration.progress.completed', { value: realCompleted.length }));
 if (skippedInPhase.length > 0) parts.push(t('migration.progress.skipped', { value: skippedInPhase.length }));
 if (failedInPhase > 0) parts.push(t('migration.progress.failed', { value: failedInPhase }));
 return parts.join(' · ') || t('migration.phases.steps', { value: steps.length });
 })()}
 </div>
 {/* Inline error preview for phase with failures */}
 {failedInPhase > 0 && status !== 'running' && (
 <div className="mt-1.5">
 {steps.filter(s => s.status === 'failed').slice(0, 2).map(s => (
 <div key={s.id} className="text-[11px] text-destructive/80 truncate max-w-md">
 {stepLabel(t, s.action, s.metadata as Record<string, unknown>)}: {s.error}
 </div>
 ))}
 {failedInPhase > 2 && (
 <div className="text-[11px] text-muted-foreground">
 {t('migration.phases.moreErrors', { value: failedInPhase - 2 })}
 </div>
 )}
 </div>
 )}
 </div>
 <span className={`text-xs font-medium ${sc.color}`}>
 {stepStatusLabel(t, status)}
 </span>
 </div>
 {steps.length > 0 && (
 <PhaseSteps steps={steps} onRetry={handleRetryStep} />
 )}
 </div>
 );
 })}
 </div>
 </ServerTabCard>
 </div>
 )}

 {/* TAB: Active Migration - No Job */}
 {activeTab === 'progress' && !activeJob && (
 <TabEmptyState
 title={t('migration.empty.noActive')}
 description={t('migration.empty.noActiveDescription')}
 />
 )}

 {/* TAB: History */}
 {activeTab === 'history' && (
 <ServerTabCard className="overflow-hidden">
 <div className="flex items-center justify-between pb-3">
 <h3 className="text-sm font-semibold text-foreground">{t('migration.history.title')}</h3>
 <button
 onClick={() => queryClient.invalidateQueries({ queryKey: qk.migrationJobs() })}
 className="text-muted-foreground hover:text-foreground"
 >
 <RefreshCw className="h-4 w-4" />
 </button>
 </div>
 {loadingJobs ? (
 <TabLoadingState rows={4} />
 ) : safeJobs.length === 0 ? (
 <TabEmptyState
 title={t('migration.empty.noJobs')}
 description={t('migration.empty.noJobsDescription')}
 />
 ) : (
 <div className="divide-y divide-border/50">
 {safeJobs.map(job => (
 <button
 key={job.id}
 onClick={() => {
 setActiveJobId(job.id);
 setActiveTab('progress');
 }}
 className="w-full flex items-center gap-4 px-4 py-3 hover:bg-surface-2/30 transition-colors text-left"
 >
 <StatusBadge status={job.status} />
 <div className="flex-1 min-w-0">
 <div className="text-sm text-foreground truncate">{job.sourceUrl}</div>
 <div className="text-xs text-muted-foreground">
 {t('migration.history.jobSteps', { completed: job.progress?.completed || 0, total: job.progress?.total || 0 })}
 {' · '}
 {formatDate(job.createdAt)}
 </div>
 </div>
 {job.error && (
 <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
 )}
 <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
 </button>
 ))}
 </div>
 )}
 </ServerTabCard>
 )}
 </div>
 );
}
