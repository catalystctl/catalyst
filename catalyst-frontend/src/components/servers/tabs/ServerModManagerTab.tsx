import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  ArrowUpCircle,
  CheckSquare,
  Download,
  ExternalLink,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Square,
  Trash2,
} from 'lucide-react';
import { formatBytes } from '../../../utils/formatters';
import { modManagerApi } from '../../../services/api/modManager';
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
import type {
  ServerPermissionsResponse,
  ModManagerProviderObject,
} from '../../../types/server';
import EmptyState from '../../shared/EmptyState';
import ServerTabCard from './ServerTabCard';
import UpdateConfirmModal, {
  type UpdateItem,
} from './UpdateConfirmModal';

type ModManagerTarget = 'mods' | 'datapacks' | 'modpacks';
type ModManagerProviderOption = {
  key: string;
  providerId: string;
  game?: string;
  label: string;
  targets: ModManagerTarget[];
};

const defaultModManagerTargets: ModManagerTarget[] = [
  'mods',
  'datapacks',
  'modpacks',
];

const normalizeModManagerTarget = (
  value: unknown,
): ModManagerTarget | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'mods' ||
    normalized === 'datapacks' ||
    normalized === 'modpacks'
  ) {
    return normalized;
  }
  return null;
};

const normalizeModManagerTargets = (value: unknown): ModManagerTarget[] => {
  if (!Array.isArray(value)) return [];
  const targets = value
    .map((entry) => normalizeModManagerTarget(entry))
    .filter((entry): entry is ModManagerTarget => Boolean(entry));
  return Array.from(new Set(targets));
};

interface Props {
  serverId: string | undefined;
  serverGameVersion?: string;
  modManagerConfig: any;
}

export default function ServerModManagerTab({
  serverId,
  serverGameVersion,
  modManagerConfig,
}: Props) {
  // ── Provider options ──
  const modProviderOptions = useMemo<ModManagerProviderOption[]>(() => {
    const providers = Array.isArray(modManagerConfig?.providers)
      ? modManagerConfig.providers
      : [];
    const rootTargets = normalizeModManagerTargets(modManagerConfig?.targets);
    const fallbackTargets = rootTargets.length
      ? rootTargets
      : defaultModManagerTargets;
    return providers
      .map((entry: any, index: number) => {
        if (typeof entry === 'string') {
          const providerId = entry.trim().toLowerCase();
          if (!providerId) return null;
          const label = displayProviderName(providerId);
          return {
            key: `${providerId}::default::${index}`,
            providerId,
            label,
            targets: fallbackTargets,
          };
        }
        if (!entry || typeof entry !== 'object') return null;
        const provider = entry as ModManagerProviderObject;
        const providerIdRaw =
          typeof provider.id === 'string' ? provider.id : '';
        const providerId = providerIdRaw.trim().toLowerCase();
        if (!providerId) return null;
        const game =
          typeof provider.game === 'string' && provider.game.trim()
            ? provider.game.trim().toLowerCase()
            : undefined;
        const providerTargets = normalizeModManagerTargets(provider.targets);
        const label =
          typeof provider.label === 'string' && provider.label.trim()
            ? provider.label.trim()
            : `${displayProviderName(providerId)}${game ? ` (${titleCase(game)})` : ''}`;
        return {
          key: `${providerId}::${game || 'default'}::${index}`,
          providerId,
          game,
          label,
          targets: providerTargets.length
            ? providerTargets
            : fallbackTargets,
        };
      })
      .filter(
        (entry): entry is ModManagerProviderOption => Boolean(entry),
      );
  }, [modManagerConfig]);

  const [modProviderKey, setModProviderKey] = useState('');
  const selectedModProvider = useMemo(
    () =>
      modProviderOptions.find((entry) => entry.key === modProviderKey) ??
      modProviderOptions[0] ??
      null,
    [modProviderKey, modProviderOptions],
  );
  const modProvider = selectedModProvider?.providerId ?? '';
  const modProviderGame = selectedModProvider?.game;
  const modTargetOptions =
    selectedModProvider?.targets ?? defaultModManagerTargets;
  const supportsModLoaderFilter =
    !modProviderGame || modProviderGame === 'minecraft';

  // ── Browse state ──
  const [modQuery, setModQuery] = useState('');
  const [modTarget, setModTarget] = useState<ModManagerTarget>('mods');
  const [modLoader, setModLoader] = useState('forge');
  const [modGameVersion, setModGameVersion] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedProjectName, setSelectedProjectName] = useState('');
  const [selectedVersion, setSelectedVersion] = useState('');
  const [modSubTab, setModSubTab] = useState<'browse' | 'installed'>('browse');

  // ── Installed state ──
  const [selectedModFiles, setSelectedModFiles] = useState<Set<string>>(
    new Set(),
  );
  const [modInstalledSearch, setModInstalledSearch] = useState('');
  const [modInstalledSort, setModInstalledSort] = useState<
    'name' | 'size' | 'date'
  >('name');
  const [modInstalledFilter, setModInstalledFilter] = useState<
    'all' | 'updates' | 'tracked' | 'untracked'
  >('all');
  const [updateConfirmMods, setUpdateConfirmMods] = useState<UpdateItem[]>([]);
  const [isCheckingModUpdates, setIsCheckingModUpdates] = useState(false);
  const [isUpdatingMods, setIsUpdatingMods] = useState(false);

  // ── Sync provider key with options ──
  useEffect(() => {
    if (!modProviderOptions.length) {
      if (modProviderKey) setModProviderKey('');
      return;
    }
    const hasSelected = modProviderOptions.some(
      (entry) => entry.key === modProviderKey,
    );
    if (!hasSelected) setModProviderKey(modProviderOptions[0].key);
  }, [modProviderKey, modProviderOptions]);

  useEffect(() => {
    if (!modTargetOptions.length) return;
    if (!modTargetOptions.includes(modTarget)) setModTarget(modTargetOptions[0]);
  }, [modTarget, modTargetOptions]);

  useEffect(() => {
    setModGameVersion('');
  }, [serverId]);

  useEffect(() => {
    const detectedVersion = serverGameVersion?.trim();
    if (!detectedVersion) return;
    setModGameVersion((current) => (current ? current : detectedVersion));
  }, [serverGameVersion]);

  useEffect(() => {
    setSelectedProject(null);
    setSelectedVersion('');
  }, [modProvider, modProviderGame, modQuery, modTarget, modLoader, modGameVersion]);

  useEffect(() => {
    setSelectedVersion('');
  }, [selectedProject]);

  // ── Queries ──
  const { data: modGameVersionTags } = useQuery({
    queryKey: ['mod-manager-game-versions', serverId, modProvider, modProviderGame],
    queryFn: () => modManagerApi.gameVersions(serverId ?? '', modProvider, modProviderGame || undefined),
    enabled: Boolean(serverId && modProvider === 'modrinth'),
    staleTime: 10 * 60 * 1000,
  });

  const {
    data: modSearchResults,
    isLoading: modSearchLoading,
    isError: modSearchError,
    refetch: refetchModSearch,
  } = useQuery({
    queryKey: [
      'mod-manager-search',
      serverId,
      modProvider,
      modProviderGame,
      modQuery,
      modTarget,
      modLoader,
      modGameVersion,
    ],
    queryFn: () =>
      modManagerApi.search(serverId ?? '', {
        provider: modProvider,
        game: modProviderGame,
        target: modTarget,
        query: modQuery.trim() || undefined,
        loader: supportsModLoaderFilter ? modLoader : undefined,
        gameVersion: modGameVersion.trim() || undefined,
      }),
    enabled: Boolean(serverId && modProvider),
  });

  const {
    data: modVersions,
    isLoading: modVersionsLoading,
    isError: modVersionsError,
  } = useQuery({
    queryKey: [
      'mod-manager-versions',
      serverId,
      modProvider,
      modProviderGame,
      selectedProject,
    ],
    queryFn: () =>
      modManagerApi.versions(serverId ?? '', {
        provider: modProvider,
        game: modProviderGame,
        projectId: selectedProject ?? '',
      }),
    enabled: Boolean(serverId && modProvider && selectedProject),
  });

  const {
    data: installedMods = [],
    refetch: refetchInstalledMods,
  } = useQuery({
    queryKey: ['mod-manager-installed', serverId, modTarget],
    queryFn: () => modManagerApi.installed(serverId ?? '', modTarget),
    enabled: Boolean(serverId && modManagerConfig),
  });

  // ── Mutations ──
  const uninstallModMutation = useMutation({
    mutationFn: (filename: string) =>
      modManagerApi.uninstall(serverId!, filename, modTarget),
    onSuccess: () => {
      notifySuccess('Mod removed');
      refetchInstalledMods();
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || 'Failed to remove mod');
    },
  });

  const installModMutation = useMutation({
    mutationFn: () => {
      if (!serverId || !selectedProject || !selectedVersion)
        throw new Error('Missing mod selection');
      return modManagerApi.install(serverId, {
        provider: modProvider,
        game: modProviderGame,
        projectId: selectedProject,
        versionId: selectedVersion,
        target: modTarget,
        projectName: selectedProjectName || undefined,
      });
    },
    onSuccess: () => {
      notifySuccess('Mod installed successfully');
      refetchInstalledMods();
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || 'Failed to install mod');
    },
  });

  // ── Derived data ──
  const modResults = useMemo(() => {
    if (!modSearchResults) return [];
    if (Array.isArray(modSearchResults.hits)) return modSearchResults.hits;
    if (Array.isArray(modSearchResults.data)) return modSearchResults.data;
    return [];
  }, [modSearchResults]);

  const modVersionOptions = useMemo(() => {
    if (!modVersions) return [];
    const raw = Array.isArray(modVersions.data)
      ? modVersions.data
      : Array.isArray(modVersions)
        ? modVersions
        : [];
    return filterAndSortVersions(raw, modGameVersion);
  }, [modGameVersion, modVersions]);

  const filteredInstalledMods = useMemo(() => {
    let list = [...installedMods];
    if (modInstalledSearch) {
      const q = modInstalledSearch.toLowerCase();
      list = list.filter(
        (m: any) => (m.projectName || m.name).toLowerCase().includes(q),
      );
    }
    if (modInstalledFilter === 'updates')
      list = list.filter((m: any) => m.hasUpdate);
    else if (modInstalledFilter === 'tracked')
      list = list.filter((m: any) => m.provider);
    else if (modInstalledFilter === 'untracked')
      list = list.filter((m: any) => !m.provider);
    list.sort((a: any, b: any) => {
      if (modInstalledSort === 'size') return b.size - a.size;
      if (modInstalledSort === 'date')
        return (
          new Date(b.modifiedAt || 0).getTime() -
          new Date(a.modifiedAt || 0).getTime()
        );
      return (a.projectName || a.name).localeCompare(b.projectName || b.name);
    });
    return list;
  }, [installedMods, modInstalledSearch, modInstalledFilter, modInstalledSort]);

  // Auto-select stable version
  useEffect(() => {
    if (!selectedProject) return;
    if (!modVersionOptions.length) {
      if (selectedVersion) setSelectedVersion('');
      return;
    }
    if (
      selectedVersion &&
      modVersionOptions.some(
        (entry: any) => normalizeVersionId(entry) === selectedVersion,
      )
    ) {
      return;
    }
    // isStableRelease is already available from the top-level import
    // (duplicated require removed — see modManagerUtils import above)
    const preferred =
      modVersionOptions.find((entry: any) => isStableRelease(entry)) ??
      modVersionOptions[0];
    const preferredId = normalizeVersionId(preferred);
    if (preferredId && preferredId !== selectedVersion) {
      setSelectedVersion(preferredId);
    }
  }, [modVersionOptions, selectedProject, selectedVersion]);

  // ── Handlers ──
  const handleUpdateMods = async () => {
    if (!serverId) return;
    setIsUpdatingMods(true);
    try {
      const filenames = updateConfirmMods.map((m) => m.name);
      const results = await modManagerApi.update(serverId, filenames);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      if (failed > 0)
        notifyError(
          `${failed} mod${failed !== 1 ? 's' : ''} failed to update`,
        );
      if (succeeded > 0)
        notifySuccess(
          `${succeeded} mod${succeeded !== 1 ? 's' : ''} updated successfully`,
        );
      refetchInstalledMods();
      setUpdateConfirmMods([]);
    } catch {
      notifyError('Failed to update mods');
    } finally {
      setIsUpdatingMods(false);
    }
  };

  const handleCheckUpdates = async () => {
    if (!serverId) return;
    setIsCheckingModUpdates(true);
    try {
      const result = await modManagerApi.checkUpdates(serverId);
      refetchInstalledMods();
      if (result.updatesAvailable > 0) {
        notifySuccess(
          `${result.updatesAvailable} update${result.updatesAvailable !== 1 ? 's' : ''} available`,
        );
      } else {
        notifySuccess('All mods are up to date');
      }
    } catch {
      notifyError('Failed to check for updates');
    } finally {
      setIsCheckingModUpdates(false);
    }
  };

  // ── Render ──
  if (!modManagerConfig) {
    return (
      <ServerTabCard>
        <EmptyState
          title="Mod manager not available"
          description="This server template does not have a mod manager configured."
        />
      </ServerTabCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sub-tab toggle + title */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Package className="h-5 w-5 text-primary-500" />
          <h2 className="text-base font-semibold text-foreground">
            Mod Manager
          </h2>
        </div>
        <div className="flex items-center overflow-hidden rounded-lg border border-border bg-surface-2">
          <button
            type="button"
            className={`px-4 py-1.5 text-xs font-semibold transition-colors ${modSubTab === 'browse' ? 'bg-primary-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => setModSubTab('browse')}
          >
            Browse
          </button>
          <button
            type="button"
            className={`px-4 py-1.5 text-xs font-semibold transition-colors ${modSubTab === 'installed' ? 'bg-primary-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
            onClick={() => {
              setModSubTab('installed');
              refetchInstalledMods();
            }}
          >
            Installed
            {installedMods.length > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-card/20 px-1 text-[10px]">
                {installedMods.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {modSubTab === 'browse' ? (
        <div className="space-y-4">
          {/* Filters card */}
          <ServerTabCard>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Provider
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                  value={selectedModProvider?.key ?? ''}
                  onChange={(event) =>
                    setModProviderKey(event.target.value)
                  }
                >
                  {modProviderOptions.map((providerEntry) => (
                    <option
                      key={providerEntry.key}
                      value={providerEntry.key}
                    >
                      {providerEntry.label}
                    </option>
                  ))}
                </select>
              </div>
              {supportsModLoaderFilter ? (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Loader
                  </label>
                  <select
                    className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                    value={modLoader}
                    onChange={(event) => setModLoader(event.target.value)}
                  >
                    <option value="forge">Forge</option>
                    <option value="neoforge">NeoForge</option>
                    <option value="fabric">Fabric</option>
                    <option value="quilt">Quilt</option>
                  </select>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Loader
                  </label>
                  <div className="rounded-lg border border-dashed border-border bg-surface-2/50 px-3 py-2 text-sm text-muted-foreground dark:bg-surface-2/50">
                    N/A
                  </div>
                </div>
              )}
              <div>
                <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Target
                </label>
                <select
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                  value={modTarget}
                  onChange={(event) =>
                    setModTarget(event.target.value as ModManagerTarget)
                  }
                >
                  {modTargetOptions.map((target) => (
                    <option key={target} value={target}>
                      {titleCase(target)}
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
                  value={modGameVersion}
                  onChange={(event) =>
                    setModGameVersion(event.target.value)
                  }
                  placeholder={serverGameVersion || 'e.g. 1.20.1, latest'}
                  list="mod-game-version-tags"
                />
                {modProvider === 'modrinth' && modGameVersionTags && modGameVersionTags.length > 0 && (
                  <datalist id="mod-game-version-tags">
                    <option value="latest" />
                    {modGameVersionTags.map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                  value={modQuery}
                  onChange={(event) => setModQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') refetchModSearch();
                  }}
                  placeholder="Search mods, datapacks, modpacks…"
                />
              </div>
              <button
                type="button"
                className="rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50"
                onClick={() => refetchModSearch()}
                disabled={modSearchLoading}
              >
                Search
              </button>
            </div>
          </ServerTabCard>

          {/* Results */}
          {modSearchLoading ? (
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
          ) : modSearchError ? (
            <div className="rounded-xl border border-danger/30 bg-danger-muted p-4 text-sm text-danger">
              Unable to load search results. Check your provider API keys in
              admin settings.
            </div>
          ) : modResults.length === 0 ? (
            <ServerTabCard>
              <EmptyState
                title="No results"
                description={
                  modQuery.trim()
                    ? 'Try a different search term or adjust your filters.'
                    : 'Search for a mod to get started.'
                }
              />
            </ServerTabCard>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {modResults.map((entry: any) => {
                const id =
                  entry.project_id ||
                  entry.id ||
                  entry.modId ||
                  entry.slug ||
                  entry.name;
                const title =
                  entry.title || entry.name || entry.slug || 'Untitled';
                const summary =
                  entry.description || entry.summary || entry.excerpt || '';
                const isActive = selectedProject === String(id);
                const imageUrl =
                  modProvider === 'modrinth'
                    ? entry.icon_url
                    : entry.logo?.thumbnailUrl || entry.logo?.url;
                const downloads =
                  entry.downloads ?? entry.downloadCount ?? 0;
                const providerLabel =
                  selectedModProvider?.label ||
                  displayProviderName(modProvider || 'provider');
                let externalUrl = '';
                if (modProvider === 'modrinth') {
                  const slug =
                    entry.slug || entry.project_id || entry.id;
                  const projectType = entry.project_type || 'project';
                  externalUrl = slug
                    ? `https://modrinth.com/${projectType}/${slug}`
                    : '';
                } else {
                  externalUrl = entry.links?.websiteUrl || '';
                  if (!externalUrl) {
                    const slug = entry.slug || entry.id;
                    const gamePath = modProviderGame || 'minecraft';
                    const classPath =
                      gamePath === 'hytale'
                        ? 'mods'
                        : modTarget === 'modpacks'
                          ? 'modpacks'
                          : modTarget === 'datapacks'
                            ? 'data-packs'
                            : 'mc-mods';
                    externalUrl = slug
                      ? `https://www.curseforge.com/${gamePath}/${classPath}/${slug}`
                      : '';
                  }
                }
                return (
                  <div
                    key={String(id)}
                    className={`group relative cursor-pointer rounded-xl border p-4 transition-all duration-200 ${isActive ? 'border-primary bg-primary-muted ring-1 ring-primary/20' : 'border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/30 hover:shadow-md'}`}
                    onClick={() => {
                      setSelectedProject(String(id));
                      setSelectedProjectName(title);
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
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-2 dark:bg-surface-2">
                          <Package className="h-5 w-5 text-muted-foreground" />
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
                              value={selectedVersion}
                              onChange={(event) =>
                                setSelectedVersion(event.target.value)
                              }
                              disabled={modVersionsLoading}
                            >
                              <option value="">
                                {modVersionsLoading
                                  ? 'Loading…'
                                  : 'Select version'}
                              </option>
                              {modVersionOptions.map((version: any) => {
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
                          </div>
                          <button
                            type="button"
                            className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50"
                            onClick={() => installModMutation.mutate()}
                            disabled={
                              !selectedVersion ||
                              installModMutation.isPending
                            }
                          >
                            {installModMutation.isPending
                              ? 'Installing…'
                              : 'Install'}
                          </button>
                        </div>
                        {modVersionsError && (
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
        /* ── Installed mods ── */
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {/* Toolbar */}
          <div className="space-y-3 border-b border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <select
                  className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground transition-colors focus:border-primary-500 focus:outline-none"
                  value={modTarget}
                  onChange={(event) =>
                    setModTarget(
                      event.target.value as ModManagerTarget,
                    )
                  }
                >
                  {modTargetOptions.map((target) => (
                    <option key={target} value={target}>
                      {titleCase(target)}
                    </option>
                  ))}
                </select>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {filteredInstalledMods.length}
                  {filteredInstalledMods.length !== installedMods.length
                    ? ` / ${installedMods.length}`
                    : ''}{' '}
                  file{installedMods.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {installedMods.some((m: any) => m.hasUpdate) && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg bg-warning-muted px-2.5 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning-muted dark:bg-warning/10 dark:text-warning dark:hover:bg-warning/20"
                    disabled={isUpdatingMods}
                    onClick={() => {
                      const modsToUpdate =
                        selectedModFiles.size > 0
                          ? installedMods.filter(
                              (m: any) =>
                                m.hasUpdate &&
                                selectedModFiles.has(m.name),
                            )
                          : installedMods.filter(
                              (m: any) => m.hasUpdate,
                            );
                      if (!modsToUpdate.length) return;
                      setUpdateConfirmMods(
                        modsToUpdate.map((m: any) => ({
                          name: m.name,
                          currentVersion:
                            m.versionId || 'unknown',
                          latestVersion:
                            m.latestVersionName ||
                            m.latestVersionId ||
                            'latest',
                        })),
                      );
                    }}
                  >
                    <ArrowUpCircle className="h-3 w-3" />
                    Update{' '}
                    {selectedModFiles.size > 0
                      ? 'Selected'
                      : 'All'}{' '}
                    (
                    {(
                      selectedModFiles.size > 0
                        ? installedMods.filter(
                            (m: any) =>
                              m.hasUpdate &&
                              selectedModFiles.has(m.name),
                          )
                        : installedMods.filter(
                            (m: any) => m.hasUpdate,
                          )
                    ).length}
                    )
                  </button>
                )}
                {selectedModFiles.size > 0 && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-lg bg-danger-muted px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-muted dark:bg-danger/10 dark:text-danger dark:hover:bg-danger/20"
                    onClick={() => {
                      if (
                        !confirm(
                          `Remove ${selectedModFiles.size} selected mod${selectedModFiles.size !== 1 ? 's' : ''}?`,
                        )
                      )
                        return;
                      selectedModFiles.forEach((name) =>
                        uninstallModMutation.mutate(name),
                      );
                      setSelectedModFiles(new Set());
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                    Remove ({selectedModFiles.size})
                  </button>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground dark:hover:bg-surface-2 dark:hover:text-foreground"
                  disabled={isCheckingModUpdates}
                  onClick={handleCheckUpdates}
                >
                  {isCheckingModUpdates ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  {isCheckingModUpdates
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
                  placeholder="Search installed mods…"
                  className="w-full rounded-lg border border-border bg-surface-2 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary-500 focus:outline-none dark:placeholder:text-muted-foreground"
                  value={modInstalledSearch}
                  onChange={(e) =>
                    setModInstalledSearch(e.target.value)
                  }
                />
              </div>
              <select
                className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground focus:border-primary-500 focus:outline-none"
                value={modInstalledFilter}
                onChange={(e) =>
                  setModInstalledFilter(
                    e.target.value as typeof modInstalledFilter,
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
                value={modInstalledSort}
                onChange={(e) =>
                  setModInstalledSort(
                    e.target.value as typeof modInstalledSort,
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
          {filteredInstalledMods.length > 0 && (
            <div className="flex items-center gap-3 border-b border-border bg-surface-2/50 px-4 py-1.5 dark:bg-surface-2/30">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground dark:hover:text-foreground"
                onClick={() => {
                  if (
                    selectedModFiles.size ===
                    filteredInstalledMods.length
                  ) {
                    setSelectedModFiles(new Set());
                  } else {
                    setSelectedModFiles(
                      new Set(
                        filteredInstalledMods.map((m: any) => m.name),
                      ),
                    );
                  }
                }}
              >
                {selectedModFiles.size ===
                  filteredInstalledMods.length &&
                filteredInstalledMods.length > 0 ? (
                  <CheckSquare className="h-3.5 w-3.5 text-primary-500" />
                ) : (
                  <Square className="h-3.5 w-3.5" />
                )}
                {selectedModFiles.size > 0
                  ? `${selectedModFiles.size} selected`
                  : 'Select all'}
              </button>
              {selectedModFiles.size > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-muted-foreground dark:hover:text-foreground"
                  onClick={() => setSelectedModFiles(new Set())}
                >
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Mod list */}
          {filteredInstalledMods.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title={
                  modInstalledSearch ||
                  modInstalledFilter !== 'all'
                    ? 'No matching mods'
                    : `No ${modTarget} installed`
                }
                description={
                  modInstalledSearch ||
                  modInstalledFilter !== 'all'
                    ? 'Try adjusting your search or filter.'
                    : 'Install mods from the Browse tab to see them here.'
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-zinc-200">
              {filteredInstalledMods.map((mod: any) => {
                const isSelected = selectedModFiles.has(mod.name);
                return (
                  <div
                    key={mod.name}
                    className={`group flex items-center gap-3 px-4 py-3 transition-colors ${isSelected ? 'bg-primary-50/40 dark:bg-primary-500/5' : 'hover:bg-surface-2 dark:hover:bg-surface-2/40'}`}
                  >
                    <button
                      type="button"
                      className="shrink-0"
                      onClick={() => {
                        const next = new Set(selectedModFiles);
                        if (isSelected)
                          next.delete(mod.name);
                        else next.add(mod.name);
                        setSelectedModFiles(next);
                      }}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-4 w-4 text-primary-500" />
                      ) : (
                        <Square className="h-4 w-4 text-foreground transition-colors group-hover:text-muted-foreground" />
                      )}
                    </button>
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${mod.hasUpdate ? 'bg-warning-muted' : 'bg-surface-2'}`}
                    >
                      <Package
                        className={`h-4 w-4 ${mod.hasUpdate ? 'text-warning' : 'text-muted-foreground'}`}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {mod.projectName || mod.name}
                        </span>
                        {mod.hasUpdate && (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-muted px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                            <ArrowUpCircle className="h-2.5 w-2.5" />
                            Update
                          </span>
                        )}
                        {mod.provider && (
                          <span className="inline-flex shrink-0 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium capitalize text-muted-foreground dark:bg-surface-2">
                            {mod.provider}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span className="font-mono">
                          {formatBytes(mod.size)}
                        </span>
                        {mod.modifiedAt && (
                          <span>
                            {new Date(
                              mod.modifiedAt,
                            ).toLocaleDateString()}
                          </span>
                        )}
                        {mod.versionId && (
                          <span title={mod.versionId}>
                            v
                            {mod.versionId.length > 12
                              ? mod.versionId.slice(0, 8) + '…'
                              : mod.versionId}
                          </span>
                        )}
                        {mod.hasUpdate &&
                          mod.latestVersionName && (
                            <span className="font-medium text-warning">
                              → {mod.latestVersionName}
                            </span>
                          )}
                        {!mod.provider && (
                          <span className="italic text-foreground">
                            untracked
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {mod.hasUpdate && (
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-warning transition-colors hover:bg-warning-muted"
                          title="Update to latest version"
                          disabled={isUpdatingMods}
                          onClick={() =>
                            setUpdateConfirmMods([
                              {
                                name: mod.name,
                                currentVersion:
                                  mod.versionId || 'unknown',
                                latestVersion:
                                  mod.latestVersionName ||
                                  mod.latestVersionId ||
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
                              `Remove ${mod.projectName || mod.name}?`,
                            )
                          )
                            uninstallModMutation.mutate(mod.name);
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
        itemType="Mod"
        items={updateConfirmMods}
        isUpdating={isUpdatingMods}
        warningMessage="⚠️ Updating mods may break compatibility with other mods or your world. Make sure to back up your server before proceeding."
        onCancel={() => setUpdateConfirmMods([])}
        onConfirm={handleUpdateMods}
      />
    </div>
  );
}
