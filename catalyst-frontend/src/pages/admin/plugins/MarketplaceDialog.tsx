import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation } from '@/csync';
import {
  ExternalLink,
  ChevronDown,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  Store,
  Trash2,
  SlidersHorizontal,
  Tag,
} from 'lucide-react';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  addMarketplaceSource,
  deleteMarketplaceSource,
  fetchMarketplace,
  fetchMarketplaceSources,
  installPlugin,
  updateMarketplaceSource,
  type MarketplaceBrowseResult,
  type MarketplaceEntry,
  type MarketplaceSource,
} from '../../../plugins/api';
import { queryClient } from '@/lib/queryClient';
import { toast } from 'sonner';
import { notifyError } from '../../../utils/notify';
import { formatDateTime, formatTime } from '../../../i18n/format';
import { BracketLabel } from '@/components/deck/primitives';

/** Host label for a marketplace URL that never throws on malformed input. */
function sourceHostLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** True when marketplace is a strictly newer x.y.z than the installed copy. */
function isNewerVersion(installed: string | null | undefined, marketplace: string | null | undefined): boolean {
  if (!installed || !marketplace) return false;
  const parts = (v: string) => v.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const a = parts(installed);
  const b = parts(marketplace);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return true;
    if ((b[i] ?? 0) < (a[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Marketplace browser: lists plugin packages from the configured index
 * sources and installs them into the panel. Installing places inert code —
 * enabling still runs through the safety-consent gate.
 */
export function MarketplaceDialog({
  open,
  onOpenChange,
  onInstalled,
  installedVersions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any successful install so lists refresh. */
  onInstalled: () => void;
  /** Installed plugin name → version, used to flag updates even if the API omits it. */
  installedVersions?: Record<string, string>;
}) {
  const { t } = useTranslation('admin-system');
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'available' | 'installed' | 'updates'>('all');
  const [sortBy, setSortBy] = useState<'relevance' | 'name' | 'newest'>('relevance');
  const [tagFilter, setTagFilter] = useState('all');
  const [manageSourcesOpen, setManageSourcesOpen] = useState(false);
  const [collapsedSources, setCollapsedSources] = useState<Record<string, boolean>>({});
  const [installingName, setInstallingName] = useState<string | null>(null);
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [newSourceLabel, setNewSourceLabel] = useState('');
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['plugins', 'marketplace'],
    queryFn: () => fetchMarketplace(true),
    enabled: open,
    staleTime: 0,
  });

  const {
    data: sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
  } = useQuery({
    queryKey: ['plugins', 'marketplace-sources'],
    queryFn: () => fetchMarketplaceSources(),
    enabled: open,
    staleTime: 0,
  });

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
        const installed = entry.installedVersion ?? installedVersions?.[entry.name] ?? null;
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
      refreshMarketplace();
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
      refreshMarketplace();
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
      onInstalled();
      void refreshMarketplace({ silent: true });
    },
    onSettled: () => setInstallingName(null),
    onError: (error: any) => notifyError(error),
  });

  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    const q = searchQuery.trim().toLowerCase();
    const annotated = data.entries.map((entry) => {
      const installedVersion = entry.installedVersion ?? installedVersions?.[entry.name] ?? null;
      const installed = Boolean(entry.installed || installedVersion);
      const updateAvailable =
        Boolean(entry.updateAvailable) || isNewerVersion(installedVersion, entry.version);
      return { ...entry, installed, installedVersion, updateAvailable };
    });
    const filtered = annotated.filter((e) => {
      const matchesSource = sourceFilter === 'all' || e.sourceUrl === sourceFilter;
      const matchesTag = tagFilter === 'all' || (e.tags ?? []).includes(tagFilter);
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'available' && !e.installed) ||
        (statusFilter === 'installed' && e.installed) ||
        (statusFilter === 'updates' && e.updateAvailable);
      const matchesSearch = !q ||
      [e.displayName ?? '', e.name, e.description ?? '', e.author ?? '', ...(e.tags ?? [])]
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
  }, [data?.entries, searchQuery, installedVersions, sourceFilter, tagFilter, statusFilter, sortBy]);

  const availableTags = useMemo(() => {
    const tags = new Set((data?.entries ?? []).flatMap((entry) => entry.tags ?? []));
    return [...tags].sort((a, b) => a.localeCompare(b));
  }, [data?.entries]);

  const entriesBySource = useMemo(() => {
    const groups = new Map<string, MarketplaceEntry[]>();
    for (const entry of filteredEntries) {
      const key = entry.sourceUrl ?? 'unknown';
      const group = groups.get(key) ?? [];
      group.push(entry);
      groups.set(key, group);
    }
    return [...groups.entries()];
  }, [filteredEntries]);

  const counts = useMemo(() => ({
    all: filteredEntries.length,
    available: filteredEntries.filter((entry) => !entry.installed).length,
    installed: filteredEntries.filter((entry) => entry.installed).length,
    updates: filteredEntries.filter((entry) => entry.updateAvailable).length,
  }), [filteredEntries]);

  const healthByUrl = useMemo(() => {
    const map = new Map<string, { ok: boolean; error?: string; entryCount: number }>();
    for (const s of data?.sources ?? []) map.set(s.url, s);
    return map;
  }, [data?.sources]);

    const originLabel = (origin: MarketplaceSource['origin']): string => {
    if (origin === 'official') return t('pluginsAdmin.originOfficial');
    if (origin === 'env') return t('pluginsAdmin.originEnv');
    return t('pluginsAdmin.originAdded');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="plugin-marketplace">
        <DialogHeader icon={<Store className="h-4 w-4" />}>
          <DialogTitle>{t('pluginsAdmin.marketplaceTitle')}</DialogTitle>
          <DialogDescription>
            {t('pluginsAdmin.marketplaceDescription')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-4">
            {/* In-panel source manager: add more marketplaces without env edits. */}
            <section aria-label={t('pluginsAdmin.marketplaces')} className="border-b border-border/40 pb-3">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 py-1 text-left text-muted-foreground hover:text-foreground"
                onClick={() => setManageSourcesOpen((open) => !open)}
                aria-expanded={manageSourcesOpen}
              >
                <div className="flex items-center gap-2">
                  <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${manageSourcesOpen ? '' : '-rotate-90'}`} />
                  <BracketLabel tone="muted">{t('pluginsAdmin.marketplaces')}</BracketLabel>
                  {sources && sources.length > 0 && (
                    <span className="font-mono text-micro tabular-nums text-muted-foreground">
                      {sources.length}
                    </span>
                  )}
                </div>
                <p className="text-micro text-muted-foreground">{t('pluginsAdmin.browsedTogether')}</p>
              </button>
              {manageSourcesOpen && <div className="mt-3 space-y-3">
              {sourcesLoading ? (
                <div className="flex items-center gap-2 py-3 text-mini text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('pluginsAdmin.loadingMarketplaces')}
                </div>
              ) : sources && sources.length > 0 ? (
                <ul className="divide-y divide-border/30">
                  {sources.map((source) => {
                    const health = healthByUrl.get(source.url);
                    const busy = pendingSourceId === source.id;
                    return (
                      <li key={source.id} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="max-w-full truncate text-mini font-medium text-foreground">
                              {source.label?.trim() || sourceHostLabel(source.url)}
                            </span>
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
                                {health.ok ? t('pluginsAdmin.pluginCount', { count: health.entryCount }) : health.error}
                              </span>
                            ) : null}
                          </div>
                          <p
                            className="max-w-full truncate font-mono text-micro text-muted-foreground/70"
                            title={source.url}
                          >
                            {source.url}
                          </p>
                        </div>
                        {source.removable ? (
                          <>
                            <Switch
                              checked={source.enabled}
                              disabled={busy}
                              aria-label={t('pluginsAdmin.toggleSourceAria', {
                                action: source.enabled ? t('common:actions.disable') : t('common:actions.enable'),
                                url: source.url,
                              })}
                              onCheckedChange={(checked) =>
                                toggleSourceMutation.mutate({ id: source.id, enabled: checked })
                              }
                            />
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('pluginsAdmin.removeSourceAria', { url: source.url })}
                              disabled={busy}
                              onClick={() => deleteSourceMutation.mutate({ id: source.id })}
                            >
                              {busy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </>
                        ) : (
                          <Badge variant="secondary" className="shrink-0 text-micro">
                            {t('pluginsAdmin.alwaysOn')}
                          </Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-mini text-muted-foreground">
                  {t('pluginsAdmin.noMarketplaceConfigured')}
                </p>
              )}
              <form
                className="mt-2 flex flex-col gap-2 sm:flex-row"
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
                  className="h-7 flex-1 rounded-sm font-mono text-mini"
                />
                <Input
                  value={newSourceLabel}
                  onChange={(e) => setNewSourceLabel(e.target.value)}
                  placeholder={t('pluginsAdmin.labelOptionalPlaceholder')}
                  aria-label={t('pluginsAdmin.newSourceLabelAria')}
                  className="h-7 rounded-sm text-mini sm:w-36"
                />
                <Button
                  type="submit"
                  size="sm"
                  className="h-8 px-3 text-mini"
                  disabled={!newSourceUrl.trim() || pendingSourceId === 'new'}
                >
                  {pendingSourceId === 'new' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  {t('pluginsAdmin.add')}
                </Button>
              </form>
              </div>}
            </section>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('pluginsAdmin.searchPlaceholder')}
                  className="h-7 rounded-sm pl-8 text-mini"
                  aria-label={t('pluginsAdmin.searchAria')}
                />
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
              {lastChecked && (
                <span className="shrink-0 font-mono text-micro tabular-nums text-muted-foreground" title={formatDateTime(lastChecked)}>
                  {t('pluginsAdmin.checkedAt', { time: formatTime(lastChecked) })}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5" aria-label={t('pluginsAdmin.filterAria')}>
              {([
                ['all', t('pluginsAdmin.filterAll')],
                ['available', t('pluginsAdmin.install')],
                ['updates', t('pluginsAdmin.update')],
                ['installed', t('pluginsAdmin.installed')],
              ] as const).map(([status, label]) => (
                <Button
                  key={status}
                  type="button"
                  variant={statusFilter === status ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 rounded-sm px-2.5 text-micro"
                  onClick={() => setStatusFilter(status)}
                >
                  {label}
                  <span className="ml-1 font-mono tabular-nums text-muted-foreground">{counts[status]}</span>
                </Button>
              ))}
              <select
                value={sourceFilter}
                onChange={(event) => setSourceFilter(event.target.value)}
                aria-label={t('pluginsAdmin.sourceFilterAria')}
                className="ml-auto h-7 max-w-full rounded-sm border border-border/60 bg-background px-2 text-micro text-foreground"
              >
                <option value="all">{t('pluginsAdmin.allMarketplaces')}</option>
                {(sources ?? []).filter((source) => source.enabled).map((source) => (
                  <option key={source.url} value={source.url}>
                    {source.label?.trim() || sourceHostLabel(source.url)}
                  </option>
                ))}
              </select>
              <Select value={tagFilter} onValueChange={setTagFilter}>
                <SelectTrigger className="h-7 w-auto min-w-28 rounded-sm px-2 text-micro">
                  <Tag className="mr-1.5 h-3 w-3 text-muted-foreground" />
                  <SelectValue placeholder={t('pluginsAdmin.allTags')} />
                </SelectTrigger>
                <SelectContent className="max-h-[min(18rem,calc(100vh-2rem))] max-w-[calc(100vw-2rem)]">
                  <SelectItem value="all">{t('pluginsAdmin.allTags')}</SelectItem>
                  {availableTags.map((tag) => (
                    <SelectItem key={tag} value={tag} className="whitespace-normal break-words">
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
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
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !data || data.sources.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border/50 px-4 py-6 text-center">
                <p className="text-data font-medium text-foreground">{t('pluginsAdmin.emptyMarketplaceTitle')}</p>
                <p className="mt-1 text-mini leading-relaxed text-muted-foreground">
                  {t('pluginsAdmin.emptyDescription')}
                </p>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="rounded-sm border border-dashed border-border/50 px-4 py-6 text-center">
                <p className="text-mini text-muted-foreground">{t('pluginsAdmin.noSearchResults')}</p>
              </div>
            ) : (
              <div className="space-y-6">
                {entriesBySource.map(([sourceUrl, entries]) => {
                  const source = sources?.find((item) => item.url === sourceUrl);
                  const collapsed = collapsedSources[sourceUrl] ?? false;
                  return (
                    <section key={sourceUrl}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 border-b border-border/50 pb-2 text-left hover:text-primary"
                        onClick={() => setCollapsedSources((current) => ({ ...current, [sourceUrl]: !collapsed }))}
                        aria-expanded={!collapsed}
                      >
                        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                        <span className="min-w-0 flex-1 truncate text-mini font-medium text-foreground">
                          {source?.label?.trim() || sourceHostLabel(sourceUrl)}
                        </span>
                        <Badge variant="outline" className="text-micro">{entries.length}</Badge>
                        {source && <Badge variant="secondary" className="text-micro">{originLabel(source.origin)}</Badge>}
                      </button>
                      {!collapsed && <ul className="divide-y divide-border/40">
                {entries.map((entry) => (
                  <li key={`${entry.name}:${entry.version ?? ''}`} className="flex min-w-0 items-start gap-4 py-3 transition-colors hover:bg-surface-1/30">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {entry.displayName ?? entry.name}
                        </span>
                        {entry.version && (
                          <span className="font-mono text-micro tabular-nums text-muted-foreground">
                            v{entry.version}
                          </span>
                        )}
                        {entry.licensing && (
                          <Badge variant="outline" className="shrink-0 gap-1 border-primary/40 text-primary text-micro">
                            {t('pluginsAdmin.licensedBadge')}
                          </Badge>
                        )}
                        {entry.updateAvailable ? (
                          <Badge variant="outline" className="gap-1 border-warning/40 text-warning text-micro">
                            {entry.installedVersion
                              ? t('pluginsAdmin.updateAvailable', { from: entry.installedVersion, to: entry.version })
                              : t('pluginsAdmin.updateTo', { version: entry.version })}
                          </Badge>
                        ) : entry.installed ? (
                          <Badge variant="secondary" className="gap-1 text-micro">
                            <PackageCheck className="h-3 w-3" />
                            {t('pluginsAdmin.installed')}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 line-clamp-2 text-mini leading-relaxed text-muted-foreground">
                        {entry.description || t('pluginsAdmin.noDescription')}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {entry.author && (
                          <span className="text-micro text-muted-foreground/70">{entry.author}</span>
                        )}
                        {entry.sourceUrl && (data?.sources.length ?? 0) > 1 && (
                          <span
                            className="max-w-full truncate font-mono text-micro text-muted-foreground/60"
                            title={entry.sourceUrl}
                          >
                            {t('pluginsAdmin.viaHost', { host: sourceHostLabel(entry.sourceUrl) })}
                          </span>
                        )}
                        {(entry.tags ?? []).slice(0, 4).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-micro">
                            {tag}
                          </Badge>
                        ))}
                        {entry.homepage && (
                          <a
                            href={entry.homepage}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-0.5 text-micro text-primary hover:underline"
                          >
                            {t('pluginsAdmin.homepage')}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2 pt-0.5">
                    <Button
                      size="sm"
                      className="h-8 px-3 text-mini"
                      variant={entry.updateAvailable ? 'default' : entry.installed ? 'outline' : 'default'}
                      onClick={() => installMutation.mutate({ entry })}
                      disabled={installingName === entry.name || (entry.installed && !entry.updateAvailable)}
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
                      {installingName === entry.name && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                      {entry.updateAvailable ? t('pluginsAdmin.update') : entry.installed ? t('pluginsAdmin.installed') : t('pluginsAdmin.install')}
                    </Button>
                    </div>
                  </li>
                ))}
                      </ul>}
                    </section>
                  );
                })}
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" className="h-8 px-3 text-mini" onClick={() => onOpenChange(false)}>
            {t('common:actions.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
