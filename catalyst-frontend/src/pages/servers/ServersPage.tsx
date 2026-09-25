import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { notifyError, notifySuccess } from '../../utils/notify';
import CreateServerModal from '../../components/servers/CreateServerModal';
import ServerControls from '../../components/servers/ServerControls';
import { useServers } from '../../hooks/useServers';
import type { Server, ServerListParams, ServerStatus } from '../../types/server';
import { useAuthStore } from '../../stores/authStore';
import {
  ActivityBars,
  BracketLabel,
  GameChip,
  MetricCluster,
  Segmented,
  StatusLed,
} from '../../components/deck/primitives';
import {
  ChevronRight,
  Copy,
  FolderOpen,
  Globe,
  HardDrive,
  Search,
  Settings,
  Shield,
  Terminal,
  Users,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { serverStatusLabel } from '../../utils/constants';

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
 *   base : identity · actions
 *   md   : identity · address · state · actions
 *   xl   : identity · game · cpu · ram · disk · address · state · actions
 */
const GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 ' +
  'md:grid-cols-[minmax(0,1fr)_9rem_6rem_auto] ' +
  'xl:grid-cols-[minmax(0,1fr)_10rem_5.25rem_5.25rem_5.25rem_11rem_5.5rem_minmax(0.5rem,0.12fr)_auto]';

const formatMB = (mb: number) =>
  mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;

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

function stateTextClass(status: ServerStatus, running: boolean) {
  if (running) return 'text-success';
  if (status === 'crashed' || status === 'error') return 'text-danger';
  if (status === 'suspended') return 'text-warning';
  return 'text-muted-foreground';
}

function ServerRow({
  server,
  selected,
  onSelect,
  onMoveFocus,
}: {
  server: Server;
  selected: boolean;
  onSelect: () => void;
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
      role="row"
      tabIndex={0}
      aria-selected={selected}
      onFocus={onSelect}
      onClick={onSelect}
      onKeyDown={(event) => {
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
        'group relative cursor-default py-1.5 pl-3 pr-2 outline-none transition-colors',
        'focus-visible:bg-primary/10',
        selected && 'bg-primary/[0.07]',
      )}
    >
      {selected && (
        <span className="absolute left-0 top-0 h-full w-[2px] bg-primary" aria-hidden />
      )}

      {/* identity — on small screens this cell also carries address + state */}
      <div className="flex min-w-0 items-center gap-2">
        <StatusLed tone={toneForState(server.status)} pulse={running} />
        <GameChip game={game} className="hidden sm:inline-flex" />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="flex min-w-0 items-baseline gap-2">
            <Link
              to={`/servers/${server.id}`}
              className="truncate font-display text-data font-semibold tracking-tight text-foreground hover:text-primary"
            >
              {server.name}
            </Link>
            {version && (
              <Segmented muted className="hidden shrink-0 md:inline">
                {version}
              </Segmented>
            )}
          </span>
          <span className="flex items-center gap-2 text-micro text-muted-foreground">
            <span className="hidden shrink-0 font-mono md:inline">
              {server.node?.name ??
                server.nodeName ??
                (server.nodeId ? `${server.nodeId.slice(0, 8)}…` : '')}
            </span>
            <span className="md:hidden truncate font-mono">
              {host}:{port}
            </span>
            <span
              className={cn(
                'shrink-0 font-display uppercase tracking-[0.12em] md:hidden',
                stateTextClass(server.status, running),
              )}
            >
              {serverStatusLabel(t, server.status)}
            </span>
          </span>
        </div>
      </div>

      {/* game */}
      <span className="hidden min-w-0 xl:block">
        <span className="block truncate text-micro text-muted-foreground">{game ?? '—'}</span>
      </span>

      {/* live activity cluster — labelled by the column header, so the row
          carries only the reading (bars + value) to stay dense and aligned */}
      <span className="hidden items-center justify-end gap-2 xl:flex">
        <ActivityBars value={cpu} />
        <Segmented muted={cpu == null} className="min-w-[3.25rem] text-right">
          {cpu == null ? '—' : `${Math.round(cpu)}%`}
        </Segmented>
      </span>
      <span className="hidden items-center justify-end gap-2 xl:flex">
        <ActivityBars value={ramPct} />
        <Segmented muted={ramPct == null} className="min-w-[3.25rem] text-right">
          {ramPct == null ? '—' : `${Math.round(ramPct)}%`}
        </Segmented>
      </span>
      <span className="hidden items-center justify-end gap-2 xl:flex">
        <ActivityBars value={diskPct} />
        <Segmented muted={diskPct == null} className="min-w-[3.25rem] text-right">
          {diskPct == null ? '—' : `${Math.round(diskPct)}%`}
        </Segmented>
      </span>

      {/* address */}
      <span className="hidden min-w-0 items-center gap-1.5 md:flex">
        <Globe className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span className="truncate font-mono text-micro text-muted-foreground">
          {host}:{port}
        </span>
      </span>

      {/* state */}
      <span className="hidden justify-end md:flex">
        <span
          className={cn(
            'font-display text-micro uppercase tracking-[0.12em]',
            stateTextClass(server.status, running),
          )}
        >
          {serverStatusLabel(t, server.status)}
        </span>
      </span>

      {/* flexible spacer: keeps the data columns compact and pins actions right.
          Must exist in the header too, or the tracks shift by one. */}
      <span className="hidden xl:block" aria-hidden />

      <span className="flex shrink-0 items-center justify-end gap-1">
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
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <Terminal className="h-3.5 w-3.5" />
        </Link>
        <Link
          to={`/servers/${server.id}`}
          title={t('card.manage')}
          aria-label={t('card.manage')}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </span>
    </div>
  );
}

/** Selection detail — the browser's lower pane, rendered inline under its row. */
function ServerDetail({ server }: { server: Server }) {
  const { t } = useTranslation('servers');
  const running = server.status === 'running';
  const cols = useColumns();

  const host =
    server.connection?.host ??
    server.primaryIp ??
    server.node?.publicAddress ??
    server.node?.hostname ??
    '—';
  const port = server.connection?.port ?? server.primaryPort ?? '—';

  const copyAddress = () => {
    navigator.clipboard.writeText(`${host}:${port}`).then(
      () => notifySuccess(t('details.copiedAddress')),
      () => notifyError(t('details.copyFailed')),
    );
  };

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

  const links = [
    { to: `/servers/${server.id}/console`, label: t('tabs.console'), icon: Terminal },
    { to: `/servers/${server.id}/files`, label: t('tabs.files'), icon: FolderOpen },
    { to: `/servers/${server.id}/backups`, label: t('tabs.backups'), icon: HardDrive },
    { to: `/servers/${server.id}/settings`, label: t('tabs.settings'), icon: Settings },
  ];

  return (
    <div className="border-t border-border/50 bg-surface-1/50 px-3 py-3">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div className="min-w-[13rem]">
          <BracketLabel tone="muted">{cols.address}</BracketLabel>
          <button
            type="button"
            onClick={copyAddress}
            className="mt-1 flex items-center gap-1.5 font-mono text-data tabular-nums text-foreground hover:text-primary"
          >
            {host}:{port}
            <Copy className="h-3 w-3 opacity-60" />
          </button>
          <p className="type-meta mt-1">
            {server.node?.name ??
              server.nodeName ??
              (server.nodeId ? `${server.nodeId.slice(0, 8)}…` : '')}
            {gameVersion(server) ? ` · ${gameVersion(server)}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <MetricCluster label={cols.cpu} value={cpu} display={cpu == null ? '—' : `${Math.round(cpu)}%`} />
          <MetricCluster
            label={cols.ram}
            value={ramPct}
            display={
              server.memoryUsageMb != null && server.allocatedMemoryMb
                ? `${formatMB(server.memoryUsageMb)}/${formatMB(server.allocatedMemoryMb)}`
                : '—'
            }
          />
          <MetricCluster
            label={cols.disk}
            value={diskPct}
            display={
              server.diskUsageMb != null && diskTotal
                ? `${formatMB(server.diskUsageMb)}/${formatMB(diskTotal)}`
                : '—'
            }
          />
        </div>

        <div className="ml-auto flex flex-col items-end gap-2">
          <ServerControls
            serverId={server.id}
            status={server.status}
            permissions={server.effectivePermissions}
          />
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                className="flex items-center gap-1.5 rounded-sm border border-border/60 px-2 py-1 font-display text-micro uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                <link.icon className="h-3 w-3" />
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ServersPage() {
  const { t } = useTranslation('servers');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ServerStatus | undefined>();
  const [debounced, setDebounced] = useState<ServerListParams>({});
  const [accessFilter, setAccessFilter] = useState<AccessFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useServers(debounced);
  const user = useAuthStore((s) => s.user);
  const cols = useColumns();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced({ search: search || undefined, status }), 200);
    return () => clearTimeout(timer);
  }, [search, status]);

  const canCreateServer =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.write') ||
    user?.permissions?.includes('server.create');

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
  const online = statusCounts.running;
  const fleetPct = totalServers > 0 ? (online / totalServers) * 100 : 0;
  const selected = filtered.find((server) => server.id === selectedId) ?? null;
  const hasFilters = Boolean(search || status);

  const moveFocus = (dir: 1 | -1) => {
    const rows = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="row"]') ?? []);
    const idx = rows.findIndex((row) => row === document.activeElement);
    const next = rows[idx + dir];
    if (next) {
      next.focus();
      setSelectedId(next.getAttribute('data-server-id'));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── Deck header ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-0.5">
        <div className="min-w-0">
          <BracketLabel>{t('page.overline')}</BracketLabel>
          <h1 className="font-display text-2xl font-semibold leading-tight tracking-tight text-foreground">
            {t('page.title')}
          </h1>
          <p className="type-meta mt-0.5">{t('page.description')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-2">
            <StatusLed tone={online > 0 ? 'go' : 'idle'} pulse={online > 0} />
            <Segmented className="text-mini">
              {online}/{totalServers}
            </Segmented>
            <ActivityBars value={fleetPct} bars={7} />
          </span>
          {canCreateServer && <CreateServerModal />}
        </div>
      </header>

      {/* ── The deck: controls, columns, rows and footer in one frame ── */}
      <div className="deck-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Control strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-2.5 py-2">
          <div className="flex items-center gap-0.5 rounded-sm border border-border/60 bg-background/40 p-0.5">
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

          <span className="h-5 w-px bg-border/60" aria-hidden />

          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('filters.searchPlaceholder')}
              className="h-7 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </label>

          <select
            value={status ?? '__all__'}
            onChange={(event) =>
              setStatus(event.target.value === '__all__' ? undefined : (event.target.value as ServerStatus))
            }
            className="h-7 rounded-sm border border-border/60 bg-background/40 pl-2 pr-7 text-mini text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40"
            aria-label={t('filters.allStatuses')}
          >
            <option value="__all__">{t('filters.allStatuses')}</option>
            {(['running', 'stopped', 'installing', 'starting', 'stopping', 'crashed', 'transferring', 'cloning', 'suspended'] as ServerStatus[]).map(
              (value) => (
                <option key={value} value={value}>
                  {serverStatusLabel(t, value)}
                </option>
              ),
            )}
          </select>

          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                setStatus(undefined);
              }}
              className="flex h-7 items-center gap-1 rounded-sm px-2 font-display text-micro uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-3 w-3" />
              {t('filters.clear')}
            </button>
          )}

          <span className="ml-auto flex items-center gap-2">
            <Segmented muted className="text-mini">
              {filtered.length}/{totalServers}
            </Segmented>
            <span className="font-display text-micro uppercase tracking-[0.12em] text-muted-foreground">
              {t('page.stats.total')}
            </span>
          </span>
        </div>

        {/* Column header — same grid as the rows, so columns always line up */}
        <div
          className={cn(
            GRID,
            'border-b border-border/50 bg-surface-1/30 py-1.5 pl-3 pr-2 text-muted-foreground',
          )}
        >
          <span className="deck-label">{cols.server}</span>
          <span className="deck-label deck-label--muted hidden xl:inline-flex">{cols.game}</span>
          <span className="deck-label deck-label--muted hidden justify-end xl:inline-flex">{cols.cpu}</span>
          <span className="deck-label deck-label--muted hidden justify-end xl:inline-flex">{cols.ram}</span>
          <span className="deck-label deck-label--muted hidden justify-end xl:inline-flex">{cols.disk}</span>
          <span className="deck-label deck-label--muted hidden md:inline-flex">{cols.address}</span>
          <span className="deck-label deck-label--muted hidden justify-end md:inline-flex">{cols.state}</span>
          <span className="hidden xl:block" aria-hidden />
          <span className="deck-label deck-label--muted justify-self-end">{cols.actions}</span>
        </div>

        {/* Rows */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto bg-background/25">
          {isLoading ? (
            <div>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className={cn(GRID, 'py-2 pl-3 pr-2')}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-surface-3" />
                    <div className="h-3.5 w-40 animate-pulse bg-surface-3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
              <Search className="h-4 w-4 text-muted-foreground" />
              <p className="type-meta">{t('page.empty')}</p>
            </div>
          ) : (
            filtered.map((server, index) => (
              <Fragment key={server.id}>
                <div
                  data-server-id={server.id}
                  className={cn(index > 0 && 'border-t border-border/40')}
                >
                  <ServerRow
                    server={server}
                    selected={server.id === selectedId}
                    onSelect={() => setSelectedId(server.id)}
                    onMoveFocus={moveFocus}
                  />
                </div>
                {selected?.id === server.id && <ServerDetail server={server} />}
              </Fragment>
            ))
          )}
        </div>

        {/* Footer strip — legend + keymap, the deck's bottom edge */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/50 bg-surface-1/40 px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <LegendCount tone="go" value={statusCounts.running} label={t('common:status.running')} />
            <LegendCount tone="idle" value={statusCounts.stopped} label={t('common:status.stopped')} />
            <LegendCount tone="alarm" value={statusCounts.issues} label={t('page.stats.issues')} />
          </div>
          <div className="flex items-center gap-3 font-mono text-micro text-muted-foreground/80">
            <span>
              <kbd className="rounded-sm border border-border/60 px-1">↑↓</kbd> {t('hints.navigate')}
            </span>
            <span>
              <kbd className="rounded-sm border border-border/60 px-1">↵</kbd> {t('hints.open')}
            </span>
            <span className="hidden sm:inline">
              <kbd className="rounded-sm border border-border/60 px-1">↹</kbd> {t('hints.actions')}
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
      <span className="font-display text-micro uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </span>
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
        'flex h-6 items-center gap-1.5 rounded-sm px-2 transition-colors',
        'font-display text-micro uppercase tracking-[0.12em]',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
      )}
    >
      {icon}
      <span>{label}</span>
      <span
        className={cn(
          'font-mono text-micro tabular-nums',
          active ? 'text-primary-foreground/75' : 'text-muted-foreground/70',
        )}
      >
        {count}
      </span>
    </button>
  );
}

export default ServersPage;
