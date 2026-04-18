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
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
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
  ModManagerProviderObject,
} from '../../../types/server';
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

// ── Version Selector ──
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
  const [searchPage, setSearchPage] = useState(1);
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

  // ── Sync ──
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

  // Reset page and selection on filter change
  useEffect(() => {
    setSelectedProject(null);
    setSelectedVersion('');
    setSearchPage(1);
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
      searchPage,
    ],
    queryFn: () =>
      modManagerApi.search(serverId ?? '', {
        provider: modProvider,
        game: modProviderGame,
        target: modTarget,
        query: modQuery.trim() || undefined,
        loader: supportsModLoaderFilter ? modLoader : undefined,
        gameVersion: modGameVersion.trim() || undefined,
        page: searchPage,
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

  const totalHits = (modSearchResults as any)?.total_hits ?? modResults.length;
  const totalPages = Math.max(1, Math.ceil(totalHits / RESULTS_PER_PAGE));

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

  const modsWithUpdates = installedMods.filter((m: any) => m.hasUpdate);
  const modsWithUpdatesSelected = modsWithUpdates.filter((m: any) =>
    selectedModFiles.has(m.name),
  );

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
    const preferred =
      modVersionOptions.find((entry: any) => isStableRelease(entry)) ??
      modVersionOptions[0];
    const preferredId = normalizeVersionId(preferred);
    if (preferredId && preferredId !== selectedVersion) {
      setSelectedVersion(preferredId);
    }
  }, [modVersionOptions, selectedProject, selectedVersion]);

  // ── Handlers ──
  const handleSearch = useCallback(() => {
    setSearchPage(1);
  }, []);

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

  // ── Guard ──
  if (!modManagerConfig) {
    return (
      <EmptyState
        title="Mod manager not available"
        description="This server template does not have a mod manager configured."
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
              <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 opacity-20 blur-sm" />
              <Package className="relative h-7 w-7 text-amber-600 dark:text-amber-400" />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
              Mods
            </h1>
          </div>
          <p className="ml-10 text-sm text-muted-foreground">
            Browse and install mods, datapacks, and modpacks
          </p>
        </div>
        <div className="flex items-center gap-2">
          {installedMods.length > 0 && (
            <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
              <Package className="h-2.5 w-2.5" />
              {installedMods.length} installed
            </Badge>
          )}
          {modsWithUpdates.length > 0 && (
            <Badge variant="warning" className="h-8 gap-1.5 px-3 text-xs">
              <ArrowUpCircle className="h-2.5 w-2.5" />
              {modsWithUpdates.length} update{modsWithUpdates.length !== 1 ? 's' : ''}
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
              modSubTab === tab
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => {
              setModSubTab(tab);
              if (tab === 'installed') refetchInstalledMods();
            }}
          >
            {tab === 'browse' ? 'Browse' : 'Installed'}
            {tab === 'installed' && installedMods.length > 0 && (
              <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] ${
                modSubTab === 'installed' ? 'bg-white/20' : 'bg-surface-2'
              }`}>
                {installedMods.length}
              </span>
            )}
          </button>
        ))}
      </motion.div>

      <AnimatePresence mode="wait">
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* BROWSE TAB                                                       */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {modSubTab === 'browse' && (
          <motion.div
            key="browse"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
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
                  value={modQuery}
                  onChange={(e) => setModQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch();
                  }}
                  placeholder="Search mods, datapacks, modpacks…"
                  className="pl-9"
                />
              </div>

              {/* Provider */}
              <select
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                value={selectedModProvider?.key ?? ''}
                onChange={(e) => setModProviderKey(e.target.value)}
              >
                {modProviderOptions.map((providerEntry) => (
                  <option key={providerEntry.key} value={providerEntry.key}>
                    {providerEntry.label}
                  </option>
                ))}
              </select>

              {/* Loader */}
              {supportsModLoaderFilter ? (
                <select
                  className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  value={modLoader}
                  onChange={(e) => setModLoader(e.target.value)}
                >
                  <option value="forge">Forge</option>
                  <option value="neoforge">NeoForge</option>
                  <option value="fabric">Fabric</option>
                  <option value="quilt">Quilt</option>
                </select>
              ) : null}

              {/* Target */}
              <select
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                value={modTarget}
                onChange={(e) =>
                  setModTarget(e.target.value as ModManagerTarget)
                }
              >
                {modTargetOptions.map((target) => (
                  <option key={target} value={target}>
                    {titleCase(target)}
                  </option>
                ))}
              </select>

              {/* Game version */}
              <div className="relative">
                <Input
                  value={modGameVersion}
                  onChange={(e) => setModGameVersion(e.target.value)}
                  placeholder={serverGameVersion || 'Game version'}
                  className="w-40"
                  list="mod-game-version-tags"
                />
                {modProvider === 'modrinth' && modGameVersionTags && modGameVersionTags.length > 0 && (
                  <datalist id="mod-game-version-tags">
                    <option value="latest" />
                    {modGameVersionTags.slice(0, 30).map((v) => (
                      <option key={v} value={v} />
                    ))}
                  </datalist>
                )}
              </div>

              {/* Search button */}
              <Button
                size="sm"
                onClick={handleSearch}
                disabled={modSearchLoading}
                className="gap-1.5"
              >
                {modSearchLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
                Search
              </Button>
            </motion.div>

            {/* ── Results area ── */}
            {modSearchLoading ? (
              <BrowseSkeleton />
            ) : modSearchError ? (
              <motion.div
                variants={itemVariants}
                className="rounded-xl border border-danger/30 bg-danger-muted p-4 text-sm text-danger"
              >
                Unable to load search results. Check your provider API keys in
                admin settings.
              </motion.div>
            ) : modResults.length === 0 ? (
              <motion.div variants={itemVariants}>
                <EmptyState
                  title="No results"
                  description={
                    modQuery.trim()
                      ? 'Try a different search term or adjust your filters.'
                      : 'Search for a mod to get started.'
                  }
                />
              </motion.div>
            ) : (
              <>
                {/* Results count + pagination */}
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
                        <motion.div
                          key={String(id)}
                          variants={cardVariants}
                          layout
                          layoutId={`mod-${String(id)}`}
                          className={`group relative rounded-xl border p-4 transition-all duration-200 ${
                            isActive
                              ? 'border-primary/50 bg-primary-muted/50 ring-1 ring-primary/20 shadow-lg shadow-primary/5'
                              : 'border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/30 hover:shadow-md'
                          }`}
                          onClick={() => {
                            setSelectedProject(isActive ? null : String(id));
                            setSelectedProjectName(title);
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
                              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-surface-2">
                                <Package className="h-5 w-5 text-muted-foreground" />
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

                          {/* Expanded version selector */}
                          <AnimatePresence>
                            {isActive && (
                              <VersionSelector
                                versionOptions={modVersionOptions}
                                selectedVersion={selectedVersion}
                                onVersionChange={setSelectedVersion}
                                isLoading={modVersionsLoading}
                                isError={modVersionsError}
                                onInstall={() => installModMutation.mutate()}
                                isInstalling={installModMutation.isPending}
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
                      onClick={() => setSearchPage((p) => Math.max(1, p - 1))}
                      className="gap-1.5"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from(
                        { length: Math.min(totalPages, 5) },
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
                      onClick={() => setSearchPage((p) => Math.min(totalPages, p + 1))}
                      className="gap-1.5"
                    >
                      Next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </motion.div>
                )}
              </>
            )}
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* INSTALLED TAB                                                     */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {modSubTab === 'installed' && (
          <motion.div
            key="installed"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
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
                  value={modInstalledSearch}
                  onChange={(e) => setModInstalledSearch(e.target.value)}
                  placeholder="Search installed mods…"
                  className="pl-9"
                />
              </div>

              <select
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
                className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                value={modInstalledSort}
                onChange={(e) =>
                  setModInstalledSort(
                    e.target.value as typeof modInstalledSort,
                  )
                }
              >
                <option value="name">Name</option>
                <option value="size">Size</option>
                <option value="date">Date</option>
              </select>

              <div className="ml-auto flex items-center gap-1.5">
                {modsWithUpdates.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-warning/30 text-warning hover:bg-warning/10 hover:text-warning"
                    disabled={isUpdatingMods}
                    onClick={() => {
                      const modsToUpdate =
                        modsWithUpdatesSelected.length > 0
                          ? modsWithUpdatesSelected
                          : modsWithUpdates;
                      if (!modsToUpdate.length) return;
                      setUpdateConfirmMods(
                        modsToUpdate.map((m: any) => ({
                          name: m.name,
                          currentVersion: m.versionId || 'unknown',
                          latestVersion:
                            m.latestVersionName ||
                            m.latestVersionId ||
                            'latest',
                        })),
                      );
                    }}
                  >
                    <ArrowUpCircle className="h-3.5 w-3.5" />
                    Update
                    {modsWithUpdatesSelected.length > 0
                      ? ` (${modsWithUpdatesSelected.length})`
                      : ` All (${modsWithUpdates.length})`}
                  </Button>
                )}

                {selectedModFiles.size > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 border-danger/30 text-danger hover:bg-danger/10 hover:text-danger"
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
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove ({selectedModFiles.size})
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isCheckingModUpdates}
                  onClick={handleCheckUpdates}
                  className="gap-1.5"
                >
                  {isCheckingModUpdates ? (
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
              <div className="flex items-center gap-2">
                <select
                  className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  value={modTarget}
                  onChange={(e) =>
                    setModTarget(e.target.value as ModManagerTarget)
                  }
                >
                  {modTargetOptions.map((target) => (
                    <option key={target} value={target}>
                      {titleCase(target)}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-muted-foreground">
                  {filteredInstalledMods.length}
                  {filteredInstalledMods.length !== installedMods.length
                    ? ` of ${installedMods.length}`
                    : ''}{' '}
                  file{installedMods.length !== 1 ? 's' : ''}
                </span>
              </div>
              {filteredInstalledMods.length > 0 && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  onClick={() => {
                    if (
                      selectedModFiles.size ===
                      filteredInstalledMods.length
                    ) {
                      setSelectedModFiles(new Set());
                    } else {
                      setSelectedModFiles(
                        new Set(filteredInstalledMods.map((m: any) => m.name)),
                      );
                    }
                  }}
                >
                  {selectedModFiles.size ===
                    filteredInstalledMods.length &&
                  selectedModFiles.size > 0
                    ? 'Deselect all'
                    : 'Select all'}
                </button>
              )}
            </motion.div>

            {/* ── Mod list ── */}
            {filteredInstalledMods.length === 0 ? (
              <motion.div variants={itemVariants}>
                <EmptyState
                  title={
                    modInstalledSearch || modInstalledFilter !== 'all'
                      ? 'No matching mods'
                      : `No ${modTarget} installed`
                  }
                  description={
                    modInstalledSearch || modInstalledFilter !== 'all'
                      ? 'Try adjusting your search or filter.'
                      : 'Install mods from the Browse tab to see them here.'
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
                  {filteredInstalledMods.map((mod: any) => {
                    const isSelected = selectedModFiles.has(mod.name);
                    return (
                      <motion.div
                        key={mod.name}
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
                            const next = new Set(selectedModFiles);
                            if (isSelected) next.delete(mod.name);
                            else next.add(mod.name);
                            setSelectedModFiles(next);
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
                            mod.hasUpdate
                              ? 'bg-warning/10'
                              : 'bg-surface-2'
                          }`}
                        >
                          <Package
                            className={`h-4 w-4 ${
                              mod.hasUpdate
                                ? 'text-warning'
                                : 'text-muted-foreground'
                            }`}
                          />
                        </div>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-foreground">
                              {mod.projectName || mod.name}
                            </span>
                            {mod.hasUpdate && (
                              <Badge
                                variant="warning"
                                className="gap-1 px-1.5 py-0 text-[10px]"
                              >
                                <ArrowUpCircle className="h-2.5 w-2.5" />
                                Update
                              </Badge>
                            )}
                            {mod.provider && (
                              <Badge
                                variant="secondary"
                                className="px-1.5 py-0 text-[10px] capitalize"
                              >
                                {mod.provider}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                            <span className="font-mono">
                              {formatBytes(mod.size)}
                            </span>
                            {mod.modifiedAt && (
                              <span>
                                {new Date(mod.modifiedAt).toLocaleDateString()}
                              </span>
                            )}
                            {!mod.provider && (
                              <span className="italic text-foreground/60">
                                untracked
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Update arrow */}
                        {mod.hasUpdate && mod.latestVersionName && (
                          <div className="hidden items-center gap-1.5 sm:flex">
                            <span className="text-[11px] text-muted-foreground line-through">
                              {mod.versionId?.length > 12
                                ? mod.versionId.slice(0, 8) + '…'
                                : mod.versionId}
                            </span>
                            <ArrowLeftRight className="h-3 w-3 text-muted-foreground" />
                            <span className="text-[11px] font-medium text-warning">
                              {mod.latestVersionName}
                            </span>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {mod.hasUpdate && (
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-warning transition-colors hover:bg-warning/10"
                              title="Update to latest version"
                              disabled={isUpdatingMods}
                              onClick={() =>
                                setUpdateConfirmMods([
                                  {
                                    name: mod.name,
                                    currentVersion: mod.versionId || 'unknown',
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
                            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
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
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Update confirmation modal */}
      <UpdateConfirmModal
        itemType="Mod"
        items={updateConfirmMods}
        isUpdating={isUpdatingMods}
        warningMessage="⚠️ Updating mods may break compatibility with other mods or your world. Make sure to back up your server before proceeding."
        onCancel={() => setUpdateConfirmMods([])}
        onConfirm={handleUpdateMods}
      />
    </motion.div>
  );
}
