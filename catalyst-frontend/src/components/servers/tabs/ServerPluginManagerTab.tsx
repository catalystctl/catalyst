import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  ArrowUpCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Puzzle,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { formatBytes } from '../../../utils/formatters';
import { pluginManagerApi } from '../../../services/api/pluginManager';
import {
  notifyError,
  notifySuccess,
} from '../../../utils/notify';
import { reportSystemError } from '../../../services/api/systemErrors';
import {
  titleCase,
  normalizeVersionId,
  normalizeVersionLabel,
  filterAndSortVersions,
  formatDownloadCount,
  isStableRelease,
} from '../../../utils/modManagerUtils';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Skeleton } from '../../../components/ui/skeleton';
import EmptyState from '../../shared/EmptyState';
import UpdateConfirmModal, {
  type UpdateItem,
} from './UpdateConfirmModal';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

const cardVariants: Variants = {
  hidden: { opacity: 0, scale: 0.97 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 400, damping: 28 },
  },
  exit: {
    opacity: 0,
    scale: 0.97,
    transition: { duration: 0.15 },
  },
};

const RESULTS_PER_PAGE = 12;

// ── Types ──
interface Props {
  serverId: string | undefined;
  serverGameVersion?: string;
  pluginManagerConfig: any;
}

// ── Skeleton Loaders ──
function BrowseSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-border/50 bg-card/60 p-4"
        >
          <div className="flex gap-3">
            <Skeleton className="h-11 w-11 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/5 rounded" />
              <Skeleton className="h-3 w-full rounded" />
              <Skeleton className="h-3 w-20 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Version Selector Popover ──
function VersionSelector({
  versionOptions,
  selectedVersion,
  onVersionChange,
  isLoading,
  isError,
  onInstall,
  isInstalling,
}: {
  versionOptions: any[];
  selectedVersion: string;
  onVersionChange: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
  onInstall: () => void;
  isInstalling: boolean;
}) {
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeInOut' }}
      className="overflow-hidden"
    >
      <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
        <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Version
        </label>
        {isError ? (
          <p className="text-xs text-danger">Failed to load versions.</p>
        ) : (
          <div className="flex items-end gap-2">
            <div className="relative flex-1">
              <select
                className="w-full appearance-none rounded-lg border border-border bg-surface-2 px-3 py-2 pr-8 text-xs text-foreground transition-colors focus:border-primary-500 focus:outline-none"
                value={selectedVersion}
                onChange={(event) => onVersionChange(event.target.value)}
                disabled={isLoading}
              >
                <option value="">
                  {isLoading ? 'Loading…' : 'Select version'}
                </option>
                {versionOptions.map((version: any) => {
                  const vid = normalizeVersionId(version);
                  const vlabel = normalizeVersionLabel(version);
                  if (!vid) return null;
                  return (
                    <option key={vid} value={String(vid)}>
                      {vlabel}
                    </option>
                  );
                })}
              </select>
              <ChevronLeft className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -rotate-90 text-muted-foreground" />
            </div>
            <Button
              size="sm"
              disabled={!selectedVersion || isInstalling}
              onClick={onInstall}
              className="gap-1.5"
            >
              {isInstalling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {isInstalling ? 'Installing…' : 'Install'}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Main Component ──
export default function ServerPluginManagerTab({
  serverId,
  serverGameVersion,
  pluginManagerConfig,
}: Props) {
  // ── Provider state ──
  const pluginManagerProviders = pluginManagerConfig?.providers ?? [];
  const [pluginProvider, setPluginProvider] = useState('modrinth');

  useEffect(() => {
    if (!pluginManagerProviders.length) return;
    if (!pluginManagerProviders.includes(pluginProvider)) {
      setPluginProvider(pluginManagerProviders[0]);
    }
  }, [pluginManagerProviders, pluginProvider]);

  // ── Browse state ──
  const [pluginQuery, setPluginQuery] = useState('');
  const [pluginGameVersion, setPluginGameVersion] = useState('');
  const [searchPage, setSearchPage] = useState(1);
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const [selectedPluginName, setSelectedPluginName] = useState('');
  const [selectedPluginVersion, setSelectedPluginVersion] = useState('');
  const [pluginSubTab, setPluginSubTab] = useState<'browse' | 'installed'>(
    'browse',
  );

  // ── Installed state ──
  const [selectedPluginFiles, setSelectedPluginFiles] = useState<Set<string>>(
    new Set(),
  );
  const [pluginInstalledSearch, setPluginInstalledSearch] = useState('');
  const [pluginInstalledSort, setPluginInstalledSort] = useState<
    'name' | 'size' | 'date'
  >('name');
  const [pluginInstalledFilter, setPluginInstalledFilter] = useState<
    'all' | 'updates' | 'tracked' | 'untracked'
  >('all');
  const [updateConfirmPlugins, setUpdateConfirmPlugins] = useState<
    UpdateItem[]
  >([]);
  const [isCheckingPluginUpdates, setIsCheckingPluginUpdates] =
    useState(false);
  const [isUpdatingPlugins, setIsUpdatingPlugins] = useState(false);

  // ── Sync game version ──
  useEffect(() => {
    setPluginGameVersion('');
  }, [serverId]);

  useEffect(() => {
    const detectedVersion = serverGameVersion?.trim();
    if (!detectedVersion) return;
    setPluginGameVersion((current) =>
      current ? current : detectedVersion,
    );
  }, [serverGameVersion]);

  // Reset page and selection on filter change
  useEffect(() => {
    setSelectedPlugin(null);
    setSelectedPluginVersion('');
    setSearchPage(1);
  }, [pluginProvider, pluginQuery, pluginGameVersion]);

  useEffect(() => {
    setSelectedPluginVersion('');
  }, [selectedPlugin]);

  // ── Queries ──
  const { data: pluginGameVersionTags } = useQuery({
    queryKey: ['plugin-manager-game-versions', serverId, pluginProvider],
    queryFn: () => pluginManagerApi.gameVersions(serverId ?? '', pluginProvider),
    enabled: Boolean(serverId && pluginProvider === 'modrinth'),
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const {
    data: pluginSearchResults,
    isLoading: pluginSearchLoading,
    isError: pluginSearchError,
  } = useQuery({
    queryKey: [
      'plugin-manager-search',
      serverId,
      pluginProvider,
      pluginQuery,
      pluginGameVersion,
      searchPage,
    ],
    queryFn: () =>
      pluginManagerApi.search(serverId ?? '', {
        provider: pluginProvider,
        query: pluginQuery.trim() || undefined,
        gameVersion: pluginGameVersion.trim() || undefined,
        page: searchPage,
      }),
    enabled: Boolean(serverId && pluginProvider),
  });

  const {
    data: pluginVersions,
    isLoading: pluginVersionsLoading,
    isError: pluginVersionsError,
  } = useQuery({
    queryKey: [
      'plugin-manager-versions',
      serverId,
      pluginProvider,
      selectedPlugin,
    ],
    queryFn: () =>
      pluginManagerApi.versions(serverId ?? '', {
        provider: pluginProvider,
        projectId: selectedPlugin ?? '',
      }),
    enabled: Boolean(serverId && pluginProvider && selectedPlugin),
  });

  const {
    data: installedPlugins = [],
    refetch: refetchInstalledPlugins,
  } = useQuery({
    queryKey: ['plugin-manager-installed', serverId],
    queryFn: () => pluginManagerApi.installed(serverId ?? ''),
    enabled: Boolean(serverId && pluginManagerConfig),
    refetchInterval: 10000,
  });

  // ── Mutations ──
  const uninstallPluginMutation = useMutation({
    mutationFn: (filename: string) =>
      pluginManagerApi.uninstall(serverId!, filename),
    onSuccess: () => {
      notifySuccess('Plugin removed');
      refetchInstalledPlugins();
    },
    onError: (error: any) => {
      notifyError(
        error?.response?.data?.error || 'Failed to remove plugin',
      );
    },
  });

  const installPluginMutation = useMutation({
    mutationFn: () => {
      if (!serverId || !selectedPlugin || !selectedPluginVersion) {
        reportSystemError({ level: 'error', component: 'ServerPluginManagerTab', message: 'Missing plugin selection', metadata: { context: 'install plugin mutation' } });
        throw new Error('Missing plugin selection');
      }
      return pluginManagerApi.install(serverId, {
        provider: pluginProvider,
        projectId: selectedPlugin,
        versionId: selectedPluginVersion,
        projectName: selectedPluginName || undefined,
      });
    },
    onSuccess: () => {
      notifySuccess('Plugin installed successfully');
      refetchInstalledPlugins();
    },
    onError: (error: any) => {
      notifyError(
        error?.response?.data?.error || 'Failed to install plugin',
      );
    },
  });

  // ── Derived data ──
  const pluginResults = useMemo(() => {
    if (!pluginSearchResults) return [];
    if (Array.isArray(pluginSearchResults.hits))
      return pluginSearchResults.hits;
    if (Array.isArray(pluginSearchResults.data))
      return pluginSearchResults.data;
    if (Array.isArray(pluginSearchResults))
      return pluginSearchResults;
    return [];
  }, [pluginSearchResults]);

  const totalHits = (pluginSearchResults as any)?.total_hits ?? pluginResults.length;

  const totalPages = Math.max(1, Math.ceil(totalHits / RESULTS_PER_PAGE));

  const pluginVersionOptions = useMemo(() => {
    if (!pluginVersions) return [];
    const versionsResponse = pluginVersions as any;
    const raw = Array.isArray(versionsResponse.data)
      ? versionsResponse.data
      : Array.isArray(versionsResponse.result)
        ? versionsResponse.result
        : Array.isArray(pluginVersions)
          ? pluginVersions
          : [];
    return filterAndSortVersions(raw, pluginGameVersion);
  }, [pluginGameVersion, pluginVersions]);

  const filteredInstalledPlugins = useMemo(() => {
    let list = [...installedPlugins];
    if (pluginInstalledSearch) {
      const q = pluginInstalledSearch.toLowerCase();
      list = list.filter(
        (p: any) => (p.projectName || p.name).toLowerCase().includes(q),
      );
    }
    if (pluginInstalledFilter === 'updates')
      list = list.filter((p: any) => p.hasUpdate);
    else if (pluginInstalledFilter === 'tracked')
      list = list.filter((p: any) => p.provider);
    else if (pluginInstalledFilter === 'untracked')
      list = list.filter((p: any) => !p.provider);
    list.sort((a: any, b: any) => {
      if (pluginInstalledSort === 'size') return b.size - a.size;
      if (pluginInstalledSort === 'date')
        return (
          new Date(b.modifiedAt || 0).getTime() -
          new Date(a.modifiedAt || 0).getTime()
        );
      return (a.projectName || a.name).localeCompare(
        b.projectName || b.name,
      );
    });
    return list;
  }, [
    installedPlugins,
    pluginInstalledSearch,
    pluginInstalledFilter,
    pluginInstalledSort,
  ]);

  const pluginsWithUpdates = installedPlugins.filter(
    (p: any) => p.hasUpdate,
  );
  const pluginsWithUpdatesSelected = pluginsWithUpdates.filter((p: any) =>
    selectedPluginFiles.has(p.name),
  );

  // Auto-select stable version
  useEffect(() => {
    if (!selectedPlugin) return;
    if (!pluginVersionOptions.length) {
      if (selectedPluginVersion) setSelectedPluginVersion('');
      return;
    }
    if (
      selectedPluginVersion &&
      pluginVersionOptions.some(
        (entry: any) => normalizeVersionId(entry) === selectedPluginVersion,
      )
    ) {
      return;
    }
    const preferred =
      pluginVersionOptions.find((entry: any) =>
        isStableRelease(entry),
      ) ?? pluginVersionOptions[0];
    const preferredId = normalizeVersionId(preferred);
    if (preferredId && preferredId !== selectedPluginVersion) {
      setSelectedPluginVersion(preferredId);
    }
  }, [pluginVersionOptions, selectedPlugin, selectedPluginVersion]);

  // ── Handlers ──
  const handleSearch = useCallback(() => {
    setSearchPage(1);
  }, []);

  const handleUpdatePlugins = async () => {
    if (!serverId) return;
    setIsUpdatingPlugins(true);
    try {
      const filenames = updateConfirmPlugins.map((p) => p.name);
      const results = await pluginManagerApi.update(serverId, filenames);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      if (failed > 0)
        notifyError(
          `${failed} plugin${failed !== 1 ? 's' : ''} failed to update`,
        );
      if (succeeded > 0)
        notifySuccess(
          `${succeeded} plugin${succeeded !== 1 ? 's' : ''} updated successfully`,
        );
      refetchInstalledPlugins();
      setUpdateConfirmPlugins([]);
    } catch {
      notifyError('Failed to update plugins');
    } finally {
      setIsUpdatingPlugins(false);
    }
  };

  const handleCheckUpdates = async () => {
    if (!serverId) return;
    setIsCheckingPluginUpdates(true);
    try {
      const result = await pluginManagerApi.checkUpdates(serverId);
      refetchInstalledPlugins();
      if (result.updatesAvailable > 0) {
        notifySuccess(
          `${result.updatesAvailable} update${result.updatesAvailable !== 1 ? 's' : ''} available`,
        );
      } else {
        notifySuccess('All plugins are up to date');
      }
    } catch {
      notifyError('Failed to check for updates');
    } finally {
      setIsCheckingPluginUpdates(false);
    }
  };

  // ── Guard ──
  if (!pluginManagerConfig) {
    return (
      <EmptyState
        title="Plugin manager not available"
        description="This server template does not have a plugin manager configured."
      />
    );
  }

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-5"
    >
      {/* ── Header ── */}
      <motion.div
        variants={itemVariants}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-violet-500 to-purple-500 opacity-20 blur-sm" />
              <Puzzle className="relative h-7 w-7 text-violet-600 dark:text-violet-400" />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
              Plugins
            </h1>
          </div>
          <p className="ml-10 text-sm text-muted-foreground">
            Browse and install plugins for your server
          </p>
        </div>
        <div className="flex items-center gap-2">
          {installedPlugins.length > 0 && (
            <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
              <Package className="h-2.5 w-2.5" />
              {installedPlugins.length} installed
            </Badge>
          )}
          {pluginsWithUpdates.length > 0 && (
            <Badge variant="warning" className="h-8 gap-1.5 px-3 text-xs">
              <ArrowUpCircle className="h-2.5 w-2.5" />
              {pluginsWithUpdates.length} update{pluginsWithUpdates.length !== 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </motion.div>

      {/* ── Sub-tab toggle ── */}
      <motion.div variants={itemVariants} className="flex items-center gap-1 rounded-xl border border-border bg-card/80 p-1 backdrop-blur-sm">
        {(['browse', 'installed'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            className={`relative flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all duration-200 ${
              pluginSubTab === tab
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => {
              setPluginSubTab(tab);
              if (tab === 'installed') refetchInstalledPlugins();
            }}
          >
            {tab === 'browse' ? 'Browse' : 'Installed'}
            {tab === 'installed' && installedPlugins.length > 0 && (
              <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] ${
                pluginSubTab === 'installed' ? 'bg-white/20' : 'bg-surface-2'
              }`}>
                {installedPlugins.length}
              </span>
            )}
          </button>
        ))}
      </motion.div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BROWSE TAB                                                       */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div
        style={{ display: pluginSubTab === 'browse' ? 'contents' : 'none' }}
        className="space-y-4"
      >
            {/* ── Filters ── */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-center gap-2.5"
            >
              {/* Search */}
              <div className="relative min-w-[200px] flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={pluginQuery}
                  onChange={(e) => setPluginQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch();
                  }}
                  placeholder="Search plugins…"
                  className="pl-9"
                />
              </div>

              {/* Game version */}
              <div className="relative">
                <Input
                  value={pluginGameVersion}
                  onChange={(e) => setPluginGameVersion(e.target.value)}
                  placeholder={serverGameVersion || 'Game version'}
                  className="w-40"
                  list="plugin-game-version-tags"
                />
                {pluginProvider === 'modrinth' && pluginGameVersionTags && pluginGameVersionTags.length > 0 && (
                  <datalist id="plugin-game-version-tags">
                    <option value="latest" />
                    {pluginGameVersionTags.slice(0, 30).map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </div>

              {/* Provider */}
              <select
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                value={pluginProvider}
                onChange={(e) => setPluginProvider(e.target.value)}
              >
                {pluginManagerProviders.map((provider: string) => (
                  <option key={provider} value={provider}>
                    {provider === 'spiget' ? 'Spigot' : titleCase(provider)}
                  </option>
                ))}
              </select>

              {/* Search button */}
              <Button
                size="sm"
                onClick={handleSearch}
                disabled={pluginSearchLoading}
                className="gap-1.5"
              >
                {pluginSearchLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                Search
              </Button>
            </motion.div>

            {/* ── Results area ── */}
            {pluginSearchLoading ? (
              <BrowseSkeleton />
            ) : pluginSearchError ? (
              <motion.div
                variants={itemVariants}
                className="rounded-xl border border-danger/30 bg-danger-muted p-4 text-sm text-danger"
              >
                Unable to load search results. Check your provider API keys in
                admin settings.
              </motion.div>
            ) : pluginResults.length === 0 ? (
              <motion.div variants={itemVariants}>
                <EmptyState
                  title="No results"
                  description={
                    pluginQuery.trim()
                      ? 'Try a different search term or adjust your filters.'
                      : 'Search for a plugin to get started.'
                  }
                />
              </motion.div>
            ) : (
              <>
                {/* Results count + pagination info */}
                <motion.div
                  variants={itemVariants}
                  className="flex items-center justify-between"
                >
                  <span className="text-xs text-muted-foreground">
                    {totalHits.toLocaleString()} result{totalHits !== 1 ? 's' : ''}
                    {totalHits > RESULTS_PER_PAGE && (
                      <> · Page {searchPage} of {totalPages}</>
                    )}
                  </span>
                  {totalHits > RESULTS_PER_PAGE && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={searchPage <= 1}
                        onClick={() => setSearchPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="min-w-[4rem] text-center text-xs text-muted-foreground">
                        {searchPage} / {totalPages}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        disabled={searchPage >= totalPages}
                        onClick={() => setSearchPage((p) => Math.min(totalPages, p + 1))}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </motion.div>

                {/* Result cards */}
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                  <AnimatePresence>
                    {pluginResults.map((entry: any) => {
                      const id =
                        pluginProvider === 'paper'
                          ? encodeURIComponent(
                              (entry.owner?.name && entry.slug
                                ? `${entry.owner.name}/${entry.slug}`
                                : entry.slug || entry.id) ?? '',
                            )
                          : entry.project_id ||
                            entry.id ||
                            entry.resourceId ||
                            entry.slug ||
                            entry.name;
                      const title =
                        entry.name ||
                        entry.title ||
                        entry.tag ||
                        entry.slug ||
                        'Untitled';
                      const summary =
                        entry.description ||
                        entry.summary ||
                        entry.tag ||
                        '';
                      const isActive =
                        selectedPlugin === String(id);
                      const imageUrl =
                        pluginProvider === 'modrinth'
                          ? entry.icon_url
                          : pluginProvider === 'paper'
                            ? entry.avatarUrl
                            : entry.icon?.url || entry.icon?.data;
                      const fallbackLabel = title
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((s: string) => s[0]?.toUpperCase() ?? '')
                        .join('');
                      const downloads =
                        entry.downloads ?? entry.stats?.downloads ?? 0;
                      let externalUrl = '';
                      if (pluginProvider === 'modrinth') {
                        const slug =
                          entry.slug || entry.project_id || entry.id;
                        externalUrl = slug
                          ? `https://modrinth.com/plugin/${slug}`
                          : '';
                      } else if (pluginProvider === 'paper') {
                        const hangarOwner = entry.owner?.name || entry.namespace?.owner;
                        const hangarSlug = entry.slug || entry.namespace?.slug;
                        externalUrl =
                          hangarOwner && hangarSlug
                            ? `https://hangar.papermc.io/${hangarOwner}/${hangarSlug}`
                            : '';
                      } else {
                        externalUrl = id
                          ? `https://www.spigotmc.org/resources/${id}/`
                          : '';
                      }

                      return (
                        <motion.div
                          key={String(id)}
                          variants={cardVariants}
                          layout
                          layoutId={`plugin-${String(id)}`}
                          className={`group relative rounded-xl border p-4 transition-all duration-200 ${
                            isActive
                              ? 'border-primary/50 bg-primary-muted/50 ring-1 ring-primary/20 shadow-lg shadow-primary/5'
                              : 'border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/30 hover:shadow-md'
                          }`}
                          onClick={() => {
                            setSelectedPlugin(
                              isActive ? null : String(id),
                            );
                            setSelectedPluginName(title);
                          }}
                        >
                          <div className="flex gap-3">
                            {imageUrl ? (
                              <img
                                src={imageUrl}
                                alt=""
                                loading="lazy"
                                className="h-11 w-11 rounded-lg object-cover ring-1 ring-black/5"
                              />
                            ) : (
                              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2 text-xs font-bold text-muted-foreground">
                                {fallbackLabel || 'PL'}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <span className="truncate text-sm font-semibold text-foreground">
                                  {title}
                                </span>
                                {externalUrl && (
                                  <a
                                    href={externalUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="shrink-0 rounded-md p-0.5 opacity-0 transition-all hover:bg-surface-2 group-hover:opacity-100"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary-500" />
                                  </a>
                                )}
                              </div>
                              {summary && (
                                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                                  {summary}
                                </p>
                              )}
                              {downloads > 0 && (
                                <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                                  <Download className="h-3 w-3" />
                                  {formatDownloadCount(downloads)}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Expanded version selector */}
                          <AnimatePresence>
                            {isActive && (
                              <VersionSelector
                                versionOptions={pluginVersionOptions}
                                selectedVersion={selectedPluginVersion}
                                onVersionChange={setSelectedPluginVersion}
                                isLoading={pluginVersionsLoading}
                                isError={pluginVersionsError}
                                onInstall={() =>
                                  installPluginMutation.mutate()
                                }
                                isInstalling={
                                  installPluginMutation.isPending
                                }
                              />
                            )}
                          </AnimatePresence>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                </motion.div>

                {/* Bottom pagination */}
                {totalHits > RESULTS_PER_PAGE && (
                  <motion.div
                    variants={itemVariants}
                    className="flex items-center justify-center gap-2 pt-2"
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={searchPage <= 1}
                      onClick={() =>
                        setSearchPage((p) => Math.max(1, p - 1))
                      }
                      className="gap-1.5"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from(
                        {
                          length: Math.min(totalPages, 5),
                        },
                        (_, i) => {
                          let pageNum: number;
                          if (totalPages <= 5) {
                            pageNum = i + 1;
                          } else if (searchPage <= 3) {
                            pageNum = i + 1;
                          } else if (searchPage >= totalPages - 2) {
                            pageNum = totalPages - 4 + i;
                          } else {
                            pageNum = searchPage - 2 + i;
                          }
                          return (
                            <button
                              key={pageNum}
                              type="button"
                              className={`h-8 min-w-8 rounded-lg px-2 text-xs font-medium transition-colors ${
                                searchPage === pageNum
                                  ? 'bg-primary text-white shadow-sm'
                                  : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
                              }`}
                              onClick={() => setSearchPage(pageNum)}
                            >
                              {pageNum}
                            </button>
                          );
                        },
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={searchPage >= totalPages}
                      onClick={() =>
                        setSearchPage((p) =>
                          Math.min(totalPages, p + 1),
                        )
                      }
                      className="gap-1.5"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </motion.div>
                )}
              </>
            )}
          </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* INSTALLED TAB                                                     */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div
          style={{ display: pluginSubTab === 'installed' ? 'contents' : 'none' }}
          className="space-y-3"
        >
            {/* ── Toolbar ── */}
            <motion.div
              variants={itemVariants}
              className="flex flex-wrap items-center gap-2.5"
            >
              <div className="relative min-w-[200px] flex-1 max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={pluginInstalledSearch}
                  onChange={(e) =>
                    setPluginInstalledSearch(e.target.value)
                  }
                  placeholder="Search installed plugins…"
                  className="pl-9"
                />
              </div>

              <select
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                value={pluginInstalledFilter}
                onChange={(e) =>
                  setPluginInstalledFilter(
                    e.target.value as typeof pluginInstalledFilter,
                  )
                }
              >
                <option value="all">All</option>
                <option value="updates">Has Updates</option>
                <option value="tracked">Tracked</option>
                <option value="untracked">Untracked</option>
              </select>

              <select
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                value={pluginInstalledSort}
                onChange={(e) =>
                  setPluginInstalledSort(
                    e.target.value as typeof pluginInstalledSort,
                  )
                }
              >
                <option value="name">Name</option>
                <option value="size">Size</option>
                <option value="date">Date</option>
              </select>

              <div className="ml-auto flex items-center gap-1.5">
                {pluginsWithUpdates.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-warning/30 text-warning hover:bg-warning/10 hover:text-warning"
                    disabled={isUpdatingPlugins}
                    onClick={() => {
                      const modsToUpdate =
                        pluginsWithUpdatesSelected.length > 0
                          ? pluginsWithUpdatesSelected
                          : pluginsWithUpdates;
                      if (!modsToUpdate.length) return;
                      setUpdateConfirmPlugins(
                        modsToUpdate.map((p: any) => ({
                          name: p.name,
                          currentVersion:
                            p.versionId || 'unknown',
                          latestVersion:
                            p.latestVersionName ||
                            p.latestVersionId ||
                            'latest',
                        })),
                      );
                    }}
                  >
                    <ArrowUpCircle className="h-3.5 w-3.5" />
                    Update
                    {pluginsWithUpdatesSelected.length > 0
                      ? ` (${pluginsWithUpdatesSelected.length})`
                      : ` All (${pluginsWithUpdates.length})`}
                  </Button>
                )}

                {selectedPluginFiles.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-danger/30 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => {
                      if (
                        !confirm(
                          `Remove ${selectedPluginFiles.size} selected plugin${selectedPluginFiles.size !== 1 ? 's' : ''}?`,
                        )
                      )
                        return;
                      selectedPluginFiles.forEach((name) =>
                        uninstallPluginMutation.mutate(name),
                      );
                      setSelectedPluginFiles(new Set());
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove ({selectedPluginFiles.size})
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isCheckingPluginUpdates}
                  onClick={handleCheckUpdates}
                  className="gap-1.5"
                >
                  {isCheckingPluginUpdates ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Check Updates
                </Button>
              </div>
            </motion.div>

            {/* Count bar */}
            <motion.div
              variants={itemVariants}
              className="flex items-center justify-between px-1"
            >
              <span className="text-xs text-muted-foreground">
                {filteredInstalledPlugins.length}
                {filteredInstalledPlugins.length !==
                installedPlugins.length
                  ? ` of ${installedPlugins.length}`
                  : ''}{' '}
                plugin{installedPlugins.length !== 1 ? 's' : ''}
              </span>
              {filteredInstalledPlugins.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => {
                    if (
                      selectedPluginFiles.size ===
                      filteredInstalledPlugins.length
                    ) {
                      setSelectedPluginFiles(new Set());
                    } else {
                      setSelectedPluginFiles(
                        new Set(
                          filteredInstalledPlugins.map(
                            (p: any) => p.name,
                          ),
                        ),
                      );
                    }
                  }}
                >
                  {selectedPluginFiles.size ===
                    filteredInstalledPlugins.length &&
                  selectedPluginFiles.size > 0
                    ? 'Deselect all'
                    : 'Select all'}
                </button>
              )}
            </motion.div>

            {/* ── Plugin list ── */}
            {filteredInstalledPlugins.length === 0 ? (
              <motion.div variants={itemVariants}>
                <EmptyState
                  title={
                    pluginInstalledSearch ||
                    pluginInstalledFilter !== 'all'
                      ? 'No matching plugins'
                      : 'No plugins installed'
                  }
                  description={
                    pluginInstalledSearch ||
                    pluginInstalledFilter !== 'all'
                      ? 'Try adjusting your search or filter.'
                      : 'Install plugins from the Browse tab to see them here.'
                  }
                />
              </motion.div>
            ) : (
              <motion.div
                variants={containerVariants}
                initial="hidden"
                animate="visible"
                className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm"
              >
                <AnimatePresence>
                  {filteredInstalledPlugins.map((plugin: any) => {
                    const isSelected = selectedPluginFiles.has(
                      plugin.name,
                    );
                    return (
                      <motion.div
                        key={plugin.name}
                        variants={itemVariants}
                        layout
                        className={`group flex items-center gap-3 border-b border-border/50 px-4 py-3 transition-colors last:border-0 ${
                          isSelected
                            ? 'bg-primary-500/5'
                            : 'hover:bg-surface-2/60'
                        }`}
                      >
                        {/* Checkbox */}
                        <button
                          type="button"
                          className="shrink-0 rounded-md transition-colors hover:bg-surface-2"
                          onClick={() => {
                            const next = new Set(selectedPluginFiles);
                            if (isSelected)
                              next.delete(plugin.name);
                            else next.add(plugin.name);
                            setSelectedPluginFiles(next);
                          }}
                        >
                          <div
                            className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${
                              isSelected
                                ? 'border-primary bg-primary text-white'
                                : 'border-border bg-background group-hover:border-primary/40'
                            }`}
                          >
                            {isSelected && (
                              <svg
                                className="h-3 w-3"
                                viewBox="0 0 12 12"
                                fill="none"
                              >
                                <path
                                  d="M2.5 6L5 8.5L9.5 3.5"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </div>
                        </button>

                        {/* Icon */}
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            plugin.hasUpdate
                              ? 'bg-warning/10'
                              : 'bg-surface-2'
                          }`}
                        >
                          <Puzzle
                            className={`h-4 w-4 ${
                              plugin.hasUpdate
                                ? 'text-warning'
                                : 'text-muted-foreground'
                            }`}
                          />
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {plugin.projectName || plugin.name}
                            </span>
                            {plugin.hasUpdate && (
                              <Badge
                                variant="warning"
                                className="gap-1 px-1.5 py-0 text-[10px]"
                              >
                                <ArrowUpCircle className="h-2.5 w-2.5" />
                                Update
                              </Badge>
                            )}
                            {plugin.provider && (
                              <Badge
                                variant="secondary"
                                className="px-1.5 py-0 text-[10px] capitalize"
                              >
                                {plugin.provider}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span className="font-mono">
                              {formatBytes(plugin.size)}
                            </span>
                            {plugin.modifiedAt && (
                              <span>
                                {new Date(
                                  plugin.modifiedAt,
                                ).toLocaleDateString()}
                              </span>
                            )}
                            {!plugin.provider && (
                              <span className="italic text-foreground/60">
                                untracked
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Update arrow */}
                        {plugin.hasUpdate && plugin.latestVersionName && (
                          <div className="hidden items-center gap-1.5 sm:flex">
                            <span className="text-[11px] text-muted-foreground line-through">
                              {plugin.versionId?.length > 12
                                ? plugin.versionId.slice(0, 8) + '…'
                                : plugin.versionId}
                            </span>
                            <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[11px] font-medium text-warning">
                              {plugin.latestVersionName}
                            </span>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {plugin.hasUpdate && (
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-warning transition-colors hover:bg-warning/10"
                              title="Update to latest version"
                              disabled={isUpdatingPlugins}
                              onClick={() =>
                                setUpdateConfirmPlugins([
                                  {
                                    name: plugin.name,
                                    currentVersion:
                                      plugin.versionId || 'unknown',
                                    latestVersion:
                                      plugin.latestVersionName ||
                                      plugin.latestVersionId ||
                                      'latest',
                                  },
                                ])
                              }
                            >
                              <ArrowUpCircle className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                            title="Remove"
                            onClick={() => {
                              if (
                                confirm(
                                  `Remove ${plugin.projectName || plugin.name}?`,
                                )
                              )
                                uninstallPluginMutation.mutate(
                                  plugin.name,
                                );
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </motion.div>
            )}
          </div>

      {/* Update confirmation modal */}
      <UpdateConfirmModal
        itemType="Plugin"
        items={updateConfirmPlugins}
        isUpdating={isUpdatingPlugins}
        warningMessage="⚠️ Updating plugins may cause compatibility issues. Test on a staging server if possible, and always maintain backups."
        onCancel={() => setUpdateConfirmPlugins([])}
        onConfirm={handleUpdatePlugins}
      />
    </motion.div>
  );
}
