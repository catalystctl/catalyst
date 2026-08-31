import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@/csync';
import {
 ArrowLeftRight,
 ArrowUpCircle,
 ChevronDown,
 ChevronLeft,
 ChevronRight,
 Download,
 ExternalLink,
 Flame,
 History,
 Loader2,
 Package,
 Puzzle,
 RefreshCw,
 Search,
 Sparkles,
 Star,
 Trash2,
 TrendingUp,
} from 'lucide-react';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
 formatBytes,
 formatRelativeTime,
} from '../../../utils/formatters';
import { pluginManagerApi } from '../../../services/api/pluginManager';
import {
 providerKeysApi,
 providerKeyConfigured,
} from '../../../services/api/providerKeys';
import { qk } from '../../../lib/queryKeys';
import {
 notifyError,
 notifySuccess,
} from '../../../utils/notify';
import { reportSystemError } from '../../../services/api/systemErrors';
import {
 titleCase,
 normalizeVersionId,
 normalizeVersionLabel,
 splitVersionsForGameVersion,
 formatDownloadCount,
 isStableRelease,
} from '../../../utils/modManagerUtils';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Skeleton } from '../../../components/ui/skeleton';
import EmptyState from '../../shared/EmptyState';
import ConfirmDialog from '../../shared/ConfirmDialog';
import UpdateConfirmModal, {
 type UpdateItem,
} from './UpdateConfirmModal';
import TabHeader from './TabHeader';

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

const RESULTS_PER_PAGE = 12;

// ── Sort presets (mapped server-side to each provider's native params) ──
const PLUGIN_SORT_OPTIONS = [
 { id: 'trending', label: 'Trending', icon: Flame },
 { id: 'popular', label: 'Popular', icon: TrendingUp },
 { id: 'rating', label: 'Top rated', icon: Star },
 { id: 'updated', label: 'Recently updated', icon: History },
 { id: 'newest', label: 'Newest', icon: Sparkles },
] as const;

type PluginSortId = (typeof PLUGIN_SORT_OPTIONS)[number]['id'];

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
 gameVersionLabel,
 exactMatch,
 rawCount,
}: {
 versionOptions: any[];
 selectedVersion: string;
 onVersionChange: (id: string) => void;
 isLoading: boolean;
 isError: boolean;
 onInstall: () => void;
 isInstalling: boolean;
 gameVersionLabel?: string;
 exactMatch: boolean;
 rawCount: number;
}) {
 const filterNote = (() => {
  if (!gameVersionLabel) return '';
  if (exactMatch) return `${versionOptions.length} for ${gameVersionLabel}`;
  if (versionOptions.length > 0)
   return `nothing tagged for ${gameVersionLabel} — showing all`;
  return '';
 })();

 return (
 // Clicks inside the selector (opening the <select> dropdown, pressing
 // Install) must not bubble to the card, whose onClick toggles selection
 // and would unmount this panel mid-interaction.
 <div onClick={(event) => event.stopPropagation()}>
   <motion.div
    initial={{ height: 0, opacity: 0 }}
    animate={{ height: 'auto', opacity: 1 }}
    exit={{ height: 0, opacity: 0 }}
    transition={{ duration: 0.2, ease: 'easeInOut' }}
    className="overflow-hidden"
   >
    <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
     <div className="flex items-center justify-between gap-2">
      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
       Version
      </label>
      {filterNote && (
       <span className="truncate text-[10px] text-muted-foreground">
        {filterNote}
       </span>
      )}
     </div>
     {isError ? (
      <p className="text-xs text-danger">Failed to load versions.</p>
     ) : (
      <div className="flex items-end gap-2">
       <div className="relative flex-1">
        <select
         className="w-full appearance-none rounded-lg border border-border bg-surface-2 px-3 py-2 pr-8 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
         value={selectedVersion}
         onChange={(event) => onVersionChange(event.target.value)}
         disabled={isLoading}
        >
         <option value="">
          {isLoading ? 'Loading…' : 'Select version'}
         </option>
         {versionOptions.map((version: any) => {
          const vid = normalizeVersionId(version);
          const rawLabel = normalizeVersionLabel(version);
          const vlabel =
            typeof rawLabel === 'string' ? rawLabel : String(rawLabel ?? '');
          if (!vid) return null;
          const stabilitySuffix = isStableRelease(version)
           ? ''
           : ' (pre-release)';
          return (
           <option key={vid} value={String(vid)}>
            {vlabel}
            {stabilitySuffix}
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
     {!isError && !isLoading && versionOptions.length === 0 && rawCount === 0 && (
      <p className="text-xs text-muted-foreground">
       No published versions found for this plugin.
      </p>
     )}
    </div>
   </motion.div>
  </div>
 );
}

// Stable empty fallback — inline `?? []` recreates identity every render and
// infinite-loops the React 19 prev-state sync below when providers are missing.
const EMPTY_PLUGIN_PROVIDERS: string[] = [];

// ── Main Component ──
export default function ServerPluginManagerTab({
 serverId,
 serverGameVersion,
 pluginManagerConfig,
}: Props) {
 const queryClient = useQueryClient();
 // ── Provider key availability ──
 // Providers whose required API key isn't configured (Modrinth) are hidden
 // from the dropdown — selecting them would only produce 409 errors.
 const {
 data: providerKeyStatus,
 isSuccess: keyStatusLoaded,
 isError: keyStatusUnavailable,
 } = useQuery({
 queryKey: qk.providerKeyStatus,
 queryFn: providerKeysApi.status,
 staleTime: 60_000,
 retry: 1,
 });
 const keyStatusSettled = keyStatusLoaded || keyStatusUnavailable;

 // ── Provider state ──
 const pluginManagerProviders = Array.isArray(pluginManagerConfig?.providers)
 ? pluginManagerConfig.providers
 : EMPTY_PLUGIN_PROVIDERS;
 const availablePluginProviders = useMemo(
 () =>
 pluginManagerProviders.filter((provider: string) =>
 providerKeyConfigured(provider, providerKeyStatus),
 ),
 [pluginManagerProviders, providerKeyStatus],
 );
 // Initialize from the already-filtered list: when the key status is cached
 // (returning to the tab), the list may exclude the 'modrinth' default on the
 // very first render — the render-sync block below can't fix that, because
 // its tracker is initialized to the same list and never sees a "change".
 const [pluginProvider, setPluginProvider] = useState(() =>
 availablePluginProviders.length > 0 &&
 !availablePluginProviders.includes('modrinth')
 ? availablePluginProviders[0]
 : 'modrinth',
 );

 // ── Sync (set state during render, React 19 pattern) ──
 // Track each input via useState; when an input changes between renders,
 // update the dependent state and advance the tracker during render. This
 // replaces the setState-in-useEffect anti-pattern flagged by react-hooks.
 const [prevPluginProviders, setPrevPluginProviders] = useState(availablePluginProviders);
 if (availablePluginProviders !== prevPluginProviders) {
 setPrevPluginProviders(availablePluginProviders);
 if (
 availablePluginProviders.length > 0 &&
 !availablePluginProviders.includes(pluginProvider)
 ) {
 setPluginProvider(availablePluginProviders[0]);
 }
 }

 // ── Browse state ──
 const [pluginQuery, setPluginQuery] = useState('');
 // Search fires against the debounced query so typing doesn't hammer the
 // provider APIs (and trip their rate limits) with a request per keystroke.
 const [debouncedPluginQuery, setDebouncedPluginQuery] = useState('');
 useEffect(() => {
  const timer = setTimeout(() => setDebouncedPluginQuery(pluginQuery.trim()), 350);
  return () => clearTimeout(timer);
 }, [pluginQuery]);
 // Default the game-version filter to the server's detected Minecraft
 // version; the render-sync block below keeps it in sync when the prop
 // arrives after mount.
 const [pluginGameVersion, setPluginGameVersion] = useState(
 () => serverGameVersion?.trim() || '',
 );
 const [pluginSort, setPluginSort] = useState<PluginSortId>('trending');
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
 const [pendingRemovePlugins, setPendingRemovePlugins] = useState<
 string[] | null
 >(null);
 const [isCheckingPluginUpdates, setIsCheckingPluginUpdates] =
 useState(false);
 const [isUpdatingPlugins, setIsUpdatingPlugins] = useState(false);

 // ── Sync game version ──
 const [prevPluginServerId, setPrevPluginServerId] = useState(serverId);
 if (serverId !== prevPluginServerId) {
 setPrevPluginServerId(serverId);
 setPluginGameVersion('');
 }

 const [prevPluginServerGameVersion, setPrevPluginServerGameVersion] = useState(serverGameVersion);
 if (serverGameVersion !== prevPluginServerGameVersion) {
 setPrevPluginServerGameVersion(serverGameVersion);
 const detectedVersion = serverGameVersion?.trim();
 if (detectedVersion) {
 setPluginGameVersion((current) => (current ? current : detectedVersion));
 }
 }

 // Reset page and selection on filter change
 const pluginFilterKey = `${pluginProvider}|${debouncedPluginQuery}|${pluginGameVersion}|${pluginSort}`;
 const [prevPluginFilterKey, setPrevPluginFilterKey] = useState(pluginFilterKey);
 if (pluginFilterKey !== prevPluginFilterKey) {
 setPrevPluginFilterKey(pluginFilterKey);
 setSelectedPlugin(null);
 setSelectedPluginVersion('');
 setSearchPage(1);
 }

 const [prevSelectedPlugin, setPrevSelectedPlugin] = useState<string | null>(selectedPlugin);
 if (selectedPlugin !== prevSelectedPlugin) {
 setPrevSelectedPlugin(selectedPlugin);
 setSelectedPluginVersion('');
 }

 // ── Queries ──
 // Minecraft game-version tags are provider-agnostic (the backend resolves
 // them from Modrinth regardless of provider), so fetch them once per server.
 const { data: pluginGameVersionTags } = useQuery({
 queryKey: qk.pluginManagerGameVersions(serverId ?? '', 'modrinth'),
 queryFn: () => pluginManagerApi.gameVersions(serverId ?? '', 'modrinth'),
 enabled: Boolean(serverId),
 staleTime: 10 * 60 * 1000,
 });

 const {
 data: pluginSearchResults,
 isLoading: pluginSearchLoading,
 isError: pluginSearchError,
 error: pluginSearchErrorDetail,
 } = useQuery({
 queryKey: qk.pluginManagerSearch(serverId ?? '', pluginProvider, debouncedPluginQuery, pluginGameVersion.trim(), searchPage, pluginSort),
 queryFn: () =>
 pluginManagerApi.search(serverId ?? '', {
 provider: pluginProvider,
 query: debouncedPluginQuery || undefined,
 gameVersion: pluginGameVersion.trim() || undefined,
 sort: pluginSort,
 page: searchPage,
 }),
 // Wait for key status to settle and for the selected provider to be one
 // that's actually available, so a hidden default never fires a doomed 409.
 enabled:
 Boolean(serverId && pluginProvider) &&
 keyStatusSettled &&
 availablePluginProviders.includes(pluginProvider),
 });

 // Detected Minecraft version from the server environment, plus whether the
 // provider tag list already contains it (avoids duplicate select options).
 const detectedVersion = serverGameVersion?.trim() || '';
 const gameVersionTagsIncludeDetected = Boolean(
 detectedVersion &&
 (pluginGameVersionTags ?? []).some(
 (tag: string) => tag.toLowerCase() === detectedVersion.toLowerCase(),
 ),
 );

 const {
 data: pluginVersions,
 isLoading: pluginVersionsLoading,
 isError: pluginVersionsError,
 } = useQuery({
 queryKey: qk.pluginManagerVersions(serverId ?? '', pluginProvider, selectedPlugin ?? ''),
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
 queryKey: qk.pluginManagerInstalled(serverId ?? ''),
 queryFn: () => pluginManagerApi.installed(serverId ?? ''),
 enabled: Boolean(serverId && pluginManagerConfig),
 staleTime: 300_000,
 refetchInterval: false, // install/uninstall/update complete via SSE
 refetchIntervalInBackground: false,
 });

 // ── Mutations ──
 const uninstallPluginMutation = useMutation({
 mutationFn: (filename: string) =>
 pluginManagerApi.uninstall(serverId!, filename),
 onSuccess: () => notifySuccess('Plugin removed'),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.pluginManagerInstalled(serverId ?? '') });
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
 onSuccess: () => notifySuccess('Plugin installed successfully'),
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.pluginManagerInstalled(serverId ?? '') });
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
 const response = pluginSearchResults as any;
 // Modrinth → { hits, total_hits }; Paper → { result, pagination: { count } };
 // Spigot → plain array.
 if (Array.isArray(response)) return response;
 if (Array.isArray(response.result)) return response.result;
 if (Array.isArray(response.hits)) return response.hits;
 if (Array.isArray(response.data)) return response.data;
 return [];
 }, [pluginSearchResults]);

 const totalHits = useMemo(() => {
 const response = pluginSearchResults as any;
 return (
 response?.total_hits ??
 response?.pagination?.count ??
 pluginResults.length
 );
 }, [pluginSearchResults, pluginResults]);

 const totalPages = Math.max(1, Math.ceil(totalHits / RESULTS_PER_PAGE));

 const rawPluginVersions = useMemo(() => {
 if (!pluginVersions) return [];
 const versionsResponse = pluginVersions as any;
 if (Array.isArray(versionsResponse)) return versionsResponse;
 if (Array.isArray(versionsResponse.data)) return versionsResponse.data;
 if (Array.isArray(versionsResponse.result)) return versionsResponse.result;
 return [];
 }, [pluginVersions]);

 const {
 list: pluginVersionOptions,
 exactMatch: pluginVersionsExactMatch,
 } = useMemo(
 () =>
 splitVersionsForGameVersion(rawPluginVersions, pluginGameVersion),
 [rawPluginVersions, pluginGameVersion],
 );

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
 const [prevPluginAuto, setPrevPluginAuto] = useState({
 options: pluginVersionOptions,
 project: selectedPlugin,
 version: selectedPluginVersion,
 });
 if (
 pluginVersionOptions !== prevPluginAuto.options ||
 selectedPlugin !== prevPluginAuto.project ||
 selectedPluginVersion !== prevPluginAuto.version
 ) {
 setPrevPluginAuto({
 options: pluginVersionOptions,
 project: selectedPlugin,
 version: selectedPluginVersion,
 });
 if (selectedPlugin) {
 if (pluginVersionOptions.length === 0) {
 if (selectedPluginVersion) setSelectedPluginVersion('');
 } else if (
 !(
 selectedPluginVersion &&
 pluginVersionOptions.some(
 (entry: any) => normalizeVersionId(entry) === selectedPluginVersion,
 )
 )
 ) {
 const preferred =
 pluginVersionOptions.find((entry: any) =>
 isStableRelease(entry),
 ) ?? pluginVersionOptions[0];
 const preferredId = normalizeVersionId(preferred);
 if (preferredId && preferredId !== selectedPluginVersion) {
 setSelectedPluginVersion(preferredId);
 }
 }
 }
 }

 // ── Handlers ──
 const handleSearch = useCallback(() => {
 // Flush the debounce so Enter/Search applies immediately.
 setDebouncedPluginQuery(pluginQuery.trim());
 setSearchPage(1);
 }, [pluginQuery]);

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
 <motion.div variants={itemVariants}>
 <TabHeader
 icon={Puzzle}
 title="Plugins"
 description="Discover, install, and update plugins for your server."
 actions={(
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
 )}
 />
 </motion.div>

 {/* ── Sub-tab toggle ── */}
 <motion.div variants={itemVariants} className="flex items-center gap-1 rounded-xl border border-border bg-card/80 p-1 backdrop-blur-sm">
 {(['browse', 'installed'] as const).map((tab) => (
 <button
 key={tab}
 type="button"
 className={`relative flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-all duration-200 ${
 pluginSubTab === tab
 ? 'bg-primary text-primary-foreground shadow-sm'
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
 pluginSubTab === 'installed' ? 'bg-primary-foreground/20' : 'bg-surface-2'
 }`}>
 {installedPlugins.length}
 </span>
 )}
 </button>
 ))}
 </motion.div>

 {/* ═══════════════════════════════════════════════════════════════ */}
 {/* BROWSE TAB */}
 {/* ═══════════════════════════════════════════════════════════════ */}
 <div
 style={{ display: pluginSubTab === 'browse' ? 'contents' : 'none' }}
 className="space-y-4"
 >
 {/* ── Filters ── */}
 <motion.div
 variants={itemVariants}
 className="rounded-xl border border-border/50 bg-card/60 p-2.5 backdrop-blur-sm"
 >
 <div className="flex flex-wrap items-center gap-2.5">
 {/* Search */}
 <div className="relative min-w-[220px] flex-1">
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

 {/* Game version — provider-agnostic Minecraft version filter */}
 <select
 className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
 value={pluginGameVersion}
 onChange={(e) => setPluginGameVersion(e.target.value)}
 aria-label="Filter by game version"
 >
 <option value="">Any game version</option>
 {detectedVersion && !gameVersionTagsIncludeDetected && (
 <option value={detectedVersion}>
 Server version ({detectedVersion})
 </option>
 )}
 {(pluginGameVersionTags ?? []).slice(0, 60).map((v) => (
 <option key={v} value={v}>
 {v}
 </option>
 ))}
 </select>

 {/* Provider */}
 <select
 className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
 value={pluginProvider}
 onChange={(e) => setPluginProvider(e.target.value)}
 >
 {availablePluginProviders.map((provider: string) => (
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
 </div>
 </motion.div>

 {/* ── Sort presets + result meta ── */}
 <motion.div
 variants={itemVariants}
 className="flex flex-wrap items-center justify-between gap-2"
 >
 <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border/50 bg-card/60 p-1 backdrop-blur-sm">
 {PLUGIN_SORT_OPTIONS.map(({ id, label, icon: SortIcon }) => (
 <button
 key={id}
 type="button"
 className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
 pluginSort === id
 ? 'bg-primary text-primary-foreground shadow-sm'
 : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
 }`}
 onClick={() => setPluginSort(id)}
 >
 <SortIcon className="h-3.5 w-3.5" />
 {label}
 </button>
 ))}
 </div>
 {availablePluginProviders.length > 0 && (
 <span className="text-xs text-muted-foreground">
 {totalHits.toLocaleString()} result{totalHits !== 1 ? 's' : ''}
 {totalHits > RESULTS_PER_PAGE && (
 <> · page {searchPage} of {totalPages}</>
 )}
 </span>
 )}
 </motion.div>

 {/* ── Results area ── */}
 {availablePluginProviders.length === 0 ? (
 <motion.div variants={itemVariants}>
 <EmptyState
 title="No providers available"
 description="Every provider this template offers requires an API key that isn't configured. An administrator can add one under Admin → System → Mod Manager API Keys."
 />
 </motion.div>
 ) : !keyStatusSettled ? (
 /* Provider key status still resolving — search is gated on it, so show
    a loader rather than a misleading "No results" flash. */
 <BrowseSkeleton />
 ) : pluginSearchLoading ? (
 <BrowseSkeleton />
 ) : pluginSearchError ? (
 <motion.div
 variants={itemVariants}
 className="rounded-xl border border-danger/30 bg-danger-muted p-4 text-sm text-danger"
 >
 {(() => {
 const err: any = pluginSearchErrorDetail;
 const status = err?.response?.status ?? err?.status;
 const detail =
 err?.response?.data?.error ||
 err?.response?.data?.message ||
 err?.message;
 if (status === 409) {
 return (
 detail ||
 'Provider API key not configured. Set it under Admin → System → Mod Manager API Keys.'
 );
 }
 if (detail) {
 return `Search failed${status ? ` (HTTP ${status})` : ''}: ${String(detail).slice(0, 200)}`;
 }
 return 'Unable to load search results. Try again in a moment.';
 })()}
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
 {/* Result cards — each card owns its entrance animation (direct props,
     not inherited variants): orchestrated staggered entrances can strand
     late children in the "hidden" state when a re-render lands mid-flight,
     which showed up as cards silently missing until a re-mount. */}
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
 <AnimatePresence>
 {pluginResults.map((entry: any, index: number) => {
 const id =
 pluginProvider === 'paper'
 ? encodeURIComponent(
 // Hangar identifies projects as {owner}/{slug} (namespace); fall
 // back to the bare slug, which the Hangar API also accepts.
 (entry.namespace?.owner && entry.namespace?.slug
 ? `${entry.namespace.owner}/${entry.namespace.slug}`
 : entry.owner?.name && entry.slug
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
 entry.id ||
 'Untitled';
 // Provider payloads vary — never render a non-string as a React child.
 const titleText = typeof title === 'string' ? title : String(title);
 const rawSummary =
 entry.description ||
 entry.summary ||
 entry.tag ||
 '';
 const summary = typeof rawSummary === 'string' ? rawSummary : '';
 const isActive =
 selectedPlugin === String(id);
 const imageUrl =
 pluginProvider === 'modrinth'
 ? entry.icon_url
 : pluginProvider === 'paper'
 ? entry.avatarUrl
 : entry.icon?.url || entry.icon?.data;
 const fallbackLabel = titleText
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

 // Spiget search results carry `author` as `{id}` only (no name) — extract
 // strings strictly so nothing object-shaped reaches the JSX.
 const rawAuthor =
 pluginProvider === 'modrinth'
 ? entry.author
 : pluginProvider === 'paper'
 ? entry.namespace?.owner
 : entry.author?.name;
 const author = typeof rawAuthor === 'string' ? rawAuthor.trim() : '';
 const updatedValue =
 pluginProvider === 'modrinth'
 ? entry.date_modified
 : pluginProvider === 'paper'
 ? entry.lastUpdated
 : entry.updateDate;
 const updatedLabel = formatRelativeTime(updatedValue);

 return (
 <motion.div
 key={String(id)}
 initial={{ opacity: 0, y: 8 }}
 animate={{
 opacity: 1,
 y: 0,
 transition: {
 duration: 0.22,
 delay: Math.min(index * 0.03, 0.15),
 ease: 'easeOut',
 },
 }}
 exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
 className={`group relative cursor-pointer rounded-xl border p-4 transition-all duration-200 ${
 isActive
 ? 'border-primary/50 bg-primary-muted/50 ring-1 ring-primary/20'
 : 'border-border/50 bg-card/80 backdrop-blur-sm hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-black/5'
 }`}
 onClick={() => {
 setSelectedPlugin(
 isActive ? null : String(id),
 );
 setSelectedPluginName(titleText);
 }}
 >
 <div className="flex items-start gap-3">
 {imageUrl ? (
 <img
 src={imageUrl}
 alt=""
 loading="lazy"
 className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-black/5"
 />
 ) : (
 <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/15 to-primary/5 text-xs font-bold text-primary/70">
 {fallbackLabel || 'PL'}
 </div>
 )}
 <div className="min-w-0 flex-1">
 <div className="flex items-start justify-between gap-2">
 <span className="truncate text-sm font-semibold text-foreground">
 {titleText}
 </span>
 {externalUrl && (
 <a
 href={externalUrl}
 target="_blank"
 rel="noreferrer"
 onClick={(e) => e.stopPropagation()}
 className="shrink-0 rounded-md p-0.5 opacity-0 transition-all hover:bg-surface-2 group-hover:opacity-100"
 >
 <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary" />
 </a>
 )}
 </div>
 {author && (
 <p className="truncate text-[11px] text-muted-foreground">
 by {author}
 </p>
 )}
 </div>
 </div>
 {summary && (
 <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
 {summary}
 </p>
 )}
 <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/40 pt-2.5">
 <div className="flex min-w-0 items-center gap-3 text-[11px] text-muted-foreground">
 {downloads > 0 && (
 <span className="flex items-center gap-1">
 <Download className="h-3 w-3" />
 {formatDownloadCount(downloads)}
 </span>
 )}
 {updatedLabel && (
 <span className="truncate">
 updated {updatedLabel}
 </span>
 )}
 </div>
 <ChevronDown
 className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${
 isActive ? 'rotate-180 text-primary' : ''
 }`}
 />
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
 gameVersionLabel={
 pluginGameVersion.trim() || undefined
 }
 exactMatch={pluginVersionsExactMatch}
 rawCount={rawPluginVersions.length}
 />
 )}
 </AnimatePresence>
 </motion.div>
 );
 })}
 </AnimatePresence>
 </div>

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
 ? 'bg-primary text-primary-foreground shadow-sm'
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
 {/* INSTALLED TAB */}
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
 setPendingRemovePlugins(Array.from(selectedPluginFiles));
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
 <div className="overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm">
 <AnimatePresence>
 {filteredInstalledPlugins.map((plugin: any) => {
 const isSelected = selectedPluginFiles.has(
 plugin.name,
 );
 return (
 <motion.div
 key={plugin.name}
 initial={{ opacity: 0, y: 6 }}
 animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
 exit={{ opacity: 0, transition: { duration: 0.1 } }}
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
 ? 'border-primary bg-primary text-primary-foreground'
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
 setPendingRemovePlugins([plugin.name]);
 }}
 >
 <Trash2 className="h-4 w-4" />
 </button>
 </div>
 </motion.div>
 );
 })}
 </AnimatePresence>
 </div>
 )}
 </div>

 {/* Remove confirmation modal */}
 <ConfirmDialog
 open={pendingRemovePlugins !== null && pendingRemovePlugins.length > 0}
 title={
 pendingRemovePlugins?.length === 1 ? 'Remove plugin' : 'Remove plugins'
 }
 message={
 pendingRemovePlugins?.length === 1
 ? `Remove ${pendingRemovePlugins[0]}? This cannot be undone.`
 : `Remove ${pendingRemovePlugins?.length ?? 0} selected plugins? This cannot be undone.`
 }
 confirmText="Remove"
 variant="danger"
 loading={uninstallPluginMutation.isPending}
 onConfirm={() => {
 if (!pendingRemovePlugins) return;
 pendingRemovePlugins.forEach((name) =>
 uninstallPluginMutation.mutate(name),
 );
 setSelectedPluginFiles(new Set());
 setPendingRemovePlugins(null);
 }}
 onCancel={() => {
 if (!uninstallPluginMutation.isPending) setPendingRemovePlugins(null);
 }}
 />

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
