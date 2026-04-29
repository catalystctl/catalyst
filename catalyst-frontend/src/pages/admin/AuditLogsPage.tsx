import { useState, useMemo, useEffect, createElement } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  ScrollText,
  Search,
  Download,
  RotateCcw,
  Eye,
  User,
  Zap,
  Globe,
  Clock,
  Hash,
  X,
  Activity,
  Server,
  Shield,
  Key,
  AlertTriangle,
  HardDrive,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '../../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { useAuditLogs } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import type { AuditLogEntry } from '../../types/admin';
import Pagination from '../../components/shared/Pagination';
import { ModalPortal } from '@/components/ui/modal-portal';
import { Link } from 'react-router-dom';

const pageSize = 50;

const buildDefaultRange = () => {
  const now = new Date();
  const initialFrom = new Date(now);
  initialFrom.setHours(now.getHours() - 24);
  return {
    from: initialFrom.toISOString().slice(0, 16),
    to: now.toISOString().slice(0, 16),
  };
};

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

// ── Helpers ──
function formatAction(action: string): string {
  return action
    .split(/[._]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getResourceIcon(resource: string) {
  const icons: Record<string, React.ElementType> = {
    server: Server, node: HardDrive, user: User, role: Shield,
    api_key: Key, auth: User, alert: AlertTriangle, backup: HardDrive,
    template: Server, smtp: Zap, security: Shield, database: HardDrive,
  };
  return icons[resource] || Activity;
}

function getActionTone(action: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (action.includes('delete') || action.includes('ban') || action.includes('failed') || action.includes('disconnect')) return 'danger';
  if (action.includes('suspend')) return 'warning';
  if (action.includes('start') || action.includes('create') || action.includes('resolve') || action.includes('connect') || action.includes('unsuspend') || action.includes('unban') || action.includes('success')) return 'success';
  return 'neutral';
}

function toneDot(tone: 'success' | 'warning' | 'danger' | 'neutral') {
  switch (tone) {
    case 'success': return 'bg-success';
    case 'warning': return 'bg-warning';
    case 'danger': return 'bg-danger';
    case 'neutral': return 'bg-muted-foreground/30';
  }
}

function formatTimeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function isToday(date: string): boolean {
  const d = new Date(date);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isYesterday(date: string): boolean {
  const d = new Date(date);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate();
}

function getDateLabel(date: string): string {
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// ── Log Detail Modal ──
function LogDetailModal({ log, onClose }: { log: AuditLogEntry; onClose: () => void }) {
  const metadata = log.metadata || {};
  const metadataEntries = Object.entries(metadata);
  const hasMetadata = metadataEntries.length > 0;

  return (
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="mx-4 w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {createElement(getResourceIcon(log.resource), { className: 'h-4 w-4' })}
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground">{log.action}</h2>
                <p className="text-xs text-muted-foreground">{log.resource} · {log.id}</p>
              </div>
            </div>
            <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={onClose}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">User</span>
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                  <User className="h-3.5 w-3.5 text-primary" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground">{log.user?.username ?? 'Unknown'}</div>
                  <div className="text-[11px] text-muted-foreground">{log.user?.email ?? log.userId ?? 'n/a'}</div>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Timestamp</span>
              <div className="flex items-center gap-2 text-sm text-foreground">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(log.timestamp).toLocaleString()}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Action</span>
              <Badge variant="outline" className="text-[11px]">{log.action}</Badge>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resource</span>
              <Badge variant="secondary" className="gap-1 text-[11px]">
                {createElement(getResourceIcon(log.resource), { className: 'h-3 w-3' })}
                {log.resource}
              </Badge>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">IP Address</span>
              <span className="block text-xs text-foreground">{log.ipAddress ?? 'n/a'}</span>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">User ID</span>
              <span className="block text-[11px] text-muted-foreground truncate" title={log.userId ?? 'n/a'}>{log.userId ?? 'n/a'}</span>
            </div>
          </div>

          {hasMetadata ? (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Metadata ({metadataEntries.length})</span>
              <div className="rounded-lg border border-border bg-muted/30 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-3 py-2 font-semibold text-muted-foreground">Key</th>
                      <th className="px-3 py-2 font-semibold text-muted-foreground">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {metadataEntries.map(([key, value]) => (
                      <tr key={key} className="hover:bg-muted/50">
                        <td className="px-3 py-2 text-foreground">{key}</td>
                        <td className="max-w-xs truncate px-3 py-2 text-muted-foreground" title={JSON.stringify(value)}>
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-3 text-center text-xs text-muted-foreground">
              No metadata recorded for this event.
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-6 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </motion.div>
    </div>
    </ModalPortal>
  );
}

// ── Main Page ──
function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [userId, setUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [defaultRange] = useState(buildDefaultRange);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [range, setRange] = useState('24h');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [livePoll, setLivePoll] = useState(false);

  const { data, isLoading, refetch, isFetching } = useAuditLogs({
    page,
    limit: pageSize,
    action: action || undefined,
    resource: resource || undefined,
    userId: userId || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });

  useEffect(() => {
    if (!livePoll) return;
    const interval = setInterval(() => refetch(), 15000);
    return () => clearInterval(interval);
  }, [livePoll, refetch]);

  const logs = data?.logs ?? [];
  const pagination = data?.pagination;
  const hasFilters = action || resource || userId || from || to;

  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;
    const q = searchQuery.toLowerCase();
    return logs.filter((log) =>
      log.action.toLowerCase().includes(q) ||
      log.resource.toLowerCase().includes(q) ||
      log.user?.username?.toLowerCase().includes(q) ||
      log.user?.email?.toLowerCase().includes(q) ||
      log.resourceId?.toLowerCase().includes(q) ||
      log.ipAddress?.toLowerCase().includes(q),
    );
  }, [logs, searchQuery]);

  const grouped = useMemo(() => {
    const groups = new Map<string, AuditLogEntry[]>();
    for (const log of filteredLogs) {
      const label = getDateLabel(log.timestamp);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(log);
    }
    return groups;
  }, [filteredLogs]);

  const clearFilters = () => {
    setAction('');
    setResource('');
    setUserId('');
    setSearchQuery('');
    const fresh = buildDefaultRange();
    setFrom(fresh.from);
    setTo(fresh.to);
    setRange('24h');
    setPage(1);
  };

  const handleExport = async () => {
    const payload = await adminApi.exportAuditLogs({
      action: action || undefined,
      resource: resource || undefined,
      userId: userId || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(to).toISOString() : undefined,
      format: 'csv',
    });
    const blob = new Blob([payload], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-logs-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-violet-500/8 to-cyan-500/8 blur-3xl dark:from-violet-500/15 dark:to-cyan-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-sky-500/8 to-indigo-500/8 blur-3xl dark:from-sky-500/15 dark:to-indigo-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-violet-500 to-cyan-500 opacity-20 blur-sm" />
                <Activity className="relative h-7 w-7 text-violet-600 dark:text-violet-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground ">
                Audit Logs
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Track admin and user actions across the platform.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {livePoll && (
              <Badge variant="outline" className="gap-1.5 border-success/30 text-success text-xs">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
                </span>
                Live
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {pagination?.total ?? 0} events
            </Badge>
            <Button variant="outline" size="sm" onClick={() => setLivePoll(!livePoll)} className="gap-1.5">
              <RefreshCw className={`h-3.5 w-3.5 ${livePoll && isFetching ? 'animate-spin' : ''}`} />
              {livePoll ? 'Auto' : 'Poll'}
            </Button>
            <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </Button>
          </div>
        </motion.div>

        {/* ── Filters ── */}
        <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            <Search className="h-3.5 w-3.5" />
            Filters
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search actions, users, IP…"
                className="pl-9"
              />
            </div>
            <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="Action contains…" />
            <Input value={resource} onChange={(e) => { setResource(e.target.value); setPage(1); }} placeholder="Resource type…" />
            <Input value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} placeholder="User ID…" />
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input type="datetime-local" value={from} onChange={(e) => { setFrom(e.target.value); setRange(''); setPage(1); }} />
            <Input type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); setRange(''); setPage(1); }} />
            <Select
              value={range || 'custom'}
              onValueChange={(next) => {
                const value = next === 'custom' ? '' : next;
                setRange(value);
                if (!value) return;
                const now = new Date();
                const nextFrom = new Date(now);
                if (value === '1h') nextFrom.setHours(now.getHours() - 1);
                if (value === '6h') nextFrom.setHours(now.getHours() - 6);
                if (value === '24h') nextFrom.setHours(now.getHours() - 24);
                if (value === '7d') nextFrom.setDate(now.getDate() - 7);
                setFrom(nextFrom.toISOString().slice(0, 16));
                setTo(now.toISOString().slice(0, 16));
                setPage(1);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Quick range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom</SelectItem>
                <SelectItem value="1h">Last 1 hour</SelectItem>
                <SelectItem value="6h">Last 6 hours</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasFilters && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="text-[11px] text-muted-foreground">Active:</span>
              {action && <Badge variant="outline" className="text-[10px]">action: {action}</Badge>}
              {resource && <Badge variant="outline" className="text-[10px]">resource: {resource}</Badge>}
              {userId && <Badge variant="outline" className="text-[10px]">user: {userId}</Badge>}
              {range && <Badge variant="outline" className="text-[10px]">range: {range}</Badge>}
            </div>
          )}
        </motion.div>

        {/* ── Log Feed ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="flex gap-3 rounded-xl border border-border bg-card p-4">
                <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-3 w-12 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </motion.div>
        ) : filteredLogs.length > 0 ? (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([dateLabel, entries]) => (
              <div key={dateLabel}>
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">{dateLabel}</h3>
                  <div className="h-px flex-1 bg-border" />
                  <Badge variant="outline" className="text-[10px]">{entries.length}</Badge>
                </div>

                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {entries.map((log, i) => {
                      const Icon = getResourceIcon(log.resource);
                      const tone = getActionTone(log.action);
                      const resourceLink = log.resource === 'server' && log.resourceId ? `/servers/${log.resourceId}` :
                        log.resource === 'node' && log.resourceId ? `/admin/nodes/${log.resourceId}` : null;

                      return (
                        <motion.div
                          key={log.id}
                          variants={itemVariants}
                          initial="hidden"
                          animate="visible"
                          layout
                          className="group flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-primary/20"
                        >
                          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="h-4 w-4" />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-foreground">
                                {formatAction(log.action)}
                              </span>
                              <span className={`h-1.5 w-1.5 rounded-full ${toneDot(tone)}`} />
                              <Badge variant="secondary" className="text-[10px]">{log.resource}</Badge>
                            </div>

                            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              {log.user?.username && (
                                <span className="font-medium text-foreground/70">{log.user.username}</span>
                              )}
                              {resourceLink ? (
                                <Link to={resourceLink} className="inline-flex items-center gap-1 text-primary transition-colors hover:underline">
                                  {log.resource}:{log.resourceId?.slice(0, 8)}
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </Link>
                              ) : log.resourceId ? (
                                <span>{log.resource}:{log.resourceId.slice(0, 8)}</span>
                              ) : null}
                              {log.ipAddress && <span className="opacity-60">{log.ipAddress}</span>}
                            </div>
                          </div>

                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="text-[11px] text-muted-foreground" title={new Date(log.timestamp).toLocaleString()}>
                              {formatTimeAgo(log.timestamp)}
                            </span>
                            <button
                              className="rounded-md p-1 text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-primary/10 hover:text-primary"
                              onClick={() => setSelectedLog(log)}
                              title="View details"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <motion.div variants={itemVariants}>
            <EmptyState
              title="No audit logs"
              description={hasFilters || searchQuery ? 'Try adjusting your filters.' : 'Audit events will appear once user actions are recorded.'}
            />
          </motion.div>
        )}

        {/* ── Pagination ── */}
        {pagination && pagination.totalPages > 1 && (
          <motion.div variants={itemVariants} className="flex justify-center">
            <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} />
          </motion.div>
        )}
      </div>

      {/* ── Log Detail Modal ── */}
      {selectedLog && (
        <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />
      )}
    </motion.div>
  );
}

export default AuditLogsPage;
