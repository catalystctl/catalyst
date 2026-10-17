import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@/csync';
import {
  ArrowLeft,
  ChevronDown,
  ExternalLink,
  Home,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Store,
  Tag,
  Trash2,
  X,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { BracketLabel } from '@/components/deck/primitives';
import TabEmptyState from '@/components/servers/tabs/TabEmptyState';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { notifyError } from '../../../utils/notify';
import { formatDateTime, formatRelativeTime } from '../../../i18n/format';
import {
  addMarketplaceSource,
  deleteMarketplaceSource,
  fetchMarketplace,
  fetchMarketplaceSources,
  fetchPlugins,
  installPlugin,
  updateMarketplaceSource,
  type MarketplaceBrowseResult,
  type MarketplaceEntry,
  type MarketplaceSource,
} from '../../../plugins/api';
import { isNewerVersion, sourceHostLabel } from './marketplace-utils';

/** Browse row plus the locally re-derived install state. */
interface AnnotatedEntry extends MarketplaceEntry {
  installed: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
}

/**
 * One grid template shared by the column header and every row so the version
 * and action columns line up. Fixed / minmax(0,1fr) tracks only — never `auto`.
 */
const GRID = 'grid grid-cols-1 items-center gap-x-3 gap-y-1 md:grid-cols-[minmax(0,1fr)_7rem_9.5rem]';

type StatusFilter = 'all' | 'available' | 'installed' | 'updates';
type SortBy = 'relevance' | 'name' | 'newest';

function entryKey(entry: MarketplaceEntry): string {
  return `${entry.sourceUrl ?? ''}:${entry.name}`;
}

/**
 * Marketplace browser — a full page rather than a modal, because browsing an
 * index and comparing versions is a task admins return to, and a dialog
 * cannot hold sources, filters and a detail pane at once.
 *
 * Installing places inert code; enabling still runs through the safety-consent
 * gate on the Plugins page.
 */
export default function MarketplacePage() {
  const { t } = useTranslation('admin-system');
  // The plugin list deep-links here with `?status=updates` when it knows about
  // pending updates, so the "N updates" chip lands on the filtered view.
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status');

  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    initialStatus === 'available' || initialStatus === 'installed' || initialStatus === 'updates'
      ? initialStatus
      : 'all',
  );
  const [sortBy, setSortBy] = useState<SortBy>('relevance');
  const [tagFilter, setTagFilter] = useState('all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceLabel, setNewSourceLabel] = useState('');
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['plugins', 'marketplace'],
    queryFn: () => fetchMarketplace(false),
    staleTime: 0,
  });

  const { data: plugins } = useQuery({
    queryKey: qk.adminPlugins(),
    queryFn: fetchPlugins,
    staleTime: 60_000,
  });

  const {
    data: sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
  } = useQuery({
    queryKey: ['plugins', 'marketplace-sources'],
    queryFn: () => fetchMarketplaceSources(),
    staleTime: 0,
  });

  const installedVersions = useMemo(
    () => new Map((plugins ?? []).map((plugin) => [plugin.name, plugin.version])),
    [plugins],
  );

  // Refresh bypasses the frontend stale guard and the backend 5-minute index
  // cache, so it always re-reads the marketplace repo for new versions.
  const refreshMarketplace = async (opts: { silent?: boolean } = {}) => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const [fresh, freshSources] = await Promise.all([
        fetchMarketplace(true),
        fetchMarketplaceSources().catch(() => undefined),
      ]);
      queryClient.setQueryData<MarketplaceBrowseResult>(['plugins', 'marketplace'], fresh);
      if (freshSources) {
        queryClient.setQueryData(['plugins', 'marketplace-sources'], freshSources);
      } else {
        await refetchSources().catch(() => undefined);
      }
      setLastChecked(new Date());
      if (opts.silent) return;
      const updates = fresh.entries.filter((entry) => {
        const installed = entry.installedVersion ?? installedVersions.get(entry.name) ?? null;
        return Boolean(entry.updateAvailable) || isNewerVersion(installed, entry.version);
      }).length;
      toast.success(
        updates > 0
          ? t('pluginsAdmin.toastMarketplaceRefreshed', { count: updates })
          : t('pluginsAdmin.toastMarketplaceUpToDate'),
      );
    } catch (error: any) {
      if (!opts.silent) notifyError(error);
    } finally {
      setRefreshing(false);
    }
  };

  const addSourceMutation = useMutation({
    mutationFn: ({ url, label }: { url: string; label?: string }) => addMarketplaceSource(url, label),
    onMutate: () => setPendingSourceId('new'),
    onSuccess: (source: MarketplaceSource) => {
      toast.success(t('pluginsAdmin.toastMarketplaceAdded', { host: sourceHostLabel(source.url) }));
      setNewSourceUrl('');
      setNewSourceLabel('');
      void refreshMarketplace();
    },
    onSettled: () => setPendingSourceId(null),
    onError: (error: any) => notifyError(error),
  });

  const toggleSourceMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateMarketplaceSource(id, enabled),
    onMutate: ({ id }) => setPendingSourceId(id),
    onSuccess: () => refreshMarketplace(),
    onSettled: () => setPendingSourceId(null),
    onError: (error: any) => notifyError(error),
  });

  const deleteSourceMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => deleteMarketplaceSource(id),
    onMutate: ({ id }) => setPendingSourceId(id),
    onSuccess: () => {
      toast.success(t('pluginsAdmin.toastMarketplaceRemoved'));
      void refreshMarketplace();
    },
    onSettled: () => setPendingSourceId(null),
    onError: (error: any) => notifyError(error),
  });

  const installMutation = useMutation({
    mutationFn: ({ entry }: { entry: MarketplaceEntry }) =>
      installPlugin(entry.downloadUrl, entry.sha256),
    onMutate: ({ entry }) => setInstallingName(entry.name),
    onSuccess: (result) => {
      toast.success(
        result.upgraded
          ? t('pluginsAdmin.toastPluginUpgraded', { name: result.name, version: result.version })
          : t('pluginsAdmin.toastPluginInstalled', { name: result.name, version: result.version }),
        { duration: 6000 },
      );
      queryClient.invalidateQueries({ queryKey: qk.adminPlugins() });
      void refreshMarketplace({ silent: true });
    },
    onSettled: () => setInstallingName(null),
    onError: (error: any) => notifyError(error),
  });

  const entries = useMemo<AnnotatedEntry[]>(() => {
    return (data?.entries ?? []).map((entry) => {
      const installedVersion = entry.installedVersion ?? installedVersions.get(entry.name) ?? null;
      const installed = Boolean(entry.installed || installedVersion);
      const updateAvailable =
        Boolean(entry.updateAvailable) || isNewerVersion(installedVersion, entry.version);
      return { ...entry, installed, installedVersion, updateAvailable };
    });
  }, [data?.entries, installedVersions]);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = entries.filter((entry) => {
      const matchesSource = sourceFilter === 'all' || entry.sourceUrl === sourceFilter;
      const matchesTag = tagFilter === 'all' || (entry.tags ?? []).includes(tagFilter);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'available' && !entry.installed) ||
        (statusFilter === 'installed' && entry.installed) ||
        (statusFilter === 'updates' && entry.updateAvailable);
      const matchesSearch =
        !q ||
        [entry.displayName ?? '', entry.name, entry.description ?? '', entry.author ?? '', ...(entry.tags ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(q);
      return matchesSource && matchesTag && matchesStatus && matchesSearch;
    });
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') return (a.displayName ?? a.name).localeCompare(b.displayName ?? b.name);
      if (sortBy === 'newest') return (b.version ?? '').localeCompare(a.version ?? '', undefined, { numeric: true });
      return Number(b.updateAvailable) - Number(a.updateAvailable) || Number(b.installed) - Number(a.installed);
    });
  }, [entries, searchQuery, sourceFilter, tagFilter, statusFilter, sortBy]);

  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      for (const tag of entry.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  const entriesBySource = useMemo(() => {
    const groups = new Map<string, AnnotatedEntry[]>();
    for (const entry of filteredEntries) {
      const key = entry.sourceUrl ?? 'unknown';
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [filteredEntries]);

  const counts = useMemo(
    () => ({
      all: entries.length,
      available: entries.filter((entry) => !entry.installed).length,
      installed: entries.filter((entry) => entry.installed).length,
      updates: entries.filter((entry) => entry.updateAvailable).length,
    }),
    [entries],
  );

  const healthByUrl = useMemo(() => {
    const map = new Map<string, { ok: boolean; error?: string; entryCount: number }>();
    for (const source of data?.sources ?? []) map.set(source.url, source);
    return map;
  }, [data?.sources]);

  const originLabel = (origin: MarketplaceSource['origin']): string => {
    if (origin === 'official') return t('pluginsAdmin.originOfficial');
    if (origin === 'env') return t('pluginsAdmin.originEnv');
    return t('pluginsAdmin.originAdded');
  };

  /** Sequential, one toast at the end — parallel installs would fight over the plugins dir. */
  const updateAll = async () => {
    const pending = entries.filter((entry) => entry.updateAvailable);
    if (pending.length === 0) return;
    setBulkProgress({ done: 0, total: pending.length });
    let updated = 0;
    for (const [index, entry] of pending.entries()) {
      setBulkProgress({ done: index, total: pending.length });
      try {
        await installPlugin(entry.downloadUrl, entry.sha256);
        updated += 1;
      } catch (error: any) {
        notifyError(error);
      }
    }
    setBulkProgress(null);
    queryClient.invalidateQueries({ queryKey: qk.adminPlugins() });
    void refreshMarketplace({ silent: true });
    toast.success(t('pluginsAdmin.toastUpdateAllDone', { count: updated }), { duration: 6000 });
  };

  const anyFilterActive =
    statusFilter !== 'all' || sourceFilter !== 'all' || tagFilter !== 'all' || searchQuery.trim() !== '';

  const resetFilters = () => {
    setSearchQuery('');
    setSourceFilter('all');
    setTagFilter('all');
    setStatusFilter('all');
  };

  const statusTabs: Array<[StatusFilter, string]> = [
    ['all', t('pluginsAdmin.filterAll')],
    ['available', t('pluginsAdmin.install')],
    ['updates', t('pluginsAdmin.update')],
    ['installed', t('pluginsAdmin.installed')],
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── Deck header ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('layout:sections.extensions')}</BracketLabel>
          <h1 className="flex items-center gap-2 font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            <Store className="h-4 w-4 text-muted-foreground" />
            {t('pluginsAdmin.marketplaceTitle')}
          </h1>
          <p className="text-mini text-muted-foreground">{t('pluginsAdmin.marketplaceDescription')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {counts.updates > 0 && (
            <Button
              size="sm"
              className="h-8 rounded-sm px-3 text-mini"
              onClick={updateAll}
              disabled={bulkProgress !== null}
            >
              {bulkProgress ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {bulkProgress
                ? t('pluginsAdmin.updatingAll', { current: bulkProgress.done + 1, total: bulkProgress.total })
                : t('pluginsAdmin.updateAll', { count: counts.updates })}
            </Button>
          )}
          <Button asChild variant="outline" size="sm" className="h-8 rounded-sm px-3 text-mini">
            <Link to="/admin/plugins">
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('pluginsAdmin.backToPlugins')}
            </Link>
          </Button>
        </div>
      </header>

      <div className="deck-panel flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* ── Control strip ── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('pluginsAdmin.searchPlaceholder')}
              aria-label={t('pluginsAdmin.searchAria')}
              className="h-7 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </label>
          <div className="flex items-center gap-0.5" role="tablist" aria-label={t('pluginsAdmin.filterAria')}>
            {statusTabs.map(([status, label]) => (
              <button
                key={status}
                role="tab"
                aria-selected={statusFilter === status}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  'relative flex h-7 items-center gap-1.5 px-2.5 text-mini transition-colors',
                  statusFilter === status ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {statusFilter === status && (
                  <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />
                )}
                {label}
                <span className="font-mono text-micro tabular-nums text-muted-foreground/80">
                  {counts[status]}
                </span>
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('pluginsAdmin.refreshAria')}
            title={t('pluginsAdmin.refreshTitle')}
            onClick={() => refreshMarketplace()}
            disabled={refreshing}
          >
            {refreshing || isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
          <span
            className="shrink-0 font-mono text-micro tabular-nums text-muted-foreground"
            title={lastChecked ? formatDateTime(lastChecked) : undefined}
          >
            {lastChecked
              ? t('pluginsAdmin.checkedAt', { time: formatRelativeTime(lastChecked.getTime()) })
              : t('pluginsAdmin.notYetChecked')}
          </span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          {/* ── Sources + tags rail ── */}
          <aside
            aria-label={t('pluginsAdmin.marketplaces')}
            className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto border-b border-border/50 px-3 py-3 lg:w-64 lg:border-b-0 lg:border-r"
          >
            <section>
              <div className="flex items-center justify-between gap-2">
                <BracketLabel tone="muted">{t('pluginsAdmin.marketplaces')}</BracketLabel>
                {sources && sources.length > 0 && (
                  <span className="font-mono text-micro tabular-nums text-muted-foreground">
                    {sources.length}
                  </span>
                )}
              </div>
              {sourcesLoading ? (
                <div className="flex items-center gap-2 py-3 text-mini text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('pluginsAdmin.loadingMarketplaces')}
                </div>
              ) : sources && sources.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {sources.map((source) => {
                    const health = healthByUrl.get(source.url);
                    const busy = pendingSourceId === source.id;
                    const selected = sourceFilter === source.url;
                    return (
                      <li
                        key={source.id}
                        className={cn(
                          'rounded-sm border px-2 py-1.5 transition-colors',
                          selected ? 'border-primary/40 bg-primary/5' : 'border-border/40 hover:bg-surface-1/50',
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            className="min-w-0 flex-1 truncate text-left text-mini font-medium text-foreground"
                            title={source.url}
                            onClick={() => setSourceFilter(selected ? 'all' : source.url)}
                          >
                            {source.label?.trim() || sourceHostLabel(source.url)}
                          </button>
                          {source.removable && (
                            <>
                              <Switch
                                checked={source.enabled}
                                disabled={busy}
                                className="scale-75"
                                aria-label={t('pluginsAdmin.toggleSourceAria', {
                                  action: source.enabled
                                    ? t('common:actions.disable')
                                    : t('common:actions.enable'),
                                  url: source.url,
                                })}
                                onCheckedChange={(checked) =>
                                  toggleSourceMutation.mutate({ id: source.id, enabled: checked })
                                }
                              />
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="h-6 w-6"
                                aria-label={t('pluginsAdmin.removeSourceAria', { url: source.url })}
                                disabled={busy}
                                onClick={() => deleteSourceMutation.mutate({ id: source.id })}
                              >
                                {busy ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3 w-3" />
                                )}
                              </Button>
                            </>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-micro">
                            {originLabel(source.origin)}
                          </Badge>
                          {!source.enabled ? (
                            <Badge variant="secondary" className="text-micro">
                              {t('common:actions.disabled')}
                            </Badge>
                          ) : health ? (
                            <span
                              className="font-mono text-micro tabular-nums text-muted-foreground"
                              title={health.error ?? source.url}
                            >
                              {health.ok
                                ? t('pluginsAdmin.pluginCount', { count: health.entryCount })
                                : health.error}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate font-mono text-micro text-muted-foreground/60" title={source.url}>
                          {source.url}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-2 text-mini text-muted-foreground">
                  {t('pluginsAdmin.noMarketplaceConfigured')}
                </p>
              )}

              <form
                className="mt-2 flex flex-col gap-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newSourceUrl.trim() || pendingSourceId === 'new') return;
                  addSourceMutation.mutate({
                    url: newSourceUrl.trim(),
                    label: newSourceLabel.trim() || undefined,
                  });
                }}
              >
                <Input
                  value={newSourceUrl}
                  onChange={(e) => setNewSourceUrl(e.target.value)}
                  placeholder="https://example.com/index.json"
                  aria-label={t('pluginsAdmin.newSourceUrlAria')}
                  inputMode="url"
                  className="h-7 rounded-sm font-mono text-micro"
                />
                <div className="flex gap-1.5">
                  <Input
                    value={newSourceLabel}
                    onChange={(e) => setNewSourceLabel(e.target.value)}
                    placeholder={t('pluginsAdmin.labelOptionalPlaceholder')}
                    aria-label={t('pluginsAdmin.newSourceLabelAria')}
                    className="h-7 flex-1 rounded-sm text-micro"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-7 px-2 text-mini"
                    disabled={!newSourceUrl.trim() || pendingSourceId === 'new'}
                  >
                    {pendingSourceId === 'new' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    {t('pluginsAdmin.add')}
                  </Button>
                </div>
              </form>
            </section>

            {tagCounts.length > 0 && (
              <section className="border-t border-border/40 pt-3">
                <BracketLabel tone="muted">{t('pluginsAdmin.tagsTitle')}</BracketLabel>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setTagFilter('all')}
                    className={cn(
                      'rounded-sm border px-2 py-0.5 text-micro transition-colors',
                      tagFilter === 'all'
                        ? 'border-primary/50 bg-primary/10 text-foreground'
                        : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground',
                    )}
                  >
                    {t('pluginsAdmin.allTags')}
                  </button>
                  {tagCounts.map(([tag, count]) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setTagFilter(tagFilter === tag ? 'all' : tag)}
                      className={cn(
                        'rounded-sm border px-2 py-0.5 text-micro transition-colors',
                        tagFilter === tag
                          ? 'border-primary/50 bg-primary/10 text-foreground'
                          : 'border-border/50 text-muted-foreground hover:border-border hover:text-foreground',
                      )}
                    >
                      {tag}
                      <span className="ml-1 font-mono tabular-nums text-muted-foreground/70">{count}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </aside>

          {/* ── Results ── */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              className={cn(
                GRID,
                'sticky top-0 z-10 hidden border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground/70 md:grid',
              )}
            >
              <span className="type-overline">{t('pluginsAdmin.pluginColumn')}</span>
              <span className="type-overline">{t('pluginsAdmin.versionColumn')}</span>
              <span className="type-overline justify-self-end">{t('common:actions.more')}</span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-background/25">
              {isLoading ? (
                <div>
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className={cn(GRID, 'border-t border-border/40 py-3 pl-3 pr-3')}>
                      <div className="h-3.5 w-48 animate-pulse bg-surface-3" />
                    </div>
                  ))}
                </div>
              ) : !data || data.sources.length === 0 ? (
                <div className="p-3">
                  <TabEmptyState
                    title={t('pluginsAdmin.emptyMarketplaceTitle')}
                    description={t('pluginsAdmin.emptyDescription')}
                  />
                </div>
              ) : filteredEntries.length === 0 ? (
                <div className="p-3">
                  <TabEmptyState
                    title={t('pluginsAdmin.noMatchesTitle')}
                    description={t('pluginsAdmin.noSearchResults')}
                    action={
                      anyFilterActive ? (
                        <Button variant="outline" size="sm" className="h-7 px-2.5 text-mini" onClick={resetFilters}>
                          <X className="h-3.5 w-3.5" />
                          {t('pluginsAdmin.clearFilters')}
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                entriesBySource.map(([sourceUrl, sourceEntries]) => {
                  const source = sources?.find((item) => item.url === sourceUrl);
                  return (
                    <section key={sourceUrl}>
                      <div className="flex items-center gap-2 border-y border-border/40 bg-surface-1/60 px-3 py-1.5">
                        <BracketLabel tone="muted" className="min-w-0 truncate">
                          {source?.label?.trim() || sourceHostLabel(sourceUrl)}
                        </BracketLabel>
                        <Badge variant="outline" className="text-micro">{sourceEntries.length}</Badge>
                        {source && (
                          <Badge variant="secondary" className="text-micro">{originLabel(source.origin)}</Badge>
                        )}
                      </div>
                      <ul>
                        {sourceEntries.map((entry) => {
                          const key = entryKey(entry);
                          const expanded = expandedKey === key;
                          const busy = installingName === entry.name;
                          return (
                            <li key={key} className="border-b border-border/40 last:border-b-0">
                              <div
                                className={cn(
                                  GRID,
                                  'py-2.5 pl-3 pr-3 transition-colors hover:bg-surface-1/40',
                                  expanded && 'bg-surface-1/40',
                                )}
                              >
                                <button
                                  type="button"
                                  className="flex min-w-0 items-start gap-2 text-left"
                                  aria-expanded={expanded}
                                  aria-label={t('pluginsAdmin.rowDetailsAria', {
                                    name: entry.displayName ?? entry.name,
                                  })}
                                  onClick={() => setExpandedKey(expanded ? null : key)}
                                >
                                  <ChevronDown
                                    className={cn(
                                      'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
                                      expanded ? '' : '-rotate-90',
                                    )}
                                  />
                                  <span className="flex min-w-0 flex-col">
                                    <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                      <span className="truncate text-data font-medium text-foreground">
                                        {entry.displayName ?? entry.name}
                                      </span>
                                      {entry.updateAvailable ? (
                                        <Badge variant="outline" className="gap-1 border-warning/40 text-warning text-micro">
                                          {t('pluginsAdmin.updateAvailable', {
                                            from: entry.installedVersion ?? '—',
                                            to: entry.version,
                                          })}
                                        </Badge>
                                      ) : entry.installed ? (
                                        <Badge variant="secondary" className="gap-1 text-micro">
                                          <PackageCheck className="h-3 w-3" />
                                          {t('pluginsAdmin.installed')}
                                        </Badge>
                                      ) : null}
                                      {entry.licensing && (
                                        <Badge variant="outline" className="shrink-0 gap-1 border-primary/40 text-primary text-micro">
                                          {t('pluginsAdmin.licensedBadge')}
                                        </Badge>
                                      )}
                                    </span>
                                    <span className="mt-0.5 line-clamp-2 text-mini leading-relaxed text-muted-foreground">
                                      {entry.description || t('pluginsAdmin.noDescription')}
                                    </span>
                                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-micro text-muted-foreground/70">
                                      {entry.author && <span>{entry.author}</span>}
                                      <span className="font-mono">{entry.name}</span>
                                      {(entry.tags ?? []).slice(0, 4).map((tag) => (
                                        <Badge key={tag} variant="outline" className="text-micro">{tag}</Badge>
                                      ))}
                                    </span>
                                  </span>
                                </button>

                                <div className="flex flex-col gap-0.5 font-mono text-micro tabular-nums md:pl-0 pl-6">
                                  <span className="text-foreground">v{entry.version ?? '—'}</span>
                                  {entry.installed && (
                                    <span className="text-muted-foreground/70">
                                      {t('pluginsAdmin.installedVersionShort', {
                                        version: entry.installedVersion ?? '—',
                                      })}
                                    </span>
                                  )}
                                </div>

                                <div className="flex shrink-0 items-center justify-start gap-1.5 md:justify-end">
                                  <Button
                                    size="sm"
                                    className="h-7 rounded-sm px-2.5 text-mini"
                                    variant={entry.updateAvailable ? 'default' : 'outline'}
                                    onClick={() => installMutation.mutate({ entry })}
                                    disabled={busy || (entry.installed && !entry.updateAvailable)}
                                    title={
                                      entry.updateAvailable
                                        ? t('pluginsAdmin.updateTitle', { name: entry.name, version: entry.version })
                                        : entry.installed
                                          ? t('pluginsAdmin.alreadyInstalledTitle', {
                                              name: entry.name,
                                              version: entry.installedVersion ?? entry.version,
                                            })
                                          : t('pluginsAdmin.installTitle', { name: entry.name })
                                    }
                                  >
                                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                    {entry.updateAvailable
                                      ? t('pluginsAdmin.update')
                                      : entry.installed
                                        ? t('pluginsAdmin.installed')
                                        : t('pluginsAdmin.install')}
                                  </Button>
                                </div>
                              </div>

                              {expanded && (
                                <div className="border-t border-border/30 bg-surface-1/20 px-3 py-2.5 md:pl-10">
                                  <p className="max-w-3xl text-mini leading-relaxed text-muted-foreground">
                                    {entry.description || t('pluginsAdmin.noDescription')}
                                  </p>
                                  <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
                                    <div className="flex items-baseline gap-2">
                                      <dt className="type-overline shrink-0">{t('pluginsAdmin.authorLabel')}</dt>
                                      <dd className="truncate text-mini text-foreground">{entry.author || '—'}</dd>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                      <dt className="type-overline shrink-0">{t('pluginsAdmin.sourceColumn')}</dt>
                                      <dd className="truncate font-mono text-mini text-foreground">
                                        {entry.sourceUrl ? sourceHostLabel(entry.sourceUrl) : '—'}
                                      </dd>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                      <dt className="type-overline shrink-0">{t('pluginsAdmin.checksumLabel')}</dt>
                                      <dd className="truncate font-mono text-mini text-muted-foreground" title={entry.sha256}>
                                        {entry.sha256 ?? t('pluginsAdmin.unsigned')}
                                      </dd>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                      <dt className="type-overline shrink-0">{t('pluginsAdmin.downloadLabel')}</dt>
                                      <dd className="min-w-0">
                                        <a
                                          href={entry.downloadUrl}
                                          target="_blank"
                                          rel="noreferrer noopener"
                                          className="inline-flex min-w-0 items-center gap-0.5 font-mono text-mini text-primary hover:underline"
                                        >
                                          <span className="truncate">{entry.downloadUrl}</span>
                                          <ExternalLink className="h-3 w-3 shrink-0" />
                                        </a>
                                      </dd>
                                    </div>
                                    {entry.homepage && (
                                      <div className="flex items-baseline gap-2">
                                        <dt className="type-overline shrink-0">{t('pluginsAdmin.homepage')}</dt>
                                        <dd className="min-w-0">
                                          <a
                                            href={entry.homepage}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            className="inline-flex min-w-0 items-center gap-0.5 text-mini text-primary hover:underline"
                                          >
                                            <Home className="h-3 w-3 shrink-0" />
                                            <span className="truncate">{entry.homepage}</span>
                                          </a>
                                        </dd>
                                      </div>
                                    )}
                                    {entry.licensing?.licenseServer && (
                                      <div className="flex items-baseline gap-2">
                                        <dt className="type-overline shrink-0">
                                          {t('pluginsAdmin.licenseServerLabel')}
                                        </dt>
                                        <dd className="truncate font-mono text-mini text-foreground">
                                          {entry.licensing.licenseServer}
                                        </dd>
                                      </div>
                                    )}
                                    {entry.licensing?.encrypted && (
                                      <div className="flex items-baseline gap-2">
                                        <dt className="type-overline shrink-0">
                                          {t('pluginsAdmin.payloadLabel')}
                                        </dt>
                                        <dd className="text-mini text-warning">{t('pluginsAdmin.encryptedPayload')}</dd>
                                      </div>
                                    )}
                                  </dl>
                                  {entry.licensing?.buyUrl && (
                                    <Button asChild variant="outline" size="sm" className="mt-2 h-7 px-2.5 text-mini">
                                      <a href={entry.licensing.buyUrl} target="_blank" rel="noreferrer noopener">
                                        <Tag className="h-3.5 w-3.5" />
                                        {t('pluginsAdmin.consentLicensingBuy')}
                                      </a>
                                    </Button>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </section>
                  );
                })
              )}
            </div>

            {/* ── Sort / source footer strip ── */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 bg-surface-1/40 px-3 py-1.5">
              <span className="type-overline">{t('pluginsAdmin.sortLabel')}</span>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
                <SelectTrigger className="h-7 w-auto min-w-28 rounded-sm px-2 text-micro">
                  <SlidersHorizontal className="mr-1.5 h-3 w-3 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="relevance">{t('pluginsAdmin.sortRelevance')}</SelectItem>
                  <SelectItem value="name">{t('pluginsAdmin.sortName')}</SelectItem>
                  <SelectItem value="newest">{t('pluginsAdmin.sortNewest')}</SelectItem>
                </SelectContent>
              </Select>
              <span className="ml-auto font-mono text-micro tabular-nums text-muted-foreground">
                {t('pluginsAdmin.resultsCount', { count: filteredEntries.length })}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
