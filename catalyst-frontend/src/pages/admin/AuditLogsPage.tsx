import { useState } from 'react';
import { motion, type Variants } from 'framer-motion';
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

// ── Action Color Helper ──
function actionColor(action: string) {
  if (action.includes('.create') || action.includes('.start')) return 'border-emerald-400/40 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400';
  if (action.includes('.delete') || action.includes('.suspend') || action.includes('.ban')) return 'border-rose-400/40 text-rose-700 dark:border-rose-500/30 dark:text-rose-400';
  if (action.includes('.update') || action.includes('.edit')) return 'border-amber-400/40 text-amber-700 dark:border-amber-500/30 dark:text-amber-400';
  return 'border-border text-muted-foreground';
}

function actionBg(action: string) {
  if (action.includes('.create') || action.includes('.start')) return 'bg-emerald-100 dark:bg-emerald-900/20';
  if (action.includes('.delete') || action.includes('.suspend') || action.includes('.ban')) return 'bg-rose-100 dark:bg-rose-900/20';
  if (action.includes('.update') || action.includes('.edit')) return 'bg-amber-100 dark:bg-amber-900/20';
  return 'bg-surface-2/50';
}

function resourceIcon(resource: string) {
  if (resource === 'server') return <Zap className="h-3 w-3" />;
  if (resource === 'node') return <Globe className="h-3 w-3" />;
  if (resource === 'user') return <User className="h-3 w-3" />;
  if (resource === 'role') return <Hash className="h-3 w-3" />;
  return <ScrollText className="h-3 w-3" />;
}

// ── Log Detail Modal ──
function LogDetailModal({
  log,
  onClose,
}: {
  log: AuditLogEntry;
  onClose: () => void;
}) {
  const metadata = log.metadata || {};
  const metadataEntries = Object.entries(metadata);
  const hasMetadata = metadataEntries.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="mx-4 w-full max-w-2xl rounded-xl border border-border bg-card shadow-xl"
      >
        {/* Header */}
        <div className="border-b border-border/50 px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${actionBg(log.action)}`}>
                {resourceIcon(log.resource)}
              </div>
              <div>
                <h2 className="text-base font-semibold text-foreground dark:text-white">
                  {log.action}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {log.resource} · {log.id}
                </p>
              </div>
            </div>
            <button
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="space-y-5 px-6 py-5">
          {/* User info */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">User</span>
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary-100 dark:bg-primary-900/30">
                  <User className="h-3.5 w-3.5 text-primary-600 dark:text-primary-400" />
                </div>
                <div>
                  <div className="text-sm font-medium text-foreground dark:text-zinc-100">
                    {log.user?.username ?? 'Unknown'}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {log.user?.email ?? log.userId ?? 'n/a'}
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Timestamp</span>
              <div className="flex items-center gap-2 text-sm text-foreground dark:text-zinc-100">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(log.timestamp).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Action</span>
              <Badge variant="outline" className={`text-[11px] ${actionColor(log.action)}`}>
                {log.action}
              </Badge>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Resource</span>
              <Badge variant="secondary" className="gap-1 text-[11px]">
                {resourceIcon(log.resource)}
                {log.resource}
              </Badge>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">IP Address</span>
              <span className="block font-mono text-xs text-foreground dark:text-zinc-300">
                {log.ipAddress ?? 'n/a'}
              </span>
            </div>
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">User ID</span>
              <span className="block font-mono text-[11px] text-muted-foreground truncate" title={log.userId ?? 'n/a'}>
                {log.userId ?? 'n/a'}
              </span>
            </div>
          </div>

          {/* Metadata */}
          {hasMetadata && (
            <div className="space-y-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Metadata ({metadataEntries.length} field{metadataEntries.length === 1 ? '' : 's'})
              </span>
              <div className="rounded-lg border border-border/50 bg-surface-2/40 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/50 text-left">
                      <th className="px-3 py-2 font-semibold text-muted-foreground">Key</th>
                      <th className="px-3 py-2 font-semibold text-muted-foreground">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {metadataEntries.map(([key, value]) => (
                      <tr key={key} className="transition-colors hover:bg-surface-2/60">
                        <td className="px-3 py-2 font-mono text-foreground dark:text-zinc-300">{key}</td>
                        <td className="max-w-xs truncate px-3 py-2 text-muted-foreground" title={JSON.stringify(value)}>
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!hasMetadata && (
            <div className="rounded-lg border border-dashed border-border/50 bg-surface-2/20 px-4 py-3 text-center text-xs text-muted-foreground">
              No metadata recorded for this event.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border/50 px-6 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Log Row ──
function LogRow({
  log,
  onView,
  index,
}: {
  log: AuditLogEntry;
  onView: () => void;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.015 }}
      className="group relative px-5 py-3.5 text-sm transition-colors hover:bg-surface-2/30"
    >
      {/* Desktop: grid */}
      <div className="hidden grid-cols-12 items-center gap-3 md:grid">
        <div className="col-span-3 min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-100 dark:bg-primary-900/30">
              <User className="h-3 w-3 text-primary-600 dark:text-primary-400" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium text-foreground dark:text-zinc-100">
                {log.user?.username ?? 'Unknown'}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {log.user?.email ?? log.userId ?? 'n/a'}
              </div>
            </div>
          </div>
        </div>
        <div className="col-span-3 min-w-0">
          <Badge variant="outline" className={`text-[11px] ${actionColor(log.action)}`}>
            {log.action}
          </Badge>
        </div>
        <div className="col-span-2">
          <Badge variant="secondary" className="gap-1 text-[11px]">
            {resourceIcon(log.resource)}
            {log.resource}
          </Badge>
        </div>
        <div className="col-span-2 truncate font-mono text-xs text-muted-foreground">
          {log.ipAddress ?? 'n/a'}
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">
            {new Date(log.timestamp).toLocaleString()}
          </span>
          <button
            className="rounded-md p-1 text-muted-foreground opacity-0 transition-colors hover:bg-primary/5 hover:text-primary sm:group-hover:opacity-100"
            onClick={onView}
            title="View details"
          >
            <Eye className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Mobile: stacked */}
      <div className="md:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary-100 dark:bg-primary-900/30">
                <User className="h-3 w-3 text-primary-600 dark:text-primary-400" />
              </div>
              <span className="truncate font-medium text-foreground dark:text-zinc-100">
                {log.user?.username ?? 'Unknown'}
              </span>
            </div>
            <div className="ml-8 mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Badge variant="outline" className={`text-[10px] ${actionColor(log.action)}`}>
                {log.action}
              </Badge>
              <Badge variant="secondary" className="gap-1 text-[10px]">
                {resourceIcon(log.resource)}
                {log.resource}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {new Date(log.timestamp).toLocaleString()}
            </span>
            <button
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              onClick={onView}
              title="View details"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="ml-8 mt-1 text-[11px] text-muted-foreground">
          {log.user?.email ?? log.userId ?? 'n/a'} · {log.ipAddress ?? 'n/a'}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Page ──
function AuditLogsPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [userId, setUserId] = useState('');
  const [defaultRange] = useState(buildDefaultRange);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [range, setRange] = useState('24h');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const { data, isLoading } = useAuditLogs({
    page,
    limit: pageSize,
    action: action || undefined,
    resource: resource || undefined,
    userId: userId || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });

  const logs = data?.logs ?? [];
  const pagination = data?.pagination;
  const hasFilters = action || resource || userId || from || to;

  const clearFilters = () => {
    setAction('');
    setResource('');
    setUserId('');
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
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-slate-500/8 to-zinc-500/8 blur-3xl dark:from-slate-500/15 dark:to-zinc-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-blue-500/8 to-indigo-500/8 blur-3xl dark:from-blue-500/15 dark:to-indigo-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-slate-500 to-zinc-500 opacity-20 blur-sm" />
                <ScrollText className="relative h-7 w-7 text-slate-600 dark:text-slate-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                Audit Logs
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Track admin and user actions across the platform.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {data?.pagination?.total ?? logs.length} events
            </Badge>
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
        <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border/50 bg-card/60 p-4 backdrop-blur-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            <Search className="h-3.5 w-3.5" />
            Filters
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Action contains</span>
              <Input value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="server.create" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Resource</span>
              <Input value={resource} onChange={(e) => { setResource(e.target.value); setPage(1); }} placeholder="server" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">User ID</span>
              <Input value={userId} onChange={(e) => { setUserId(e.target.value); setPage(1); }} placeholder="cuid" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">From</span>
              <Input
                type="datetime-local"
                value={from}
                onChange={(e) => { setFrom(e.target.value); setRange(''); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">To</span>
              <Input
                type="datetime-local"
                value={to}
                onChange={(e) => { setTo(e.target.value); setRange(''); setPage(1); }}
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Quick range</span>
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
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Custom" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="1h">Last 1h</SelectItem>
                  <SelectItem value="6h">Last 6h</SelectItem>
                  <SelectItem value="24h">Last 24h</SelectItem>
                  <SelectItem value="7d">Last 7d</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          {/* Active filter chips */}
          {hasFilters && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
              <span className="text-[11px] text-muted-foreground">Active:</span>
              {action && <Badge variant="outline" className="text-[10px]">action: {action}</Badge>}
              {resource && <Badge variant="outline" className="text-[10px]">resource: {resource}</Badge>}
              {userId && <Badge variant="outline" className="text-[10px]">user: {userId}</Badge>}
              {range && <Badge variant="outline" className="text-[10px]">range: {range}</Badge>}
            </div>
          )}
        </motion.div>

        {/* ── Log Table ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border bg-card/80">
            {/* Desktop header */}
            <div className="hidden border-b border-border/50 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-12 md:gap-3">
              <div className="col-span-3">User</div>
              <div className="col-span-3">Action</div>
              <div className="col-span-2">Resource</div>
              <div className="col-span-2">IP</div>
              <div className="col-span-2 text-right">Timestamp</div>
            </div>
            <div className="divide-y divide-border/30">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="px-5 py-3.5">
                  <div className="hidden grid-cols-12 gap-3 md:grid">
                    <div className="col-span-3 flex items-center gap-2">
                      <div className="h-6 w-6 animate-pulse rounded-md bg-surface-3" />
                      <div className="space-y-1">
                        <div className="h-3 w-20 animate-pulse rounded bg-surface-3" />
                        <div className="h-2.5 w-32 animate-pulse rounded bg-surface-2" />
                      </div>
                    </div>
                    <div className="col-span-3"><div className="h-5 w-24 animate-pulse rounded-full bg-surface-2" /></div>
                    <div className="col-span-2"><div className="h-5 w-16 animate-pulse rounded-full bg-surface-2" /></div>
                    <div className="col-span-2"><div className="h-3 w-20 animate-pulse rounded bg-surface-2" /></div>
                    <div className="col-span-2 flex justify-end"><div className="h-3 w-28 animate-pulse rounded bg-surface-2" /></div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ) : logs.length > 0 ? (
          <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm">
            {/* Desktop header */}
            <div className="hidden border-b border-border/50 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-12 md:gap-3">
              <div className="col-span-3">User</div>
              <div className="col-span-3">Action</div>
              <div className="col-span-2">Resource</div>
              <div className="col-span-2">IP</div>
              <div className="col-span-2 text-right">Timestamp</div>
            </div>
            <div className="divide-y divide-border/30">
              {logs.map((log, i) => (
                <LogRow
                  key={log.id}
                  log={log}
                  index={i}
                  onView={() => setSelectedLog(log)}
                />
              ))}
            </div>
            {pagination && pagination.totalPages > 1 && (
              <div className="flex justify-center border-t border-border/50 pt-3">
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div variants={itemVariants}>
            <EmptyState
              title="No audit logs"
              description={hasFilters ? 'Try adjusting your filters.' : 'Audit events will appear once user actions are recorded.'}
            />
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
