import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
 Bug,
 Search,
 RotateCcw,
 Eye,
 Clock,
 CheckCircle2,
 CheckCheck,
 Download,
 Radio,
 Copy,
 Check,
 Server,
 Loader2,
} from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
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
import { useSystemErrors, useResolveSystemError, useResolveAllSystemErrors } from '../../hooks/useAdmin';
import { getLocalizedErrorMessage } from '../../i18n/api-errors';
import { formatDateTime } from '../../i18n/format';
import { adminApi } from '../../services/api/admin';
import type { SystemError } from '../../types/admin';
import Pagination from '../../components/shared/Pagination';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

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

// ── Level Color Helpers ──
function levelColor(level: string) {
 if (level === 'critical') return 'border-destructive/40 text-destructive';
 if (level === 'error') return 'border-danger/40 text-danger';
 if (level === 'warn') return 'border-warning/40 text-warning';
 return 'border-border text-muted-foreground';
}

function levelBg(level: string) {
 if (level === 'critical') return 'bg-destructive/10';
 if (level === 'error') return 'bg-danger/10';
 if (level === 'warn') return 'bg-warning/10';
 return 'bg-surface-2/50';
}

function levelLabel(level: string) {
 if (level === 'critical') return 'Critical';
 if (level === 'error') return 'Error';
 if (level === 'warn') return 'Warning';
 return level;
}
/** Localized level badge; the copyable diagnostics report keeps the raw level names. */
function LevelBadge({ level, className }: { level: string; className: string }) {
 const { t } = useTranslation('admin-system');
 const label =
 level === 'critical'
 ? t('systemErrors.levelCritical')
 : level === 'error'
 ? t('systemErrors.levelError')
 : level === 'warn'
 ? t('systemErrors.levelWarning')
 : level;
 return <Badge variant="outline" className={className}>{label}</Badge>;
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
 if (error.nodeId) lines.push(`**Node ID:** ${error.nodeId}`);
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
// Reuses the shared admin EventSource hub (no second socket).
function useSseStatus() {
 const [status, setStatus] = useState<
 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error'
 >('closed');

 useEffect(() => {
 // Lazy import avoids circular deps with admin page bundle
 let unsub: (() => void) | undefined;
 import('../../services/api/admin-events')
 .then(({ createAdminEventsStream }) => {
 unsub = createAdminEventsStream(
 () => {
 /* status-only subscriber — cache updates come from AppLayout useSseAdminEvents */
 },
 (s) => setStatus(s),
 );
 })
 .catch(() => setStatus('error'));
 return () => {
 unsub?.();
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
 const { t } = useTranslation('admin-system');
 const metadata = error.metadata || {};
 const metadataEntries = Object.entries(metadata);
 const hasMetadata = metadataEntries.length > 0;
 const { copiedId, copy } = useCopyToClipboard();
 const isCopied = copiedId === error.id;

return (
 <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
 <DialogContent size="xl">
 <DialogHeader
 icon={<Bug className="h-4 w-4" />}
 iconClassName={levelBg(error.level)}
 >
 <DialogTitle>{error.component}</DialogTitle>
 <DialogDescription>{error.id}</DialogDescription>
 </DialogHeader>

 <DialogBody className="space-y-5">
 <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
 <div className="space-y-1">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.level')}</span>
 <LevelBadge level={error.level} className={`text-[11px] ${levelColor(error.level)}`} />
 </div>
 <div className="space-y-1">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.status')}</span>
 <Badge variant={error.resolved ? 'outline' : 'secondary'} className={`text-[11px] ${error.resolved ? 'border-success/40 text-success' : ''}`}>
 {error.resolved ? t('systemErrors.resolved') : t('systemErrors.unresolved')}
 </Badge>
 </div>
 <div className="space-y-1">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.nodeId')}</span>
 <span className="block truncate font-mono text-[11px]" title={error.nodeId ?? t('systemErrors.notAvailable')}>
 {error.nodeId ? (
 <span className="flex items-center gap-1 text-primary">
 <Server className="h-3 w-3" />
 {error.nodeId}
 </span>
 ) : (
 <span className="text-muted-foreground">{t('systemErrors.notAvailable')}</span>
 )}
 </span>
 </div>
 <div className="space-y-1">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.requestId')}</span>
 <span className="block truncate font-mono text-[11px] text-muted-foreground" title={error.requestId ?? 'n/a'}>
 {error.requestId ?? 'n/a'}
 </span>
 </div>
 <div className="space-y-1">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.userId')}</span>
 <span className="block truncate font-mono text-[11px] text-muted-foreground" title={error.userId ?? 'n/a'}>
 {error.userId ?? 'n/a'}
 </span>
 </div>
 </div>

 <div className="space-y-1">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.timestamp')}</span>
 <div className="flex items-center gap-2 text-sm text-foreground">
 <Clock className="h-3.5 w-3.5 text-muted-foreground" />
 {formatDateTime(error.createdAt)}
 </div>
 </div>

 <div className="space-y-1">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.tableMessage')}</span>
 <div className="rounded-lg border border-border/30 bg-surface-2/40 px-3 py-2 text-sm text-foreground">
 {error.message}
 </div>
 </div>

 {error.stack && (
 <div className="space-y-1">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.stackTrace')}</span>
 <pre className="max-h-64 overflow-auto rounded-lg border border-border/30 bg-surface-0 p-3 font-mono text-[11px] leading-relaxed text-foreground">
 {error.stack}
 </pre>
 </div>
 )}

 {hasMetadata && (
 <div className="space-y-2">
 <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
 {t('systemErrors.metadataCount', { count: metadataEntries.length })}
 </span>
 <div className="overflow-hidden rounded-lg border border-border/30 bg-surface-2/40">
 <table className="w-full text-xs">
 <thead>
 <tr className="border-b border-border/30 text-left">
 <th className="px-3 py-2 font-semibold text-muted-foreground">{t('systemErrors.metadataKey')}</th>
 <th className="px-3 py-2 font-semibold text-muted-foreground">{t('systemErrors.metadataValue')}</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border/30">
 {metadataEntries.map(([key, value]) => (
 <tr key={key} className="transition-colors hover:bg-surface-2/60">
 <td className="px-3 py-2 font-mono text-foreground">{key}</td>
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
 <div className="rounded-lg border border-dashed border-border/30 bg-surface-2/20 px-4 py-3 text-center text-xs text-muted-foreground">
 {t('systemErrors.noMetadata')}
 </div>
 )}
 </DialogBody>

 <DialogFooter>
 <Button
 variant="outline"
 size="sm"
 className="gap-1.5"
 onClick={() => copy(formatErrorForCopy(error), error.id)}
 >
 {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
 {isCopied ? t('systemErrors.copied') : t('systemErrors.copyForAi')}
 </Button>
 <Button variant="outline" size="sm" onClick={onClose}>
 {t('common:actions.close')}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
);

}

// ── Error Row ──
function ErrorRow({
 error,
 onView,
 onResolve,
 isResolving,
}: {
 error: SystemError;
 onView: () => void;
 onResolve: () => void;
 isResolving: boolean;
}) {
 const { t } = useTranslation('admin-system');
 const { copiedId, copy } = useCopyToClipboard();
 const isCopied = copiedId === error.id;
 return (
 <div className="group relative px-5 py-3.5 text-sm transition-colors hover:bg-surface-2/30">
 {/* Desktop: grid */}
 <div className="hidden grid-cols-12 items-center gap-3 md:grid">
 <div className="col-span-2 min-w-0">
 <LevelBadge level={error.level} className={`text-[11px] ${levelColor(error.level)}`} />
 </div>
 <div className="col-span-2 truncate font-medium text-foreground">
 {error.component}
 </div>
 <div className="col-span-1 truncate font-mono text-[10px] text-muted-foreground">
 {error.nodeId ? (
 <span className="inline-flex items-center gap-1" title={t('systemErrors.nodeTitle', { nodeId: error.nodeId })}>
 <Server className="h-3 w-3 shrink-0" />
 <span className="truncate">{error.nodeId}</span>
 </span>
 ) : (
 <span className="text-muted-foreground/40">—</span>
 )}
 </div>
 <div className="col-span-3 truncate text-muted-foreground">
 {error.message}
 </div>
 <div className="col-span-2 truncate font-mono text-xs text-muted-foreground">
 {formatDateTime(error.createdAt)}
 </div>
 <div className="col-span-2 flex items-center justify-end gap-2">
 {!error.resolved && (
 <Button
 variant="ghost"
 size="sm"
 className="h-7 gap-1 text-[11px] text-success hover:text-success"
 onClick={(e) => {
 e.stopPropagation();
 onResolve();
 }}
 disabled={isResolving}
 >
 <CheckCircle2 className="h-3.5 w-3.5" />
 {t('systemErrors.resolve')}
 </Button>
 )}
 <button
 className="rounded-md p-1 text-muted-foreground opacity-0 transition-colors hover:bg-primary/5 hover:text-primary sm:group-hover:opacity-100"
 onClick={(e) => {
 e.stopPropagation();
 copy(formatErrorForCopy(error), error.id);
 }}
 title={isCopied ? t('systemErrors.copied') : t('systemErrors.copyForAi')}
 >
 {isCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
 </button>
 <button
 className="rounded-md p-1 text-muted-foreground opacity-0 transition-colors hover:bg-primary/5 hover:text-primary sm:group-hover:opacity-100"
 onClick={onView}
 title={t('systemErrors.viewDetails')}
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
 <LevelBadge level={error.level} className={`text-[10px] ${levelColor(error.level)}`} />
 <span className="truncate font-medium text-foreground">
 {error.component}
 </span>
 </div>
 <div className="mt-0.5 truncate text-xs text-muted-foreground">
 {error.message}
 </div>
 </div>
 <div className="flex items-center gap-2">
 <span className="text-[11px] text-muted-foreground">
 {formatDateTime(error.createdAt)}
 </span>
 <button
 className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
 onClick={(e) => {
 e.stopPropagation();
 copy(formatErrorForCopy(error), error.id);
 }}
 title={isCopied ? t('systemErrors.copied') : t('systemErrors.copyForAi')}
 >
 {isCopied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
 </button>
 <button
 className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
 onClick={onView}
 title={t('systemErrors.viewDetails')}
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
 className="h-7 gap-1 text-[11px] text-success hover:text-success"
 onClick={(e) => {
 e.stopPropagation();
 onResolve();
 }}
 disabled={isResolving}
 >
 <CheckCircle2 className="h-3.5 w-3.5" />
 {t('systemErrors.resolve')}
 </Button>
 </div>
 )}
 </div>
 </div>
 );
}

// ── Export Modal ──
const EXPORT_RANGES = [
 { value: '1h', hours: 1 },
 { value: '6h', hours: 6 },
 { value: '24h', hours: 24 },
 { value: '7d', hours: 24 * 7 },
 { value: '30d', hours: 24 * 30 },
 { value: 'all', hours: null },
] as const;

/** Display label for an export time range. */
function exportRangeLabel(t: TFunction<'admin-system'>, value: string): string {
 switch (value) {
 case '1h': return t('systemErrors.exportRange1h');
 case '6h': return t('systemErrors.exportRange6h');
 case '24h': return t('systemErrors.exportRange24h');
 case '7d': return t('systemErrors.exportRange7d');
 case '30d': return t('systemErrors.exportRange30d');
 case 'all': return t('systemErrors.exportRangeAll');
 default: return value;
 }
}

type ExportRangeValue = (typeof EXPORT_RANGES)[number]['value'];

function ExportErrorsModal({
 filters,
 onClose,
}: {
 filters: { level?: string; component?: string; nodeId?: string; resolved?: boolean };
 onClose: () => void;
}) {
 const { t } = useTranslation('admin-system');
 const [range, setExportRange] = useState<ExportRangeValue>('24h');
 const [format, setFormat] = useState<'markdown' | 'json'>('markdown');
 const [isExporting, setIsExporting] = useState(false);
 const [error, setError] = useState<string | null>(null);

 const handleExport = async () => {
  setIsExporting(true);
  setError(null);
  try {
   const now = new Date();
   const selected = EXPORT_RANGES.find((r) => r.value === range);
   const from = selected?.hours ? new Date(now.getTime() - selected.hours * 3600_000).toISOString() : undefined;
   const payload = await adminApi.exportSystemErrors({
    level: filters.level || undefined,
    component: filters.component || undefined,
    nodeId: filters.nodeId || undefined,
    resolved: filters.resolved,
    from,
    to: now.toISOString(),
    format,
   });
   const mime = format === 'json' ? 'application/json' : 'text/markdown';
   const ext = format === 'json' ? 'json' : 'md';
   const blob = new Blob([payload], { type: mime });
   const url = URL.createObjectURL(blob);
   const link = document.createElement('a');
   link.href = url;
   link.download = `system-errors-${range}-${Date.now()}.${ext}`;
   document.body.appendChild(link);
   link.click();
   link.remove();
   URL.revokeObjectURL(url);
   onClose();
  } catch (err) {
   setError(getLocalizedErrorMessage(err));
  } finally {
   setIsExporting(false);
  }
 };
 const activeFilterChips = [
  filters.level ? t('systemErrors.chipLevel', { value: filters.level }) : null,
  filters.component ? t('systemErrors.chipComponent', { value: filters.component }) : null,
  filters.nodeId ? t('systemErrors.chipNode', { value: filters.nodeId }) : null,
  filters.resolved !== undefined
   ? t('systemErrors.chipStatus', {
      value: filters.resolved ? t('systemErrors.statusResolvedLower') : t('systemErrors.statusUnresolvedLower'),
     })
   : null,
 ].filter(Boolean) as string[];

 return (
  <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
   <DialogContent size="md">
    <DialogHeader
     icon={<Download className="h-4 w-4" />}
    >
     <DialogTitle>{t('systemErrors.exportTitle')}</DialogTitle>
     <DialogDescription>
      {t('systemErrors.exportDescription')}
     </DialogDescription>
    </DialogHeader>

    <DialogBody className="space-y-5">
     <div className="space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.timeRange')}</span>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
       {EXPORT_RANGES.map((option) => (
        <Button
         key={option.value}
         variant={range === option.value ? 'default' : 'outline'}
         size="sm"
         onClick={() => setExportRange(option.value)}
        >
         {exportRangeLabel(t, option.value)}
        </Button>
       ))}
      </div>
     </div>

     <div className="space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('systemErrors.format')}</span>
      <Select value={format} onValueChange={(next) => setFormat(next as 'markdown' | 'json')}>
       <SelectTrigger className="w-full border-border/40">
        <SelectValue />
       </SelectTrigger>
       <SelectContent>
        <SelectItem value="markdown">{t('systemErrors.formatMarkdown')}</SelectItem>
        <SelectItem value="json">{t('systemErrors.formatJson')}</SelectItem>
       </SelectContent>
      </Select>
     </div>

     {activeFilterChips.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/30 bg-surface-2/40 px-3 py-2">
       <span className="text-[11px] text-muted-foreground">{t('systemErrors.currentFilters')}</span>
       {activeFilterChips.map((chip) => (
        <Badge key={chip} variant="outline" className="text-[10px]">{chip}</Badge>
       ))}
      </div>
     ) : (
      <p className="text-xs text-muted-foreground">{t('systemErrors.noFilters')}</p>
     )}

     {error && (
      <p className="text-xs text-destructive">{error}</p>
     )}
    </DialogBody>

    <DialogFooter>
     <Button variant="outline" size="sm" onClick={onClose} disabled={isExporting}>
      {t('common:actions.cancel')}
     </Button>
     <Button size="sm" onClick={handleExport} disabled={isExporting} className="gap-1.5">
      {isExporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {isExporting ? t('systemErrors.exporting') : t('systemErrors.export')}
     </Button>
    </DialogFooter>
   </DialogContent>
  </Dialog>
 );
}

// ── Resolve All Confirm Modal ──
function ResolveAllModal({
 unresolvedCount,
 filtersSummary,
 isPending,
 error,
 onConfirm,
 onClose,
}: {
 unresolvedCount: number | null;
 filtersSummary: string[];
 isPending: boolean;
 error: string | null;
 onConfirm: () => void;
 onClose: () => void;
}) {
 const { t } = useTranslation('admin-system');
 return (
  <Dialog open onOpenChange={(open) => { if (!open && !isPending) onClose(); }}>
   <DialogContent size="sm">
    <DialogHeader
     icon={<CheckCheck className="h-4 w-4" />}
    >
     <DialogTitle>{t('systemErrors.resolveAllTitle')}</DialogTitle>
     <DialogDescription>
      {unresolvedCount !== null
       ? t('systemErrors.resolveAllConfirm', { count: unresolvedCount })
       : t('systemErrors.resolveAllConfirmAll')}
     </DialogDescription>
    </DialogHeader>

    <DialogBody className="space-y-3">
     {filtersSummary.length > 0 ? (
      <div className="flex flex-wrap items-center gap-2">
       <span className="text-[11px] text-muted-foreground">{t('systemErrors.matchingFilters')}</span>
       {filtersSummary.map((chip) => (
        <Badge key={chip} variant="outline" className="text-[10px]">{chip}</Badge>
       ))}
      </div>
     ) : (
      <p className="text-xs text-muted-foreground">{t('systemErrors.noFiltersAll')}</p>
     )}
     <p className="text-xs text-muted-foreground">{t('systemErrors.cannotUndo')}</p>
     {error && <p className="text-xs text-destructive">{error}</p>}
    </DialogBody>

    <DialogFooter>
     <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
      {t('common:actions.cancel')}
     </Button>
     <Button size="sm" onClick={onConfirm} disabled={isPending} className="gap-1.5">
      {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
      {isPending ? t('systemErrors.resolving') : t('systemErrors.resolveAll')}
     </Button>
    </DialogFooter>
   </DialogContent>
  </Dialog>
 );
}

// ── Main Page ──
function SystemErrorsPage() {
 const { t } = useTranslation('admin-system');
 const [page, setPage] = useState(1);
 const [level, setLevel] = useState('');
 const [component, setComponent] = useState('');
 const [nodeId, setNodeId] = useState('');
 const [resolved, setResolved] = useState('');
 const [defaultRange] = useState(buildDefaultRange);
 const [from, setFrom] = useState(defaultRange.from);
 const [to, setTo] = useState(defaultRange.to);
 const [range, setRange] = useState('24h');
 const [selectedError, setSelectedError] = useState<SystemError | null>(null);
 const [showExport, setShowExport] = useState(false);
 const [showResolveAll, setShowResolveAll] = useState(false);
 const [resolveAllError, setResolveAllError] = useState<string | null>(null);

 const sseStatus = useSseStatus();
 const isLive = sseStatus === 'connected';

 const resolvedBool = resolved === '' ? undefined : resolved === 'true';

 const { data, isLoading } = useSystemErrors({
 page,
 limit: pageSize,
 level: level || undefined,
 component: component || undefined,
 nodeId: nodeId || undefined,
 resolved: resolvedBool,
 from: from ? new Date(from).toISOString() : undefined,
 to: to ? new Date(to).toISOString() : undefined,
 });

 const resolveMutation = useResolveSystemError();
 const resolveAllMutation = useResolveAllSystemErrors();

 const errors = data?.errors ?? [];
 const pagination = data?.pagination;
 const hasFilters = level || component || nodeId || resolved || from || to;

 const clearFilters = () => {
 setLevel('');
 setComponent('');
 setNodeId('');
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

 const resolveAllFiltersSummary = [
 level ? t('systemErrors.chipLevel', { value: level }) : null,
 component ? t('systemErrors.chipComponent', { value: component }) : null,
 nodeId ? t('systemErrors.chipNode', { value: nodeId }) : null,
 resolved === 'false' ? t('systemErrors.chipStatus', { value: t('systemErrors.statusUnresolvedLower') }) : null,
 range ? t('systemErrors.chipRange', { value: range }) : null,
 ].filter(Boolean) as string[];
 const resolveAllUnresolvedCount = resolved === 'false' ? (pagination?.total ?? null) : null;
 const isResolveAllDisabled = resolved === 'true';

 const handleResolveAllConfirm = () => {
  setResolveAllError(null);
  resolveAllMutation.mutate(
   {
    level: level || undefined,
    component: component || undefined,
    nodeId: nodeId || undefined,
    resolved: resolved || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
   },
   {
    onSuccess: () => {
     setShowResolveAll(false);
    },
    onError: (err) => {
     setResolveAllError(getLocalizedErrorMessage(err));
    },
   },
  );
 };

 return (
 <div className="space-y-5">
 <TabHeader
 icon={Bug}
 title={t('systemErrors.title')}
 description={t('systemErrors.description')}
 actions={
 <div className="flex flex-wrap items-center gap-2">
 {isLive && (
 <Badge variant="outline" className="gap-1.5 border-success/40 text-success text-xs">
 <span className="relative flex h-2 w-2">
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
 <span className="relative inline-flex h-2 w-2 rounded-full bg-success/50" />
 </span>
 {t('systemErrors.live')}
 </Badge>
 )}
 {!isLive && (
 <Badge variant="outline" className="gap-1.5 text-xs text-muted-foreground">
 <Radio className="h-3 w-3" />
 {t('systemErrors.offline')}
 </Badge>
 )}
 <Badge variant="outline" className="text-xs">
 {t('systemErrors.errorCount', { count: data?.pagination?.total ?? errors.length })}
 </Badge>
 <Button variant="outline" size="sm" onClick={() => setShowExport(true)} className="gap-1.5">
 <Download className="h-3.5 w-3.5" />
 {t('systemErrors.export')}
 </Button>
 <Button
  variant="outline"
  size="sm"
  onClick={() => { setResolveAllError(null); setShowResolveAll(true); }}
  disabled={isResolveAllDisabled}
  className="gap-1.5"
  title={isResolveAllDisabled ? t('systemErrors.resolveAllDisabledTitle') : t('systemErrors.resolveAllTooltip')}
 >
 <CheckCheck className="h-3.5 w-3.5" />
 {t('systemErrors.resolveAll')}
 </Button>
 <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1.5">
 <RotateCcw className="h-3.5 w-3.5" />
 {t('systemErrors.clear')}
 </Button>
 </div>
 }
 variant="danger"
 />

 {/* ── Filters ── */}
 <div className="overflow-hidden rounded-xl border border-border/30 bg-card/60 p-4">
 <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
 <Search className="h-3.5 w-3.5" />
 {t('systemErrors.filters')}
 </div>
 <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">{t('systemErrors.level')}</span>
 <Select
 value={level || 'all'}
 onValueChange={(next) => {
 setLevel(next === 'all' ? '' : next);
 setPage(1);
 }}
 >
 <SelectTrigger className="w-full border-border/40">
 <SelectValue placeholder={t('systemErrors.allLevels')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">{t('systemErrors.allLevels')}</SelectItem>
 <SelectItem value="error">{t('systemErrors.levelError')}</SelectItem>
 <SelectItem value="warn">{t('systemErrors.levelWarning')}</SelectItem>
 <SelectItem value="critical">{t('systemErrors.levelCritical')}</SelectItem>
 </SelectContent>
 </Select>
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">{t('systemErrors.component')}</span>
 <Input value={component} onChange={(e) => { setComponent(e.target.value); setPage(1); }} placeholder={t('systemErrors.componentPlaceholder')} className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">{t('systemErrors.node')}</span>
 <Input value={nodeId} onChange={(e) => { setNodeId(e.target.value); setPage(1); }} placeholder={t('systemErrors.nodePlaceholder')} className="border-border/40" />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">{t('systemErrors.status')}</span>
 <Select
 value={resolved === '' ? 'all' : resolved === 'true' ? 'resolved' : 'unresolved'}
 onValueChange={(next) => {
 if (next === 'all') setResolved('');
 else if (next === 'resolved') setResolved('true');
 else setResolved('false');
 setPage(1);
 }}
 >
 <SelectTrigger className="w-full border-border/40">
 <SelectValue placeholder={t('systemErrors.all')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="all">{t('systemErrors.all')}</SelectItem>
 <SelectItem value="resolved">{t('systemErrors.resolved')}</SelectItem>
 <SelectItem value="unresolved">{t('systemErrors.unresolved')}</SelectItem>
 </SelectContent>
 </Select>
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">{t('systemErrors.from')}</span>
 <Input
 type="datetime-local"
 value={from}
 onChange={(e) => { setFrom(e.target.value); setRange(''); setPage(1); }}
 className="border-border/40"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">{t('systemErrors.to')}</span>
 <Input
 type="datetime-local"
 value={to}
 onChange={(e) => { setTo(e.target.value); setRange(''); setPage(1); }}
 className="border-border/40"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">{t('systemErrors.quickRange')}</span>
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
 <SelectTrigger className="w-full border-border/40">
 <SelectValue placeholder={t('systemErrors.custom')} />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="custom">{t('systemErrors.custom')}</SelectItem>
 <SelectItem value="1h">{t('systemErrors.range1h')}</SelectItem>
 <SelectItem value="6h">{t('systemErrors.range6h')}</SelectItem>
 <SelectItem value="24h">{t('systemErrors.range24h')}</SelectItem>
 <SelectItem value="7d">{t('systemErrors.range7d')}</SelectItem>
 </SelectContent>
 </Select>
 </label>
 </div>

 {/* Active filter chips */}
 {hasFilters && (
 <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/30 pt-3">
 <span className="text-[11px] text-muted-foreground">{t('activeLabel')}</span>
 {level && <Badge variant="outline" className="text-[10px]">{t('systemErrors.chipLevel', { value: level })}</Badge>}
 {component && <Badge variant="outline" className="text-[10px]">{t('systemErrors.chipComponent', { value: component })}</Badge>}
 {nodeId && <Badge variant="outline" className="text-[10px]">{t('systemErrors.chipNode', { value: nodeId })}</Badge>}
 {resolved && <Badge variant="outline" className="text-[10px]">{t('systemErrors.chipStatus', { value: resolved === 'true' ? t('systemErrors.statusResolvedLower') : t('systemErrors.statusUnresolvedLower') })}</Badge>}
 {range && <Badge variant="outline" className="text-[10px]">{t('systemErrors.chipRange', { value: range })}</Badge>}
 </div>
 )}
 </div>

 {/* ── Error Table ── */}
 {isLoading ? (
 <div className="overflow-hidden rounded-xl border border-border/30 bg-card/80 p-4">
 {/* Desktop header */}
 <div className="hidden border-b border-border/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-12 md:gap-3">
 <div className="col-span-2">{t('systemErrors.tableLevel')}</div>
 <div className="col-span-2">{t('systemErrors.tableComponent')}</div>
 <div className="col-span-1">{t('systemErrors.tableNode')}</div>
 <div className="col-span-3">{t('systemErrors.tableMessage')}</div>
 <div className="col-span-2">{t('systemErrors.tableTimestamp')}</div>
 <div className="col-span-2 text-right">{t('systemErrors.tableActions')}</div>
 </div>
 <TabLoadingState rows={8} />
 </div>
 ) : errors.length > 0 ? (
 <div className="overflow-hidden rounded-xl border border-border/30 bg-card/80">
 {/* Desktop header */}
 <div className="hidden border-b border-border/30 px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-12 md:gap-3">
 <div className="col-span-2">{t('systemErrors.tableLevel')}</div>
 <div className="col-span-2">{t('systemErrors.tableComponent')}</div>
 <div className="col-span-1">{t('systemErrors.tableNode')}</div>
 <div className="col-span-3">{t('systemErrors.tableMessage')}</div>
 <div className="col-span-2">{t('systemErrors.tableTimestamp')}</div>
 <div className="col-span-2 text-right">{t('systemErrors.tableActions')}</div>
 </div>
 <div className="divide-y divide-border/30">
 {errors.map((error) => (
 <ErrorRow
 key={error.id}
 error={error}
 onView={() => setSelectedError(error)}
 onResolve={() => handleResolve(error.id)}
 isResolving={resolveMutation.isPending && resolveMutation.variables === error.id}
 />
 ))}
 </div>
 {pagination && pagination.totalPages > 1 && (
 <div className="flex justify-center border-t border-border/30 pt-3">
 <Pagination
 page={pagination.page}
 totalPages={pagination.totalPages}
 onPageChange={setPage}
 />
 </div>
 )}
 </div>
 ) : (
 <TabEmptyState
 title={t('systemErrors.emptyTitle')}
 description={hasFilters ? t('systemErrors.emptyFilteredDescription') : t('systemErrors.emptyDescription')}
 />
 )}

 {/* ── Error Detail Modal ── */}
 {selectedError && (
 <ErrorDetailModal error={selectedError} onClose={() => setSelectedError(null)} />
 )}

 {/* ── Export Modal ── */}
 {showExport && (
  <ExportErrorsModal
   filters={{ level, component, nodeId, resolved: resolvedBool }}
   onClose={() => setShowExport(false)}
  />
 )}

 {/* ── Resolve All Modal ── */}
 {showResolveAll && (
  <ResolveAllModal
   unresolvedCount={resolveAllUnresolvedCount}
   filtersSummary={resolveAllFiltersSummary}
   isPending={resolveAllMutation.isPending}
   error={resolveAllError}
   onConfirm={handleResolveAllConfirm}
   onClose={() => { if (!resolveAllMutation.isPending) setShowResolveAll(false); }}
  />
 )}
 </div>
 );
}

export default SystemErrorsPage;
