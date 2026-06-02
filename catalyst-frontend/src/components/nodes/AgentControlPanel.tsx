import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '../../lib/queryKeys';
import { agentApi } from '../../services/api/agent';
import type {
  AgentLogEntry,
} from '../../types/agent';
import { notifyError, notifySuccess } from '../../utils/notify';
import ServerTabCard from '../servers/tabs/ServerTabCard';
import SectionHeader from '../servers/tabs/SectionHeader';
import StatGrid from '../servers/tabs/StatGrid';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ModalPortal } from '../ui/modal-portal';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  HardDrive,
  Loader2,
  MonitorDot,
  Power,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Terminal,
  Upload,
  Wifi,
  WifiOff,
  Zap,
  ChevronDown,
  Copy,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import type { NodeInfo, NodeStats } from '../../types/node';

// ── Tab IDs ──
type AgentTab = 'status' | 'logs' | 'update' | 'config' | 'actions';

const TABS: { id: AgentTab; label: string; icon: typeof Activity }[] = [
  { id: 'status', label: 'Status', icon: Activity },
  { id: 'logs', label: 'Logs', icon: Terminal },
  { id: 'update', label: 'Update', icon: Upload },
  { id: 'config', label: 'Config', icon: Settings },
  { id: 'actions', label: 'Actions', icon: Zap },
];

// ── Utility ──
function formatUptime(seconds: number | null): string {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(seconds % 60)}s`;
}

function formatTimestamp(ts: string): string {
  try {
    // Handle epoch-seconds (e.g. "1718400000") — multiply by 1000 for JS Date
    const numeric = Number(ts);
    if (!isNaN(numeric) && numeric > 1_000_000_000 && numeric < 10_000_000_000) {
      return new Date(numeric * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    // Handle ISO strings and other parseable formats
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  error: 'text-red-400 bg-red-400/10 border-red-400/20',
  warn: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  info: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
  debug: 'text-slate-400 bg-slate-400/10 border-slate-400/20',
  trace: 'text-slate-500 bg-slate-500/10 border-slate-500/20',
};

// ── Main Component ──
interface AgentControlPanelProps {
  node: NodeInfo;
  stats: NodeStats | null | undefined;
}

export default function AgentControlPanel({ node, stats }: AgentControlPanelProps) {
  const [activeTab, setActiveTab] = useState<AgentTab>('status');

  const isOnline = node.isOnline;
  const agentVersion = node.agentVersion;
  const updateAvailable = stats?.agentUpdateAvailable ?? false;
  const latestVersion = stats?.latestAgentVersion ?? null;

  return (
    <ServerTabCard className="overflow-hidden">
      {/* ── Tab Strip ── */}
      <div className="-mx-5 -mt-4 mb-0 border-b border-border/30 bg-surface-2/40">
        <div className="flex items-center gap-0 overflow-x-auto px-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            const showDot =
              (tab.id === 'update' && updateAvailable) ||
              (tab.id === 'status' && !isOnline);

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] transition-colors ${
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground/50 hover:text-muted-foreground'
                }`}
              >
                <Icon className="h-3 w-3" />
                {tab.label}
                {showDot && (
                  <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
                )}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="pt-4">
        {!isOnline && activeTab !== 'actions' ? (
          <AgentOfflineState />
        ) : (
          <>
            {activeTab === 'status' && (
              <AgentStatusTab node={node} stats={stats} />
            )}
            {activeTab === 'logs' && <AgentLogsTab nodeId={node.id} />}
            {activeTab === 'update' && (
              <AgentUpdateTab
                nodeId={node.id}
                agentVersion={agentVersion ?? null}
                updateAvailable={updateAvailable}
                latestVersion={latestVersion}
              />
            )}
            {activeTab === 'config' && <AgentConfigTab nodeId={node.id} />}
            {activeTab === 'actions' && (
              <AgentActionsTab
                nodeId={node.id}
                isOnline={isOnline}
                node={node}
              />
            )}
          </>
        )}
      </div>
    </ServerTabCard>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// OFFLINE STATE
// ══════════════════════════════════════════════════════════════════════════
function AgentOfflineState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/30 bg-surface-2">
        <WifiOff className="h-6 w-6 text-muted-foreground/40" />
      </div>
      <p className="mt-3 text-sm font-medium text-muted-foreground">
        Agent is offline
      </p>
      <p className="mt-1 text-xs text-muted-foreground/50">
        Connect the agent to view this information
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// STATUS TAB
// ══════════════════════════════════════════════════════════════════════════
function AgentStatusTab({ node, stats }: { node: NodeInfo; stats: NodeStats | null | undefined }) {
  const { data: agentStatus } = useQuery({
    queryKey: qk.agentStatus(node.id),
    queryFn: () => agentApi.getStatus(node.id),
    enabled: node.isOnline,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const { data: _, mutate: ping, isPending: isPinging } = useMutation({
    mutationFn: () => agentApi.ping(node.id),
    onSuccess: (result) => {
      if (result) notifySuccess(`Ping: ${result.latencyMs}ms`);
      else notifyError('Ping failed \u2014 no response');
    },
    onError: () => notifyError('Ping failed'),
  });

  const res = stats?.resources;

  return (
    <div className="space-y-4">
      {/* Connection badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`flex h-7 w-7 items-center justify-center rounded-lg border ${
            node.isOnline
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-border/30 bg-surface-2 text-muted-foreground'
          }`}>
            {node.isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
          </div>
          <div>
            <span className="text-xs font-semibold text-foreground">Connection</span>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {node.isOnline ? (
                <>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success/50" />
                  </span>
                  Connected
                </>
              ) : (
                'Disconnected'
              )}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => ping()}
          disabled={!node.isOnline || isPinging}
          className="gap-1.5 text-xs"
        >
          {isPinging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          Ping
        </Button>
      </div>

      {/* Agent Info Grid */}
      <StatGrid
        columns={3}
        items={[
          { label: 'Agent version', value: node.agentVersion ?? '—' },
          { label: 'Uptime', value: formatUptime(agentStatus?.uptime ?? null) },
          { label: 'OS', value: agentStatus?.osInfo ?? '—' },
          { label: 'Kernel', value: agentStatus?.kernelVersion ?? '—' },
          { label: 'Container runtime', value: agentStatus?.containerRuntime ?? '—' },
          { label: 'Containers', value: `${agentStatus?.runningContainers ?? stats?.servers.running ?? 0} / ${agentStatus?.totalContainers ?? stats?.servers.total ?? 0}` },
          { label: 'SFTP', value: node.sftpEnabled ? `Enabled :${node.sftpPort ?? '—'}` : 'Disabled' },
          { label: 'Config path', value: agentStatus?.configPath ?? node.agentConfigPath ?? '—' },
          { label: 'Last seen', value: node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : '—' },
        ]}
      />

      {/* ── Capacity ── */}
      <SectionHeader icon={HardDrive} title="Capacity" />
      <StatGrid
        columns={3}
        items={[
          {
            label: 'CPU cores',
            value: node.cpuOverallocatePercent && node.cpuOverallocatePercent !== 0
              ? node.cpuOverallocatePercent === -1
                ? `${node.maxCpuCores ?? 0} (eff: ∞)`
                : `${node.maxCpuCores ?? 0} (eff: ${res?.effectiveMaxCpuCores ?? ((node.maxCpuCores ?? 0) * (1 + node.cpuOverallocatePercent / 100)).toFixed(1)})`
              : String(node.maxCpuCores ?? 0),
          },
          {
            label: 'Memory',
            value: node.memoryOverallocatePercent && node.memoryOverallocatePercent !== 0
              ? node.memoryOverallocatePercent === -1
                ? `${node.maxMemoryMb ?? 0} MB (eff: ∞)`
                : `${node.maxMemoryMb ?? 0} MB (eff: ${res?.effectiveMaxMemoryMb ?? ((node.maxMemoryMb ?? 0) * (1 + node.memoryOverallocatePercent / 100)).toFixed(0)} MB)`
              : `${node.maxMemoryMb ?? 0} MB`,
          },
          {
            label: 'Disk',
            value: res
              ? `${res.actualDiskUsageMb} / ${res.actualDiskTotalMb} MB`
              : 'n/a',
          },
        ]}
      />

      {/* Live Resource Bars */}
      {res && (
        <div className="space-y-3">
          <SectionHeader icon={MonitorDot} title="Live Resources" />
          {[
            { label: 'CPU', pct: res.cpuUsagePercent, color: 'bg-primary' },
            { label: 'Memory', pct: res.memoryUsagePercent, color: 'bg-success' },
            { label: 'Disk', pct: res.actualDiskTotalMb ? (res.actualDiskUsageMb / res.actualDiskTotalMb) * 100 : 0, color: 'bg-warning' },
          ].map((m) => (
            <div key={m.label} className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="font-semibold uppercase tracking-wider text-muted-foreground/50">{m.label}</span>
                <span className="font-mono tabular-nums text-foreground">{m.pct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full rounded-full ${m.color} transition-all duration-700`}
                  style={{ width: `${Math.min(100, Math.max(0, m.pct))}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// LOGS TAB — Uses polling instead of SSE (no SSE endpoint exists)
// ══════════════════════════════════════════════════════════════════════════
function AgentLogsTab({ nodeId }: { nodeId: string }) {
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch initial logs
  const { data: initialLogs, isLoading } = useQuery({
    queryKey: qk.agentLogs(nodeId, { lines: 200 }),
    queryFn: () => agentApi.getLogs(nodeId, { lines: 200 }),
    enabled: true,
    staleTime: 0,
  });

  // Load initial logs once
  const [prevInitialLogs, setPrevInitialLogs] = useState(initialLogs);
  if (initialLogs && initialLogs.length > 0 && logs.length === 0 && initialLogs !== prevInitialLogs) {
    setPrevInitialLogs(initialLogs);
    setLogs(initialLogs.map((l) => ({
      timestamp: l.timestamp,
      level: l.level,
      target: l.target,
      message: l.message,
    })));
  }

  // Polling for streaming mode — merge new entries instead of replacing to avoid
  // losing entries between polls and preserve scroll position.
  useEffect(() => {
    if (!isStreaming) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      return;
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const fresh = await agentApi.getLogs(nodeId, { lines: 300 });
        if (fresh && fresh.length > 0) {
          setLogs((prev) => {
            // Build a set of existing keys to avoid duplicates
            const existing = new Set(prev.map((l) => `${l.timestamp}|${l.target}|${l.message}`));
            const newEntries = fresh
              .filter((l) => !existing.has(`${l.timestamp}|${l.target}|${l.message}`))
              .map((l) => ({ timestamp: l.timestamp, level: l.level, target: l.target, message: l.message }));
            if (newEntries.length === 0) return prev;
            return [...prev, ...newEntries];
          });
        }
      } catch {
        // Silently ignore poll failures
      }
    }, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [nodeId, isStreaming]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const toggleStream = useCallback(() => {
    setIsStreaming((prev) => !prev);
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const handleRefresh = useCallback(async () => {
    try {
      const fresh = await agentApi.getLogs(nodeId, { lines: 300 });
      if (fresh) {
        setLogs(fresh.map((l) => ({
          timestamp: l.timestamp,
          level: l.level,
          target: l.target,
          message: l.message,
        })));
      }
    } catch {
      // ignore
    }
  }, [nodeId]);

  const filteredLogs = useMemo(() => {
    let result = logs;
    if (levelFilter !== 'all') {
      result = result.filter((l) => l.level === levelFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (l) => l.message.toLowerCase().includes(q) || l.target.toLowerCase().includes(q),
      );
    }
    return result;
  }, [logs, levelFilter, searchQuery]);

  const LEVEL_OPTIONS = ['all', 'error', 'warn', 'info', 'debug', 'trace'];

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={isStreaming ? 'outline' : 'default'}
          size="sm"
          onClick={toggleStream}
          className="gap-1.5 text-xs"
        >
          {isStreaming ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {isStreaming ? 'Pause' : 'Live'}
        </Button>

        {isStreaming && (
          <Badge variant="outline" className="gap-1 text-[10px] text-success">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success/50" />
            </span>
            Polling
          </Badge>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="gap-1.5 text-xs"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>

        {/* Level filter */}
        <div className="flex items-center rounded-md border border-border/30 bg-surface-2/40">
          {LEVEL_OPTIONS.map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                levelFilter === level
                  ? 'text-primary'
                  : 'text-muted-foreground/40 hover:text-muted-foreground'
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/40" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter logs…"
            className="w-full rounded-md border border-border/30 bg-surface-2/40 py-1 pl-7 pr-2 text-xs text-foreground placeholder:text-muted-foreground/30 focus:border-primary/30 focus:outline-none"
          />
        </div>

        <Button variant="ghost" size="sm" onClick={clearLogs} className="gap-1 text-xs text-muted-foreground">
          <Trash2 className="h-3 w-3" />
          Clear
        </Button>
      </div>

      {/* Log count */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground/40">
        <span>{filteredLogs.length} entries{levelFilter !== 'all' ? ` (${levelFilter})` : ''}</span>
        <label className="flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3 w-3 rounded border-border/40"
          />
          Auto-scroll
        </label>
      </div>

      {/* Log viewer */}
      <div
        ref={logContainerRef}
        className="max-h-[400px] overflow-y-auto rounded-lg border border-border/30 bg-[#0d1117] p-3 font-mono text-[11px] leading-relaxed"
      >
        {isLoading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground/40">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading logs…
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground/30">
            No log entries{levelFilter !== 'all' ? ` at ${levelFilter} level` : ''}
          </div>
        ) : (
          filteredLogs.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${entry.target}-${i}`}
              className="flex gap-2 border-b border-white/[0.03] py-0.5 hover:bg-white/[0.02]"
            >
              <span className="shrink-0 text-muted-foreground/30 tabular-nums w-[70px]">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span
                className={`shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase border ${LOG_LEVEL_COLORS[entry.level] || LOG_LEVEL_COLORS.trace}`}
              >
                {entry.level.padEnd(5)}
              </span>
              <span className="shrink-0 text-cyan-400/50 max-w-[180px] truncate" title={entry.target}>
                {entry.target.split('::').slice(-2).join('::')}
              </span>
              <span className="text-gray-300 break-all">{entry.message}</span>
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// UPDATE TAB
// ══════════════════════════════════════════════════════════════════════════
function AgentUpdateTab({
  nodeId,
  agentVersion,
  updateAvailable,
  latestVersion,
}: {
  nodeId: string;
  agentVersion: string | null;
  updateAvailable: boolean;
  latestVersion: string | null;
}) {
  const queryClient = useQueryClient();

  const { data: updateStatus } = useQuery({
    queryKey: qk.agentUpdateStatus(nodeId),
    queryFn: () => agentApi.getUpdateStatus(nodeId),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });

  const updateMutation = useMutation({
    mutationFn: () => agentApi.triggerUpdate(nodeId, latestVersion ?? undefined),
    onSuccess: (sent) => {
      if (sent) {
        notifySuccess('Update command sent to agent');
        queryClient.invalidateQueries({ queryKey: qk.agentUpdateStatus(nodeId) });
      } else {
        notifyError('Agent did not receive update command');
      }
    },
    onError: (err: any) => {
      notifyError(err?.response?.data?.error || 'Failed to trigger update');
    },
  });

  const isUpdating = updateStatus?.status && updateStatus.status !== 'idle' && updateStatus.status !== 'failed';

  return (
    <div className="space-y-4">
      {/* Version comparison */}
      <div className="flex items-center gap-4">
        <div className="flex-1 rounded-lg border border-border/30 bg-surface-2/30 px-4 py-3">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40">Current</div>
          <div className="mt-1 font-mono text-lg font-bold text-foreground">
            v{agentVersion ?? '?'}
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="h-px w-6 bg-border/30" />
          <ChevronDown className="h-4 w-4 text-muted-foreground/30 -rotate-90" />
          <div className="h-px w-6 bg-border/30" />
        </div>
        <div className={`flex-1 rounded-lg border px-4 py-3 ${
          updateAvailable
            ? 'border-warning/30 bg-warning/5'
            : 'border-success/20 bg-success/5'
        }`}>
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/40">Latest</div>
          <div className="mt-1 font-mono text-lg font-bold text-foreground">
            v{latestVersion ?? '?'}
          </div>
        </div>
      </div>

      {/* Update status */}
      {updateStatus && updateStatus.status !== 'idle' && (
        <div className={`rounded-lg border px-4 py-3 ${
          updateStatus.status === 'failed'
            ? 'border-danger/30 bg-danger/5'
            : updateStatus.status === 'restarting'
            ? 'border-success/30 bg-success/5'
            : 'border-primary/20 bg-primary/5'
        }`}>
          <div className="flex items-center gap-2 text-sm font-medium">
            {isUpdating && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
            {updateStatus.status === 'failed' && <AlertTriangle className="h-4 w-4 text-danger" />}
            {updateStatus.status === 'restarting' && <CheckCircle className="h-4 w-4 text-success" />}
            <span className="capitalize">{updateStatus.status}</span>
          </div>
          {updateStatus.status === 'downloading' && (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${updateStatus.progress}%` }}
              />
            </div>
          )}
          {updateStatus.error && (
            <p className="mt-2 text-xs text-danger/80">{updateStatus.error}</p>
          )}
        </div>
      )}

      {/* Action */}
      <div className="flex items-center justify-between rounded-lg border border-border/30 bg-surface-2/20 px-4 py-3">
        <div className="flex items-center gap-2">
          {updateAvailable ? (
            <>
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-sm text-foreground">Update available</span>
            </>
          ) : (
            <>
              <CheckCircle className="h-4 w-4 text-success" />
              <span className="text-sm text-muted-foreground">Agent is up to date</span>
            </>
          )}
        </div>
        <Button
          variant={updateAvailable ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateMutation.mutate()}
          disabled={!updateAvailable || updateMutation.isPending || isUpdating}
          className="gap-1.5 text-xs"
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          {updateAvailable ? 'Update Agent' : 'No Update'}
        </Button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIG TAB
// ══════════════════════════════════════════════════════════════════════════
function AgentConfigTab({ nodeId }: { nodeId: string }) {
  const queryClient = useQueryClient();
  const [editContent, setEditContent] = useState<string | null>(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);

  const { data: config, isLoading } = useQuery({
    queryKey: qk.agentConfig(nodeId),
    queryFn: () => agentApi.getConfig(nodeId),
    staleTime: 30_000,
  });

  const [prevConfig, setPrevConfig] = useState(config);
  if (config !== prevConfig) {
    setPrevConfig(config);
    if (config && editContent === null) {
      setEditContent(config.content);
    }
  }

  const saveMutation = useMutation({
    mutationFn: () => agentApi.updateConfig(nodeId, editContent!),
    onSuccess: (saved) => {
      if (saved) {
        notifySuccess('Agent config saved. Restart the agent to apply changes.');
        queryClient.invalidateQueries({ queryKey: qk.agentConfig(nodeId) });
      } else {
        notifyError('Failed to save agent config');
      }
    },
    onError: (err: any) => {
      notifyError(err?.response?.data?.error || 'Failed to save config');
    },
  });

  const hasChanges = editContent !== config?.content;

  return (
    <div className="space-y-3">
      {/* Config meta */}
      {config && (
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/40">
          <span className="font-mono">{config.path}</span>
          {config.lastModified && (
            <span>Modified: {new Date(config.lastModified).toLocaleString()}</span>
          )}
        </div>
      )}

      {/* Editor */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin mr-2 text-muted-foreground/40" />
          <span className="text-xs text-muted-foreground/40">Loading config…</span>
        </div>
      ) : (
        <textarea
          value={editContent ?? ''}
          onChange={(e) => setEditContent(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[320px] rounded-lg border border-border/30 bg-[#0d1117] p-3 font-mono text-[11px] leading-relaxed text-gray-300 focus:border-primary/30 focus:outline-none resize-y"
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Badge variant="outline" className="gap-1 text-[10px] border-warning/30 text-warning">
              <Clock className="h-2.5 w-2.5" />
              Unsaved changes
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditContent(config?.content ?? '')}
            disabled={!hasChanges}
            className="gap-1.5 text-xs"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowSaveConfirm(true)}
            disabled={!hasChanges || saveMutation.isPending}
            className="gap-1.5 text-xs"
          >
            {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            Save
          </Button>
        </div>
      </div>

      {/* Save confirm modal */}
      {showSaveConfirm && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl border border-warning/40 bg-card shadow-xl">
              <div className="border-b border-warning/20 bg-warning/5 px-6 py-4">
                <h2 className="text-lg font-semibold text-foreground">Apply Config Changes?</h2>
              </div>
              <div className="space-y-3 px-6 py-4 text-sm text-muted-foreground">
                <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Saving the config file will overwrite the agent's <code className="rounded bg-warning/10 px-1">config.toml</code>.
                    The agent must be restarted for changes to take effect.
                  </span>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-border/30 px-6 py-4 text-xs">
                <Button variant="outline" size="sm" onClick={() => setShowSaveConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    saveMutation.mutate();
                    setShowSaveConfirm(false);
                  }}
                  disabled={saveMutation.isPending}
                  className="gap-1.5"
                >
                  {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                  Save Config
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ACTIONS TAB
// ══════════════════════════════════════════════════════════════════════════
function AgentActionsTab({ nodeId, isOnline, node }: { nodeId: string; isOnline: boolean; node: NodeInfo }) {
  const queryClient = useQueryClient();
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [pingResult, setPingResult] = useState<number | null>(null);

  const restartMutation = useMutation({
    mutationFn: () => agentApi.restart(nodeId),
    onSuccess: (sent) => {
      if (sent) {
        notifySuccess('Restart command sent. Agent will reconnect shortly.');
        queryClient.invalidateQueries({ queryKey: qk.node(nodeId) });
        queryClient.invalidateQueries({ queryKey: qk.nodeStats(nodeId) });
      } else {
        notifyError('Agent did not receive restart command');
      }
    },
    onError: (err: any) => {
      notifyError(err?.response?.data?.error || 'Failed to restart agent');
    },
  });

  const pingMutation = useMutation({
    mutationFn: () => agentApi.ping(nodeId),
    onSuccess: (result) => {
      if (result) {
        setPingResult(result.latencyMs);
        notifySuccess(`Agent responded in ${result.latencyMs}ms`);
      } else {
        setPingResult(null);
        notifyError('Agent did not respond to ping');
      }
    },
    onError: () => {
      setPingResult(null);
      notifyError('Ping failed — agent may be unreachable');
    },
  });

  const actions = [
    {
      id: 'restart',
      icon: Power,
      label: 'Restart Agent',
      description: 'Gracefully shut down and restart the agent process. Running servers will not be affected.',
      variant: 'outline' as const,
      danger: true,
      disabled: !isOnline,
      onClick: () => setRestartConfirm(true),
    },
    {
      id: 'ping',
      icon: Zap,
      label: 'Ping Agent',
      description: 'Send a health-check request and measure round-trip latency.',
      variant: 'outline' as const,
      danger: false,
      disabled: !isOnline || pingMutation.isPending,
      onClick: () => pingMutation.mutate(),
    },
    {
      id: 'refresh-stats',
      icon: RefreshCw,
      label: 'Refresh Stats',
      description: 'Force the agent to send fresh resource metrics immediately.',
      variant: 'outline' as const,
      danger: false,
      disabled: !isOnline,
      onClick: () => {
        queryClient.invalidateQueries({ queryKey: qk.nodeStats(nodeId) });
        queryClient.invalidateQueries({ queryKey: qk.nodeMetrics(nodeId) });
        notifySuccess('Stats refreshed');
      },
    },
    {
      id: 'copy-id',
      icon: Copy,
      label: 'Copy Node ID',
      description: `Copy this node's ID (${nodeId.slice(0, 8)}…) to clipboard.`,
      variant: 'outline' as const,
      danger: false,
      disabled: false,
      onClick: () => {
        navigator.clipboard.writeText(nodeId);
        notifySuccess('Node ID copied');
      },
    },
  ];

  return (
    <div className="space-y-2">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <div
            key={action.id}
            className="group flex items-center justify-between rounded-lg border border-border/30 bg-surface-2/20 px-4 py-3 transition-all hover:border-border/50"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                action.danger
                  ? 'border-danger/20 bg-danger/5 text-danger'
                  : 'border-border/30 bg-surface-2 text-muted-foreground'
              }`}>
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{action.label}</div>
                <div className="text-[11px] text-muted-foreground/60 truncate">{action.description}</div>
              </div>
            </div>
            <Button
              variant={action.variant}
              size="sm"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`gap-1.5 text-xs shrink-0 ${
                action.danger
                  ? 'text-danger hover:bg-danger/5 hover:text-danger hover:border-danger/30'
                  : ''
              }`}
            >
              {action.id === 'ping' && pingMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : action.id === 'restart' && restartMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {action.id === 'ping' && pingResult !== null ? `${pingResult}ms` : 'Run'}
            </Button>
          </div>
        );
      })}

      {/* Restart confirmation modal */}
      {restartConfirm && (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-xl border border-danger/40 bg-card shadow-xl">
              <div className="border-b border-danger/20 bg-danger/5 px-6 py-4">
                <h2 className="text-lg font-semibold text-foreground">Restart Agent?</h2>
              </div>
              <div className="space-y-3 px-6 py-4 text-sm text-muted-foreground">
                <p>
                  This will send a restart command to the agent on <strong className="text-foreground">{node.name}</strong>.
                </p>
                <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    The agent will temporarily disconnect. Running game servers will continue operating.
                    The agent should reconnect within 10-30 seconds.
                  </span>
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-border/30 px-6 py-4 text-xs">
                <Button variant="outline" size="sm" onClick={() => setRestartConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    restartMutation.mutate();
                    setRestartConfirm(false);
                  }}
                  disabled={restartMutation.isPending}
                  className="gap-1.5 bg-danger hover:bg-danger/90"
                >
                  {restartMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                  Restart Agent
                </Button>
              </div>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}
