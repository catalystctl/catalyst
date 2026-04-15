import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  Activity,
  Server,
  Shield,
  User,
  Key,
  AlertTriangle,
  HardDrive,
  Filter,
  Search,
  RefreshCw,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import EmptyState from '../../components/shared/EmptyState';
import Pagination from '../../components/shared/Pagination';
import { useAuditLogs } from '../../hooks/useAdmin';
import type { AuditLogEntry } from '../../types/admin';
import { Link } from 'react-router-dom';

// ── Constants ──
const REFRESH_INTERVAL = 15_000;
const PAGE_SIZE = 40;

const RESOURCE_FILTERS = [
  { value: '', label: 'All Events' },
  { value: 'server', label: 'Servers' },
  { value: 'node', label: 'Nodes' },
  { value: 'user', label: 'Users' },
  { value: 'role', label: 'Roles' },
  { value: 'api_key', label: 'API Keys' },
  { value: 'auth', label: 'Auth' },
  { value: 'backup', label: 'Backups' },
  { value: 'alert', label: 'Alerts' },
  { value: 'template', label: 'Templates' },
  { value: 'smtp', label: 'Email' },
  { value: 'security', label: 'Security' },
];

// ── Animation ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.08 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 400, damping: 28 },
  },
};

// ── Helpers ──
function formatAction(action: string): string {
  const map: Record<string, string> = {
    'server.start': 'Server started',
    'server.stop': 'Server stopped',
    'server.restart': 'Server restarted',
    'server.create': 'Server created',
    'server.delete': 'Server deleted',
    'server.suspend': 'Server suspended',
    'server.unsuspend': 'Server unsuspended',
    'server.update': 'Server updated',
    'server.bulk_start': 'Bulk servers started',
    'server.bulk_stop': 'Bulk servers stopped',
    'server.bulk_restart': 'Bulk servers restarted',
    'server.bulk_delete': 'Bulk servers deleted',
    'server.bulk_suspend': 'Bulk servers suspended',
    'server.bulk_unsuspend': 'Bulk servers unsuspended',
    'backup.create': 'Backup created',
    'backup.restore': 'Backup restored',
    'backup.delete': 'Backup deleted',
    'node.create': 'Node created',
    'node.update': 'Node updated',
    'node.delete': 'Node deleted',
    'node.connect': 'Node connected',
    'node.disconnect': 'Node disconnected',
    'user.create': 'User created',
    'user.update': 'User updated',
    'user.delete': 'User deleted',
    'user.set_roles': 'User roles changed',
    'user.ban': 'User banned',
    'user.unban': 'User unbanned',
    'role.create': 'Role created',
    'role.update': 'Role updated',
    'role.delete': 'Role deleted',
    'login_success': 'Successful login',
    'login_failed': 'Failed login attempt',
    'logout': 'User logged out',
    'api_key.create': 'API key created',
    'api_key.delete': 'API key deleted',
    'api_key.regenerate': 'API key regenerated',
    'alert.create': 'Alert created',
    'alert.resolve': 'Alert resolved',
    'alert.delete': 'Alert deleted',
    'template.create': 'Template created',
    'template.update': 'Template updated',
    'template.delete': 'Template deleted',
    'smtp.update': 'Email settings updated',
    'smtp.test': 'Email test sent',
    'security.update': 'Security settings updated',
    'theme.update': 'Theme settings updated',
    'database.create': 'Database host created',
    'database.update': 'Database host updated',
    'database.delete': 'Database host deleted',
  };

  if (map[action]) return map[action];

  return action
    .split(/[._]/g)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getResourceIcon(resource: string) {
  const icons: Record<string, React.ElementType> = {
    server: Server,
    node: HardDrive,
    user: User,
    role: Shield,
    api_key: Key,
    auth: User,
    alert: AlertTriangle,
    backup: HardDrive,
    template: Server,
    smtp: Zap,
    security: Shield,
    database: HardDrive,
  };
  return icons[resource] || Activity;
}

function getResourceColor(resource: string) {
  const colors: Record<string, string> = {
    server: 'text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800/50',
    node: 'text-emerald-500 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800/50',
    user: 'text-sky-500 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800/50',
    role: 'text-violet-500 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40 border-violet-200 dark:border-violet-800/50',
    api_key: 'text-amber-500 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800/50',
    auth: 'text-rose-500 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800/50',
    alert: 'text-orange-500 dark:text-orange-400 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800/50',
    backup: 'text-cyan-500 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/40 border-cyan-200 dark:border-cyan-800/50',
    template: 'text-fuchsia-500 dark:text-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-950/40 border-fuchsia-200 dark:border-fuchsia-800/50',
    smtp: 'text-pink-500 dark:text-pink-400 bg-pink-50 dark:bg-pink-950/40 border-pink-200 dark:border-pink-800/50',
    security: 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800/50',
    database: 'text-teal-500 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800/50',
  };
  return colors[resource] || 'text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950/40 border-zinc-200 dark:border-zinc-800/50';
}

function getActionTone(action: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (action.includes('delete') || action.includes('ban') || action.includes('failed') || action.includes('disconnect')) return 'danger';
  if (action.includes('suspend') || action.includes('alert')) return 'warning';
  if (action.includes('start') || action.includes('create') || action.includes('resolve') || action.includes('connect') || action.includes('unsuspend') || action.includes('unban') || action.includes('success')) return 'success';
  return 'neutral';
}

function getDotColor(tone: 'success' | 'warning' | 'danger' | 'neutral') {
  switch (tone) {
    case 'success': return 'bg-emerald-500';
    case 'warning': return 'bg-amber-500';
    case 'danger': return 'bg-rose-500';
    case 'neutral': return 'bg-zinc-400 dark:bg-zinc-500';
  }
}

function formatTimeAgo(date: string): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatFullTime(date: string): string {
  return new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDetails(details: unknown): string | null {
  if (details === null || details === undefined) return null;
  if (typeof details === 'string') return details;
  if (typeof details === 'number' || typeof details === 'boolean') return String(details);
  try {
    const json = JSON.stringify(details);
    return json.length > 200 ? `${json.slice(0, 197)}...` : json;
  } catch {
    return String(details);
  }
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

// ── Component ──
function ActivityPage() {
  const [page, setPage] = useState(1);
  const [resourceFilter, setResourceFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [livePoll, setLivePoll] = useState(true);

  const queryParams = useMemo(() => ({
    page: Number.isFinite(page) ? page : 1,
    limit: PAGE_SIZE,
    ...(resourceFilter ? { resource: resourceFilter } : {}),
  }), [page, resourceFilter]);

  const { data, isLoading, isError, refetch, isFetching } = useAuditLogs(queryParams);

  const logs = data?.logs ?? [];
  const pagination = data?.pagination;
  const totalLogs = pagination?.total ?? 0;

  // Live poll
  useEffect(() => {
    if (!livePoll) return;
    const interval = setInterval(() => refetch(), REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [livePoll, refetch]);

  const grouped = useMemo(() => {
    const groups = new Map<string, AuditLogEntry[]>();
    for (const log of logs) {
      const label = getDateLabel(log.timestamp);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(log);
    }
    return groups;
  }, [logs]);

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      {/* ── Header ── */}
      <motion.div variants={itemVariants}>
        <div className="rounded-xl border border-border bg-card/80 px-6 py-4 shadow-sm backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-br from-indigo-500/20 to-violet-500/20 blur-sm" />
                <Activity className="relative h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground dark:text-white">
                  Activity
                </h1>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                  Live event stream across your entire cluster
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {livePoll && (
                <Badge variant="outline" className="gap-1.5 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Live
                </Badge>
              )}
              <Badge variant="secondary" className="text-xs">
                {totalLogs.toLocaleString()} events
              </Badge>
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Filters ── */}
      <motion.div variants={itemVariants}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 dark:border-border dark:bg-surface-1">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <select
              className="appearance-none bg-transparent text-sm font-medium text-foreground outline-none dark:text-zinc-200"
              value={resourceFilter}
              onChange={(e) => { setResourceFilter(e.target.value); setPage(1); }}
            >
              {RESOURCE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              className="w-full rounded-lg border border-border bg-white py-1.5 pl-9 pr-3 text-sm text-foreground transition-colors focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200"
              placeholder="Search actions, users, resources…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLivePoll(!livePoll)}
              className={`gap-1.5 text-xs ${livePoll ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400' : ''}`}
            >
              <RefreshCw className={`h-3 w-3 ${livePoll && isFetching ? 'animate-spin' : ''}`} />
              {livePoll ? 'Auto-refresh' : 'Paused'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-1.5 text-xs"
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          </div>
        </div>
      </motion.div>

      {/* ── Feed ── */}
      <motion.div variants={itemVariants}>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-3 rounded-xl border border-border bg-white p-4 dark:border-border dark:bg-surface-1">
                <Skeleton className="h-8 w-8 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-64" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-8 text-center">
            <p className="text-sm text-rose-600 dark:text-rose-400">Failed to load activity feed.</p>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="mt-3 text-xs">
              Retry
            </Button>
          </div>
        ) : logs.length === 0 ? (
          <EmptyState
            title="No activity yet"
            description="Events will appear here as actions are performed across the cluster."
          />
        ) : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([dateLabel, entries]) => (
              <div key={dateLabel}>
                {/* Date divider */}
                <div className="mb-3 flex items-center gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground dark:text-zinc-500">
                    {dateLabel}
                  </h3>
                  <div className="h-px flex-1 bg-border dark:bg-zinc-800" />
                  <Badge variant="outline" className="text-[10px]">
                    {entries.length}
                  </Badge>
                </div>

                {/* Entries */}
                <div className="space-y-2">
                  <AnimatePresence mode="popLayout">
                    {entries
                      .filter((log) => {
                        if (!searchQuery.trim()) return true;
                        const q = searchQuery.toLowerCase();
                        return (
                          log.action.toLowerCase().includes(q) ||
                          log.resource.toLowerCase().includes(q) ||
                          log.user?.username?.toLowerCase().includes(q) ||
                          log.resourceId?.toLowerCase().includes(q) ||
                          formatDetails(log.details)?.toLowerCase().includes(q)
                        );
                      })
                      .map((log) => {
                        const Icon = getResourceIcon(log.resource);
                        const colorClass = getResourceColor(log.resource);
                        const tone = getActionTone(log.action);
                        const actionLabel = formatAction(log.action);
                        const details = log.details ? formatDetails(log.details) : null;
                        const resourceId = log.resourceId;
                        const resourceType = log.resource;

                        // Determine if we can link to the resource
                        let resourceLink: string | null = null;
                        if (resourceType === 'server' && resourceId) resourceLink = `/servers/${resourceId}`;
                        if (resourceType === 'node' && resourceId) resourceLink = `/admin/nodes/${resourceId}`;

                        return (
                          <motion.div
                            key={log.id}
                            variants={itemVariants}
                            initial="hidden"
                            animate="visible"
                            layout
                            className={`group flex items-start gap-3 rounded-xl border border-border/60 bg-white px-4 py-3 transition-all hover:border-border hover:shadow-sm dark:border-zinc-800/60 dark:bg-surface-1/80 dark:hover:border-zinc-700`}
                          >
                            {/* Icon */}
                            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${colorClass}`}>
                              <Icon className="h-4 w-4" />
                            </div>

                            {/* Content */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground dark:text-zinc-100">
                                  {actionLabel}
                                </span>
                                <span className={`h-1.5 w-1.5 rounded-full ${getDotColor(tone)}`} />
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground dark:text-zinc-400">
                                {/* User */}
                                {log.user?.username && (
                                  <span className="font-medium text-foreground/70 dark:text-zinc-300">
                                    {log.user.username}
                                  </span>
                                )}

                                {/* Resource link */}
                                {resourceLink && resourceId ? (
                                  <Link
                                    to={resourceLink}
                                    className="inline-flex items-center gap-1 font-mono text-primary-600 transition-colors hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
                                  >
                                    {resourceType}:{resourceId.slice(0, 8)}
                                    <ExternalLink className="h-2.5 w-2.5" />
                                  </Link>
                                ) : resourceId ? (
                                  <span className="font-mono">
                                    {resourceType}:{resourceId.slice(0, 8)}
                                  </span>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    {log.resource}
                                  </Badge>
                                )}

                                {/* Details */}
                                {details && details !== '{}' && (
                                  <span className="truncate max-w-xs font-mono text-[11px] opacity-60">
                                    {details}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Time */}
                            <div className="flex shrink-0 flex-col items-end gap-0.5">
                              <span
                                className="text-[11px] text-muted-foreground dark:text-zinc-500"
                                title={formatFullTime(log.timestamp)}
                              >
                                {formatTimeAgo(log.timestamp)}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })}
                  </AnimatePresence>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* ── Pagination ── */}
      {pagination && pagination.totalPages > 1 && (
        <motion.div variants={itemVariants}>
          <Pagination
            page={page}
            totalPages={pagination.totalPages}
            onPageChange={setPage}
          />
        </motion.div>
      )}
    </motion.div>
  );
}

export default ActivityPage;
