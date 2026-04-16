import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  ArrowRightLeft,
  Play,
  Pause,
  RotateCcw,
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
  WifiOff,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { Checkbox } from '../../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { migrationApi } from '../../services/api/migration';
import { notifySuccess, notifyError, notifyInfo } from '../../utils/notify';
import type {
  MigrationJob,
  MigrationStep,
  PterodactylTestResult,
  MigrationPhaseId,
  MigrationScope,
  CatalystNodeOption,
  PterodactylServerInfo,
} from '../../types/migration';
import { MIGRATION_PHASES, PHASE_STATUS_COLORS } from '../../types/migration';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

// ── Status helpers ──
const statusConfig: Record<string, { label: string; variant: 'default' | 'success' | 'destructive' | 'secondary' | 'outline'; icon: any }> = {
  pending: { label: 'Pending', variant: 'secondary', icon: Clock },
  validating: { label: 'Validating', variant: 'outline', icon: Loader2 },
  running: { label: 'Running', variant: 'default', icon: Loader2 },
  paused: { label: 'Paused', variant: 'outline', icon: Pause },
  completed: { label: 'Completed', variant: 'success', icon: CheckCircle2 },
  failed: { label: 'Failed', variant: 'destructive', icon: XCircle },
  cancelled: { label: 'Cancelled', variant: 'secondary', icon: X },
};

function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;
  return (
    <Badge variant={config.variant} className="gap-1.5">
      {status === 'running' || status === 'validating' ? (
        <Icon className="h-3 w-3 animate-spin" />
      ) : (
        <Icon className="h-3 w-3" />
      )}
      {config.label}
    </Badge>
  );
}

const stepStatusConfig: Record<string, { label: string; color: string; icon: any; bg: string }> = {
  pending: { label: 'Pending', color: 'text-zinc-500', icon: Clock, bg: '' },
  running: { label: 'Running', color: 'text-blue-400', icon: Loader2, bg: 'bg-blue-500/10' },
  completed: { label: 'Done', color: 'text-emerald-400', icon: CheckCircle2, bg: '' },
  failed: { label: 'Failed', color: 'text-red-400', icon: XCircle, bg: 'bg-red-500/10' },
  skipped: { label: 'Skipped', color: 'text-zinc-400', icon: Clock, bg: '' },
};

// Human-readable step labels
function stepLabel(action: string, metadata?: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    validate_connection: 'Test connection',
    import_location: 'Import location',
    import_nest: 'Import nest',
    import_template: 'Import template',
    import_user: 'Import user',
    import_server: 'Import server',
    import_database_host: 'Import database host',
    import_database: 'Import database',
    import_schedule: 'Import schedule',
    import_backup: 'Import backup',
    download_files: 'Download files',
  };
  const base = labels[action] || action.replace(/_/g, ' ');
  if (metadata?.name) return `${base}: ${metadata.name as string}`;
  return base;
}

// Derive a human-readable skip reason from step metadata
function skipReason(status: string, metadata?: Record<string, unknown> | null): string | null {
  if (status !== 'skipped' && status !== 'completed') return null;
  if (!metadata?.skipped && !metadata?.reason) return null;
  const reason = (metadata.reason as string) || '';
  if (reason.includes('already exists') || reason.includes('already done')) return 'Already existing';
  if (reason.includes('not migrated') || reason.includes('User not migrated')) return 'Not applicable';
  if (reason.includes('server owner') || reason.includes('is server owner')) return 'Not applicable';
  if (reason.includes('No client API key')) return 'No client API key';
  if (reason.includes('backup limit') || reason.includes('backup slot')) return 'No backup slots';
  if (reason.includes('No schedules') || reason.includes('no schedules')) return 'No schedules';
  if (reason.includes('not accessible') || reason.includes('404')) return 'Not available';
  return reason || 'Skipped';
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
  const pct = progress.total > 0 ? Math.round(((progress.completed + progress.failed + progress.skipped) / progress.total) * 100) : 0;
  const completedPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
  const failedPct = progress.total > 0 ? (progress.failed / progress.total) * 100 : 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-zinc-400">
        <span>{progress.completed} completed</span>
        <span>{progress.failed} failed</span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
        <div className="flex h-full">
          <motion.div
            className="h-full bg-emerald-500"
            initial={{ width: 0 }}
            animate={{ width: `${completedPct}%` }}
            transition={{ duration: 0.5 }}
          />
          <motion.div
            className="h-full bg-red-500"
            initial={{ width: 0 }}
            animate={{ width: `${failedPct}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Phase Step List ──
function PhaseSteps({ steps, onRetry }: { steps: MigrationStep[]; onRetry: (stepId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [errorStepId, setErrorStepId] = useState<string | null>(null);

  if (steps.length === 0) return null;

  const failedSteps = steps.filter(s => s.status === 'failed');
  // Auto-expand if there are failures
  const showExpanded = expanded || failedSteps.length > 0;

  return (
    <div className="mt-2 ml-6 border-l border-zinc-700/50 pl-3 space-y-0.5">
      {(showExpanded ? steps : steps.slice(0, 5)).map((step) => {
        const sc = stepStatusConfig[step.status] || stepStatusConfig.pending;
        const StepIcon = sc.icon;
        const showError = step.status === 'failed' && errorStepId === step.id;
        return (
          <motion.div
            key={step.id}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            className={`${sc.bg} rounded px-2 py-1 -mx-2`}
          >
            <div className="flex items-center gap-2">
              <StepIcon className={`h-3 w-3 flex-shrink-0 ${sc.color} ${step.status === 'running' ? 'animate-spin' : ''}`} />
              <span className="text-xs text-zinc-300 flex-1 truncate">
                {stepLabel(step.action, step.metadata as Record<string, unknown>)}
                {step.sourceId && (
                  <span className="text-zinc-600"> #{step.sourceId}</span>
                )}
                {skipReason(step.status, step.metadata as Record<string, unknown>) && (
                  <span className="text-zinc-500 ml-1.5">
                    — {skipReason(step.status, step.metadata as Record<string, unknown>)}
                  </span>
                )}
              </span>
              <span className="text-xs text-zinc-600 flex-shrink-0">{formatDuration(step.durationMs)}</span>
              {step.status === 'failed' && (
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => setErrorStepId(showError ? null : step.id)}
                    className="text-xs text-zinc-500 hover:text-zinc-300"
                    title="Toggle error details"
                  >
                    {showError ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={() => onRetry(step.id)}
                    className="text-xs text-blue-400 hover:text-blue-300"
                    title="Retry"
                  >
                    <RefreshCw className="h-3 w-3" />
                  </button>
                </div>
              )}
              {step.status === 'completed' && step.metadata && (
                <CheckCircle2 className="h-3 w-3 text-emerald-500/50 flex-shrink-0" />
              )}
            </div>
            {showError && step.error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-1 pl-5"
              >
                <p className="text-xs text-red-400 bg-red-950/40 border border-red-800/30 rounded px-2 py-1.5 break-all">
                  {step.error}
                </p>
              </motion.div>
            )}
          </motion.div>
        );
      })}
      {steps.length > 5 && failedSteps.length === 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mt-0.5"
        >
          {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {expanded ? 'Show less' : `${steps.length - 5} more...`}
        </button>
      )}
    </div>
  );
}

// ── What Gets Migrated Card ──
function WhatGetsMigratedCard() {
  const sections = [
    {
      title: 'Server Configuration',
      items: [
        'Name, description, and container name (identifier)',
        'All egg variable values (environment)',
        'Startup command override',
        'Docker image override',
        'Memory, CPU, disk, swap, and IO weight limits',
        'Port allocations from Catalyst node',
        'Suspension status',
      ],
    },
    {
      title: 'Users & Permissions',
      items: [
        'User accounts (email, name, admin status)',
        'Subusers with permission mapping',
        'Server ownership (owner gets full access)',
        'Passwords reset (cannot import bcrypt hashes)',
      ],
    },
    {
      title: 'Templates & Config',
      'items': [
        'Nests and eggs (auto-converted to Catalyst templates)',
        'Config file editor support (from egg definition)',
        'Install image and scripts',
      ],
    },
    {
      title: 'Data & Files',
      items: [
        'Server files (via Pterodactyl backup system)',
        'SHA1 checksum validation on file transfer',
        'Databases and database hosts (preserves passwords)',
      ],
    },
    {
      title: 'Schedules & Tasks',
      items: [
        'Scheduled tasks (cron jobs) with time offsets',
        'Power actions and command sequences',
      ],
    },
    {
      title: 'Not Migrated',
      items: [
        'API keys (users create fresh ones)',
        'User passwords (must be reset after migration)',
        'Activity logs and audit history',
        'Node allocations (uses Catalyst\'s allocation system)',
      ],
      dim: true,
    },
  ];

  return (
    <Card className="p-5 bg-card border border-border">
      <h3 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center gap-2">
        <ArrowRightLeft className="h-4 w-4 text-primary" />
        What Gets Migrated
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map(section => (
          <div key={section.title}>
            <div className={`text-xs font-semibold uppercase tracking-wider mb-1.5 ${section.dim ? 'text-zinc-600' : 'text-zinc-400'}`}>
              {section.title}
            </div>
            <ul className="space-y-1">
              {section.items.map(item => (
                <li key={item} className="flex items-start gap-1.5 text-xs">
                  {section.dim ? (
                    <XCircle className="h-3 w-3 text-zinc-700 mt-0.5 flex-shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-emerald-500/50 mt-0.5 flex-shrink-0" />
                  )}
                  <span className={section.dim ? 'text-zinc-600' : 'text-zinc-400'}>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ── Server Import Summary ──
function ServerImportSummary({ server }: { server: PterodactylServerInfo }) {
  const items: Array<{ label: string; value: number | string | boolean; icon: any }> = [
    { label: 'Memory', value: `${server.memory} MB`, icon: HardDrive },
    { label: 'Disk', value: `${server.disk} MB`, icon: HardDrive },
    { label: 'CPU', value: `${server.cpu}%`, icon: Server },
  ];

  const imports: Array<{ label: string; count: number; icon: any; zeroLabel?: string }> = [
    { label: 'Schedules', count: server.schedules, icon: Clock },
    { label: 'Subusers', count: server.subusers, icon: Users },
    { label: 'Databases', count: server.databases, icon: Database },
    { label: 'Server Files', count: server.backupSlots > 0 ? 1 : 0, icon: HardDrive, zeroLabel: 'No backup slots' },
  ];

  return (
    <div className="mt-2 ml-1 space-y-2">
      {/* Server resources */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {items.map(item => (
          <span key={item.label} className="flex items-center gap-1.5 text-xs text-zinc-400">
            <item.icon className="h-3 w-3 text-zinc-600" />
            <span className="text-zinc-500">{item.label}:</span>
            <span className="text-zinc-300 font-medium">{item.value}</span>
          </span>
        ))}
        {server.suspended && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400">
            <Pause className="h-3 w-3" />
            Suspended
          </span>
        )}
      </div>

      {/* What gets imported */}
      <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Imports</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        {/* Always imported */}
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
          Server config &amp; env vars
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
          Port allocations
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
          Startup command
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
          Docker image override
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
          Config file editor
        </span>
        <span className="flex items-center gap-1.5 text-xs text-zinc-400">
          <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
          Swap &amp; IO weight
        </span>
        {/* Conditional imports */}
        {imports.map(item => (
          <span
            key={item.label}
            className={`flex items-center gap-1.5 text-xs ${
              item.count > 0
                ? 'text-zinc-400'
                : 'text-zinc-600'
            }`}
          >
            {item.count > 0 ? (
              <CheckCircle2 className="h-3 w-3 text-emerald-500/60" />
            ) : (
              <XCircle className="h-3 w-3 text-zinc-700" />
            )}
            {item.label}
            {item.count > 0 && (
              <span className="text-zinc-500 font-medium">({item.count})</span>
            )}
            {item.count === 0 && item.zeroLabel && (
              <span className="text-zinc-700 text-[10px]">
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
  nodes: Array<{ id: number; name: string; fqdn: string; memory: number; serverCount: number }>;
  servers: PterodactylServerInfo[];
  nodeMappings: Record<string, string>;
  setNodeMappings: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onlineNodes: CatalystNodeOption[];
  scope: MigrationScope;
}) {
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
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="space-y-2"
    >
      <label className="text-sm font-medium text-zinc-300">
        Map Pterodactyl Nodes to Catalyst Nodes
      </label>
      <p className="text-xs text-zinc-500">
        {scope === 'full'
          ? 'All Pterodactyl nodes must be mapped. Click a node to see what gets imported.'
          : 'Select which Pterodactyl nodes to map. Click to see server import details.'}
      </p>
      <div className="max-h-80 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 divide-y divide-zinc-800">
        {nodes.map(node => {
          const expanded = expandedNodeId === node.id;
          const nodeServers = serversByNode.get(node.id) || [];
          return (
            <div key={node.id}>
              <div
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                onClick={() => setExpandedNodeId(expanded ? null : node.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200 truncate flex items-center gap-2">
                    {expanded ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
                    {node.name}
                    <span className="text-xs text-zinc-500 font-normal">{node.serverCount} servers</span>
                  </div>
                  <div className="text-xs text-zinc-500">{node.fqdn} · {node.memory} MB</div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-600 flex-shrink-0" />
                <div onClick={e => e.stopPropagation()}>
                  <Select
                    value={nodeMappings[String(node.id)] || ''}
                    onValueChange={(v) =>
                      setNodeMappings(prev => ({ ...prev, [String(node.id)]: v }))
                    }
                  >
                    <SelectTrigger className="w-48 bg-zinc-800 border-zinc-700 text-zinc-200 text-xs h-8">
                      <SelectValue placeholder="Select target node" />
                    </SelectTrigger>
                    <SelectContent>
                      {onlineNodes.map(cn => (
                        <SelectItem key={cn.id} value={cn.id}>
                          <span className="flex items-center gap-1.5">
                            <Wifi className="h-3 w-3 text-emerald-400" />
                            {cn.name}
                            <span className="text-zinc-500">({cn.locationName})</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {expanded && nodeServers.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="border-t border-zinc-800/50 bg-zinc-900/50"
                >
                  <div className="px-4 py-2">
                    <div className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-2">
                      Servers on this node ({nodeServers.length})
                    </div>
                    <div className="space-y-3">
                      {nodeServers.map(s => (
                        <div key={s.id} className="rounded-md border border-zinc-800/50 bg-zinc-900 px-3 py-2">
                          <div className="text-xs text-zinc-300 font-medium">{s.name}</div>
                          <div className="text-[11px] text-zinc-500">
                            {s.nestName}/{s.eggName}
                            {s.suspended && (
                              <span className="text-amber-400 ml-2">(suspended)</span>
                            )}
                          </div>
                          <ServerImportSummary server={s} />
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
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
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="space-y-2"
    >
      <label className="text-sm font-medium text-zinc-300">
        Map Pterodactyl Servers to Catalyst Nodes
      </label>
      <p className="text-xs text-zinc-500">
        Click a server to see what gets imported automatically.
      </p>
      <div className="max-h-96 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 divide-y divide-zinc-800">
        {servers.map(server => {
          const expanded = expandedId === server.id;
          return (
            <div key={server.id}>
              <div
                className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-zinc-800/50 transition-colors"
                onClick={() => setExpandedId(expanded ? null : server.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-zinc-200 truncate flex items-center gap-2">
                    {expanded ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
                    {server.name}
                    {server.backupSlots === 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/50 border border-amber-800/30 rounded px-1.5 py-0">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        no backups
                      </span>
                    )}
                    {server.backupSlots > 0 && server.currentBackups >= server.backupSlots && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/80 bg-amber-950/30 border border-amber-800/20 rounded px-1.5 py-0">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        slots full
                      </span>
                    )}
                    {server.suspended && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-950/30 border border-amber-800/20 rounded px-1.5 py-0">
                        Suspended
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {server.nestName}/{server.eggName} · {server.nodeName}
                    <span className="text-zinc-600 ml-2">
                      {server.memory} MB · {server.disk} MB · {server.cpu}% CPU
                    </span>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-zinc-600 flex-shrink-0" />
                <div onClick={e => e.stopPropagation()}>
                  <Select
                    value={serverMappings[String(server.id)] || ''}
                    onValueChange={(v) =>
                      setServerMappings(prev => ({ ...prev, [String(server.id)]: v }))
                    }
                  >
                    <SelectTrigger className="w-48 bg-zinc-800 border-zinc-700 text-zinc-200 text-xs h-8">
                      <SelectValue placeholder="Select target node" />
                    </SelectTrigger>
                    <SelectContent>
                      {onlineNodes.map(cn => (
                        <SelectItem key={cn.id} value={cn.id}>
                          <span className="flex items-center gap-1.5">
                            <Wifi className="h-3 w-3 text-emerald-400" />
                            {cn.name}
                            <span className="text-zinc-500">({cn.locationName})</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {expanded && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="px-4 pb-3 border-t border-zinc-800/50 bg-zinc-900/50"
                >
                  <ServerImportSummary server={server} />
                </motion.div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

// ── Backup Slot Warnings ──
function BackupSlotWarnings({ serversList }: { serversList?: Array<{ id: number; name: string; backupSlots: number; currentBackups: number }> }) {
  if (!serversList) return null;
  const noSlotServers = serversList.filter(s => s.backupSlots === 0);
  const fullSlotServers = serversList.filter(s => s.backupSlots > 0 && s.currentBackups >= s.backupSlots);
  if (noSlotServers.length === 0 && fullSlotServers.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="space-y-2"
    >
      {noSlotServers.length > 0 && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 p-3">
          <div className="flex items-center gap-2 text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">{noSlotServers.length} server{noSlotServers.length > 1 ? 's have' : ' has'} 0 backup slots</span>
          </div>
          <p className="text-sm text-amber-400/80 mt-1">
            The migration will automatically set the backup limit to 1 on these servers to create a migration backup.
          </p>
          <ul className="text-xs text-amber-400/70 mt-1 space-y-0.5 ml-4 list-disc">
            {noSlotServers.slice(0, 5).map(s => (
              <li key={s.id}>{s.name}</li>
            ))}
            {noSlotServers.length > 5 && (
              <li className="text-zinc-500">+{noSlotServers.length - 5} more</li>
            )}
          </ul>
        </div>
      )}
      {fullSlotServers.length > 0 && (
        <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3">
          <div className="flex items-center gap-2 text-amber-400/80">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">{fullSlotServers.length} server{fullSlotServers.length > 1 ? 's have' : ' has'} all backup slots in use</span>
          </div>
          <p className="text-xs text-amber-400/60 mt-1">
            The migration will automatically increase the backup limit by 1 to make room for a migration backup.
          </p>
        </div>
      )}
    </motion.div>
  );
}

// ── Main Component ──
export default function MigrationPage() {

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
    queryKey: ['catalyst-nodes'],
    queryFn: migrationApi.getCatalystNodes,
  });

  const onlineNodes = catalystNodes.filter(n => n.isOnline);

  // Fetch migration jobs
  const { data: jobs, isLoading: loadingJobs } = useQuery<MigrationJob[]>({
    queryKey: ['migration-jobs'],
    queryFn: migrationApi.listJobs,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!Array.isArray(data)) return false;
      const hasActive = data.some(j => j.status === 'running' || j.status === 'validating');
      return hasActive ? 2000 : false;
    },
  });

  // Ensure jobs is always an array for safe usage
  const safeJobs = Array.isArray(jobs) ? jobs : [];

  // Fetch active job
  const { data: activeJob } = useQuery({
    queryKey: ['migration-job', activeJobId],
    queryFn: () => migrationApi.getStatus(activeJobId!),
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const job = query.state.data;
      if (!job) return false;
      return (job.status === 'running' || job.status === 'validating') ? 2000 : false;
    },
  });

  // Fetch steps for active job
  const { data: activeSteps, isLoading: loadingSteps } = useQuery({
    queryKey: ['migration-steps', activeJobId],
    queryFn: () => migrationApi.getSteps(activeJobId!, { limit: 500 }),
    enabled: !!activeJobId,
    refetchInterval: (query) => {
      const job = activeJob;
      if (!job) return 2000;
      return ['running', 'validating', 'paused'].includes(job.status) ? 2000 : false;
    },
  });

  // Notify on job completion/failure
  const prevJobStatusRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeJob) return;
    const prev = prevJobStatusRef.current;
    if (prev && prev === 'running' && activeJob.status === 'completed') {
      notifySuccess('Migration completed successfully!');
    }
    if (prev && prev === 'running' && activeJob.status === 'failed') {
      notifyError(`Migration failed: ${activeJob.error || 'Unknown error'}`);
    }
    prevJobStatusRef.current = activeJob.status;
  }, [activeJob?.status]);

  // Auto-detect active job
  useEffect(() => {
    if (safeJobs) {
      const active = safeJobs.find(j => j.status === 'running' || j.status === 'validating' || j.status === 'paused');
      if (active) {
        setActiveJobId(active.id);
        setActiveTab('progress');
      } else {
        // If we were watching a job that's no longer active
        if (activeJobId && activeJob?.status && !['running', 'validating', 'paused'].includes(activeJob.status)) {
          // Keep showing it
        }
      }
    }
  }, [safeJobs]);

  // Mutations
  const testMutation = useMutation({
    mutationFn: () => migrationApi.testConnection(panelUrl, apiKey, clientApiKey || undefined),
    onMutate: () => { setTesting(true); setTestResult(null); },
    onSettled: () => { setTesting(false); },
    onSuccess: (data) => {
      setTestResult(data);
      if (data.success) {
        notifySuccess('Connected to Pterodactyl panel');
      } else {
        notifyError(data.error || 'Connection failed');
      }
    },
    onError: (err: any) => {
      setTestResult({ success: false, error: err.response?.data?.error || err.message });
      notifyError('Connection test failed');
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
      queryClient.invalidateQueries({ queryKey: qk.migrationJobs() });
      notifySuccess('Migration started');
    },
    onError: (err: any) => {
      notifyError(err.response?.data?.error || 'Failed to start migration');
    },
  });

  const pauseMutation = useMutation({
    mutationFn: () => migrationApi.pause(activeJobId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.migrationJob() });
      queryClient.invalidateQueries({ queryKey: qk.migrationJobs() });
      notifyInfo('Migration paused');
    },
    onError: (err: any) => notifyError(err.response?.data?.error || 'Failed to pause'),
  });

  const resumeMutation = useMutation({
    mutationFn: () => migrationApi.resume(activeJobId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.migrationJob() });
      queryClient.invalidateQueries({ queryKey: qk.migrationJobs() });
      notifySuccess('Migration resumed');
    },
    onError: (err: any) => notifyError(err.response?.data?.error || 'Failed to resume'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => migrationApi.cancel(activeJobId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.migrationJob() });
      queryClient.invalidateQueries({ queryKey: qk.migrationJobs() });
      notifyInfo('Migration cancelled');
    },
    onError: (err: any) => notifyError(err.response?.data?.error || 'Failed to cancel'),
  });

  const retryMutation = useMutation({
    mutationFn: (stepId: string) => migrationApi.retryStep(activeJobId!, stepId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.migrationJob() });
      queryClient.invalidateQueries({ queryKey: qk.migrationSteps() });
      notifySuccess('Step queued for retry');
    },
    onError: (err: any) => notifyError(err.response?.data?.error || 'Retry failed'),
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
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!activeJob?.startedAt || !['running', 'validating'].includes(activeJob.status)) {
      setElapsed(0);
      return;
    }
    const start = new Date(activeJob.startedAt).getTime();
    setElapsed(Date.now() - start);
    const timer = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [activeJob?.startedAt, activeJob?.status]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100 flex items-center gap-3">
            <ArrowRightLeft className="h-6 w-6 text-primary" />
            Migration
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Migrate servers from Pterodactyl to Catalyst
          </p>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-1 border-b border-zinc-800 pb-px">
        {[
          { id: 'new' as const, label: 'New Migration' },
          { id: 'progress' as const, label: 'Active Migration', show: !!activeJobId },
          { id: 'history' as const, label: 'History' },
        ]
          .filter(t => t.show !== false)
          .map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors relative ${
                activeTab === tab.id
                  ? 'text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.label}
              {activeTab === tab.id && (
                <motion.div
                  layoutId="migration-tab"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary"
                />
              )}
            </button>
          ))}
      </div>

      <AnimatePresence mode="wait">
        {/* TAB: New Migration */}
        {activeTab === 'new' && (
          <motion.div
            key="new"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <WhatGetsMigratedCard />
            <Card className="p-6 bg-card border border-border mt-6">
              <h2 className="text-lg font-semibold text-zinc-100 mb-1">Connect to Pterodactyl</h2>
              <p className="text-sm text-zinc-400 mb-6">
                Enter your Pterodactyl panel URL and Application API key. After connecting,
                you will map Pterodactyl nodes or servers to <strong>existing online Catalyst nodes</strong>.
              </p>

              <div className="space-y-4">
                {/* Panel URL */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-300">Panel URL</label>
                  <Input
                    value={panelUrl}
                    onChange={(e) => setPanelUrl(e.target.value)}
                    placeholder="http://panel.example.com"
                    className="bg-zinc-900 border-zinc-700 text-zinc-100"
                  />
                </div>

                {/* API Key */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-300">Application API Key</label>
                  <div className="relative">
                    <Input
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      type={showKey ? 'text' : 'password'}
                      placeholder="ptla_..."
                      className="bg-zinc-900 border-zinc-700 text-zinc-100 pr-10"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Client API Key */}
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-zinc-300">
                    Client API Key{" "}
                    <span className="text-zinc-500 font-normal">(for file migration)</span>
                  </label>
                  <div className="relative">
                    <Input
                      value={clientApiKey}
                      onChange={(e) => setClientApiKey(e.target.value)}
                      type={showClientKey ? 'text' : 'password'}
                      placeholder="ptlc_..."
                      className="bg-zinc-900 border-zinc-700 text-zinc-100 pr-10"
                    />
                    <button
                      onClick={() => setShowClientKey(!showClientKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    Required for backup creation and file migration. Create in Pterodactyl → API Credentials → Client API.
                  </p>
                </div>

                {/* Test Result */}
                {testResult && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className={`rounded-lg border p-4 ${
                      testResult.success
                        ? 'border-emerald-800/50 bg-emerald-950/30'
                        : 'border-red-800/50 bg-red-950/30'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      {testResult.success ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-400" />
                      )}
                      <span className={`text-sm font-medium ${testResult.success ? 'text-emerald-300' : 'text-red-300'}`}>
                        {testResult.success ? `Connected (v${testResult.version || '1.x'})` : 'Connection Failed'}
                      </span>
                    </div>
                    {!testResult.success ? (
                      <p className="text-sm text-red-400">{testResult.error}</p>
                    ) : testResult.stats ? (
                      <div className="grid grid-cols-5 gap-3 mt-2">
                        {[
                          { label: 'Locations', value: testResult.stats.locations, icon: MapPin },
                          { label: 'Nodes', value: testResult.stats.nodes, icon: Server },
                          { label: 'Nests', value: testResult.stats.nests, icon: Shield },
                          { label: 'Users', value: testResult.stats.users, icon: Users },
                          { label: 'Servers', value: testResult.stats.servers, icon: Server },
                        ].map(stat => (
                          <div key={stat.label} className="text-center">
                            <stat.icon className="h-4 w-4 text-zinc-500 mx-auto mb-1" />
                            <div className="text-lg font-semibold text-zinc-100">{stat.value}</div>
                            <div className="text-xs text-zinc-500">{stat.label}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </motion.div>
                )}


                {/* Backup slot warnings */}
                <BackupSlotWarnings serversList={testResult?.serversList} />

                {/* Migration Scope (only shown after successful test) */}
                {testResult?.success && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-3"
                  >
                    <label className="text-sm font-medium text-zinc-300">Migration Scope</label>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { value: 'full' as const, label: 'Full Migration', desc: 'Map all Ptero nodes to Catalyst nodes' },
                        { value: 'node' as const, label: 'Node by Node', desc: 'Select which Ptero nodes to migrate' },
                        { value: 'server' as const, label: 'Server by Server', desc: 'Map individual servers to Catalyst nodes' },
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
                              : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
                          }`}
                        >
                          <div className={`text-sm font-medium ${migrationScope === opt.value ? 'text-zinc-100' : 'text-zinc-300'}`}>
                            {opt.label}
                          </div>
                          <div className="text-xs text-zinc-500 mt-0.5">{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Online nodes warning */}
                {testResult?.success && onlineNodes.length === 0 && (
                  <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 p-3">
                    <div className="flex items-center gap-2 text-amber-400">
                      <WifiOff className="h-4 w-4" />
                      <span className="text-sm font-medium">No online Catalyst nodes</span>
                    </div>
                    <p className="text-sm text-amber-400/80 mt-1">
                      Migration requires at least one Catalyst node to be online. Start the agent on your nodes first.
                    </p>
                  </div>
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
                  <div className="text-xs text-zinc-500 space-y-1">
                    {migrationScope === 'server' && (
                      <p>{Object.keys(serverMappings).length} of {testResult.serversList?.length || 0} servers mapped</p>
                    )}
                    {(migrationScope === 'full' || migrationScope === 'node') && (
                      <p>{Object.keys(nodeMappings).length} of {
                        migrationScope === 'full' ? testResult.nodesList?.length || 0 : 'selected'
                      } nodes mapped</p>
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
                    Test Connection
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
                    Start Migration
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}

        {/* TAB: Active Migration Progress */}
        {activeTab === 'progress' && activeJob && (
          <motion.div
            key="progress"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* Status Header */}
            <Card className="p-6 bg-card border border-border">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <StatusBadge status={activeJob.status} />
                  <div>
                    <h2 className="text-lg font-semibold text-zinc-100">Migration Progress</h2>
                    <p className="text-sm text-zinc-400">
                      {activeJob.sourceUrl}
                      {activeJob.currentPhase && (
                        <span className="text-zinc-500">
                          {' '}— Phase: <span className="text-zinc-300">{activeJob.currentPhase}</span>
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
                      Pause
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
                      Resume
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
                      Cancel
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
                  <div className="mt-3 flex items-center gap-2 text-xs text-blue-400">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>
                      {stepLabel(runningStep.action, runningStep.metadata as Record<string, unknown>)}
                      {runningStep.sourceId && <span className="text-blue-400/60"> #{runningStep.sourceId}</span>}
                    </span>
                  </div>
                );
              })()}
              {activeJob.error && (
                <div className="mt-4 rounded-lg border border-red-800/50 bg-red-950/30 p-3">
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-medium">Error</span>
                  </div>
                  <p className="text-sm text-red-400/80 mt-1">{activeJob.error}</p>
                </div>
              )}

              {/* Timing & Stats */}
              <div className="flex gap-6 mt-4 text-xs text-zinc-500">
                <span>Started: {activeJob.startedAt ? new Date(activeJob.startedAt).toLocaleString() : '—'}</span>
                {['running', 'validating'].includes(activeJob.status) && elapsed > 0 && (
                  <span className="text-zinc-400 font-medium">Elapsed: {formatDuration(elapsed)}</span>
                )}
                {activeJob.completedAt && activeJob.startedAt && (
                  <span className="text-zinc-400">
                    Duration: {formatDuration(new Date(activeJob.completedAt).getTime() - new Date(activeJob.startedAt).getTime())}
                  </span>
                )}
              </div>
            </Card>

            {/* Phase List */}
            <Card className="bg-card border border-border overflow-hidden">
              <div className="p-4 border-b border-zinc-800">
                <h3 className="text-sm font-semibold text-zinc-200">Migration Phases</h3>
              </div>
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {MIGRATION_PHASES.map((phase) => {
                  const status = phaseStatuses[phase.id] || 'pending';
                  const steps = stepsByPhase[phase.id] || [];
                  const sc = stepStatusConfig[status];
                  const PhaseIconComp = PhaseIcon;
                  const isCurrentPhase = activeJob.currentPhase === phase.id;
                  const completedInPhase = steps.filter(s => s.status === 'completed').length;
                  const failedInPhase = steps.filter(s => s.status === 'failed').length;

                  return (
                    <motion.div
                      key={phase.id}
                      variants={itemVariants}
                      ref={isCurrentPhase ? activePhaseRef : undefined}
                      className={`border-b border-zinc-800/50 last:border-0 ${
                        isCurrentPhase ? 'bg-zinc-800/30' : ''
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
                            <span className="text-sm font-medium text-zinc-200">{phase.label}</span>
                            {isCurrentPhase && (
                              <Badge variant="default" className="text-[10px] px-1.5 py-0">CURRENT</Badge>
                            )}
                          </div>
                          <div className="text-xs text-zinc-500 mt-0.5">
                            {(() => {
                              if (steps.length === 0) {
                                return 'Waiting...';
                              }
                              const skippedInPhase = steps.filter(s => s.status === 'skipped' || (s.status === 'completed' && skipReason(s.status, s.metadata as Record<string, unknown>)));
                              const realCompleted = steps.filter(s => s.status === 'completed' && !skipReason(s.status, s.metadata as Record<string, unknown>));
                              const parts: string[] = [];
                              if (realCompleted.length > 0) parts.push(`${realCompleted.length} completed`);
                              if (skippedInPhase.length > 0) parts.push(`${skippedInPhase.length} skipped`);
                              if (failedInPhase > 0) parts.push(`${failedInPhase} failed`);
                              return parts.join(' · ') || `${steps.length} steps`;
                            })()}
                          </div>
                          {/* Inline error preview for phase with failures */}
                          {failedInPhase > 0 && status !== 'running' && (
                            <div className="mt-1.5">
                              {steps.filter(s => s.status === 'failed').slice(0, 2).map(s => (
                                <div key={s.id} className="text-[11px] text-red-400/80 truncate max-w-md">
                                  {stepLabel(s.action, s.metadata as Record<string, unknown>)}: {s.error}
                                </div>
                              ))}
                              {failedInPhase > 2 && (
                                <div className="text-[11px] text-zinc-600">
                                  +{failedInPhase - 2} more errors
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <span className={`text-xs font-medium ${sc.color}`}>
                          {sc.label}
                        </span>
                      </div>
                      {steps.length > 0 && (
                        <PhaseSteps steps={steps} onRetry={handleRetryStep} />
                      )}
                    </motion.div>
                  );
                })}
              </motion.div>
            </Card>
          </motion.div>
        )}

        {/* TAB: Active Migration - No Job */}
        {activeTab === 'progress' && !activeJob && (
          <motion.div
            key="progress-empty"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="p-8 bg-card border border-border text-center">
              <ArrowRightLeft className="h-8 w-8 text-zinc-600 mx-auto mb-3" />
              <h3 className="text-sm font-medium text-zinc-300">No active migration</h3>
              <p className="text-xs text-zinc-500 mt-1">Start a new migration to see progress here.</p>
            </Card>
          </motion.div>
        )}

        {/* TAB: History */}
        {activeTab === 'history' && (
          <motion.div
            key="history"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <Card className="bg-card border border-border overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-200">Migration History</h3>
                <button
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['migration-jobs'] })}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              {loadingJobs ? (
                <div className="p-8 text-center text-zinc-500">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
                  Loading...
                </div>
              ) : safeJobs.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">
                  No migration jobs yet
                </div>
              ) : (
                <div className="divide-y divide-zinc-800/50">
                  {safeJobs.map(job => (
                    <button
                      key={job.id}
                      onClick={() => {
                        setActiveJobId(job.id);
                        setActiveTab('progress');
                      }}
                      className="w-full flex items-center gap-4 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left"
                    >
                      <StatusBadge status={job.status} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-zinc-200 truncate">{job.sourceUrl}</div>
                        <div className="text-xs text-zinc-500">
                          {job.progress?.completed || 0}/{job.progress?.total || 0} steps
                          {' · '}
                          {new Date(job.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      {job.error && (
                        <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />
                      )}
                      <ChevronRight className="h-4 w-4 text-zinc-600 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
