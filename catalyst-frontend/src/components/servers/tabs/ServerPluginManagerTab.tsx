import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowUpCircle,
  CheckSquare,
  Download,
  ExternalLink,
  Loader2,
  Puzzle,
  RefreshCw,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { formatBytes } from '../../../utils/formatters';
import { pluginManagerApi } from '../../../services/api/pluginManager';
import {
  notifyError,
  notifySuccess,
} from '../../../utils/notify';
import {
  titleCase,
  displayProviderName,
  normalizeVersionId,
  normalizeVersionLabel,
  filterAndSortVersions,
  formatDownloadCount,
  isStableRelease,
} from '../../../utils/modManagerUtils';
import EmptyState from '../../shared/EmptyState';
import ServerTabCard from './ServerTabCard';
import UpdateConfirmModal, {
  type UpdateItem,
} from './UpdateConfirmModal';

interface Props {
  serverId: string | undefined;
  serverGameVersion?: string;
  pluginManagerConfig: any;
}

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

  useEffect(() => {
    setSelectedPlugin(null);
    setSelectedPluginVersion('');
  }, [pluginProvider, pluginQuery, pluginGameVersion]);

  useEffect(() => {
    setSelectedPluginVersion('');
  }, [selectedPlugin]);

  // ── Queries ──
  const {
    data: pluginSearchResults,
    isLoading: pluginSearchLoading,
    isError: pluginSearchError,
    refetch: refetchPluginSearch,
  } = useQuery({
    queryKey: [
      'plugin-manager-search',
      serverId,
      pluginProvider,
      pluginQuery,
      pluginGameVersion,
    ],
    queryFn: () =>
      pluginManagerApi.search(serverId ?? '', {
        provider: pluginProvider,
        query: pluginQuery.trim() || undefined,
        gameVersion: pluginGameVersion.trim() || undefined,
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
      if (!serverId || !selectedPlugin || !selectedPluginVersion)
        throw new Error('Missing plugin selection');
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

  // ── Render ──
  if (!pluginManagerConfig) {
    return (
      <ServerTabCard>
        <EmptyState
          title="Plugin manager not available"
          description="This server template does not have a plugin manager configured."
        />
      </ServerTabCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-tab toggle + title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Puzzle className="h-5 w-5 text-primary-500" />
          <h2 className="text-base font-semibold text-foreground">
            Plugin Manager
          </h2>
        </div>
        <div className="flex items-center overflow-hidden rounded-lg border border-border bg-surface-2">
          <button
            type="button"
            className={`px-4 py-1.5 text-xs font-semibold transition-colors ${pluginSubTab === 'browse' ? 'bg-primary-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setPluginSubTab('browse')}
          >
            Browse
          </button>
          <button
            type="button"
            className={`px-4 py-1.5 text-xs font-semibold transition-colors ${pluginSubTab === 'installed' ? 'bg-primary-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => {
              setPluginSubTab('installed');
              refetchInstalledPlugins();
            }}
          >
            Installed
            {installedPlugins.length > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-card/20 px-1 text-[10px]">
                {installedPlugins.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {pluginSubTab === 'browse' ? (
        <div className="space-y-4">
          {/* Filters card */}
          <ServerTabCard>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Provider
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                  value={pluginProvider}
                  onChange={(event) =>
                    setPluginProvider(event.target.value)
                  }
                >
                  {pluginManagerProviders.map((provider: string) => (
                    <option key={provider} value={provider}>
                      {provider === 'spiget'
                        ? 'Spigot'
                        : titleCase(provider)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Game Version
                </label>
                <input
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                  value={pluginGameVersion}
                  onChange={(event) =>
                    setPluginGameVersion(event.target.value)
                  }
                  placeholder={serverGameVersion || 'e.g. 1.20.1'}
                />
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                  value={pluginQuery}
                  onChange={(event) => setPluginQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') refetchPluginSearch();
                  }}
                  placeholder="Search plugins…"
                />
              </div>
              <button
                type="button"
                className="rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50"
                onClick={() => refetchPluginSearch()}
                disabled={pluginSearchLoading}
              >
                Search
              </button>
            </div>
          </ServerTabCard>

          {/* Results */}
          {pluginSearchLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="animate-pulse rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex gap-3">
                    <div className="h-12 w-12 rounded-lg bg-surface-3 dark:bg-surface-2" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-2/3 rounded bg-surface-3 dark:bg-surface-2" />
                      <div className="h-3 w-full rounded bg-surface-2 dark:bg-surface-2/60" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : pluginSearchError ? (
            <div className="rounded-xl border border-danger/30 bg-danger-muted p-4 text-sm text-danger">
              Unable to load search results. Check your provider API keys in
              admin settings.
            </div>
          ) : pluginResults.length === 0 ? (
            <ServerTabCard>
              <EmptyState
                title="No results"
                description={
                  pluginQuery.trim()
                    ? 'Try a different search term or adjust your filters.'
                    : 'Search for a plugin to get started.'
                }
              />
            </ServerTabCard>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {pluginResults.map((entry: any) => {
                const hangarOwner =
                  entry.owner?.name ||
                  entry.owner?.username ||
                  entry.namespace?.owner;
                const hangarSlug =
                  entry.slug || entry.namespace?.slug;
                const hangarProjectId =
                  hangarOwner && hangarSlug
                    ? `${hangarOwner}/${hangarSlug}`
                    : entry.slug || entry.id;
                const id =
                  pluginProvider === 'paper'
                    ? encodeURIComponent(hangarProjectId ?? '')
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
                const isActive = selectedPlugin === String(id);
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
                  .map((segment: string) =>
                    segment[0]?.toUpperCase() ?? '',
                  )
                  .join('');
                const downloads =
                  entry.downloads ?? entry.stats?.downloads ?? 0;
                const providerLabel =
                  pluginProvider === 'modrinth'
                    ? 'Modrinth'
                    : pluginProvider === 'paper'
                      ? 'Paper'
                      : 'Spigot';
                let externalUrl = '';
                if (pluginProvider === 'modrinth') {
                  const slug =
                    entry.slug || entry.project_id || entry.id;
                  externalUrl = slug
                    ? `https://modrinth.com/plugin/${slug}`
                    : '';
                } else if (pluginProvider === 'paper') {
                  externalUrl = hangarProjectId
                    ? `https://hangar.papermc.io/${hangarProjectId}`
                    : '';
                } else {
                  externalUrl = id
                    ? `https://www.spigotmc.org/resources/${id}/`
                    : '';
                }
                return (
                  <div
                    key={String(id)}
                    className={`group relative cursor-pointer rounded-xl border p-4 transition-all duration-200 ${isActive ? 'border-primary bg-primary-muted ring-1 ring-primary/20' : 'border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/30 hover:shadow-md'}`}
                    onClick={() => {
                      setSelectedPlugin(String(id));
                      setSelectedPluginName(title);
                    }}
                  >
                    <div className="flex gap-3">
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt=""
                          loading="lazy"
                          className="h-12 w-12 rounded-lg object-cover"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-2 text-xs font-bold text-muted-foreground dark:bg-surface-2">
                          {fallbackLabel || 'PL'}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-semibold text-foreground">
                            {title}
                          </span>
                          {externalUrl && (
                            <a
                              href={externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) =>
                                event.stopPropagation()
                              }
                              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                              title={`View on ${providerLabel}`}
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
                    {isActive && (
                      <div className="mt-3 border-t border-border pt-3">
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Version
                            </label>
                            <select
                              className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none"
                              value={selectedPluginVersion}
                              onChange={(event) =>
                                setSelectedPluginVersion(
                                  event.target.value,
                                )
                              }
                              disabled={pluginVersionsLoading}
                            >
                              <option value="">
                                {pluginVersionsLoading
                                  ? 'Loading…'
                                  : 'Select version'}
                              </option>
                              {pluginVersionOptions.map(
                                (version: any) => {
                                  const vid = normalizeVersionId(version);
                                  const vlabel =
                                    normalizeVersionLabel(version);
                                  if (!vid) return null;
                                  return (
                                    <option
                                      key={vid}
                                      value={String(vid)}
                                    >
                                      {vlabel}
                                    </option>
                                  );
                                },
                              )}
                            </select>
                          </div>
                          <button
                            type="button"
                            className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50"
                            onClick={() =>
                              installPluginMutation.mutate()
                            }
                            disabled={
                              !selectedPluginVersion ||
                              installPluginMutation.isPending
                            }
                          >
                            {installPluginMutation.isPending
                              ? 'Installing…'
                              : 'Install'}
                          </button>
                        </div>
                        {pluginVersionsError && (
                          <p className="mt-2 text-xs text-danger">
                            Failed to load versions.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* ── Installed plugins ── */
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {/* Toolbar */}
          <div className="space-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs tabular-nums text-muted-foreground">
                {filteredInstalledPlugins.length}
                {filteredInstalledPlugins.length !==
                installedPlugins.length
                  ? ` / ${installedPlugins.length}`
                  : ''}{' '}
                plugin{installedPlugins.length !== 1 ? 's' : ''}
              </span>
              <div className="flex items-center gap-1.5">
                {installedPlugins.some((p: any) => p.hasUpdate) && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg bg-warning-muted px-2.5 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning-muted dark:bg-warning/10 dark:text-warning dark:hover:bg-warning/20"
                    disabled={isUpdatingPlugins}
                    onClick={() => {
                      const pluginsToUpdate =
                        selectedPluginFiles.size > 0
                          ? installedPlugins.filter(
                              (p: any) =>
                                p.hasUpdate &&
                                selectedPluginFiles.has(p.name),
                            )
                          : installedPlugins.filter(
                              (p: any) => p.hasUpdate,
                            );
                      if (!pluginsToUpdate.length) return;
                      setUpdateConfirmPlugins(
                        pluginsToUpdate.map((p: any) => ({
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
                    <ArrowUpCircle className="h-3 w-3" />
                    Update{' '}
                    {selectedPluginFiles.size > 0
                      ? 'Selected'
                      : 'All'}{' '}
                    (
                    {(
                      selectedPluginFiles.size > 0
                        ? installedPlugins.filter(
                            (p: any) =>
                              p.hasUpdate &&
                              selectedPluginFiles.has(p.name),
                          )
                        : installedPlugins.filter(
                            (p: any) => p.hasUpdate,
                          )
                    ).length}
                    )
                  </button>
                )}
                {selectedPluginFiles.size > 0 && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg bg-danger-muted px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-muted dark:bg-danger/10 dark:text-danger dark:hover:bg-danger/20"
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
                    <Trash2 className="h-3 w-3" />
                    Remove ({selectedPluginFiles.size})
                  </button>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground dark:hover:bg-surface-2 dark:hover:text-foreground"
                  disabled={isCheckingPluginUpdates}
                  onClick={handleCheckUpdates}
                >
                  {isCheckingPluginUpdates ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {isCheckingPluginUpdates
                    ? 'Checking…'
                    : 'Check Updates'}
                </button>
              </div>
            </div>
            {/* Search, Filter, Sort row */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search installed plugins…"
                  className="w-full rounded-lg border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary-500 focus:outline-none dark:placeholder:text-muted-foreground"
                  value={pluginInstalledSearch}
                  onChange={(e) =>
                    setPluginInstalledSearch(e.target.value)
                  }
                />
              </div>
              <select
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground focus:border-primary-500 focus:outline-none"
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
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground focus:border-primary-500 focus:outline-none"
                value={pluginInstalledSort}
                onChange={(e) =>
                  setPluginInstalledSort(
                    e.target.value as typeof pluginInstalledSort,
                  )
                }
              >
                <option value="name">Sort: Name</option>
                <option value="size">Sort: Size</option>
                <option value="date">Sort: Date</option>
              </select>
            </div>
          </div>

          {/* Select All bar */}
          {filteredInstalledPlugins.length > 0 && (
            <div className="flex items-center gap-3 border-b border-border bg-surface-2/50 px-4 py-1.5 dark:bg-surface-2/30">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground dark:hover:text-foreground"
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
                filteredInstalledPlugins.length > 0 ? (
                  <CheckSquare className="h-3.5 w-3.5 text-primary-500" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {selectedPluginFiles.size > 0
                  ? `${selectedPluginFiles.size} selected`
                  : 'Select all'}
              </button>
              {selectedPluginFiles.size > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-muted-foreground dark:hover:text-foreground"
                  onClick={() => setSelectedPluginFiles(new Set())}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Plugin list */}
          {filteredInstalledPlugins.length === 0 ? (
            <div className="p-8">
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
            </div>
          ) : (
            <div className="divide-y divide-zinc-200">
              {filteredInstalledPlugins.map((plugin: any) => {
                const isSelected = selectedPluginFiles.has(
                  plugin.name,
                );
                return (
                  <div
                    key={plugin.name}
                    className={`group flex items-center gap-3 px-4 py-3 transition-colors ${isSelected ? 'bg-primary-50/40 dark:bg-primary-500/5' : 'hover:bg-surface-2 dark:hover:bg-surface-2/40'}`}
                  >
                    <button
                      type="button"
                      className="shrink-0"
                      onClick={() => {
                        const next = new Set(selectedPluginFiles);
                        if (isSelected)
                          next.delete(plugin.name);
                        else next.add(plugin.name);
                        setSelectedPluginFiles(next);
                      }}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-primary-500" />
                      ) : (
                        <Square className="h-4 w-4 text-foreground transition-colors group-hover:text-muted-foreground" />
                      )}
                    </button>
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${plugin.hasUpdate ? 'bg-warning-muted' : 'bg-surface-2'}`}
                    >
                      <Puzzle
                        className={`h-4 w-4 ${plugin.hasUpdate ? 'text-warning' : 'text-muted-foreground'}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {plugin.projectName || plugin.name}
                        </span>
                        {plugin.hasUpdate && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                            <ArrowUpCircle className="h-2.5 w-2.5" />
                            Update
                          </span>
                        )}
                        {plugin.provider && (
                          <span className="inline-flex shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground dark:bg-surface-2">
                            {plugin.provider}
                          </span>
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
                        {plugin.versionId && (
                          <span title={plugin.versionId}>
                            v
                            {plugin.versionId.length > 12
                              ? plugin.versionId.slice(0, 8) +
                                '…'
                              : plugin.versionId}
                          </span>
                        )}
                        {plugin.hasUpdate &&
                          plugin.latestVersionName && (
                            <span className="font-medium text-warning">
                              → {plugin.latestVersionName}
                            </span>
                          )}
                        {!plugin.provider && (
                          <span className="italic text-foreground">
                            untracked
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {plugin.hasUpdate && (
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-warning transition-colors hover:bg-warning-muted"
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
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-danger-muted hover:text-danger"
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Update confirmation modal */}
      <UpdateConfirmModal
        itemType="Plugin"
        items={updateConfirmPlugins}
        isUpdating={isUpdatingPlugins}
        warningMessage="⚠️ Updating plugins may cause compatibility issues. Test on a staging server if possible, and always maintain backups."
        onCancel={() => setUpdateConfirmPlugins([])}
        onConfirm={handleUpdatePlugins}
      />
    </div>
  );
}
