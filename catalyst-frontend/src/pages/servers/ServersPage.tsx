import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import CreateServerModal from '../../components/servers/CreateServerModal';
import ServerControls from '../../components/servers/ServerControls';
import { useServers } from '../../hooks/useServers';
import { useAccessibleNodes } from '../../hooks/useNodes';
import type { Server, ServerListParams, ServerStatus } from '../../types/server';
import { useAuthStore } from '../../stores/authStore';
import {
  BracketLabel,
  GameChip,
  Meter,
  Segmented,
  StatusLed,
} from '../../components/deck/primitives';
import {
  ChevronRight,
  Globe,
  Search,
  Shield,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { cn } from '@/lib/utils';
import { serverStatusLabel } from '../../utils/constants';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import TabErrorState from '../../components/servers/tabs/TabErrorState';

type AccessFilter = 'all' | 'owned' | 'other';
type Tone = 'go' | 'hazard' | 'alarm' | 'idle' | 'info';

const STATE_TONE: Record<string, Tone> = {
  running: 'go',
  stopped: 'idle',
  crashed: 'alarm',
  error: 'alarm',
  suspended: 'hazard',
  archived: 'idle',
};
const toneForState = (status: string): Tone => STATE_TONE[status] ?? 'info';

/**
 * One grid template shared by the column header and every row, so columns line
 * up exactly at each breakpoint. Hidden cells drop out of grid placement, which
 * is why the visible order matches each template.
 *   base : identity · actions (one row)
 *   48rem deck : identity · address · state · actions
 *   80rem deck : identity · game · cpu · ram · disk · address · state · actions
 */
const GRID = 'server-list-grid grid items-center gap-x-3 gap-y-1.5';

function gameVersion(server: Server): string | undefined {
  const env = server.environment ?? {};
  return (
    env.MC_VERSION ||
    env.MINECRAFT_VERSION ||
    env.GAME_VERSION ||
    env.SERVER_VERSION ||
    env.VERSION
  );
}

/** Column labels, declared once and shared by header + metric clusters. */
function useColumns() {
  const { t } = useTranslation('servers');
  return {
    server: t('columns.server'),
    game: t('columns.game'),
    cpu: t('columns.cpu'),
    ram: t('columns.ram'),
    disk: t('columns.disk'),
    address: t('columns.address'),
    state: t('columns.state'),
    actions: t('columns.actions'),
  };
}

/** Load severity belongs on the reading; the bars are only a glance. */
function severityClass(value: number | null) {
  if (value == null) return undefined;
  return value >= 90 ? 'text-danger' : value >= 75 ? 'text-warning' : undefined;
}

function stateTextClass(status: ServerStatus) {
  if (status === 'crashed' || status === 'error') return 'text-danger';
  if (status === 'suspended') return 'text-warning';
  return 'text-muted-foreground';
}

function ServerRow({
  server,
  onMoveFocus,
}: {
  server: Server;
  onMoveFocus: (dir: 1 | -1) => void;
}) {
  const { t } = useTranslation('servers');
  const navigate = useNavigate();
  const running = server.status === 'running';

  const cpu = running && server.cpuPercent != null ? server.cpuPercent : null;
  const ramPct =
    running && server.memoryUsageMb != null && server.allocatedMemoryMb
      ? (server.memoryUsageMb / server.allocatedMemoryMb) * 100
      : null;
  const diskTotal = server.diskTotalMb ?? server.allocatedDiskMb ?? null;
  const diskPct =
    running && server.diskUsageMb != null && diskTotal
      ? (server.diskUsageMb / diskTotal) * 100
      : null;

  const host =
    server.connection?.host ??
    server.primaryIp ??
    server.node?.publicAddress ??
    server.node?.hostname ??
    '—';
  const port = server.connection?.port ?? server.primaryPort ?? '—';
  const game = server.template?.name ?? server.templateId;
  const version = gameVersion(server);

  return (
    <div
      role="listitem"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          onMoveFocus(1);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          onMoveFocus(-1);
        } else if (event.key === 'Enter') {
          navigate(`/servers/${server.id}`);
        }
      }}
      className={cn(
        GRID,
        'group relative rounded-sm py-1.5 pl-3 pr-3 outline-none transition-colors',
        'hover:bg-surface-1/40 focus-visible:bg-primary/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
      )}
    >
      {/* identity — on small screens this cell also carries address + state */}
      <div className="flex min-w-0 items-center gap-2">
        <StatusLed tone={toneForState(server.status)} pulse={running} />
        <GameChip game={game} className="hidden sm:inline-flex" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="flex min-w-0 items-baseline gap-2">
            <Link
              to={`/servers/${server.id}`}
              title={server.name}
              className="-my-1 inline-flex min-h-7 min-w-0 items-center font-display text-data font-semibold tracking-tight text-foreground hover:text-primary"
            >
              <span className="truncate">{server.name}</span>
            </Link>
            {version && (
              <Segmented muted className="server-list-xl shrink-0">
                {version}
              </Segmented>
            )}
          </span>
          <span className="server-list-mobile-meta flex items-center gap-2 text-micro text-muted-foreground">
            <span className="truncate font-mono">
              {host}:{port}
            </span>
            <span
              className={cn('shrink-0 text-micro uppercase', stateTextClass(server.status))}
            >
              {serverStatusLabel(t, server.status)}
            </span>
          </span>
        </div>
      </div>

      {/* game */}
      <span className="server-list-xl min-w-0">
        <span className="block truncate text-micro text-muted-foreground">{game ?? '—'}</span>
      </span>

      {/* live activity cluster — labelled by the column header, so the row
          carries only the reading (bars + value) to stay dense and aligned */}
      <span className="server-list-xl items-center justify-end gap-2">
        <Meter value={cpu} />
        <Segmented muted={cpu == null} className={cn('min-w-[3rem] text-right', severityClass(cpu))}>
          {cpu == null ? '—' : `${Math.round(cpu)}%`}
        </Segmented>
      </span>
      <span className="server-list-xl items-center justify-end gap-2">
        <Meter value={ramPct} />
        <Segmented muted={ramPct == null} className={cn('min-w-[3rem] text-right', severityClass(ramPct))}>
          {ramPct == null ? '—' : `${Math.round(ramPct)}%`}
        </Segmented>
      </span>
      <span className="server-list-xl items-center justify-end gap-2">
        <Meter value={diskPct} />
        <Segmented muted={diskPct == null} className={cn('min-w-[3rem] text-right', severityClass(diskPct))}>
          {diskPct == null ? '—' : `${Math.round(diskPct)}%`}
        </Segmented>
      </span>

      {/* address */}
      <span className="server-list-md min-w-0 items-center gap-1.5">
        <Globe className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span className="truncate font-mono text-micro text-muted-foreground">
          {host}:{port}
        </span>
      </span>

      {/* state */}
      <span className="server-list-md min-w-0 justify-end overflow-hidden">
        <span
          className={cn('truncate text-micro uppercase', stateTextClass(server.status))}
        >
          {serverStatusLabel(t, server.status)}
        </span>
      </span>

      <span className="server-list-actions flex shrink-0 items-center justify-end gap-1">
        <ServerControls
          serverId={server.id}
          status={server.status}
          permissions={server.effectivePermissions}
          compact
        />
        <Link
          to={`/servers/${server.id}/console`}
          title={t('tabs.console')}
          aria-label={t('tabs.console')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:border-primary focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-7 sm:min-w-7 sm:h-7 sm:w-7"
        >
          <Terminal className="h-3.5 w-3.5" />
        </Link>
        <Link
          to={`/servers/${server.id}`}
          title={t('card.manage')}
          aria-label={t('card.manage')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:border-primary focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:min-h-7 sm:min-w-7 sm:h-7 sm:w-7"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </span>
    </div>
  );
}

function ServersPage() {
  const { t } = useTranslation('servers');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServerStatus | undefined>();
  const [debounced, setDebounced] = useState<ServerListParams>({});
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all');
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, refetch } = useServers(debounced);
  const { data: accessibleNodes } = useAccessibleNodes();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const cols = useColumns();
  const clearCreateIntent = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('action');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ search: search || undefined, status }), 200);
    return () => clearTimeout(timer);
  }, [search, status]);

  const canCreateServer =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('server.create') ||
    accessibleNodes?.hasWildcard ||
    Boolean(accessibleNodes?.nodes.length);

  const isAdmin = useMemo(
    () =>
      Boolean(
        user?.permissions?.includes('*') ||
          user?.permissions?.includes('admin.read') ||
          user?.permissions?.includes('admin.write'),
      ),
    [user?.permissions],
  );

  const accessFiltered = useMemo(() => {
    if (!data) return [] as Server[];
    if (accessFilter === 'all') return data;
    return data.filter((server) => {
      const isOwner = server.ownerId === user?.id;
      if (accessFilter === 'owned') return isOwner;
      if (accessFilter === 'other') return !isOwner;
      return true;
    });
  }, [data, accessFilter, user?.id]);

  const filtered = useMemo(() => {
    return accessFiltered.filter((server) => {
      const matchesStatus = status ? server.status === status : true;
      const matchesSearch = search
        ? server.name.toLowerCase().includes(search.toLowerCase()) ||
          server.nodeName?.toLowerCase().includes(search.toLowerCase())
        : true;
      return matchesStatus && matchesSearch;
    });
  }, [accessFiltered, search, status]);

  const statusCounts = useMemo(() => {
    const counts = { running: 0, stopped: 0, transitioning: 0, issues: 0 };
    data?.forEach((server) => {
      if (server.status === 'running') { counts.running += 1; return; }
      if (server.status === 'stopped') { counts.stopped += 1; return; }
      if (['installing', 'starting', 'stopping', 'transferring', 'cloning', 'restoring', 'creating_backup'].includes(server.status)) { counts.transitioning += 1; return; }
      if (server.status === 'crashed' || server.status === 'suspended' || server.status === 'error') { counts.issues += 1; }
    });
    return counts;
  }, [data]);

  const accessCounts = useMemo(() => {
    const counts = { owned: 0, other: 0 };
    data?.forEach((server) => {
      if (server.ownerId === user?.id) counts.owned += 1;
      else counts.other += 1;
    });
    return counts;
  }, [data, user?.id]);

  const totalServers = data?.length ?? 0;
  const hasFilters = Boolean(search || status);

  const moveFocus = (dir: 1 | -1) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="listitem"]') ?? []);
    const idx = rows.findIndex((row) => row === document.activeElement);
    rows[idx + dir]?.focus();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── Deck header ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('page.overline')}</BracketLabel>
          <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            {t('page.title')}
          </h1>

        </div>

        {canCreateServer && (
          <CreateServerModal openOnIntent={searchParams.get('action') === 'create'} onIntentHandled={clearCreateIntent} />
        )}
      </header>

      {/* ── The deck: controls, columns, rows and footer in one frame ── */}
      <div className="deck-panel server-list-container flex min-h-0 flex-col overflow-hidden">
        {/* Control strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
          <div className="flex items-center gap-0.5">
            <RailTab
              active={accessFilter === 'all'}
              onClick={() => setAccessFilter('all')}
              icon={<Globe className="h-3 w-3" />}
              label={t('page.access.all')}
              count={totalServers}
            />
            <RailTab
              active={accessFilter === 'owned'}
              onClick={() => setAccessFilter('owned')}
              icon={<Users className="h-3 w-3" />}
              label={t('page.access.owned')}
              count={accessCounts.owned}
            />
            {(isAdmin || accessCounts.other > 0) && (
              <RailTab
                active={accessFilter === 'other'}
                onClick={() => setAccessFilter('other')}
                icon={<Shield className="h-3 w-3" />}
                label={t('page.access.other')}
                count={accessCounts.other}
              />
            )}
          </div>

          <span className="mx-1 h-5 w-px bg-border/60" aria-hidden />

          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('filters.searchPlaceholder')}
              className="h-8 min-h-8 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </label>

          <Select
            value={status ?? '__all__'}
            onValueChange={(value) =>
              setStatus(value === '__all__' ? undefined : (value as ServerStatus))
            }
          >
            <SelectTrigger
              className="h-8 min-h-8 rounded-sm border-border/60 bg-background/40 px-2 text-mini"
              aria-label={t('filters.allStatuses')}
            >
              <SelectValue placeholder={t('filters.allStatuses')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">{t('filters.allStatuses')}</SelectItem>
              {(['running', 'stopped', 'installing', 'starting', 'stopping', 'crashed', 'transferring', 'cloning', 'suspended'] as ServerStatus[]).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {serverStatusLabel(t, value)}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>

          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatus(undefined);
              }}
              className="flex h-8 min-h-8 items-center gap-1 rounded-sm px-2.5 text-mini text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-3 w-3" />
              {t('filters.clear')}
            </button>
          )}

        </div>

        {/* Column header — same grid as the rows, so columns always line up */}
        <div
          className={cn(
            GRID,
            'server-list-columns sticky top-0 z-10 border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground',
          )}
        >
          <span className="type-overline">{cols.server}</span>
          <span className="type-overline server-list-xl">{cols.game}</span>
          <span className="type-overline server-list-xl justify-end">{cols.cpu}</span>
          <span className="type-overline server-list-xl justify-end">{cols.ram}</span>
          <span className="type-overline server-list-xl justify-end">{cols.disk}</span>
          <span className="type-overline server-list-md">{cols.address}</span>
          <span className="type-overline server-list-md justify-end">{cols.state}</span>
          <span className="type-overline justify-self-end">{cols.actions}</span>
        </div>

        {/* A refetch failure keeps any stale rows visible, but is never shown as an empty fleet. */}
        {isError && data && <TabErrorState onRetry={() => void refetch()} />}
        {/* Rows */}
        <div ref={listRef} role="list" aria-label={t('page.title')} className="min-h-[12rem] min-w-0 flex-1 overflow-y-auto bg-background/25">
          {isLoading ? (
            <div role="status" aria-label={t('page.title')}>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className={cn(GRID, 'py-2 pl-3 pr-3')}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-surface-3" />
                    <div className="h-3.5 w-40 animate-pulse rounded-sm bg-surface-3" />
                  </div>
                  <div className="server-list-xl min-w-0">
                    <div className="h-3 w-20 animate-pulse rounded-sm bg-surface-3" />
                  </div>
                  <div className="server-list-xl items-center justify-end gap-2">
                    <div className="h-2 w-16 animate-pulse rounded-sm bg-surface-3" />
                    <div className="h-3 w-10 animate-pulse rounded-sm bg-surface-3" />
                  </div>
                  <div className="server-list-xl items-center justify-end gap-2">
                    <div className="h-2 w-16 animate-pulse rounded-sm bg-surface-3" />
                    <div className="h-3 w-10 animate-pulse rounded-sm bg-surface-3" />
                  </div>
                  <div className="server-list-xl items-center justify-end gap-2">
                    <div className="h-2 w-16 animate-pulse rounded-sm bg-surface-3" />
                    <div className="h-3 w-10 animate-pulse rounded-sm bg-surface-3" />
                  </div>
                  <div className="server-list-md min-w-0">
                    <div className="h-3 w-24 animate-pulse rounded-sm bg-surface-3" />
                  </div>
                  <div className="server-list-md min-w-0">
                    <div className="h-3 w-12 animate-pulse rounded-sm bg-surface-3" />
                  </div>
                  <div className="flex justify-end gap-1">
                    <div className="h-7 w-16 animate-pulse rounded-sm bg-surface-3" />
                  </div>
                </div>
              ))}
            </div>
          ) : isError && !data ? (
            <TabErrorState onRetry={() => void refetch()} />
          ) : filtered.length === 0 ? (
            <TabEmptyState
              title={hasFilters ? t('page.empty') : t('list.emptyTitle')}
              description={hasFilters ? undefined : t('list.emptyDescription')}
              action={
                hasFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setStatus(undefined);
                    }}
                    className="flex h-8 min-h-8 items-center gap-1 rounded-sm px-2.5 text-mini text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                    {t('filters.clear')}
                  </button>
                ) : undefined
              }
            />
          ) : (
            filtered.map((server, index) => (
              <div
                key={server.id}
                className={cn(index > 0 && 'border-t border-border/40')}
              >
                <ServerRow server={server} onMoveFocus={moveFocus} />
              </div>
            ))
          )}
        </div>

        {/* Footer strip — legend + keymap, the deck's bottom edge */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/50 bg-surface-1/40 px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <LegendCount tone="go" value={statusCounts.running} label={t('common:status.running')} />
            <LegendCount tone="idle" value={statusCounts.stopped} label={t('common:status.stopped')} />
            <LegendCount tone="alarm" value={statusCounts.issues} label={t('page.stats.issues')} />
          </div>
          <div className="hidden items-center gap-4 font-mono text-micro text-muted-foreground/60 sm:flex">
            <span>
              <kbd className="font-mono text-muted-foreground/80">↑↓</kbd> {t('hints.navigate')}
            </span>
            <span>
              <kbd className="font-mono text-muted-foreground/80">↵</kbd> {t('hints.open')}
            </span>
            <span className="hidden sm:inline">
              <kbd className="font-mono text-muted-foreground/80">↹</kbd> {t('hints.actions')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendCount({
  tone,
  value,
  label,
}: {
  tone: Tone;
  value: number;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <StatusLed tone={value > 0 ? tone : 'idle'} />
      <Segmented muted className="text-micro">
        {value}
      </Segmented>
      <span className="type-overline">{label}</span>
    </span>
  );
}

function RailTab({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex h-8 min-h-8 min-w-0 max-w-full items-center gap-1.5 px-2.5 transition-colors',
        'text-mini [@media(pointer:fine)]:h-7 [@media(pointer:fine)]:min-h-7',
        active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {active && (
        <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />
      )}
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 font-mono text-micro tabular-nums text-muted-foreground/80">{count}</span>
    </button>
  );
}

export default ServersPage;
