import { useState, useMemo, useEffect } from 'react';
import {
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
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
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

// ── Helpers ──
function formatAction(action: string): string {
 return action
 .split(/[._]/g)
 .filter(Boolean)
 .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
 .join(' ');
}

const RESOURCE_ICONS: Record<string, React.ElementType> = {
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

function ResourceIcon({ resource, className }: { resource: string; className?: string }) {
  const Icon = RESOURCE_ICONS[resource] ?? Activity;
  return <Icon className={className} />;
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
 const rawDetails = (log.details ?? log.metadata ?? {}) as Record<string, any>;
 const details = rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails) ? rawDetails : { value: rawDetails };

 // Extract actor info auto-injected by the backend
 const actorUsername = details['_actor.username'] || log.user?.username;
 const actorEmail = details['_actor.email'] || log.user?.email;
 const requestMeta = (details._request && typeof details._request === 'object')
   ? details._request as Record<string, unknown>
   : null;
 const requestIp: string | null = (typeof details.ip === 'string' ? details.ip : null)
   || (typeof requestMeta?.ip === 'string' ? String(requestMeta.ip) : null)
   || log.ipAddress
   || null;
 const requestUa: string | null = (typeof details.userAgent === 'string' ? details.userAgent : null)
   || (typeof requestMeta?.userAgent === 'string' ? String(requestMeta.userAgent) : null);
 const requestMethod = typeof requestMeta?.method === 'string' ? requestMeta.method : null;
 const requestPath = typeof requestMeta?.path === 'string' ? requestMeta.path : null;

 // Filter out internal bookkeeping keys from the generic details display
 const publicEntries = Object.entries(details).filter(([key]) => {
   if (key.startsWith('_actor')) return false;
   if (key === '_meta' || key === '_request') return false;
   // ip/userAgent shown in chips
   if (key === 'ip' || key === 'userAgent') return false;
   return true;
 });
 const hasDetails = publicEntries.length > 0 || Boolean(requestIp) || Boolean(requestUa);
 const tone = getActionTone(log.action);

 const toneStyles: Record<string, { bg: string; border: string; text: string; dot: string }> = {
 success: { bg: 'bg-success/5', border: 'border-success/20', text: 'text-success', dot: 'bg-success' },
 danger: { bg: 'bg-destructive/5', border: 'border-destructive/20', text: 'text-destructive', dot: 'bg-destructive' },
 warning: { bg: 'bg-warning/5', border: 'border-warning/20', text: 'text-warning', dot: 'bg-warning' },
 neutral: { bg: 'bg-muted/30', border: 'border-border', text: 'text-muted-foreground', dot: 'bg-muted-foreground/30' },
 };

 const ts = toneStyles[tone];

 const renderValue = (value: unknown, depth = 0): React.ReactNode => {
 if (value === null || value === undefined) return <span className="text-muted-foreground/50 italic">null</span>;
 if (typeof value === 'boolean') return <Badge variant={value ? 'success' : 'secondary'} className="text-[10px] px-1.5 py-0">{String(value)}</Badge>;
 if (typeof value === 'number') return <span className="tabular-nums text-foreground">{value}</span>;
 if (typeof value === 'string') {
 // Truncate long strings
 if (value.length > 120) return (
 <details className="inline">
 <summary className="cursor-pointer text-muted-foreground hover:text-foreground">{value.slice(0, 120)}…</summary>
 <pre className="mt-1 whitespace-pre-wrap text-xs text-foreground">{value}</pre>
 </details>
 );
 // Detect if it looks like an ID (cuid)
 if (/^cmp[a-z0-9]{20,}$/.test(value)) return <code className="rounded bg-muted/50 px-1 py-0.5 text-[11px] font-mono text-muted-foreground">{value.slice(0, 12)}…</code>;
 return <span className="text-foreground">{value}</span>;
 }
 if (Array.isArray(value)) {
 if (value.length === 0) return <span className="text-muted-foreground/50 italic">empty</span>;
 return (
 <div className="space-y-1">
 {value.map((item, i) => (
 <div key={i} className="flex items-start gap-1.5 text-xs">
 <span className="text-muted-foreground/50">{i + 1}.</span>
 {renderValue(item, depth + 1)}
 </div>
 ))}
 </div>
 );
 }
 if (typeof value === 'object') {
 const entries = Object.entries(value as Record<string, unknown>);
 if (entries.length === 0) return <span className="text-muted-foreground/50 italic">empty</span>;
 if (depth >= 2) return <code className="text-[11px] text-muted-foreground">{JSON.stringify(value)}</code>;
 return (
 <div className={`rounded-lg border border-border/50 bg-muted/20 p-2 space-y-1.5 ${depth > 0 ? 'ml-2' : ''}`}>
 {entries.map(([k, v]) => (
 <div key={k} className="flex items-start gap-2 text-xs">
 <span className="shrink-0 font-medium text-muted-foreground">{k}</span>
 <span className="flex-1">{renderValue(v, depth + 1)}</span>
 </div>
 ))}
 </div>
 );
 }
 return <span>{String(value)}</span>;
 };

 const resourceLink = log.resource === 'server' && log.resourceId ? `/servers/${log.resourceId}` :
 log.resource === 'node' && log.resourceId ? `/admin/nodes/${log.resourceId}` : null;

 return (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm" onClick={onClose}>
 <div
 onClick={(e) => e.stopPropagation()}
 className="mx-4 w-full max-w-2xl rounded-xl border border-border bg-card shadow-elevated max-h-[85vh] flex flex-col"
 >
 {/* ── Header ── */}
 <div className={`relative overflow-hidden border-b border-border px-6 py-4 ${ts.bg}`}>
 <div className="absolute inset-0 bg-gradient-to-r ${tone === 'danger' ? 'from-destructive/5 to-transparent' : tone === 'warning' ? 'from-warning/5 to-transparent' : tone === 'success' ? 'from-success/5 to-transparent' : 'from-primary/5 to-transparent'}" />

 <div className="relative flex items-start justify-between gap-3">
 <div className="flex items-start gap-3">
 <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${ts.bg} ${ts.text}`}>
 <ResourceIcon resource={log.resource} className="h-5 w-5" />
 </div>
 <div>
 <div className="flex items-center gap-2.5">
 <h2 className="text-base font-semibold text-foreground">
 {formatAction(log.action)}
 </h2>
 <span className={`h-2 w-2 rounded-full ${ts.dot}`} />
 <Badge variant="outline" className={`text-[10px] ${ts.border} ${ts.text}`}>
 {log.action}
 </Badge>
 </div>
 <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
 <Badge variant="secondary" className="gap-1 text-[10px]">
 <ResourceIcon resource={log.resource} className="h-2.5 w-2.5" />
 {log.resource}
 </Badge>
 {log.resourceId && (
 resourceLink ? (
 <Link to={resourceLink} className="inline-flex items-center gap-1 font-mono text-primary transition-colors hover:underline">
 {log.resourceId.slice(0, 12)}…
 <ExternalLink className="h-2.5 w-2.5" />
 </Link>
 ) : (
 <code className="text-[11px] text-muted-foreground">{log.resourceId.slice(0, 12)}…</code>
 )
 )}
 </div>
 </div>
 </div>
 <button className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={onClose}>
 <X className="h-4 w-4" />
 </button>
 </div>
 </div>

 {/* ── Body (scrollable) ── */}
 <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
 {/* Who & When */}
 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
 <div className="space-y-1.5">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Actor</span>
 <div className="flex items-center gap-2.5">
 <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
 <User className="h-4 w-4 text-primary" />
 </div>
 <div>
 <div className="text-sm font-medium text-foreground">{actorUsername ?? 'System'}</div>
 <div className="text-[11px] text-muted-foreground">{actorEmail ?? log.userId ?? 'n/a'}</div>
 </div>
 </div>
 </div>
 <div className="space-y-1.5">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">When</span>
 <div className="flex items-center gap-2">
 <Clock className="h-4 w-4 text-muted-foreground" />
 <div>
 <div className="text-sm font-medium text-foreground tabular-nums">
 {new Date(log.timestamp).toLocaleString()}
 </div>
 <div className="text-[11px] text-muted-foreground">
 {formatTimeAgo(log.timestamp)} ago
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Quick facts */}
 <div className="flex flex-wrap items-center gap-2">
 {requestIp && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
 <Globe className="h-3 w-3" />
 <span className="font-mono">{requestIp}</span>
 </div>
 )}
 {requestUa && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground max-w-full">
 <span className="truncate" title={requestUa}>{requestUa}</span>
 </div>
 )}
 {requestMethod && requestPath && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
 <code className="font-mono">{requestMethod} {requestPath}</code>
 </div>
 )}
 {log.userId && (
 <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
 <Hash className="h-3 w-3" />
 <code>{log.userId.slice(0, 12)}…</code>
 </div>
 )}
 </div>

 {/* Details / Metadata */}
 {hasDetails ? (
 <div className="space-y-2">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
 Details ({publicEntries.length})
 </span>
 <div className="space-y-2">
 {publicEntries.map(([key, value]) => (
 <div key={key} className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
 <div className="flex items-start gap-3">
 <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground pt-0.5 min-w-[80px]">
 {key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim()}
 </span>
 <div className="flex-1 text-xs min-w-0">
 {renderValue(value)}
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>
 ) : (
 <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-4 text-center text-xs text-muted-foreground">
 No details recorded for this event.
 </div>
 )}
 </div>

 {/* ── Footer ── */}
 <div className="flex justify-end border-t border-border px-6 py-3">
 <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
 </div>
 </div>
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
 // Prefer audit_log_created admin SSE (AppLayout). Safety poll while "Auto" is on.
 const interval = setInterval(() => refetch(), 60_000);
 return () => clearInterval(interval);
 }, [livePoll, refetch]);

 const logs = useMemo(() => data?.logs ?? [], [data?.logs]);
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
 <div className="space-y-5">
 {/* ── Header ── */}
 <TabHeader
 icon={Activity}
 title="Audit Logs"
 description="Track admin and user actions across the platform."
 actions={
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
 }
 />

 {/* ── Filters ── */}
 <ServerTabCard>
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
 className="border-border/40 bg-card pl-9"
 />
 </div>
 <Input
 value={action}
 onChange={(e) => { setAction(e.target.value); setPage(1); }}
 placeholder="Action contains…"
 className="border-border/40 bg-card"
 />
 <Input
 value={resource}
 onChange={(e) => { setResource(e.target.value); setPage(1); }}
 placeholder="Resource type…"
 className="border-border/40 bg-card"
 />
 <Input
 value={userId}
 onChange={(e) => { setUserId(e.target.value); setPage(1); }}
 placeholder="User ID…"
 className="border-border/40 bg-card"
 />
 </div>
 <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
 <Input
 type="datetime-local"
 value={from}
 onChange={(e) => { setFrom(e.target.value); setRange(''); setPage(1); }}
 className="border-border/40 bg-card"
 />
 <Input
 type="datetime-local"
 value={to}
 onChange={(e) => { setTo(e.target.value); setRange(''); setPage(1); }}
 className="border-border/40 bg-card"
 />
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
 <SelectTrigger className="border-border/40 bg-card">
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
 </ServerTabCard>

 {/* ── Log Feed ── */}
 {isLoading ? (
 <TabLoadingState rows={6} rowHeight="h-16" />
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
 {entries.map((log) => {
 const tone = getActionTone(log.action);
 const resourceLink = log.resource === 'server' && log.resourceId ? `/servers/${log.resourceId}` :
 log.resource === 'node' && log.resourceId ? `/admin/nodes/${log.resourceId}` : null;

 return (
 <div
 key={log.id}
 className="group relative flex items-start gap-3 rounded-lg border border-border/30 px-4 py-3 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
 >
 <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />
 <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
 <ResourceIcon resource={log.resource} className="h-4 w-4" />
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
 </div>
 );
 })}
 </div>
 </div>
 ))}
 </div>
 ) : (
 <TabEmptyState
 title="No audit logs"
 description={hasFilters || searchQuery ? 'Try adjusting your filters.' : 'Audit events will appear once user actions are recorded.'}
 />
 )}

 {/* ── Pagination ── */}
 {pagination && pagination.totalPages > 1 && (
 <div className="flex justify-center">
 <Pagination page={page} totalPages={pagination.totalPages} onPageChange={setPage} />
 </div>
 )}

 {/* ── Log Detail Modal ── */}
 {selectedLog && (
 <LogDetailModal log={selectedLog} onClose={() => setSelectedLog(null)} />
 )}
 </div>
 );
}

export default AuditLogsPage;
