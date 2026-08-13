import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@/csync';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Activity,
  Play,
  Square,
  RotateCcw,
  Skull,
  FileText,
  Trash2,
  Upload,
  Download,
  Settings,
  Database,
  Shield,
  type LucideIcon,
} from 'lucide-react';
import { qk } from '../../../lib/queryKeys';
import { serversApi } from '../../../services/api/servers';
import type { ServerActivityLogEntry, ServerActivityLogResponse } from '../../../types/server';
import ServerTabCard from './ServerTabCard';
import TabHeader from './TabHeader';
import TabEmptyState from './TabEmptyState';
import TabErrorState from './TabErrorState';
import TabLoadingState from './TabLoadingState';

// ── Formatting ──────────────────────────────────────────────────────────────

const formatDateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

const formatActionLabel = (action: string): string =>
  action
    .replace(/^server\./, '')
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (s) => s.toUpperCase())
    .trim();

/** Keys that are bookkeeping / already shown elsewhere — never dump raw. */
const HIDDEN_DETAIL_KEYS = new Set([
  '_meta',
  '_request',
  '_actor',
  '_actor.username',
  '_actor.email',
  '_actor.userId',
  'ip',
  'userAgent',
  // Snapshot noise that drowns the real change for power actions
  'serverUuid',
  'templateId',
  'templateSlug',
  'ownerId',
  'nodeId',
  'allocatedMemoryMb',
  'allocatedCpuCores',
  'allocatedDiskMb',
]);

const isHiddenKey = (key: string) =>
  HIDDEN_DETAIL_KEYS.has(key) || key.startsWith('_actor') || key.startsWith('_');

type DetailBag = Record<string, unknown>;

function coerceDetails(raw: unknown): DetailBag {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as DetailBag;
      }
      return { value: raw };
    } catch {
      return { value: raw };
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as DetailBag;
  }
  return { value: raw };
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…`;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]/g, ' ')
    .replace(/\b\w/g, (s) => s.toUpperCase());
}

function formatDetailValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (/^c[a-z0-9]{20,}$/i.test(value) || /^[0-9a-f-]{36}$/i.test(value)) {
      return shortId(value);
    }
    if (value.length > 80) return `${value.slice(0, 80)}…`;
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    if (value.every((v) => typeof v !== 'object')) {
      return value.slice(0, 6).map(String).join(', ') + (value.length > 6 ? ` +${value.length - 6}` : '');
    }
    return `${value.length} items`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    return keys.length ? `{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? '…' : ''}}` : '{}';
  }
  return String(value);
}

type ActionTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

function getActionTone(action: string): ActionTone {
  const a = action.toLowerCase();
  if (/(delete|kill|suspend|ban|destroy|remove)/.test(a)) return 'danger';
  if (/(stop|restart|reinstall|force)/.test(a)) return 'warning';
  if (/(start|create|install|accept|unsuspend|enable)/.test(a)) return 'success';
  if (/(update|edit|upload|write|config|variable)/.test(a)) return 'info';
  return 'neutral';
}

function getActionIcon(action: string): LucideIcon {
  const a = action.toLowerCase();
  if (a.includes('start') && !a.includes('restart')) return Play;
  if (a.includes('stop')) return Square;
  if (a.includes('restart')) return RotateCcw;
  if (a.includes('kill')) return Skull;
  if (a.includes('delete') || a.includes('remove')) return Trash2;
  if (a.includes('upload')) return Upload;
  if (a.includes('download') || a.includes('read') || a.includes('file')) return FileText;
  if (a.includes('database')) return Database;
  if (a.includes('permission') || a.includes('access') || a.includes('invite')) return Shield;
  if (a.includes('update') || a.includes('config') || a.includes('variable')) return Settings;
  if (a.includes('backup')) return Download;
  return Activity;
}

const TONE_BADGE: Record<ActionTone, string> = {
  success: 'bg-success/15 text-success border-success/25',
  danger: 'bg-destructive/15 text-destructive border-destructive/25',
  warning: 'bg-warning/15 text-warning border-warning/25',
  info: 'bg-info/15 text-info border-info/25',

  neutral: 'bg-surface-2 text-muted-foreground border-border/50',
};

const TONE_AVATAR: Record<ActionTone, string> = {
  success: 'bg-success/15 text-success',
  danger: 'bg-destructive/15 text-destructive',
  warning: 'bg-warning/15 text-warning',
  info: 'bg-info/15 text-info',

  neutral: 'bg-primary/10 text-primary',
};

/** Build a one-line human summary from the most useful detail fields. */
function buildSummary(_action: string, details: DetailBag): string | null {
  const parts: string[] = [];
  const prev = details.previousStatus ?? details.fromStatus;
  const next = details.newStatus ?? details.toStatus ?? details.status;
  if (prev && next && prev !== next) {
    parts.push(`${String(prev)} → ${String(next)}`);
  } else if (next && typeof next === 'string') {
    parts.push(`Status: ${next}`);
  }

  const path = details.path ?? details.filePath ?? details.file;
  if (typeof path === 'string' && path.length) {
    parts.push(path.length > 48 ? `…${path.slice(-48)}` : path);
  }

  if (details.force === true) parts.push('Forced');
  if (typeof details.powerResult === 'string') parts.push(details.powerResult);
  if (typeof details.serverName === 'string') parts.push(details.serverName);
  if (typeof details.nodeName === 'string') parts.push(`Node: ${details.nodeName}`);
  if (typeof details.hostPort === 'number' || typeof details.primaryPort === 'number') {
    const port = details.hostPort ?? details.primaryPort;
    parts.push(`Port ${port}`);
  }
  if (typeof details.name === 'string' && !parts.includes(details.name)) {
    parts.push(details.name);
  }

  // Fallback: first public scalar field
  if (parts.length === 0) {
    for (const [k, v] of Object.entries(details)) {
      if (isHiddenKey(k)) continue;
      if (v == null || typeof v === 'object') continue;
      parts.push(`${humanizeKey(k)}: ${formatDetailValue(v)}`);
      if (parts.length >= 2) break;
    }
  }

  return parts.length ? parts.join(' · ') : null;
}

function publicDetailEntries(details: DetailBag): [string, unknown][] {
  // Prefer high-signal keys first
  const priority = [
    'previousStatus',
    'newStatus',
    'status',
    'path',
    'filePath',
    'force',
    'powerResult',
    'serverName',
    'nodeName',
    'nodeAddress',
    'primaryPort',
    'hostPort',
    'networkMode',
    'templateName',
    'name',
    'wasRunning',
  ];
  const entries = Object.entries(details).filter(([k]) => !isHiddenKey(k));
  entries.sort(([a], [b]) => {
    const ia = priority.indexOf(a);
    const ib = priority.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return entries;
}

// ── Row ─────────────────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: ServerActivityLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const details = useMemo(
    () => coerceDetails((entry as any).details ?? (entry as any).metadata),
    [entry],
  );
  const publicEntries = useMemo(() => publicDetailEntries(details), [details]);
  const summary = useMemo(() => buildSummary(entry.action, details), [entry.action, details]);
  const tone = getActionTone(entry.action);
  const Icon = getActionIcon(entry.action);
  const actor =
    entry.user?.username ?? entry.user?.name ?? entry.user?.email ?? 'System';
  const initial = (actor[0] ?? 'S').toUpperCase();
  const hasExpandable = publicEntries.length > 0;

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border/40 bg-card/40 transition-colors hover:border-border hover:bg-card/70">
      <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors group-hover:bg-primary/50" />

      <div className="flex items-start gap-3 px-3 py-2.5 sm:px-4">
        {/* Actor avatar */}
        <div
          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${TONE_AVATAR[tone]}`}
          title={actor}
        >
          {initial}
        </div>

        {/* Main content — min-w-0 is critical so flex children can shrink/wrap */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-foreground">{actor}</span>
            <span
              className={`inline-flex max-w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[10px] font-medium ${TONE_BADGE[tone]}`}
            >
              <Icon className="h-3 w-3 shrink-0 opacity-80" />
              <span className="truncate">{formatActionLabel(entry.action)}</span>
            </span>
          </div>

          {summary && (
            <p className="break-words text-[11px] leading-snug text-muted-foreground">{summary}</p>
          )}

          {/* Compact chips for top fields when expanded is closed and we have a few keys */}
          {!expanded && publicEntries.length > 0 && !summary && (
            <div className="flex flex-wrap gap-1">
              {publicEntries.slice(0, 4).map(([k, v]) => (
                <span
                  key={k}
                  className="inline-flex max-w-full items-center gap-1 truncate rounded bg-surface-2/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                >
                  <span className="font-medium text-muted-foreground/80">{humanizeKey(k)}</span>
                  <span className="truncate text-foreground/80">{formatDetailValue(v)}</span>
                </span>
              ))}
            </div>
          )}

          {expanded && hasExpandable && (
            <dl className="mt-1.5 grid gap-1 rounded-md border border-border/40 bg-surface-1/50 p-2 sm:grid-cols-2">
              {publicEntries.map(([k, v]) => (
                <div key={k} className="min-w-0 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                  <dt className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                    {humanizeKey(k)}
                  </dt>
                  <dd className="min-w-0 break-words font-mono text-[11px] text-foreground/90">
                    {renderExpandedValue(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {/* Timestamp + expand */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <time
            className="whitespace-nowrap text-[10px] tabular-nums text-muted-foreground/70"
            dateTime={entry.timestamp}
            title={entry.timestamp}
          >
            {formatDateTime(entry.timestamp)}
          </time>
          {hasExpandable && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              aria-expanded={expanded}
            >
              {expanded ? 'Less' : 'Details'}
              <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function renderExpandedValue(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return <span className="italic text-muted-foreground/50">null</span>;
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    return <span className="tabular-nums">{value}</span>;
  }
  if (typeof value === 'string') {
    return <span className="break-all">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="italic text-muted-foreground/50">empty</span>;
    return (
      <ul className="list-inside list-disc space-y-0.5">
        {value.slice(0, 12).map((item, i) => (
          <li key={i} className="break-words">
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </li>
        ))}
        {value.length > 12 && <li className="text-muted-foreground">+{value.length - 12} more</li>}
      </ul>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([k]) => !isHiddenKey(k),
    );
    if (entries.length === 0) {
      return <span className="italic text-muted-foreground/50">empty</span>;
    }
    return (
      <div className="space-y-0.5">
        {entries.slice(0, 8).map(([k, v]) => (
          <div key={k} className="break-words">
            <span className="text-muted-foreground">{humanizeKey(k)}:</span>{' '}
            {formatDetailValue(v)}
          </div>
        ))}
        {entries.length > 8 && (
          <div className="text-muted-foreground">+{entries.length - 8} more fields</div>
        )}
      </div>
    );
  }
  return String(value);
}

// ── Tab ─────────────────────────────────────────────────────────────────────

interface Props {
  serverId: string;
}

export default function ServerActivityLogTab({ serverId }: Props) {
  const [page, setPage] = useState(1);
  const limit = 25;

  const { data, isLoading, isError, error } = useQuery<ServerActivityLogResponse>({
    queryKey: qk.serverActivity(serverId, { page, limit }),
    queryFn: () => serversApi.activity(serverId, { page, limit }),
    enabled: Boolean(serverId),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    placeholderData: (prev) => prev,
  });

  const items = Array.isArray(data?.data) ? data.data : [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-4">
      <TabHeader
        icon={Activity}
        title="Activity Log"
        description="Recent actions performed on this server."
      />

      <ServerTabCard>
        {isLoading ? (
          <TabLoadingState rows={5} />
        ) : isError ? (
          <TabErrorState
            message={error instanceof Error ? error.message : 'Failed to load activity log'}
          />
        ) : items.length === 0 ? (
          <TabEmptyState
            title="No activity recorded"
            description="Actions performed on this server will appear here."
          />
        ) : (
          <div className="space-y-1.5 overflow-x-hidden">
            {items.map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] tabular-nums text-muted-foreground/60">
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} entries
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="rounded-md border border-border/40 p-1 text-muted-foreground transition-colors hover:bg-surface-2/50 disabled:opacity-30"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1 || isLoading}
                title="Previous"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="rounded-md border border-border/40 p-1 text-muted-foreground transition-colors hover:bg-surface-2/50 disabled:opacity-30"
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= pagination.totalPages || isLoading}
                title="Next"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </ServerTabCard>
    </div>
  );
}
