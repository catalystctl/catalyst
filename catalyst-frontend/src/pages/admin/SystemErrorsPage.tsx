import { useState, useEffect, useCallback } from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  Bug,
  Search,
  RotateCcw,
  Eye,
  Clock,
  X,
  CheckCircle2,
  Radio,
  Copy,
  Check,
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
import { useSystemErrors, useResolveSystemError } from '../../hooks/useAdmin';
import type { SystemError } from '../../types/admin';
import Pagination from '../../components/shared/Pagination';
import { ModalPortal } from '@/components/ui/modal-portal';

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

// ── Level Color Helpers ──
function levelColor(level: string) {
  if (level === 'critical') return 'border-rose-400/40 text-rose-700 dark:border-rose-500/30 dark:text-rose-400';
  if (level === 'error') return 'border-orange-400/40 text-orange-700 dark:border-orange-500/30 dark:text-orange-400';
  if (level === 'warn') return 'border-amber-400/40 text-amber-700 dark:border-amber-500/30 dark:text-amber-400';
  return 'border-border text-muted-foreground';
}

function levelBg(level: string) {
  if (level === 'critical') return 'bg-rose-100 dark:bg-rose-900/20';
  if (level === 'error') return 'bg-orange-100 dark:bg-orange-900/20';
  if (level === 'warn') return 'bg-amber-100 dark:bg-amber-900/20';
  return 'bg-surface-2/50';
}

function levelLabel(level: string) {
  if (level === 'critical') return 'Critical';
  if (level === 'error') return 'Error';
  if (level === 'warn') return 'Warning';
  return level;
}

// ── Copy Helper ──
function formatErrorForCopy(error: SystemError): string {
  const lines: string[] = [];
  lines.push(`## System Error Report`);
  lines.push(`**ID:** ${error.id}`);
  lines.push(`**Level:** ${levelLabel(error.level)}`);
  lines.push(`**Component:** ${error.component}`);
  lines.push(`**Status:** ${error.resolved ? 'Resolved' : 'Unresolved'}`);
  lines.push(`**Timestamp:** ${new Date(error.createdAt).toLocaleString()}`);
  if (error.requestId) lines.push(`**Request ID:** ${error.requestId}`);
  if (error.userId) lines.push(`**User ID:** ${error.userId}`);
  lines.push('');
  lines.push(`### Message`);
  lines.push('```');
  lines.push(error.message);
  lines.push('```');
  if (error.stack) {
    lines.push('');
    lines.push(`### Stack Trace`);
    lines.push('```');
    lines.push(error.stack);
    lines.push('```');
  }
  if (error.metadata && Object.keys(error.metadata).length > 0) {
    lines.push('');
    lines.push(`### Metadata`);
    lines.push('```json');
    lines.push(JSON.stringify(error.metadata, null, 2));
    lines.push('```');
  }
  lines.push('');
  lines.push(`---`);
  lines.push(`_Copied from Catalyst System Errors_`);
  return lines.join('\n');
}

function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    } catch {
      // fallback
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedId(id);
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
    }
  }, []);

  return { copiedId, copy };
}

// ── SSE Connection Status Hook ──
function useSseStatus() {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'>('closed');

  useEffect(() => {
    const es = new EventSource('/api/admin/events', { withCredentials: true });
    es.onopen = () => setStatus('connected');
    es.onerror = () => {
      if (es.readyState === EventSource.CONNECTING) setStatus('reconnecting');
      else if (es.readyState === EventSource.CLOSED) setStatus('closed');
      else setStatus('error');
    };
    return () => {
      es.close();
      setStatus('closed');
    };
  }, []);

  return status;
}

// ── Error Detail Modal ──
function ErrorDetailModal({
  error,
  onClose,
}: {
  error: SystemError;
  onClose: () => void;
}) {
  const metadata = error.metadata || {};
  const metadataEntries = Object.entries(metadata);
  const hasMetadata = metadataEntries.length > 0;
  const { copiedId, copy } = useCopyToClipboard();
  const isCopied = copiedId === error.id;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className="mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card shadow-xl"
        >
          {/* Header */}
          <div className="border-b border-border/50 px-6 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${levelBg(error.level)}`}>
                  <Bug className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground dark:text-white">
                    {error.component}
                  </h2>
                  <p className="text-xs text-muted-foreground truncate">{error.id}</p>
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
          <div className="space-y-5 overflow-y-auto px-6 py-5">
            {/* Level + Status */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Level</span>
                <Badge variant="outline" className={`text-[11px] ${levelColor(error.level)}`}>
                  {levelLabel(error.level)}
                </Badge>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</span>
                <Badge variant={error.resolved ? 'outline' : 'secondary'} className={`text-[11px] ${error.resolved ? 'border-emerald-400/40 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400' : ''}`}>
                  {error.resolved ? 'Resolved' : 'Unresolved'}
                </Badge>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Request ID</span>
                <span className="block font-mono text-[11px] text-muted-foreground truncate" title={error.requestId ?? 'n/a'}>
                  {error.requestId ?? 'n/a'}
                </span>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">User ID</span>
                <span className="block font-mono text-[11px] text-muted-foreground truncate" title={error.userId ?? 'n/a'}>
                  {error.userId ?? 'n/a'}
                </span>
              </div>
            </div>

            {/* Timestamp */}
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Timestamp</span>
              <div className="flex items-center gap-2 text-sm text-foreground dark:text-zinc-100">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(error.createdAt).toLocaleString()}
              </div>
            </div>

            {/* Message */}
            <div className="space-y-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Message</span>
              <div className="rounded-lg border border-border/50 bg-surface-2/40 px-3 py-2 text-sm text-foreground dark:text-zinc-100">
                {error.message}
              </div>
            </div>

            {/* Stack Trace */}
            {error.stack && (
              <div className="space-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Stack Trace</span>
                <pre className="max-h-64 overflow-auto rounded-lg border border-border/50 bg-surface-0 p-3 text-[11px] font-mono leading-relaxed text-foreground dark:text-zinc-300">
                  {error.stack}
                </pre>
              </div>
            )}

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
                No metadata recorded for this error.
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 border-t border-border/50 px-6 py-3">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => copy(formatErrorForCopy(error), error.id)}
            >
              {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {isCopied ? 'Copied!' : 'Copy for AI'}
            </Button>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </motion.div>
      </div>
    </ModalPortal>
  );
}

// ── Error Row ──
function ErrorRow({
  error,
  onView,
  onResolve,
  isResolving,
  index,
}: {
  error: SystemError;
  onView: () => void;
  onResolve: () => void;
  isResolving: boolean;
  index: number;
}) {
  const { copiedId, copy } = useCopyToClipboard();
  const isCopied = copiedId === error.id;
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.015 }}
      className="group relative px-5 py-3.5 text-sm transition-colors hover:bg-surface-2/30"
    >
      {/* Desktop: grid */}
      <div className="hidden grid-cols-12 items-center gap-3 md:grid">
        <div className="col-span-2 min-w-0">
          <Badge variant="outline" className={`text-[11px] ${levelColor(error.level)}`}>
            {levelLabel(error.level)}
          </Badge>
        </div>
        <div className="col-span-2 truncate font-medium text-foreground dark:text-zinc-100">
          {error.component}
        </div>
        <div className="col-span-4 truncate text-muted-foreground">
          {error.message}
        </div>
        <div className="col-span-2 truncate font-mono text-xs text-muted-foreground">
          {new Date(error.createdAt).toLocaleString()}
        </div>
        <div className="col-span-2 flex items-center justify-end gap-2">
          {!error.resolved && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[11px] text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              disabled={isResolving}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Resolve
            </Button>
          )}
          <button
            className="rounded-md p-1 text-muted-foreground opacity-0 transition-colors hover:bg-primary/5 hover:text-primary sm:group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              copy(formatErrorForCopy(error), error.id);
            }}
            title={isCopied ? 'Copied!' : 'Copy for AI'}
          >
            {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
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
              <Badge variant="outline" className={`text-[10px] ${levelColor(error.level)}`}>
                {levelLabel(error.level)}
              </Badge>
              <span className="truncate font-medium text-foreground dark:text-zinc-100">
                {error.component}
              </span>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {error.message}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {new Date(error.createdAt).toLocaleString()}
            </span>
            <button
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              onClick={(e) => {
                e.stopPropagation();
                copy(formatErrorForCopy(error), error.id);
              }}
              title={isCopied ? 'Copied!' : 'Copy for AI'}
            >
              {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            <button
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
              onClick={onView}
              title="View details"
            >
              <Eye className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {!error.resolved && (
          <div className="mt-2 flex">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-[11px] text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              disabled={isResolving}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Resolve
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Page ──
function SystemErrorsPage() {
  const [page, setPage] = useState(1);
  const [level, setLevel] = useState('');
  const [component, setComponent] = useState('');
  const [resolved, setResolved] = useState('');
  const [defaultRange] = useState(buildDefaultRange);
  const [from, setFrom] = useState(defaultRange.from);
  const [to, setTo] = useState(defaultRange.to);
  const [range, setRange] = useState('24h');
  const [selectedError, setSelectedError] = useState<SystemError | null>(null);

  const sseStatus = useSseStatus();
  const isLive = sseStatus === 'connected';

  const resolvedBool = resolved === '' ? undefined : resolved === 'true';

  const { data, isLoading } = useSystemErrors({
    page,
    limit: pageSize,
    level: level || undefined,
    component: component || undefined,
    resolved: resolvedBool,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
  });

  const resolveMutation = useResolveSystemError();

  const errors = data?.errors ?? [];
  const pagination = data?.pagination;
  const hasFilters = level || component || resolved || from || to;

  const clearFilters = () => {
    setLevel('');
    setComponent('');
    setResolved('');
    const fresh = buildDefaultRange();
    setFrom(fresh.from);
    setTo(fresh.to);
    setRange('24h');
    setPage(1);
  };

  const handleResolve = useCallback(
    (id: string) => {
      resolveMutation.mutate(id);
    },
    [resolveMutation],
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
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-slate-500/8 to-zinc-500/8 blur-3xl dark:from-slate-500/15 dark:to-zinc-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-red-500/8 to-orange-500/8 blur-3xl dark:from-red-500/15 dark:to-orange-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-red-500 to-orange-500 opacity-20 blur-sm" />
                <Bug className="relative h-7 w-7 text-red-600 dark:text-red-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                System Errors
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Real-time system error monitoring and resolution.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isLive && (
              <Badge variant="outline" className="gap-1.5 border-emerald-400/40 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400 text-xs">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live
              </Badge>
            )}
            {!isLive && (
              <Badge variant="outline" className="gap-1.5 text-xs text-muted-foreground">
                <Radio className="h-3 w-3" />
                Offline
              </Badge>
            )}
            <Badge variant="outline" className="text-xs">
              {data?.pagination?.total ?? errors.length} errors
            </Badge>
            <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              Clear
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
              <span className="text-xs font-medium text-muted-foreground">Level</span>
              <Select
                value={level || 'all'}
                onValueChange={(next) => {
                  setLevel(next === 'all' ? '' : next);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All levels" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="warn">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Component</span>
              <Input value={component} onChange={(e) => { setComponent(e.target.value); setPage(1); }} placeholder="auth, server..." />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Status</span>
              <Select
                value={resolved === '' ? 'all' : resolved === 'true' ? 'resolved' : 'unresolved'}
                onValueChange={(next) => {
                  if (next === 'all') setResolved('');
                  else if (next === 'resolved') setResolved('true');
                  else setResolved('false');
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="unresolved">Unresolved</SelectItem>
                </SelectContent>
              </Select>
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
              {level && <Badge variant="outline" className="text-[10px]">level: {level}</Badge>}
              {component && <Badge variant="outline" className="text-[10px]">component: {component}</Badge>}
              {resolved && <Badge variant="outline" className="text-[10px]">status: {resolved === 'true' ? 'resolved' : 'unresolved'}</Badge>}
              {range && <Badge variant="outline" className="text-[10px]">range: {range}</Badge>}
            </div>
          )}
        </motion.div>

        {/* ── Error Table ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border bg-card/80">
            {/* Desktop header */}
            <div className="hidden border-b border-border/50 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-12 md:gap-3">
              <div className="col-span-2">Level</div>
              <div className="col-span-2">Component</div>
              <div className="col-span-4">Message</div>
              <div className="col-span-2">Timestamp</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
            <div className="divide-y divide-border/30">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="px-5 py-3.5">
                  <div className="hidden grid-cols-12 gap-3 md:grid">
                    <div className="col-span-2"><div className="h-5 w-16 animate-pulse rounded-full bg-surface-2" /></div>
                    <div className="col-span-2"><div className="h-3 w-20 animate-pulse rounded bg-surface-3" /></div>
                    <div className="col-span-4"><div className="h-3 w-full animate-pulse rounded bg-surface-2" /></div>
                    <div className="col-span-2"><div className="h-3 w-20 animate-pulse rounded bg-surface-2" /></div>
                    <div className="col-span-2 flex justify-end"><div className="h-7 w-16 animate-pulse rounded bg-surface-2" /></div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ) : errors.length > 0 ? (
          <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm">
            {/* Desktop header */}
            <div className="hidden border-b border-border/50 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-12 md:gap-3">
              <div className="col-span-2">Level</div>
              <div className="col-span-2">Component</div>
              <div className="col-span-4">Message</div>
              <div className="col-span-2">Timestamp</div>
              <div className="col-span-2 text-right">Actions</div>
            </div>
            <div className="divide-y divide-border/30">
              {errors.map((error, i) => (
                <ErrorRow
                  key={error.id}
                  error={error}
                  index={i}
                  onView={() => setSelectedError(error)}
                  onResolve={() => handleResolve(error.id)}
                  isResolving={resolveMutation.isPending && resolveMutation.variables === error.id}
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
              title="No system errors"
              description={hasFilters ? 'Try adjusting your filters.' : 'System errors will appear here when they occur.'}
            />
          </motion.div>
        )}
      </div>

      {/* ── Error Detail Modal ── */}
      {selectedError && (
        <ErrorDetailModal error={selectedError} onClose={() => setSelectedError(null)} />
      )}
    </motion.div>
  );
}

export default SystemErrorsPage;
