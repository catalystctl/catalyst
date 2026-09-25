import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatTime } from '@/i18n/format';
import { subscribeSharedEventSource } from '../../services/api/sse-hub';
import { useQuery, useMutation, useQueryClient } from '@/csync';
import { qk } from '../../lib/queryKeys';
import { agentApi } from '../../services/api/agent';
import type {
  AgentLogEntry,
} from '../../types/agent';
import { notifyError, notifySuccess } from '../../utils/notify';
import ServerTabCard from '../servers/tabs/ServerTabCard';
import SectionHeader from '../servers/tabs/SectionHeader';
import StatGrid from '../servers/tabs/StatGrid';
import { Button } from '../ui/button';
import { Meter, StatusLed } from '../deck/primitives';
import ConfirmDialog from '../shared/ConfirmDialog';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
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

const TABS: { id: AgentTab; icon: typeof Activity }[] = [
  { id: 'status', icon: Activity },
  { id: 'logs', icon: Terminal },
  { id: 'update', icon: Upload },
  { id: 'config', icon: Settings },
  { id: 'actions', icon: Zap },
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
      return formatTime(numeric * 1000, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    // Handle ISO strings and other parseable formats
    return formatTime(ts, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

const LOG_LEVEL_COLORS: Record<string, string> = {
  error: 'text-danger bg-danger/10 border-danger/20',
  warn: 'text-warning bg-warning/10 border-warning/20',
  info: 'text-info bg-info/10 border-info/20',
  debug: 'text-muted-foreground bg-surface-2 border-border/20',
  trace: 'text-muted-foreground bg-surface-2 border-border/20',
};

// ── Main Component ──
interface AgentControlPanelProps {
  node: NodeInfo;
  stats: NodeStats | null | undefined;
}

export default function AgentControlPanel({ node, stats }: AgentControlPanelProps) {
  const { t } = useTranslation('nodes');
  const [activeTab, setActiveTab] = useState<AgentTab>('status');
  const tabLabels: Record<AgentTab, string> = {
    status: t('agent.tabs.status'),
    logs: t('agent.tabs.logs'),
    update: t('agent.tabs.update'),
    config: t('agent.tabs.config'),
    actions: t('agent.tabs.actions'),
  };

  const isOnline = node.isOnline;
  const agentVersion = node.agentVersion;
  const updateAvailable = stats?.agentUpdateAvailable ?? false;
  const latestVersion = stats?.latestAgentVersion ?? null;

  return (
    <ServerTabCard className="overflow-hidden">
      {/* ── Tab Strip ── */}
      <div className="-mx-3 -mt-2.5 mb-0 border-b border-border/50 bg-surface-1/40">
        <div className="flex items-center gap-0.5 overflow-x-auto px-1">
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
                className={`relative flex h-7 shrink-0 items-center gap-1.5 px-2.5 type-overline transition-colors ${
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3 w-3" />
                {tabLabels[tab.id]}
                {showDot && (
                  <StatusLed tone="hazard" className="absolute right-0.5 top-1 h-1.5 w-1.5" />
                )}
                {isActive && (
                  <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div className="pt-3">
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
  const { t } = useTranslation('nodes');
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <WifiOff className="h-4 w-4 text-muted-foreground/50" />
      <p className="mt-3 text-sm font-medium text-muted-foreground">
        {t('agent.offlineTitle')}
      </p>
      <p className="type-meta mt-1 opacity-70">
        {t('agent.offlineHint')}
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// STATUS TAB
// ══════════════════════════════════════════════════════════════════════════
function AgentStatusTab({ node, stats }: { node: NodeInfo; stats: NodeStats | null | undefined }) {
  const { t } = useTranslation('nodes');
  const { data: agentStatus } = useQuery({
    queryKey: qk.agentStatus(node.id),
    queryFn: () => agentApi.getStatus(node.id),
    enabled: node.isOnline,
    staleTime: 15_000,
    // Online/offline + version refresh via node_updated / agent_update_* admin SSE.
    // Light safety poll while online for uptime/runtime fields that are not evented.
    refetchInterval: node.isOnline ? 60_000 : false,
  });

  const { data: _, mutate: ping, isPending: isPinging } = useMutation({
    mutationFn: () => agentApi.ping(node.id),
    onSuccess: (result) => {
      if (result) notifySuccess(t('agent.pingResult', { ms: result.latencyMs }));
      else notifyError(t('agent.pingFailedNoResponse'));
    },
    onError: () => notifyError(t('agent.pingFailed')),
  });

  const res = stats?.resources;

  return (
    <div className="space-y-3">
      {/* Connection badge */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusLed tone={node.isOnline ? 'go' : 'idle'} pulse={node.isOnline} />
          <div>
            <span className="text-mini font-semibold text-foreground">{t('agent.connection')}</span>
            <div className="type-overline">
              {node.isOnline ? t('agent.connected') : t('agent.disconnected')}
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => ping()}
          disabled={!node.isOnline || isPinging}
          className="h-8 gap-1.5 px-3 text-mini"
        >
          {isPinging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          {t('agent.ping')}
        </Button>
      </div>

      {/* Agent Info Grid */}
      <StatGrid
        columns={3}
        items={[
          { label: t('agent.info.agentVersion'), value: node.agentVersion ?? '—' },
          { label: t('agent.info.uptime'), value: formatUptime(agentStatus?.uptime ?? null) },
          { label: t('agent.info.os'), value: agentStatus?.osInfo ?? '—' },
          { label: t('agent.info.kernel'), value: agentStatus?.kernelVersion ?? '—' },
          { label: t('agent.info.containerRuntime'), value: agentStatus?.containerRuntime ?? '—' },
          { label: t('agent.info.containers'), value: `${agentStatus?.runningContainers ?? stats?.servers.running ?? 0} / ${agentStatus?.totalContainers ?? stats?.servers.total ?? 0}` },
          { label: t('agent.info.sftp'), value: node.sftpEnabled ? t('agent.sftpEnabledPort', { port: node.sftpPort ?? '—' }) : t('common:actions.disabled') },
          { label: t('agent.info.configPath'), value: agentStatus?.configPath ?? node.agentConfigPath ?? '—' },
          { label: t('agent.info.lastSeen'), value: node.lastSeenAt ? formatDateTime(node.lastSeenAt) : '—' },
        ]}
      />

      {/* ── Capacity ── */}
      <SectionHeader icon={HardDrive} title={t('agent.capacity')} />
      <StatGrid
        columns={3}
        items={[
          {
            label: t('form.cpuCores'),
            value: node.cpuOverallocatePercent && node.cpuOverallocatePercent !== 0
              ? node.cpuOverallocatePercent === -1
                ? t('agent.effectiveUnlimited', { value: node.maxCpuCores ?? 0 })
                : t('agent.effectiveValue', {
                    value: node.maxCpuCores ?? 0,
                    effective: res?.effectiveMaxCpuCores ?? ((node.maxCpuCores ?? 0) * (1 + node.cpuOverallocatePercent / 100)).toFixed(1),
                  })
              : String(node.maxCpuCores ?? 0),
          },
          {
            label: t('card.memory'),
            value: node.memoryOverallocatePercent && node.memoryOverallocatePercent !== 0
              ? node.memoryOverallocatePercent === -1
                ? t('agent.effectiveUnlimited', { value: `${node.maxMemoryMb ?? 0} MB` })
                : t('agent.effectiveValue', {
                    value: `${node.maxMemoryMb ?? 0} MB`,
                    effective: `${res?.effectiveMaxMemoryMb ?? ((node.maxMemoryMb ?? 0) * (1 + node.memoryOverallocatePercent / 100)).toFixed(0)} MB`,
                  })
              : `${node.maxMemoryMb ?? 0} MB`,
          },
          {
            label: t('agent.disk'),
            value: res
              ? `${res.actualDiskUsageMb} / ${res.actualDiskTotalMb} MB`
              : t('state.notAvailable'),
          },
        ]}
      />

      {/* Live Resource Bars — measured host usage from the agent, not allocations */}
      {res && (
        <div className="space-y-3">
          <SectionHeader icon={MonitorDot} title={t('agent.liveResources')} />
          {[
            { label: t('card.cpu'), pct: res.actualCpuPercent },
            {
              label: t('card.memory'),
              pct: res.actualMemoryTotalMb
                ? (res.actualMemoryUsageMb / res.actualMemoryTotalMb) * 100
                : 0,
            },
            { label: t('agent.disk'), pct: res.actualDiskTotalMb ? (res.actualDiskUsageMb / res.actualDiskTotalMb) * 100 : 0 },
          ].map((m) => (
            <div key={m.label} className="flex items-center gap-3">
              <span className="type-overline w-16 shrink-0">{m.label}</span>
              <Meter value={m.pct} width="w-full" />
              <span className="shrink-0 font-mono text-micro tabular-nums text-foreground">
                {m.pct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// LOGS TAB — Live tail via short poll while streaming (agent has no log SSE yet).
// node_updated / reconnect still refreshes via query invalidation on the initial batch.
// ══════════════════════════════════════════════════════════════════════════
function AgentLogsTab({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation('nodes');
  const [logs, setLogs] = useState<AgentLogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Fetch initial logs
  const { data: initialLogs, isLoading } = useQuery({
    queryKey: qk.agentLogs(nodeId, { lines: 200 }),
    queryFn: () => agentApi.getLogs(nodeId, { lines: 200 }),
    enabled: true,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
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

  // Live tail via shared SSE hub (/api/nodes/:id/agent/logs/stream).
  // Multi-tab leader election means only one tab pulls from the agent.
  useEffect(() => {
    if (!isStreaming) return;

    const url = `/api/nodes/${encodeURIComponent(nodeId)}/agent/logs/stream`;
    return subscribeSharedEventSource(
      url,
      ['agent_logs', 'agent_logs_error', 'connected'],
      (type, data) => {
        if (type !== 'agent_logs') return;
        const fresh = Array.isArray((data as any).logs) ? ((data as any).logs as AgentLogEntry[]) : [];
        if (fresh.length === 0) return;
        setLogs((prev) => {
          const existing = new Set(prev.map((l) => `${l.timestamp}|${l.target}|${l.message}`));
          const newEntries = fresh
            .filter((l) => !existing.has(`${l.timestamp}|${l.target}|${l.message}`))
            .map((l) => ({
              timestamp: l.timestamp,
              level: l.level,
              target: l.target,
              message: l.message,
            }));
          if (newEntries.length === 0) return prev;
          return [...prev, ...newEntries].slice(-2000);
        });
      },
    );
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
          className="h-8 gap-1.5 px-3 text-mini"
        >
          {isStreaming ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {isStreaming ? t('agent.pause') : t('agent.live')}
        </Button>

        {isStreaming && (
          <span className="flex items-center gap-1.5 type-overline text-success">
            <StatusLed tone="go" pulse />
            {t('agent.polling')}
          </span>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          className="h-8 gap-1.5 px-3 text-mini"
        >
          <RefreshCw className="h-3 w-3" />
          {t('common:actions.refresh')}
        </Button>

        {/* Level filter */}
        <div className="flex items-center gap-0.5">
          {LEVEL_OPTIONS.map((level) => (
            <button
              key={level}
              onClick={() => setLevelFilter(level)}
              className={`relative h-7 px-2 type-overline transition-colors ${
                levelFilter === level
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {level}
              {levelFilter === level && (
                <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('agent.filterLogs')}
            className="h-7 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
          />
        </div>

        <Button variant="ghost" size="sm" onClick={clearLogs} className="h-8 gap-1 px-3 text-mini text-muted-foreground">
          <Trash2 className="h-3 w-3" />
          {t('agent.clear')}
        </Button>
      </div>

      {/* Log count */}
      <div className="flex items-center justify-between text-micro text-muted-foreground/70">
        <span>{t('agent.entries', { count: filteredLogs.length })}{levelFilter !== 'all' ? ` (${levelFilter})` : ''}</span>
        <label className="flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="h-3 w-3 rounded-sm border-border/40"
          />
          {t('agent.autoScroll')}
        </label>
      </div>

      {/* Log viewer */}
      <div
        ref={logContainerRef}
        className="max-h-[400px] overflow-y-auto rounded-sm border border-border/50 bg-surface-0 p-3 font-mono text-micro leading-relaxed text-foreground"
      >
        {isLoading && logs.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground/60">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> {t('agent.loadingLogs')}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground/60">
            {t('agent.noLogEntries')}{levelFilter !== 'all' ? t('agent.noLogEntriesLevel', { level: levelFilter }) : ''}
          </div>
        ) : (
          filteredLogs.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${entry.target}-${i}`}
              className="flex gap-2 border-b border-border/20 py-0.5 hover:bg-surface-1"
            >
              <span className="shrink-0 text-muted-foreground/60 tabular-nums w-[70px]">
                {formatTimestamp(entry.timestamp)}
              </span>
              <span
                className={`shrink-0 rounded-sm border px-1 py-px text-micro font-semibold uppercase ${LOG_LEVEL_COLORS[entry.level] || LOG_LEVEL_COLORS.trace}`}
              >
                {entry.level.padEnd(5)}
              </span>
              <span className="shrink-0 text-info/70 max-w-[180px] truncate" title={entry.target}>
                {entry.target.split('::').slice(-2).join('::')}
              </span>
              <span className="text-foreground break-all">{entry.message}</span>
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
  const { t } = useTranslation('nodes');
  const queryClient = useQueryClient();

  const { data: updateStatus } = useQuery({
    queryKey: qk.agentUpdateStatus(nodeId),
    queryFn: () => agentApi.getUpdateStatus(nodeId),
    staleTime: 2_000,
    // agent_update_* admin SSE is primary; poll only while an update is in flight.
    refetchInterval: (query) => {
      const s = query.state.data as { status?: string } | undefined;
      if (!s?.status || s.status === 'idle' || s.status === 'failed' || s.status === 'completed') {
        return false;
      }
      return 3_000;
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => agentApi.triggerUpdate(nodeId, latestVersion ?? undefined),
    onSuccess: (sent) => {
      if (sent) {
        notifySuccess(t('agent.updateSent'));
        queryClient.invalidateQueries({ queryKey: qk.agentUpdateStatus(nodeId) });
      } else {
        notifyError(t('agent.updateNotReceived'));
      }
    },
    onError: (err: unknown) => {
      notifyError(err, 'nodes:agent.updateError');
    },
  });

  const isUpdating = updateStatus?.status && updateStatus.status !== 'idle' && updateStatus.status !== 'failed';

  return (
    <div className="space-y-3">
      {/* Version comparison — one frame, hairline cells */}
      <div className="flex items-stretch overflow-hidden rounded-sm border border-border/50">
        <div className="min-w-0 flex-1 px-3 py-2">
          <div className="type-overline">{t('agent.current')}</div>
          <div className="mt-0.5 font-mono text-data tabular-nums text-foreground">
            v{String(agentVersion ?? '?').replace(/^v/i, '')}
          </div>
        </div>
        <div className="flex w-8 shrink-0 items-center justify-center border-x border-border/50 bg-surface-1/40">
          <ChevronDown className="h-3.5 w-3.5 -rotate-90 text-muted-foreground/60" />
        </div>
        <div className="min-w-0 flex-1 px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className="type-overline">{t('agent.latest')}</span>
            <StatusLed tone={updateAvailable ? 'hazard' : 'go'} />
          </div>
          <div className="mt-0.5 font-mono text-data tabular-nums text-foreground">
            v{String(latestVersion ?? '?').replace(/^v/i, '')}
          </div>
        </div>
      </div>

      {/* Update status */}
      {updateStatus && updateStatus.status !== 'idle' && (
        <div className={`rounded-sm border px-3 py-2 ${
          updateStatus.status === 'failed'
            ? 'border-danger/30 bg-danger/5'
            : updateStatus.status === 'restarting'
            ? 'border-success/30 bg-success/5'
            : 'border-border/50'
        }`}>
          <div className="flex items-center gap-2 text-mini font-medium">
            {isUpdating && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
            {updateStatus.status === 'failed' && <AlertTriangle className="h-3.5 w-3.5 text-danger" />}
            {updateStatus.status === 'restarting' && <CheckCircle className="h-3.5 w-3.5 text-success" />}
            <span className="font-mono uppercase">{updateStatus.status}</span>
          </div>
          {updateStatus.status === 'downloading' && (
            <Meter value={updateStatus.progress} width="w-full" className="mt-2" />
          )}
          {updateStatus.error && (
            <p className="mt-1.5 font-mono text-micro text-danger">{updateStatus.error}</p>
          )}
        </div>
      )}

      {/* Action */}
      <div className="flex items-center justify-between gap-3 rounded-sm border border-border/50 px-3 py-2">
        <div className="flex items-center gap-2 text-mini">
          {updateAvailable ? (
            <>
              <StatusLed tone="hazard" />
              <span className="text-foreground">{t('agent.updateAvailable')}</span>
            </>
          ) : (
            <>
              <StatusLed tone="go" />
              <span className="text-muted-foreground">{t('agent.upToDate')}</span>
            </>
          )}
        </div>
        <Button
          variant={updateAvailable ? 'default' : 'outline'}
          size="sm"
          onClick={() => updateMutation.mutate()}
          disabled={!updateAvailable || updateMutation.isPending || isUpdating}
          className="h-8 gap-1.5 px-3 text-mini"
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Upload className="h-3 w-3" />
          )}
          {updateAvailable ? t('agent.updateAgent') : t('agent.noUpdate')}
        </Button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// CONFIG TAB
// ══════════════════════════════════════════════════════════════════════════
function AgentConfigTab({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation('nodes');
  const queryClient = useQueryClient();
  const [editContent, setEditContent] = useState<string | null>(null);
  const [showSaveConfirm, setShowSaveConfirm] = useState(false);
  const [allowUnsafe, setAllowUnsafe] = useState(false);

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
    mutationFn: () => agentApi.updateConfig(nodeId, editContent!, allowUnsafe),
    onSuccess: (saved) => {
      if (saved) {
        notifySuccess(t('agent.configSaved'));
        queryClient.invalidateQueries({ queryKey: qk.agentConfig(nodeId) });
      } else {
        notifyError(t('agent.configSaveFailed'));
      }
    },
    onError: (err: unknown) => {
      notifyError(err, 'nodes:agent.configSaveError');
    },
  });

  const hasChanges = editContent !== config?.content;

  return (
    <div className="space-y-3">
      {/* Config meta */}
      {config && (
        <div className="type-meta flex items-center justify-between">
          <span className="font-mono tabular-nums">{config.path}</span>
          {config.lastModified && (
            <span className="font-mono tabular-nums">{t('agent.modified', { time: formatDateTime(config.lastModified) })}</span>
          )}
        </div>
      )}

      {/* Editor */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin mr-2 text-muted-foreground/60" />
          <span className="text-mini text-muted-foreground/60">{t('agent.loadingConfig')}</span>
        </div>
      ) : (
        <textarea
          value={editContent ?? ''}
          onChange={(e) => setEditContent(e.target.value)}
          spellCheck={false}
          className="w-full min-h-[320px] rounded-sm border border-border/50 bg-surface-0 p-3 font-mono text-micro leading-relaxed text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y"
        />
      )}

      {/* Actions */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span className="flex items-center gap-1.5 type-overline text-warning">
              <StatusLed tone="hazard" />
              {t('agent.unsavedChanges')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setEditContent(config?.content ?? '')}
            disabled={!hasChanges}
            className="h-8 gap-1.5 px-3 text-mini"
          >
            <RotateCcw className="h-3 w-3" />
            {t('common:actions.reset')}
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => setShowSaveConfirm(true)}
            disabled={!hasChanges || saveMutation.isPending}
            className="h-8 gap-1.5 px-3 text-mini"
          >
            {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            {t('common:actions.save')}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={showSaveConfirm}
        title={t('agent.applyTitle')}
        message={
          <div className="space-y-3">
            <p>{t('agent.applyMessage')}</p>
            <label className="flex items-start gap-2 text-left">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={allowUnsafe}
                onChange={(e) => setAllowUnsafe(e.target.checked)}
              />
              <span>{t('agent.applyAllowUnsafe')}</span>
            </label>
          </div>
        }
        confirmText={t('agent.saveConfig')}
        variant="warning"
        loading={saveMutation.isPending}
        onConfirm={() => {
          saveMutation.mutate();
          setShowSaveConfirm(false);
        }}
        onCancel={() => setShowSaveConfirm(false)}
      />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// ACTIONS TAB
// ══════════════════════════════════════════════════════════════════════════
function AgentActionsTab({ nodeId, isOnline, node }: { nodeId: string; isOnline: boolean; node: NodeInfo }) {
  const { t } = useTranslation('nodes');
  const queryClient = useQueryClient();
  const [restartConfirm, setRestartConfirm] = useState(false);
  const [pingResult, setPingResult] = useState<number | null>(null);

  const restartMutation = useMutation({
    mutationFn: () => agentApi.restart(nodeId),
    onSuccess: (sent) => {
      if (sent) {
        notifySuccess(t('agent.restartSent'));
        queryClient.invalidateQueries({ queryKey: qk.node(nodeId) });
        queryClient.invalidateQueries({ queryKey: qk.nodeStats(nodeId) });
      } else {
        notifyError(t('agent.restartNotReceived'));
      }
    },
    onError: (err: unknown) => {
      notifyError(err, 'nodes:agent.restartError');
    },
  });

  const pingMutation = useMutation({
    mutationFn: () => agentApi.ping(nodeId),
    onSuccess: (result) => {
      if (result) {
        setPingResult(result.latencyMs);
        notifySuccess(t('agent.respondedIn', { ms: result.latencyMs }));
      } else {
        setPingResult(null);
        notifyError(t('agent.pingNoResponse'));
      }
    },
    onError: () => {
      setPingResult(null);
      notifyError(t('agent.pingUnreachable'));
    },
  });

  const actions = [
    {
      id: 'restart',
      icon: Power,
      label: t('agent.action.restart'),
      description: t('agent.action.restartDescription'),
      variant: 'outline' as const,
      danger: true,
      disabled: !isOnline,
      onClick: () => setRestartConfirm(true),
    },
    {
      id: 'ping',
      icon: Zap,
      label: t('agent.action.ping'),
      description: t('agent.action.pingDescription'),
      variant: 'outline' as const,
      danger: false,
      disabled: !isOnline || pingMutation.isPending,
      onClick: () => pingMutation.mutate(),
    },
    {
      id: 'refresh-stats',
      icon: RefreshCw,
      label: t('agent.action.refreshStats'),
      description: t('agent.action.refreshStatsDescription'),
      variant: 'outline' as const,
      danger: false,
      disabled: !isOnline,
      onClick: () => {
        queryClient.invalidateQueries({ queryKey: qk.nodeStats(nodeId) });
        queryClient.invalidateQueries({ queryKey: qk.nodeMetrics(nodeId) });
        notifySuccess(t('agent.statsRefreshed'));
      },
    },
    {
      id: 'copy-id',
      icon: Copy,
      label: t('agent.action.copyId'),
      description: t('agent.action.copyIdDescription', { id: nodeId.slice(0, 8) }),
      variant: 'outline' as const,
      danger: false,
      disabled: false,
      onClick: () => {
        navigator.clipboard.writeText(nodeId);
        notifySuccess(t('agent.idCopied'));
      },
    },
  ];

  return (
    <div className="divide-y divide-border/50">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <div
            key={action.id}
            className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Icon className={`h-3.5 w-3.5 shrink-0 ${action.danger ? 'text-danger' : 'text-muted-foreground'}`} />
              <div className="min-w-0">
                <div className="text-mini font-medium text-foreground">{action.label}</div>
                <div className="type-meta truncate">{action.description}</div>
              </div>
            </div>
            <Button
              variant={action.variant}
              size="sm"
              onClick={action.onClick}
              disabled={action.disabled}
              className={`h-8 shrink-0 gap-1.5 px-3 text-mini ${
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
              {action.id === 'ping' && pingResult !== null ? `${pingResult}ms` : t('agent.run')}
            </Button>
          </div>
        );
      })}

      <ConfirmDialog
        open={restartConfirm}
        title={t('agent.restartTitle')}
        message={t('agent.restartMessage', { name: node.name })}
        confirmText={t('agent.restartConfirm')}
        variant="danger"
        loading={restartMutation.isPending}
        onConfirm={() => {
          restartMutation.mutate();
          setRestartConfirm(false);
        }}
        onCancel={() => setRestartConfirm(false)}
      />
    </div>
  );
}
