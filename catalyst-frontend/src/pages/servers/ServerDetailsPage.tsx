import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import { ArrowUpCircle, CheckSquare, Download, ExternalLink, Loader2, Package, Puzzle, RefreshCw, Search, Square, Trash2, Terminal, FolderOpen, HardDrive, Clock, Database, BarChart3, Bell, Wrench, Users, Settings, Shield, FolderSync } from 'lucide-react';
import { useServer } from '../../hooks/useServer';
import { useServerMetrics } from '../../hooks/useServerMetrics';
import {
  useServerMetricsHistory,
  type MetricsTimeRange,
} from '../../hooks/useServerMetricsHistory';
import { formatBytes } from '../../utils/formatters';
import { useWebSocketStore } from '../../stores/websocketStore';
import ServerControls from '../../components/servers/ServerControls';
import ServerConsoleTab from '../../components/servers/ServerConsoleTab';
import ServerStatusBadge from '../../components/servers/ServerStatusBadge';
import ServerMetrics from '../../components/servers/ServerMetrics';
import ServerMetricsTrends from '../../components/servers/ServerMetricsTrends';
import MetricsTimeRangeSelector from '../../components/servers/MetricsTimeRangeSelector';
import UpdateServerModal from '../../components/servers/UpdateServerModal';
import TransferServerModal from '../../components/servers/TransferServerModal';
import DeleteServerDialog from '../../components/servers/DeleteServerDialog';
import FileManager from '../../components/files/FileManager';
import SftpConnectionInfo from '../../components/files/SftpConnectionInfo';
import BackupSection from '../../components/backups/BackupSection';
import CreateTaskModal from '../../components/tasks/CreateTaskModal';
import EditTaskModal from '../../components/tasks/EditTaskModal';
import AlertsPage from '../alerts/AlertsPage';
import EmptyState from '../../components/shared/EmptyState';
import { useConsole } from '../../hooks/useConsole';
import { useEulaPrompt } from '../../hooks/useEulaPrompt';
import EulaModal from '../../components/servers/EulaModal';
import { useTasks } from '../../hooks/useTasks';
import { useServerDatabases } from '../../hooks/useServerDatabases';
import { useDatabaseHosts } from '../../hooks/useAdmin';
import { useAuthStore } from '../../stores/authStore';
import { serversApi } from '../../services/api/servers';
import { filesApi } from '../../services/api/files';
import { databasesApi } from '../../services/api/databases';
import { modManagerApi } from '../../services/api/modManager';
import { pluginManagerApi } from '../../services/api/pluginManager';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getErrorMessage } from '../../utils/errors';
import {
  detectConfigFormat,
  parseConfig,
  serializeConfig,
  type ConfigMap,
  type ConfigNode,
} from '../../utils/configFormats';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../../services/api/tasks';
import type {
  ServerAccessEntry,
  ServerInvite,
  ServerPermissionsResponse,
  ModManagerProviderObject,
} from '../../types/server';

interface PluginVersion {
  id: string | number;
  name?: string;
  version?: string;
  slug?: string;
  gameVersion?: string;
  date?: string;
  createdAt?: string;
  [key: string]: unknown;
}

interface PluginVersionsResponse {
  data?: PluginVersion[];
  result?: PluginVersion[];
}

type ConfigEntry = {
  key: string;
  value: string;
  type: 'string' | 'number' | 'boolean' | 'null' | 'object';
  children?: ConfigEntry[];
};
type ConfigSection = {
  title: string;
  entries: ConfigEntry[];
  collapsed?: boolean;
};
type ConfigFileState = {
  path: string;
  sections: ConfigSection[];
  format: ReturnType<typeof detectConfigFormat>;
  error: string | null;
  loaded: boolean;
  viewMode: 'form' | 'raw';
  rawContent: string;
};
type ModManagerTarget = 'mods' | 'datapacks' | 'modpacks';
type ModManagerProviderOption = {
  key: string;
  providerId: string;
  game?: string;
  label: string;
  targets: ModManagerTarget[];
};
const defaultModManagerTargets: ModManagerTarget[] = ['mods', 'datapacks', 'modpacks'];
const normalizeModManagerTarget = (value: unknown): ModManagerTarget | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'mods' || normalized === 'datapacks' || normalized === 'modpacks') {
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
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const displayProviderName = (providerId: string) => {
  if (providerId === 'modrinth') return 'Modrinth';
  if (providerId === 'curseforge') return 'CurseForge';
  return titleCase(providerId);
};

const unstableReleasePattern = /\b(alpha|beta|snapshot|pre[-\s]?release|pre\b|rc)\b/i;

const normalizeVersionToken = (value: string) => value.trim().toLowerCase().replace(/^v(?=\d)/, '');

const normalizeVersionId = (version: any): string => {
  const id = version?.id ?? version?.versionId ?? version?.fileId ?? version?.fileID ?? version?.file?.id;
  if (id === undefined || id === null) return '';
  return String(id);
};

const normalizeVersionLabel = (version: any): string => {
  return (
    version?.name ||
    version?.version ||
    version?.version_number ||
    version?.displayName ||
    version?.fileName ||
    normalizeVersionId(version)
  );
};

const collectVersionStrings = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
};

const extractGameVersions = (version: any): string[] => {
  const values = [
    ...collectVersionStrings(version?.game_versions),
    ...collectVersionStrings(version?.gameVersions),
    ...collectVersionStrings(version?.versions),
    ...collectVersionStrings(version?.supportedVersions),
    ...collectVersionStrings(version?.supported_versions),
    ...collectVersionStrings(version?.minecraftVersions),
    ...collectVersionStrings(version?.minecraft_versions),
  ];
  return Array.from(new Set(values.map((entry) => normalizeVersionToken(entry))));
};

const isGameVersionMatch = (candidate: string, requested: string) => {
  const normalizedCandidate = normalizeVersionToken(candidate);
  const normalizedRequested = normalizeVersionToken(requested);
  if (!normalizedCandidate || !normalizedRequested) return false;
  if (normalizedCandidate === normalizedRequested) return true;
  if (normalizedCandidate.startsWith(`${normalizedRequested}.`)) return true;
  if (normalizedRequested.startsWith(`${normalizedCandidate}.`)) return true;
  return false;
};

const matchesRequestedGameVersion = (version: any, requestedVersion?: string) => {
  const requested = requestedVersion?.trim();
  if (!requested) return true;
  const versions = extractGameVersions(version);
  if (!versions.length) return true;
  return versions.some((entry) => isGameVersionMatch(entry, requested));
};

const resolveVersionTimestamp = (version: any): number => {
  const candidates = [
    version?.date_published,
    version?.datePublished,
    version?.publishedAt,
    version?.published,
    version?.fileDate,
    version?.createdAt,
    version?.created,
    version?.updatedAt,
    version?.releaseDate,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' || typeof value === 'number') {
      const ts = new Date(value).getTime();
      if (Number.isFinite(ts)) return ts;
    }
  }
  return 0;
};

const isStableRelease = (version: any): boolean => {
  const releaseType = version?.releaseType;
  if (typeof releaseType === 'number') {
    if (releaseType === 1) return true;
    if (releaseType === 2 || releaseType === 3) return false;
  }

  const explicitType =
    typeof version?.version_type === 'string'
      ? version.version_type
      : typeof version?.releaseChannel === 'string'
        ? version.releaseChannel
        : typeof version?.channel === 'string'
          ? version.channel
          : typeof version?.stability === 'string'
            ? version.stability
            : '';
  if (explicitType) {
    const normalized = explicitType.toLowerCase();
    if (normalized.includes('release') || normalized.includes('stable')) return true;
    if (unstableReleasePattern.test(normalized)) return false;
  }

  if (typeof version?.isStable === 'boolean') return version.isStable;
  if (typeof version?.stable === 'boolean') return version.stable;

  const label = normalizeVersionLabel(version);
  return !unstableReleasePattern.test(label.toLowerCase());
};

const filterAndSortVersions = (versions: any[], requestedGameVersion?: string) => {
  const matching = versions.filter((entry) => matchesRequestedGameVersion(entry, requestedGameVersion));
  const pool = matching.length ? matching : versions;
  return [...pool].sort((a, b) => {
    const stableDelta = Number(isStableRelease(b)) - Number(isStableRelease(a));
    if (stableDelta !== 0) return stableDelta;
    const timeDelta = resolveVersionTimestamp(b) - resolveVersionTimestamp(a);
    if (timeDelta !== 0) return timeDelta;
    const aId = Number(normalizeVersionId(a));
    const bId = Number(normalizeVersionId(b));
    if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
      return bId - aId;
    }
    return normalizeVersionLabel(b).localeCompare(normalizeVersionLabel(a));
  });
};

const tabLabels = {
  console: 'Console',
  files: 'Files',
  sftp: 'SFTP',
  backups: 'Backups',
  tasks: 'Tasks',
  databases: 'Databases',
  metrics: 'Metrics',
  alerts: 'Alerts',
  modManager: 'Mod Manager',
  pluginManager: 'Plugin Manager',
  configuration: 'Configuration',
  users: 'Users',
  settings: 'Settings',
  admin: 'Admin',
} as const;

const tabIcons: Record<keyof typeof tabLabels, React.ComponentType<{ className?: string }>> = {
  console: Terminal,
  files: FolderOpen,
  sftp: FolderSync,
  backups: HardDrive,
  tasks: Clock,
  databases: Database,
  metrics: BarChart3,
  alerts: Bell,
  modManager: Package,
  pluginManager: Puzzle,
  configuration: Wrench,
  users: Users,
  settings: Settings,
  admin: Shield,
};

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : '—');

function ServerDetailsPage() {
  const { serverId, tab } = useParams();
  const navigate = useNavigate();
  const { data: server, isLoading, isError } = useServer(serverId);
  const liveMetrics = useServerMetrics(serverId, server?.allocatedMemoryMb);
  const [metricsTimeRange, setMetricsTimeRange] = useState<MetricsTimeRange>({
    hours: 1,
    limit: 60,
    label: '1 hour',
  });
  const { data: metricsHistory } = useServerMetricsHistory(serverId, metricsTimeRange);
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(serverId);
  const {
    data: databases = [],
    isLoading: databasesLoading,
    isError: databasesError,
  } = useServerDatabases(serverId);
  const { data: databaseHosts = [] } = useDatabaseHosts();
  const { isConnected } = useWebSocketStore();
  const { user } = useAuthStore();
  const isAdmin = useMemo(
    () =>
      user?.permissions?.includes('*') ||
      user?.permissions?.includes('admin.read') ||
      user?.permissions?.includes('admin.write'),
    [user?.permissions],
  );
  const canAdminWrite = useMemo(
    () => user?.permissions?.includes('*') || user?.permissions?.includes('admin.write'),
    [user?.permissions],
  );

  // Helper: check if user has a specific permission on this server.
  // Uses effectivePermissions from server data (owner gets all).
  // Falls back to checking global admin if server data not yet loaded.
  const serverPerms = useMemo(() => new Set(server?.effectivePermissions ?? []), [server?.effectivePermissions]);
  const hasServerPerm = useCallback(
    (perm: string) => {
      if (serverPerms.size === 0) return isAdmin; // not loaded yet — show optimistically
      return serverPerms.has(perm);
    },
    [serverPerms, isAdmin],
  );

  const queryClient = useQueryClient();
  const { data: permissionsData } = useQuery<ServerPermissionsResponse>({
    queryKey: ['server-permissions', serverId],
    queryFn: () => serversApi.permissions(serverId ?? ''),
    enabled: Boolean(serverId),
  });
  const { data: invites = [] } = useQuery<ServerInvite[]>({
    queryKey: ['server-invites', serverId],
    queryFn: () => serversApi.listInvites(serverId ?? ''),
    enabled: Boolean(serverId),
  });
  const [configFiles, setConfigFiles] = useState<ConfigFileState[]>([]);
  const [openConfigIndex, setOpenConfigIndex] = useState(-1);
  const consoleScrollback = 2000;
  const [configSearch, setConfigSearch] = useState('');
  const [databaseHostId, setDatabaseHostId] = useState('');
  const [databaseName, setDatabaseName] = useState('');
  const [allocations, setAllocations] = useState<
    { containerPort: number; hostPort: number; isPrimary: boolean }[]
  >([]);
  const [allocationsError, setAllocationsError] = useState<string | null>(null);
  const [newContainerPort, setNewContainerPort] = useState('');
  const [newHostPort, setNewHostPort] = useState('');
  const [restartPolicy, setRestartPolicy] = useState<'always' | 'on-failure' | 'never'>(
    'on-failure',
  );
  const [maxCrashCount, setMaxCrashCount] = useState('5');
  const [serverName, setServerName] = useState('');
  const [startupCommand, setStartupCommand] = useState('');
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [envDirty, setEnvDirty] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [invitePreset, setInvitePreset] = useState<'readOnly' | 'power' | 'full' | 'custom'>(
    'readOnly',
  );
  const [invitePermissions, setInvitePermissions] = useState<string[]>([]);
  const [accessPermissions, setAccessPermissions] = useState<Record<string, string[]>>({});
  const modManagerConfig = server?.template?.features?.modManager;
  const modProviderOptions = useMemo<ModManagerProviderOption[]>(() => {
    const providers = Array.isArray(modManagerConfig?.providers) ? modManagerConfig.providers : [];
    const rootTargets = normalizeModManagerTargets(modManagerConfig?.targets);
    const fallbackTargets = rootTargets.length ? rootTargets : defaultModManagerTargets;
    return providers
      .map((entry, index) => {
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
          typeof provider.id === 'string'
            ? provider.id
            : '';
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
          targets: providerTargets.length ? providerTargets : fallbackTargets,
        };
      })
      .filter((entry): entry is ModManagerProviderOption => Boolean(entry));
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
  const modTargetOptions = selectedModProvider?.targets ?? defaultModManagerTargets;
  const supportsModLoaderFilter = !modProviderGame || modProviderGame === 'minecraft';
  const pluginManagerConfig = server?.template?.features?.pluginManager;
  const pluginManagerProviders = pluginManagerConfig?.providers ?? [];
  const [modQuery, setModQuery] = useState('');
  const [modTarget, setModTarget] = useState<ModManagerTarget>('mods');
  const [modLoader, setModLoader] = useState('forge');
  const [modGameVersion, setModGameVersion] = useState('');
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [selectedProjectName, setSelectedProjectName] = useState<string>('');
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [modSubTab, setModSubTab] = useState<'browse' | 'installed'>('browse');
  const [pluginProvider, setPluginProvider] = useState('modrinth');
  const [pluginGameVersion, setPluginGameVersion] = useState('');
  const [selectedPluginName, setSelectedPluginName] = useState<string>('');
  const [pluginSubTab, setPluginSubTab] = useState<'browse' | 'installed'>('browse');
  const [updateConfirmMods, setUpdateConfirmMods] = useState<{ name: string; currentVersion: string; latestVersion: string }[]>([]);
  const [updateConfirmPlugins, setUpdateConfirmPlugins] = useState<{ name: string; currentVersion: string; latestVersion: string }[]>([]);
  const [isCheckingModUpdates, setIsCheckingModUpdates] = useState(false);
  const [isCheckingPluginUpdates, setIsCheckingPluginUpdates] = useState(false);
  const [isUpdatingMods, setIsUpdatingMods] = useState(false);
  const [isUpdatingPlugins, setIsUpdatingPlugins] = useState(false);
  const [selectedModFiles, setSelectedModFiles] = useState<Set<string>>(new Set());
  const [selectedPluginFiles, setSelectedPluginFiles] = useState<Set<string>>(new Set());
  const [modInstalledSearch, setModInstalledSearch] = useState('');
  const [pluginInstalledSearch, setPluginInstalledSearch] = useState('');
  const [modInstalledSort, setModInstalledSort] = useState<'name' | 'size' | 'date'>('name');
  const [pluginInstalledSort, setPluginInstalledSort] = useState<'name' | 'size' | 'date'>('name');
  const [modInstalledFilter, setModInstalledFilter] = useState<'all' | 'updates' | 'tracked' | 'untracked'>('all');
  const [pluginInstalledFilter, setPluginInstalledFilter] = useState<'all' | 'updates' | 'tracked' | 'untracked'>('all');  const {
    entries,
    send,
    isLoading: consoleLoading,
    isError: consoleError,
    refetch: refetchConsole,
    clear: clearConsole,
  } = useConsole(serverId, {
    initialLines: consoleScrollback,
    maxEntries: consoleScrollback,
  });

  useEffect(() => {
    if (!serverId) return;
    refetchConsole().catch(() => {
      // ignore refetch errors
    });
  }, [refetchConsole, serverId]);

  const isSuspended = server?.status === 'suspended';
  const activeTab = useMemo(() => {
    const key = tab ?? 'console';
    return key in tabLabels ? (key as keyof typeof tabLabels) : 'console';
  }, [tab]);

  const { eulaPrompt, isLoading: eulaLoading, respond: respondEula } = useEulaPrompt(serverId);

  const canSend = isConnected && Boolean(serverId) && server?.status === 'running' && !isSuspended && hasServerPerm('console.write');
  const canManageDatabases =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.read') ||
    user?.permissions?.includes('database.create') ||
    user?.permissions?.includes('database.read') ||
    user?.permissions?.includes('database.rotate') ||
    user?.permissions?.includes('database.delete') ||
    Boolean(server && user?.id && server.ownerId === user.id);
  const databaseAllocation = server?.databaseAllocation ?? 0;
  const databaseLimitReached = databaseAllocation > 0 && databases.length >= databaseAllocation;
  const [pluginQuery, setPluginQuery] = useState('');
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const [selectedPluginVersion, setSelectedPluginVersion] = useState<string>('');

  const serverGameVersion =
    server?.environment?.MC_VERSION ||
    server?.environment?.MINECRAFT_VERSION ||
    server?.environment?.GAME_VERSION ||
    server?.environment?.SERVER_VERSION ||
    server?.environment?.VERSION;
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
    queryKey: ['mod-manager-versions', serverId, modProvider, modProviderGame, selectedProject],
    queryFn: () =>
      modManagerApi.versions(serverId ?? '', {
        provider: modProvider,
        game: modProviderGame,
        projectId: selectedProject ?? '',
      }),
    enabled: Boolean(serverId && modProvider && selectedProject),
  });

  const {
    data: pluginSearchResults,
    isLoading: pluginSearchLoading,
    isError: pluginSearchError,
    refetch: refetchPluginSearch,
  } = useQuery({
    queryKey: ['plugin-manager-search', serverId, pluginProvider, pluginQuery, pluginGameVersion],
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
    queryKey: ['plugin-manager-versions', serverId, pluginProvider, selectedPlugin],
    queryFn: () =>
      pluginManagerApi.versions(serverId ?? '', {
        provider: pluginProvider,
        projectId: selectedPlugin ?? '',
      }),
    enabled: Boolean(serverId && pluginProvider && selectedPlugin),
  });

  const {
    data: installedMods = [],
    refetch: refetchInstalledMods,
  } = useQuery({
    queryKey: ['mod-manager-installed', serverId, modTarget],
    queryFn: () => modManagerApi.installed(serverId ?? '', modTarget),
    enabled: Boolean(serverId && modManagerConfig),
  });

  const {
    data: installedPlugins = [],
    refetch: refetchInstalledPlugins,
  } = useQuery({
    queryKey: ['plugin-manager-installed', serverId],
    queryFn: () => pluginManagerApi.installed(serverId ?? ''),
    enabled: Boolean(serverId && pluginManagerConfig),
  });

  const uninstallModMutation = useMutation({
    mutationFn: (filename: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return modManagerApi.uninstall(server.id, filename, modTarget);
    },
    onSuccess: () => {
      notifySuccess('Mod removed');
      refetchInstalledMods();
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || 'Failed to remove mod');
    },
  });

  const uninstallPluginMutation = useMutation({
    mutationFn: (filename: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return pluginManagerApi.uninstall(server.id, filename);
    },
    onSuccess: () => {
      notifySuccess('Plugin removed');
      refetchInstalledPlugins();
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || 'Failed to remove plugin');
    },
  });

  const createDatabaseMutation = useMutation({
    mutationFn: () => {
      if (!server?.id) throw new Error('Server not loaded');
      if (!databaseHostId) throw new Error('Database host required');
      return databasesApi.create(server.id, {
        hostId: databaseHostId,
        name: databaseName.trim() || undefined,
      });
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['server-databases', server.id] });
      }
      setDatabaseName('');
      notifySuccess('Database created');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create database';
      notifyError(message);
    },
  });

  const rotateDatabaseMutation = useMutation({
    mutationFn: (databaseId: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return databasesApi.rotatePassword(server.id, databaseId);
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['server-databases', server.id] });
      }
      notifySuccess('Database password rotated');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to rotate password';
      notifyError(message);
    },
  });

  const deleteDatabaseMutation = useMutation({
    mutationFn: (databaseId: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return databasesApi.remove(server.id, databaseId);
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['server-databases', server.id] });
      }
      notifySuccess('Database deleted');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete database';
      notifyError(message);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: (task: { id: string; enabled: boolean }) => {
      if (!server?.id) throw new Error('Server not loaded');
      return tasksApi.update(server.id, task.id, { enabled: !task.enabled });
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['tasks', server.id] });
      }
      notifySuccess('Task updated');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update task';
      notifyError(message);
    },
  });

  const suspendMutation = useMutation({
    mutationFn: (reason?: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return serversApi.suspend(server.id, reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server', server?.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess('Server suspended');
      setSuspendReason('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to suspend server';
      notifyError(message);
    },
  });

  const unsuspendMutation = useMutation({
    mutationFn: () => {
      if (!server?.id) throw new Error('Server not loaded');
      return serversApi.unsuspend(server.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server', server?.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess('Server unsuspended');
      setSuspendReason('');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to unsuspend server';
      notifyError(message);
    },
  });

  const installModMutation = useMutation({
    mutationFn: () => {
      if (!server?.id || !selectedProject || !selectedVersion) {
        throw new Error('Missing mod selection');
      }
      return modManagerApi.install(server.id, {
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
      const message = error?.response?.data?.error || 'Failed to install mod';
      notifyError(message);
    },
  });

  const installPluginMutation = useMutation({
    mutationFn: () => {
      if (!server?.id || !selectedPlugin || !selectedPluginVersion) {
        throw new Error('Missing plugin selection');
      }
      return pluginManagerApi.install(server.id, {
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
      const message = error?.response?.data?.error || 'Failed to install plugin';
      notifyError(message);
    },
  });

  const configMutation = useMutation({
    mutationFn: async (index: number) => {
      if (!serverId) {
        throw new Error('Missing server id');
      }
      const target = configFiles[index];
      if (!target || !target.format) {
        throw new Error('Missing config file path');
      }
      if (target.viewMode === 'raw') {
        await filesApi.write(serverId, target.path, target.rawContent);
        return;
      }
      const record = buildConfigRecord(target.sections);
      const content = serializeConfig(target.format, record);
      await filesApi.write(serverId, target.path, content);
    },
    onSuccess: () => {
      notifySuccess('Configuration saved');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to save config';
      notifyError(message);
    },
  });

  const loadAllocations = useCallback(async () => {
    if (!serverId) return;
    try {
      const data = await serversApi.allocations(serverId);
      setAllocations(data || []);
      setAllocationsError(null);
    } catch (error: unknown) {
      setAllocationsError(getErrorMessage(error, 'Unable to load allocations'));
    }
  }, [serverId]);

  const addAllocationMutation = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Missing server id');
      const containerPort = Number(newContainerPort);
      const hostPort = Number(newHostPort || newContainerPort);
      if (!Number.isFinite(containerPort) || containerPort <= 0) {
        throw new Error('Invalid container port');
      }
      if (!Number.isFinite(hostPort) || hostPort <= 0) {
        throw new Error('Invalid host port');
      }
      return serversApi.addAllocation(serverId, { containerPort, hostPort });
    },
    onSuccess: () => {
      notifySuccess('Allocation added');
      setNewContainerPort('');
      setNewHostPort('');
      loadAllocations();
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to add allocation';
      notifyError(message);
    },
  });

  const removeAllocationMutation = useMutation({
    mutationFn: async (containerPort: number) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.removeAllocation(serverId, containerPort);
    },
    onSuccess: () => {
      notifySuccess('Allocation removed');
      loadAllocations();
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to remove allocation';
      notifyError(message);
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (containerPort: number) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.setPrimaryAllocation(serverId, containerPort);
    },
    onSuccess: () => {
      notifySuccess('Primary allocation updated');
      loadAllocations();
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update primary allocation';
      notifyError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return tasksApi.remove(server.id, taskId);
    },
    onSuccess: () => {
      if (server?.id) {
        queryClient.invalidateQueries({ queryKey: ['tasks', server.id] });
      }
      notifySuccess('Task deleted');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete task';
      notifyError(message);
    },
  });

  const restartPolicyMutation = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Missing server id');
      const parsedMax = maxCrashCount.trim() === '' ? undefined : Number(maxCrashCount);
      const minCrashCount = restartPolicy === 'always' ? 1 : 0;
      if (
        parsedMax !== undefined &&
        (!Number.isFinite(parsedMax) || parsedMax < minCrashCount || parsedMax > 100)
      ) {
        throw new Error(`Max crash count must be between ${minCrashCount} and 100`);
      }
      return serversApi.updateRestartPolicy(serverId, {
        restartPolicy,
        maxCrashCount: parsedMax,
      });
    },
    onSuccess: () => {
      notifySuccess('Restart policy updated');
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error || error?.message || 'Failed to update restart policy';
      notifyError(message);
    },
  });

  const resetCrashCountMutation = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.resetCrashCount(serverId);
    },
    onSuccess: () => {
      notifySuccess('Crash count reset');
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error || error?.message || 'Failed to reset crash count';
      notifyError(message);
    },
  });

  const renameServerMutation = useMutation({
    mutationFn: () => {
      if (!serverId) throw new Error('Missing server id');
      const nextName = serverName.trim();
      if (!nextName) throw new Error('Server name is required');
      return serversApi.update(serverId, { name: nextName });
    },
    onSuccess: () => {
      notifySuccess('Server name updated');
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || error?.message || 'Failed to rename server';
      notifyError(message);
    },
  });

  const startupCommandMutation = useMutation({
    mutationFn: () => {
      if (!serverId) throw new Error('Missing server id');
      const trimmed = startupCommand.trim();
      const templateDefault = server?.template?.startup ?? '';
      return serversApi.update(serverId, {
        startupCommand: trimmed === templateDefault ? null : trimmed || null,
      });
    },
    onSuccess: () => {
      notifySuccess('Startup command updated');
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error || error?.message || 'Failed to update startup command';
      notifyError(message);
    },
  });

  const envMutation = useMutation({
    mutationFn: () => {
      if (!serverId) throw new Error('Missing server id');
      const env: Record<string, string> = {};
      for (const row of envVars) {
        const k = row.key.trim();
        if (k) env[k] = row.value;
      }
      return serversApi.update(serverId, { environment: env });
    },
    onSuccess: () => {
      notifySuccess('Environment variables updated');
      setEnvDirty(false);
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error || error?.message || 'Failed to update environment';
      notifyError(message);
    },
  });

  useEffect(() => {
    if (!server) return;
    setRestartPolicy(server.restartPolicy ?? 'on-failure');
    setMaxCrashCount(
      server.maxCrashCount !== undefined && server.maxCrashCount !== null
        ? String(server.maxCrashCount)
        : '5',
    );
  }, [server?.id, server?.restartPolicy, server?.maxCrashCount]);

  useEffect(() => {
    if (!server?.name) return;
    setServerName(server.name);
  }, [server?.name]);

  useEffect(() => {
    if (!server) return;
    setStartupCommand(server.startupCommand ?? server.template?.startup ?? '');
  }, [server?.id, server?.startupCommand, server?.template?.startup]);

  useEffect(() => {
    if (!server?.environment) return;
    const entries = Object.entries(server.environment as Record<string, string>).map(
      ([key, value]) => ({ key, value: String(value) }),
    );
    setEnvVars(entries.length ? entries : [{ key: '', value: '' }]);
    setEnvDirty(false);
  }, [server?.id, server?.environment]);

  useEffect(() => {
    if (!permissionsData?.data) return;
    const nextPermissions: Record<string, string[]> = {};
    permissionsData.data.forEach((entry) => {
      nextPermissions[entry.userId] = entry.permissions;
    });
    setAccessPermissions(nextPermissions);
  }, [permissionsData?.data]);

  useEffect(() => {
    if (!permissionsData?.presets) return;
    if (invitePreset !== 'custom') {
      setInvitePermissions(permissionsData.presets[invitePreset]);
    }
  }, [invitePreset, permissionsData?.presets]);

  const createInviteMutation = useMutation({
    mutationFn: () => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.createInvite(serverId, {
        email: inviteEmail.trim(),
        permissions:
          invitePreset === 'custom'
            ? invitePermissions
            : (permissionsData?.presets[invitePreset] ?? []),
      });
    },
    onSuccess: () => {
      notifySuccess('Invite sent');
      setInviteEmail('');
      queryClient.invalidateQueries({ queryKey: ['server-invites', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to send invite';
      notifyError(message);
    },
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.cancelInvite(serverId, inviteId);
    },
    onSuccess: () => {
      notifySuccess('Invite cancelled');
      queryClient.invalidateQueries({ queryKey: ['server-invites', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to cancel invite';
      notifyError(message);
    },
  });

  const saveAccessMutation = useMutation({
    mutationFn: (entry: ServerAccessEntry) => {
      if (!serverId) throw new Error('Missing server id');
      const permissions = accessPermissions[entry.userId] ?? [];
      return serversApi.upsertAccess(serverId, { targetUserId: entry.userId, permissions });
    },
    onSuccess: () => {
      notifySuccess('Permissions updated');
      queryClient.invalidateQueries({ queryKey: ['server-permissions', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update permissions';
      notifyError(message);
    },
  });

  const removeAccessMutation = useMutation({
    mutationFn: (targetUserId: string) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.removeAccess(serverId, targetUserId);
    },
    onSuccess: () => {
      notifySuccess('Access removed');
      queryClient.invalidateQueries({ queryKey: ['server-permissions', serverId] });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to remove access';
      notifyError(message);
    },
  });

  const permissionOptions = useMemo(() => {
    const base = [
      'server.read',
      'server.start',
      'server.stop',
      'server.install',
      'server.transfer',
      'server.delete',
      'alert.read',
      'alert.create',
      'alert.update',
      'alert.delete',
      'console.read',
      'console.write',
      'file.read',
      'file.write',
      'database.read',
      'database.create',
      'database.rotate',
      'database.delete',
    ];
    const all = new Set<string>(base);
    permissionsData?.data?.forEach((entry) => entry.permissions.forEach((perm) => all.add(perm)));
    if (permissionsData?.presets) {
      Object.values(permissionsData.presets).forEach((list) =>
        list.forEach((perm) => all.add(perm)),
      );
    }
    return Array.from(all).sort();
  }, [permissionsData?.data, permissionsData?.presets]);

  useEffect(() => {
    if (!modProviderOptions.length) {
      if (modProviderKey) {
        setModProviderKey('');
      }
      return;
    }
    const hasSelected = modProviderOptions.some((entry) => entry.key === modProviderKey);
    if (!hasSelected) {
      setModProviderKey(modProviderOptions[0].key);
    }
  }, [modProviderKey, modProviderOptions]);

  useEffect(() => {
    if (!modTargetOptions.length) return;
    if (!modTargetOptions.includes(modTarget)) {
      setModTarget(modTargetOptions[0]);
    }
  }, [modTarget, modTargetOptions]);

  useEffect(() => {
    if (!pluginManagerProviders.length) return;
    if (!pluginManagerProviders.includes(pluginProvider)) {
      setPluginProvider(pluginManagerProviders[0]);
    }
  }, [pluginManagerProviders, pluginProvider]);

  useEffect(() => {
    setModGameVersion('');
    setPluginGameVersion('');
  }, [serverId]);

  useEffect(() => {
    const detectedVersion = serverGameVersion?.trim();
    if (!detectedVersion) return;
    setModGameVersion((current) => (current ? current : detectedVersion));
    setPluginGameVersion((current) => (current ? current : detectedVersion));
  }, [serverGameVersion]);

  useEffect(() => {
    setSelectedProject(null);
    setSelectedVersion('');
  }, [modProvider, modProviderGame, modQuery, modTarget, modLoader, modGameVersion]);

  useEffect(() => {
    setSelectedPlugin(null);
    setSelectedPluginVersion('');
  }, [pluginProvider, pluginQuery, pluginGameVersion]);

  useEffect(() => {
    setSelectedVersion('');
  }, [selectedProject]);

  useEffect(() => {
    setSelectedPluginVersion('');
  }, [selectedPlugin]);

  const modResults = useMemo(() => {
    if (!modSearchResults) return [];
    if (Array.isArray(modSearchResults.hits)) {
      return modSearchResults.hits;
    }
    if (Array.isArray(modSearchResults.data)) {
      return modSearchResults.data;
    }
    return [];
  }, [modSearchResults]);

  const filteredInstalledMods = useMemo(() => {
    let list = [...installedMods];
    if (modInstalledSearch) {
      const q = modInstalledSearch.toLowerCase();
      list = list.filter((m) => (m.projectName || m.name).toLowerCase().includes(q));
    }
    if (modInstalledFilter === 'updates') list = list.filter((m) => m.hasUpdate);
    else if (modInstalledFilter === 'tracked') list = list.filter((m) => m.provider);
    else if (modInstalledFilter === 'untracked') list = list.filter((m) => !m.provider);
    list.sort((a, b) => {
      if (modInstalledSort === 'size') return b.size - a.size;
      if (modInstalledSort === 'date') return new Date(b.modifiedAt || 0).getTime() - new Date(a.modifiedAt || 0).getTime();
      return (a.projectName || a.name).localeCompare(b.projectName || b.name);
    });
    return list;
  }, [installedMods, modInstalledSearch, modInstalledFilter, modInstalledSort]);

  const filteredInstalledPlugins = useMemo(() => {
    let list = [...installedPlugins];
    if (pluginInstalledSearch) {
      const q = pluginInstalledSearch.toLowerCase();
      list = list.filter((p) => (p.projectName || p.name).toLowerCase().includes(q));
    }
    if (pluginInstalledFilter === 'updates') list = list.filter((p) => p.hasUpdate);
    else if (pluginInstalledFilter === 'tracked') list = list.filter((p) => p.provider);
    else if (pluginInstalledFilter === 'untracked') list = list.filter((p) => !p.provider);
    list.sort((a, b) => {
      if (pluginInstalledSort === 'size') return b.size - a.size;
      if (pluginInstalledSort === 'date') return new Date(b.modifiedAt || 0).getTime() - new Date(a.modifiedAt || 0).getTime();
      return (a.projectName || a.name).localeCompare(b.projectName || b.name);
    });
    return list;
  }, [installedPlugins, pluginInstalledSearch, pluginInstalledFilter, pluginInstalledSort]);

  const modVersionOptions = useMemo(() => {
    if (!modVersions) return [];
    const raw =
      Array.isArray(modVersions.data)
        ? modVersions.data
        : Array.isArray(modVersions)
          ? modVersions
          : [];
    return filterAndSortVersions(raw, modGameVersion);
  }, [modGameVersion, modVersions]);

  const pluginResults = useMemo(() => {
    if (!pluginSearchResults) return [];
    if (Array.isArray(pluginSearchResults.hits)) {
      return pluginSearchResults.hits;
    }
    if (Array.isArray(pluginSearchResults.data)) {
      return pluginSearchResults.data;
    }
    if (Array.isArray(pluginSearchResults)) {
      return pluginSearchResults;
    }
    return [];
  }, [pluginSearchResults]);

  const pluginVersionOptions = useMemo(() => {
    if (!pluginVersions) return [];
    const versionsResponse = pluginVersions as PluginVersionsResponse;
    const raw = Array.isArray(versionsResponse.data)
      ? versionsResponse.data
      : Array.isArray(versionsResponse.result)
        ? versionsResponse.result
        : Array.isArray(pluginVersions)
          ? pluginVersions
          : [];
    return filterAndSortVersions(raw, pluginGameVersion);
  }, [pluginGameVersion, pluginVersions]);

  useEffect(() => {
    if (!selectedProject) return;
    if (!modVersionOptions.length) {
      if (selectedVersion) setSelectedVersion('');
      return;
    }
    if (selectedVersion && modVersionOptions.some((entry: any) => normalizeVersionId(entry) === selectedVersion)) {
      return;
    }
    const preferred =
      modVersionOptions.find((entry: any) => isStableRelease(entry)) ?? modVersionOptions[0];
    const preferredId = normalizeVersionId(preferred);
    if (preferredId && preferredId !== selectedVersion) {
      setSelectedVersion(preferredId);
    }
  }, [modVersionOptions, selectedProject, selectedVersion]);

  useEffect(() => {
    if (!selectedPlugin) return;
    if (!pluginVersionOptions.length) {
      if (selectedPluginVersion) setSelectedPluginVersion('');
      return;
    }
    if (
      selectedPluginVersion &&
      pluginVersionOptions.some((entry: any) => normalizeVersionId(entry) === selectedPluginVersion)
    ) {
      return;
    }
    const preferred =
      pluginVersionOptions.find((entry: any) => isStableRelease(entry)) ?? pluginVersionOptions[0];
    const preferredId = normalizeVersionId(preferred);
    if (preferredId && preferredId !== selectedPluginVersion) {
      setSelectedPluginVersion(preferredId);
    }
  }, [pluginVersionOptions, selectedPlugin, selectedPluginVersion]);

  const normalizeEntry = (key: string, value: ConfigNode): ConfigEntry => {
    if (isConfigMap(value)) {
      const children = Object.entries(value).map(([childKey, childValue]) =>
        normalizeEntry(childKey, childValue),
      );
      return { key, value: '', type: 'object', children };
    }
    if (value === null) {
      return { key, value: '', type: 'null' };
    }
    if (typeof value === 'boolean') {
      return { key, value: value ? 'true' : 'false', type: 'boolean' };
    }
    if (typeof value === 'number') {
      return { key, value: String(value), type: 'number' };
    }
    return { key, value: String(value), type: 'string' };
  };

  const isConfigMap = (value: ConfigNode): value is ConfigMap =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  const toSections = (record: ConfigMap): ConfigSection[] => {
    const rootEntries: ConfigEntry[] = [];
    const sections: ConfigSection[] = [];
    Object.entries(record).forEach(([key, value]) => {
      if (isConfigMap(value)) {
        const nestedEntries = Object.entries(value).map(([childKey, childValue]) =>
          normalizeEntry(childKey, childValue),
        );
        sections.push({ title: key, entries: nestedEntries, collapsed: true });
      } else {
        rootEntries.push(normalizeEntry(key, value));
      }
    });
    if (rootEntries.length || sections.length === 0) {
      sections.unshift({ title: 'General', entries: rootEntries, collapsed: false });
    }
    return sections;
  };

  const buildConfigRecord = (sections: ConfigSection[]): ConfigMap => {
    const record: ConfigMap = {};
    const inferType = (raw: string): ConfigEntry['type'] => {
      const trimmed = raw.trim();
      if (trimmed === '') return 'string';
      if (trimmed === 'true' || trimmed === 'false') return 'boolean';
      if (trimmed === 'null') return 'null';
      if (!Number.isNaN(Number(trimmed))) return 'number';
      return 'string';
    };
    const normalizeValue = (entry: ConfigEntry): ConfigNode => {
      const resolvedType = entry.type === 'string' ? inferType(entry.value) : entry.type;
      switch (resolvedType) {
        case 'number':
          return entry.value === '' ? 0 : Number(entry.value);
        case 'boolean':
          return entry.value === 'true';
        case 'null':
          return null;
        case 'object': {
          const output: ConfigMap = {};
          (entry.children ?? []).forEach((child) => {
            if (!child.key.trim()) return;
            output[child.key] = normalizeValue(child);
          });
          return output;
        }
        default:
          return entry.value;
      }
    };

    sections.forEach((section) => {
      const target =
        section.title === 'General' ? record : ((record[section.title] ||= {}) as ConfigMap);
      section.entries.forEach((entry) => {
        if (!entry.key.trim()) return;
        target[entry.key] = normalizeValue(entry);
      });
    });
    return record;
  };

  const loadConfigFile = useCallback(
    async (pathValue: string): Promise<ConfigFileState> => {
      const format = detectConfigFormat(pathValue);
      if (!format) {
        return {
          path: pathValue,
          sections: [],
          format: null,
          error: 'Unsupported config format.',
          loaded: true,
          viewMode: 'form',
          rawContent: '',
        } as ConfigFileState;
      }
      try {
        const content = await filesApi.readText(serverId ?? '', pathValue);
        const parsed = parseConfig(format, content);
        const sections = toSections(parsed);
        return {
          path: pathValue,
          sections,
          format,
          error: null,
          loaded: true,
          viewMode: 'form',
          rawContent: content,
        };
      } catch (error: unknown) {
        return {
          path: pathValue,
          sections: [],
          format,
          error: getErrorMessage(error, 'Failed to load config file'),
          loaded: true,
          viewMode: 'form',
          rawContent: '',
        };
      }
    },
    [serverId],
  );

  const filteredConfigFiles = useMemo(() => {
    const query = configSearch.trim().toLowerCase();
    if (!query) {
      return configFiles;
    }
    const matchesEntry = (entry: ConfigEntry) => {
      if (entry.key.toLowerCase().includes(query)) return true;
      if (entry.value.toLowerCase().includes(query)) return true;
      return (entry.children ?? []).some(matchesEntry);
    };
    return configFiles
      .map((file) => {
        if (file.viewMode === 'raw') {
          return file.rawContent.toLowerCase().includes(query) ? file : null;
        }
        const sections = file.sections
          .map((section) => {
            const entries = section.entries.filter(matchesEntry);
            if (!entries.length) return null;
            return { ...section, entries, collapsed: false };
          })
          .filter(Boolean) as ConfigSection[];
        return sections.length ? { ...file, sections } : null;
      })
      .filter(Boolean) as ConfigFileState[];
  }, [configFiles, configSearch]);

  const fileIndexByPath = useMemo(() => {
    const mapping = new Map<string, number>();
    configFiles.forEach((file, index) => {
      mapping.set(file.path, index);
    });
    return mapping;
  }, [configFiles]);

  const renderValueInput = (
    entry: ConfigEntry,
    onValueChange: (value: string) => void,
    className = 'w-full',
  ) => {
    if (entry.type === 'boolean') {
      const checked = entry.value === 'true';
      return (
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={checked}
            onChange={(event) => onValueChange(event.target.checked ? 'true' : 'false')}
          />
          <div className="h-5 w-10 rounded-full bg-surface-3 transition peer-checked:bg-primary-500 dark:bg-surface-2">
            <div className="h-4 w-4 translate-x-0.5 translate-y-0.5 rounded-full bg-card shadow transition peer-checked:translate-x-5" />
          </div>
        </label>
      );
    }

    return (
      <input
        type={entry.type === 'number' ? 'number' : 'text'}
        className={`${className} rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400`}
        value={entry.value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Value"
      />
    );
  };

  const updateConfigEntry = useCallback(
    (
      fileIndex: number,
      sectionIndex: number,
      entryIndex: number,
      patch: Partial<ConfigEntry>,
      childIndex?: number,
    ) => {
      setConfigFiles((current) =>
        current.map((file, idx) => {
          if (idx !== fileIndex) return file;
          return {
            ...file,
            sections: file.sections.map((section, secIdx) => {
              if (secIdx !== sectionIndex) return section;
              return {
                ...section,
                entries: section.entries.map((entry, entryIdx) => {
                  if (entryIdx !== entryIndex) return entry;
                  if (typeof childIndex === 'number' && entry.children) {
                    return {
                      ...entry,
                      children: entry.children.map((child, childIdx) =>
                        childIdx === childIndex ? { ...child, ...patch } : child,
                      ),
                    };
                  }
                  return { ...entry, ...patch };
                }),
              };
            }),
          };
        }),
      );
    },
    [],
  );

  const addConfigEntry = useCallback(
    (fileIndex: number, sectionIndex: number, parentIndex?: number) => {
      setConfigFiles((current) =>
        current.map((file, idx) =>
          idx === fileIndex
            ? {
                ...file,
                sections: file.sections.map((section, secIdx) => {
                  if (secIdx !== sectionIndex) return section;
                  if (typeof parentIndex === 'number') {
                    return {
                      ...section,
                      entries: section.entries.map((entry, entryIdx) =>
                        entryIdx === parentIndex
                          ? {
                              ...entry,
                              children: [
                                ...(entry.children ?? []),
                                { key: '', value: '', type: 'string' },
                              ],
                            }
                          : entry,
                      ),
                    };
                  }
                  return {
                    ...section,
                    entries: [...section.entries, { key: '', value: '', type: 'string' }],
                  };
                }),
              }
            : file,
        ),
      );
    },
    [],
  );

  const removeConfigEntry = useCallback(
    (fileIndex: number, sectionIndex: number, entryIndex: number, childIndex?: number) => {
      setConfigFiles((current) =>
        current.map((file, idx) =>
          idx === fileIndex
            ? {
                ...file,
                sections: file.sections.map((section, secIdx) => {
                  if (secIdx !== sectionIndex) return section;
                  if (typeof childIndex === 'number') {
                    return {
                      ...section,
                      entries: section.entries.map((entry, entryIdx) =>
                        entryIdx === entryIndex
                          ? {
                              ...entry,
                              children: (entry.children ?? []).filter(
                                (_, childIdx) => childIdx !== childIndex,
                              ),
                            }
                          : entry,
                      ),
                    };
                  }
                  return {
                    ...section,
                    entries: section.entries.filter((_, entryIdx) => entryIdx !== entryIndex),
                  };
                }),
              }
            : file,
        ),
      );
    },
    [],
  );

  const handleReinstall = useCallback(async () => {
    if (!serverId) return;
    try {
      await serversApi.install(serverId);
      notifySuccess('Reinstall started');
    } catch (error: unknown) {
      notifyError(getErrorMessage(error, 'Failed to reinstall server'));
    }
  }, [serverId]);

  useEffect(() => {
    if (!serverId || !server || !server.template) {
      setConfigFiles([]);
      return;
    }
    const configTemplatePath = server.template?.features?.configFile;
    const configTemplatePaths = server.template?.features?.configFiles ?? [];
    const combinedConfigPaths = [
      ...(configTemplatePath ? [configTemplatePath] : []),
      ...configTemplatePaths,
    ];

    if (combinedConfigPaths.length === 0) {
      setConfigFiles([]);
      return;
    }
    const uniquePaths = Array.from(new Set(combinedConfigPaths));
    setConfigFiles(
      uniquePaths.map((path) => ({
        path,
        sections: [],
        format: null,
        error: null,
        loaded: false,
        viewMode: 'form' as const,
        rawContent: '',
      })),
    );
    setOpenConfigIndex(-1);
    Promise.all(uniquePaths.map((path) => loadConfigFile(path))).then((results) => {
      setConfigFiles(results);
    });
  }, [
    serverId,
    server?.template?.features?.configFile,
    server?.template?.features?.configFiles?.join('|'),
    loadConfigFile,
  ]);

  useEffect(() => {
    loadAllocations();
  }, [loadAllocations]);

  if (isLoading) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-primary-500/8 to-primary-300/8 blur-3xl dark:from-primary-500/15 dark:to-primary-300/15" />
          <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-primary-400/8 to-primary-200/8 blur-3xl dark:from-primary-400/15 dark:to-primary-200/15" />
        </div>
        <div className="relative z-10 flex items-center justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (isError || !server) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-primary-500/8 to-primary-300/8 blur-3xl dark:from-primary-500/15 dark:to-primary-300/15" />
        </div>
        <div className="relative z-10 flex items-center justify-center p-8">
          <div className="rounded-xl border border-danger/30 bg-danger-muted px-6 py-4 text-sm text-danger">
            Unable to load server details.
          </div>
        </div>
      </div>
    );
  }

  const nodeLabel = server.node?.name ?? server.nodeName ?? server.nodeId;
  // For all network modes, prefer the assigned IP (from allocation or IPAM)
  // Fall back to node's public address only if no specific IP is assigned
  const nodeIp = server.connection?.host ?? server.primaryIp ?? server.node?.publicAddress ?? server.node?.hostname ?? 'n/a';
  const nodePort = server.primaryPort ?? 'n/a';
  const diskLimitMb = server.allocatedDiskMb ?? 0;
  const liveDiskUsageMb = liveMetrics?.diskUsageMb;
  const liveDiskTotalMb = liveMetrics?.diskTotalMb;
  const liveDiskIoMb = liveMetrics?.diskIoMb;
  const diskPercent =
    liveDiskUsageMb != null && (liveDiskTotalMb || diskLimitMb)
      ? Math.min(100, (liveDiskUsageMb / (liveDiskTotalMb || diskLimitMb)) * 100)
      : null;
  const configTemplatePath = server.template?.features?.configFile;
  const configTemplatePaths = server.template?.features?.configFiles ?? [];
  const combinedConfigPaths = [
    ...(configTemplatePath ? [configTemplatePath] : []),
    ...configTemplatePaths,
  ];

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-primary-500/8 to-primary-300/8 blur-3xl dark:from-primary-500/15 dark:to-primary-300/15" />\n        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-primary-400/8 to-primary-200/8 blur-3xl dark:from-primary-400/15 dark:to-primary-200/15" />\n      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="overflow-hidden rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-primary-500 to-primary-400 opacity-20 blur-sm" />\n                  <Terminal className="relative h-7 w-7 text-primary" />
                </div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
                  {server.name}
                </h1>
                <ServerStatusBadge status={server.status} />
              </div>
              <p className="ml-10 text-sm text-muted-foreground">
                Node: {nodeLabel} (IP: {nodeIp}, Port: {nodePort})
              </p>
            </div>
            <ServerControls serverId={server.id} status={server.status} permissions={server.effectivePermissions} />
          </div>
          {isSuspended ? (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger-muted px-4 py-3 text-xs text-danger">
              <div className="font-semibold">Server suspended</div>
              <div className="text-danger">
                {server?.suspensionReason
                  ? `Reason: ${server.suspensionReason}`
                  : 'No reason provided.'}
              </div>
            </div>
          ) : null}
        </motion.div>

      {/* ── Tab navigation ── */}
      <motion.div variants={itemVariants} className="flex flex-wrap gap-1.5 rounded-xl border border-border/50 bg-surface-2/40 p-1.5 backdrop-blur-sm">
        {Object.entries(tabLabels)
          .filter(([key]) => {
            if (key === 'admin') return canAdminWrite || hasServerPerm('server.delete');
            if (key === 'console') return hasServerPerm('console.read');
            if (key === 'files') return hasServerPerm('file.read');
            if (key === 'backups') return hasServerPerm('backup.read');
            if (key === 'databases') return hasServerPerm('database.read');
            if (key === 'schedules') return hasServerPerm('server.schedule');
            if (key === 'modManager') return Boolean(modManagerConfig);
            if (key === 'pluginManager') return Boolean(pluginManagerConfig);
            return true;
          })
          .map(([key, label]) => {
            const isActive = activeTab === key;
            const Icon = tabIcons[key as keyof typeof tabLabels];
            return (
              <button
                key={key}
                type="button"
                title={label}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all duration-200 ${
                  isActive
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-muted-foreground hover:bg-surface-2/70 hover:text-foreground'
                }`}
                onClick={() => navigate(`/servers/${server.id}/${key}`)}
              >
                <Icon className="h-4 w-4" />
                <span className="font-medium">{label}</span>
              </button>
            );
          })}
      </motion.div>

      {/* ── Tab Content ── */}
      <motion.div variants={itemVariants}>
        {activeTab === 'console' ? (
        <ServerConsoleTab
          liveMetrics={liveMetrics}
          liveDiskUsageMb={liveDiskUsageMb}
          liveDiskTotalMb={liveDiskTotalMb}
          isConnected={isConnected}
          canSend={!!canSend}
          entries={entries}
          send={send}
          clearConsole={clearConsole}
          isLoading={consoleLoading}
          isError={consoleError}
          refetch={refetchConsole}
        />
      ) : null}

      {activeTab === 'files' ? (
        <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
          <FileManager serverId={server.id} isSuspended={isSuspended} />
        </div>
      ) : null}

      {activeTab === 'sftp' ? (
        <div className="rounded-xl border border-border bg-card px-6 py-5 transition-all duration-300 hover:border-primary/30">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">SFTP Access</h2>
            <p className="text-xs text-muted-foreground">
              Connect to your server files via SFTP using the credentials below.
            </p>
          </div>
          <SftpConnectionInfo
            serverId={server.id}
            isOwner={server.ownerId === user?.id}
          />
        </div>
      ) : null}

      {activeTab === 'backups' ? (
        <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
          <BackupSection
            serverId={server.id}
            serverStatus={server.status}
            isSuspended={isSuspended}
          />
        </div>
      ) : null}

      {activeTab === 'tasks' ? (
        <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">
                Scheduled tasks
              </div>
              <div className="text-xs text-muted-foreground">
                Automate restarts, backups, and commands.
              </div>
            </div>
            <CreateTaskModal serverId={server.id} disabled={isSuspended} />
          </div>
          <div className="mt-4">
            {tasksLoading ? (
              <div className="text-sm text-muted-foreground">Loading tasks...</div>
            ) : tasks.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-surface-2 px-6 py-8 text-center text-sm text-muted-foreground/50">
                No tasks configured for this server yet.
              </div>
            ) : (
              <div className="space-y-3">
                {tasks.map((task) => (
                  <div
                    className="rounded-lg border border-border bg-surface-2 px-4 py-3 transition-all duration-300 hover:border-primary/30"
                    key={task.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-foreground">
                        {task.name}
                      </div>
                      <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {task.action}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {task.description || 'No description'}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Schedule: {task.schedule}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
                      <div className="rounded-md border border-border bg-card px-2 py-1">
                        <div className="text-muted-foreground">Next run</div>
                        <div className="text-foreground">
                          {formatDateTime(task.nextRunAt)}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-card px-2 py-1">
                        <div className="text-muted-foreground">Last run</div>
                        <div className="text-foreground">
                          {formatDateTime(task.lastRunAt)}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-card px-2 py-1">
                        <div className="text-muted-foreground">Status</div>
                        <div className="text-foreground">
                          {task.lastStatus ?? '—'}
                        </div>
                      </div>
                      <div className="rounded-md border border-border bg-card px-2 py-1">
                        <div className="text-muted-foreground">Runs</div>
                        <div className="text-foreground">
                          {task.runCount ?? 0}
                        </div>
                      </div>
                    </div>
                    {task.lastError ? (
                      <div className="mt-2 rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-[11px] text-danger">
                        {task.lastError}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <EditTaskModal serverId={server.id} task={task} disabled={isSuspended} />
                      <button
                        type="button"
                        className={`rounded-md border px-3 py-1 font-semibold transition-all duration-300 ${
                          task.enabled === false
                            ? 'border-success/30 text-success hover:border-success/50'
                            : 'border-warning/30 text-warning hover:border-warning/50'
                        }`}
                        onClick={() =>
                          pauseMutation.mutate(task as { id: string; enabled: boolean })
                        }
                        disabled={pauseMutation.isPending || isSuspended}
                      >
                        {task.enabled === false ? 'Resume' : 'Pause'}
                      </button>
                      <button
                        type="button"
                        className="rounded-md border border-danger/30 px-3 py-1 font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                        onClick={() => deleteMutation.mutate(task.id)}
                        disabled={deleteMutation.isPending || isSuspended}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activeTab === 'databases' ? (
        <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">
                Databases
              </div>
              <div className="text-xs text-muted-foreground">
                Create and manage per-server database credentials.
              </div>
              <div className="text-xs text-muted-foreground">
                Allocation:{' '}
                {databaseAllocation === 0 ? 'Disabled' : `${databaseAllocation} databases`}
              </div>
            </div>
            {canManageDatabases ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <select
                  className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                  value={databaseHostId}
                  onChange={(event) => setDatabaseHostId(event.target.value)}
                  disabled={isSuspended || databaseAllocation === 0}
                >
                  <option value="">Select host</option>
                  {databaseHosts.map((host) => (
                    <option key={host.id} value={host.id}>
                      {host.name} ({host.host}:{host.port})
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                  value={databaseName}
                  onChange={(event) => setDatabaseName(event.target.value)}
                  placeholder="database_name"
                  disabled={isSuspended || databaseAllocation === 0}
                />
                <button
                  type="button"
                  className="rounded-md bg-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => createDatabaseMutation.mutate()}
                  disabled={
                    !databaseHostId ||
                    createDatabaseMutation.isPending ||
                    isSuspended ||
                    databaseAllocation === 0 ||
                    databaseLimitReached
                  }
                >
                  Create
                </button>
                {databaseAllocation === 0 ? (
                  <span className="text-xs text-warning">
                    Database allocation disabled.
                  </span>
                ) : databaseLimitReached ? (
                  <span className="text-xs text-warning">
                    Allocation limit reached.
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No database permissions assigned.
              </div>
            )}
          </div>
          {databaseAllocation === 0 ? (
            <div className="mt-3 rounded-xl border border-warning/30 bg-warning-muted px-4 py-3 text-xs text-warning " >
              Provider database allocation is not available for this server. You cannot create a
              database until allocations are assigned.
            </div>
          ) : null}

          {databasesLoading ? (
            <div className="mt-4 text-sm text-muted-foreground">
              Loading databases...
            </div>
          ) : databasesError ? (
            <div className="mt-4 rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
              Unable to load databases.
            </div>
          ) : databases.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-2 px-6 py-8 text-center text-sm text-muted-foreground/50">
              No databases created yet.
            </div>
          ) : (
            <div className="mt-4 space-y-3 text-xs">
              {databases.map((database) => (
                <div
                  key={database.id}
                  className="rounded-lg border border-border bg-surface-2 px-4 py-3 transition-all duration-300 hover:border-primary/30"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {database.name}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Host: {database.hostName} ({database.host}:{database.port})
                      </div>
                    </div>
                    {canManageDatabases ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground disabled:opacity-60"
                          onClick={() => rotateDatabaseMutation.mutate(database.id)}
                          disabled={rotateDatabaseMutation.isPending || isSuspended}
                        >
                          Rotate password
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-danger/30 px-2 py-1 text-xs text-danger transition-all duration-300 hover:border-danger/50 disabled:opacity-60"
                          onClick={() => deleteDatabaseMutation.mutate(database.id)}
                          disabled={deleteDatabaseMutation.isPending || isSuspended}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <div className="rounded-md border border-border bg-card px-3 py-2">
                      <div className="text-muted-foreground">Database</div>
                      <div className="font-semibold text-foreground">
                        {database.name}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-card px-3 py-2">
                      <div className="text-muted-foreground">Username</div>
                      <div className="font-semibold text-foreground">
                        {database.username}
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-card px-3 py-2">
                      <div className="text-muted-foreground">Password</div>
                      <div className="font-semibold text-foreground">
                        {database.password}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {activeTab === 'metrics' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ServerMetrics
              cpu={liveMetrics?.cpuPercent ?? server?.cpuPercent ?? 0}
              memory={liveMetrics?.memoryPercent ?? server?.memoryPercent ?? 0}
            />
            <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30 lg:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-foreground">
                  Live snapshot
                </div>
                <div
                  className={`flex items-center gap-2 text-xs ${
                    isConnected
                      ? 'text-success'
                      : 'text-muted-foreground'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${isConnected ? 'bg-success' : 'bg-muted-foreground'}`}
                  />
                  {isConnected ? 'Live' : 'Offline'}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                <div className="rounded-md border border-border bg-card px-3 py-2">
                  <div className="text-muted-foreground">Memory used</div>
                  <div className="text-sm font-semibold text-foreground">
                    {liveMetrics?.memoryUsageMb ? `${liveMetrics.memoryUsageMb} MB` : 'n/a'}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card px-3 py-2">
                  <div className="text-muted-foreground">Disk usage</div>
                  <div className="text-sm font-semibold text-foreground">
                    {liveDiskUsageMb != null && (liveDiskTotalMb || diskLimitMb)
                      ? `${liveDiskUsageMb} / ${liveDiskTotalMb || diskLimitMb} MB${
                          diskPercent != null ? ` (${diskPercent.toFixed(0)}%)` : ''
                        }`
                      : 'n/a'}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card px-3 py-2">
                  <div className="text-muted-foreground">Disk IO (last tick)</div>
                  <div className="text-sm font-semibold text-foreground">
                    {liveDiskIoMb != null ? `${liveDiskIoMb} MB` : 'n/a'}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card px-3 py-2">
                  <div className="text-muted-foreground">Network RX</div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatBytes(Number(metricsHistory?.latest?.networkRxBytes ?? 0))}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-card px-3 py-2">
                  <div className="text-muted-foreground">Network TX</div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatBytes(Number(metricsHistory?.latest?.networkTxBytes ?? 0))}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 transition-all duration-300 hover:border-primary/30">
            <div className="text-sm font-semibold text-foreground">
              Historical metrics
            </div>
            <MetricsTimeRangeSelector
              selectedRange={metricsTimeRange}
              onRangeChange={setMetricsTimeRange}
            />
          </div>
          <ServerMetricsTrends
            history={metricsHistory?.history ?? []}
            latest={metricsHistory?.latest ?? null}
            allocatedMemoryMb={server.allocatedMemoryMb ?? 0}
            timeRangeLabel={metricsTimeRange.label}
          />
        </div>
      ) : null}

      {activeTab === 'alerts' ? (
        <div className="space-y-4">
          <AlertsPage serverId={server.id} />
        </div>
      ) : null}

      {activeTab === 'modManager' ? (
        <div className="space-y-4">
          {!modManagerConfig ? (
            <div className="rounded-xl border border-border/50 bg-card/80 p-8 shadow-sm backdrop-blur-sm">
              <EmptyState
                title="Mod manager not available"
                description="This server template does not have a mod manager configured."
              />
            </div>
          ) : (
            <>
              {/* Sub-tab toggle + title */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Package className="h-5 w-5 text-primary-500" />
                  <h2 className="text-base font-semibold text-foreground">Mod Manager</h2>
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
                    onClick={() => { setModSubTab('installed'); refetchInstalledMods(); }}
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
                  <div className="rounded-xl border border-border/50 bg-card/80 p-4 shadow-sm backdrop-blur-sm">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Provider</label>
                        <select
                          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                          value={selectedModProvider?.key ?? ''}
                          onChange={(event) => setModProviderKey(event.target.value)}
                        >
                          {modProviderOptions.map((providerEntry) => (
                            <option key={providerEntry.key} value={providerEntry.key}>{providerEntry.label}</option>
                          ))}
                        </select>
                      </div>
                      {supportsModLoaderFilter ? (
                        <div>
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Loader</label>
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
                          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Loader</label>
                          <div className="rounded-lg border border-dashed border-border bg-surface-2/50 px-3 py-2 text-sm text-muted-foreground dark:bg-surface-2/50">
                            N/A
                          </div>
                        </div>
                      )}
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Target</label>
                        <select
                          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                          value={modTarget}
                          onChange={(event) => setModTarget(event.target.value as typeof modTarget)}
                        >
                          {modTargetOptions.map((target) => (
                            <option key={target} value={target}>{titleCase(target)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Game Version</label>
                        <input
                          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                          value={modGameVersion}
                          onChange={(event) => setModGameVersion(event.target.value)}
                          placeholder={serverGameVersion || 'e.g. 1.20.1'}
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-3 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                          value={modQuery}
                          onChange={(event) => setModQuery(event.target.value)}
                          onKeyDown={(event) => { if (event.key === 'Enter') refetchModSearch(); }}
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
                  </div>

                  {/* Results */}
                  {modSearchLoading ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="animate-pulse rounded-xl border border-border bg-card p-4">
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
                      Unable to load search results. Check your provider API keys in admin settings.
                    </div>
                  ) : modResults.length === 0 ? (
                    <div className="rounded-xl border border-border/50 bg-card/80 p-8 shadow-sm backdrop-blur-sm">
                      <EmptyState
                        title="No results"
                        description={modQuery.trim() ? 'Try a different search term or adjust your filters.' : 'Search for a mod to get started.'}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {modResults.map((entry: any) => {
                        const id = entry.project_id || entry.id || entry.modId || entry.slug || entry.name;
                        const title = entry.title || entry.name || entry.slug || 'Untitled';
                        const summary = entry.description || entry.summary || entry.excerpt || '';
                        const isActive = selectedProject === String(id);
                        const imageUrl = modProvider === 'modrinth' ? entry.icon_url : entry.logo?.thumbnailUrl || entry.logo?.url;
                        const downloads = entry.downloads ?? entry.downloadCount ?? 0;
                        const providerLabel = selectedModProvider?.label || displayProviderName(modProvider || 'provider');
                        let externalUrl = '';
                        if (modProvider === 'modrinth') {
                          const slug = entry.slug || entry.project_id || entry.id;
                          const projectType = entry.project_type || 'project';
                          externalUrl = slug ? `https://modrinth.com/${projectType}/${slug}` : '';
                        } else {
                          externalUrl = entry.links?.websiteUrl || '';
                          if (!externalUrl) {
                            const slug = entry.slug || entry.id;
                            const gamePath = modProviderGame || 'minecraft';
                            const classPath = gamePath === 'hytale' ? 'mods' : modTarget === 'modpacks' ? 'modpacks' : modTarget === 'datapacks' ? 'data-packs' : 'mc-mods';
                            externalUrl = slug ? `https://www.curseforge.com/${gamePath}/${classPath}/${slug}` : '';
                          }
                        }
                        return (
                          <div
                            key={String(id)}
                            className={`group relative cursor-pointer rounded-xl border p-4 transition-all duration-200 ${isActive ? 'border-primary bg-primary-muted ring-1 ring-primary/20' : 'border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/30 hover:shadow-md'}`}
                            onClick={() => { setSelectedProject(String(id)); setSelectedProjectName(title); }}
                          >
                            <div className="flex gap-3">
                              {imageUrl ? (
                                <img src={imageUrl} alt="" loading="lazy" className="h-12 w-12 rounded-lg object-cover" />
                              ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-2 dark:bg-surface-2">
                                  <Package className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-sm font-semibold text-foreground">{title}</span>
                                  {externalUrl && (
                                    <a
                                      href={externalUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(event) => event.stopPropagation()}
                                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                      title={`View on ${providerLabel}`}
                                    >
                                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary-500" />
                                    </a>
                                  )}
                                </div>
                                {summary && (
                                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{summary}</p>
                                )}
                                {downloads > 0 && (
                                  <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Download className="h-3 w-3" />
                                    {downloads >= 1000000 ? `${(downloads / 1000000).toFixed(1)}M` : downloads >= 1000 ? `${(downloads / 1000).toFixed(1)}K` : downloads}
                                  </div>
                                )}
                              </div>
                            </div>
                            {isActive && (
                              <div className="mt-3 border-t border-border pt-3">
                                <div className="flex items-end gap-2">
                                  <div className="flex-1">
                                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Version</label>
                                    <select
                                      className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none"
                                      value={selectedVersion}
                                      onChange={(event) => setSelectedVersion(event.target.value)}
                                      disabled={modVersionsLoading}
                                    >
                                      <option value="">{modVersionsLoading ? 'Loading…' : 'Select version'}</option>
                                      {modVersionOptions.map((version: any) => {
                                        const vid = normalizeVersionId(version);
                                        const vlabel = normalizeVersionLabel(version);
                                        if (!vid) return null;
                                        return <option key={vid} value={String(vid)}>{vlabel}</option>;
                                      })}
                                    </select>
                                  </div>
                                  <button
                                    type="button"
                                    className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50"
                                    onClick={() => installModMutation.mutate()}
                                    disabled={!selectedVersion || installModMutation.isPending}
                                  >
                                    {installModMutation.isPending ? 'Installing…' : 'Install'}
                                  </button>
                                </div>
                                {modVersionsError && (
                                  <p className="mt-2 text-xs text-danger">Failed to load versions.</p>
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
                /* Installed mods */
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  {/* Toolbar */}
                  <div className="space-y-3 border-b border-border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <select
                          className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground transition-colors focus:border-primary-500 focus:outline-none"
                          value={modTarget}
                          onChange={(event) => setModTarget(event.target.value as typeof modTarget)}
                        >
                          {modTargetOptions.map((target) => (
                            <option key={target} value={target}>{titleCase(target)}</option>
                          ))}
                        </select>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {filteredInstalledMods.length}{filteredInstalledMods.length !== installedMods.length ? ` / ${installedMods.length}` : ''} file{installedMods.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {installedMods.some((m) => m.hasUpdate) && (
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded-lg bg-warning-muted px-2.5 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning-muted dark:bg-warning/10 dark:text-warning dark:hover:bg-warning/20"
                            disabled={isUpdatingMods}
                            onClick={() => {
                              const modsToUpdate = selectedModFiles.size > 0
                                ? installedMods.filter((m) => m.hasUpdate && selectedModFiles.has(m.name))
                                : installedMods.filter((m) => m.hasUpdate);
                              if (!modsToUpdate.length) return;
                              setUpdateConfirmMods(modsToUpdate.map((m) => ({
                                name: m.name,
                                currentVersion: m.versionId || 'unknown',
                                latestVersion: m.latestVersionName || m.latestVersionId || 'latest',
                              })));
                            }}
                          >
                            <ArrowUpCircle className="h-3 w-3" />
                            Update {selectedModFiles.size > 0 ? 'Selected' : 'All'} ({(selectedModFiles.size > 0 ? installedMods.filter((m) => m.hasUpdate && selectedModFiles.has(m.name)) : installedMods.filter((m) => m.hasUpdate)).length})
                          </button>
                        )}
                        {selectedModFiles.size > 0 && (
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded-lg bg-danger-muted px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-muted dark:bg-danger/10 dark:text-danger dark:hover:bg-danger/20"
                            onClick={() => {
                              if (!confirm(`Remove ${selectedModFiles.size} selected mod${selectedModFiles.size !== 1 ? 's' : ''}?`)) return;
                              selectedModFiles.forEach((name) => uninstallModMutation.mutate(name));
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
                          onClick={async () => {
                            if (!server?.id) return;
                            setIsCheckingModUpdates(true);
                            try {
                              const result = await modManagerApi.checkUpdates(server.id);
                              refetchInstalledMods();
                              if (result.updatesAvailable > 0) {
                                notifySuccess(`${result.updatesAvailable} update${result.updatesAvailable !== 1 ? 's' : ''} available`);
                              } else {
                                notifySuccess('All mods are up to date');
                              }
                            } catch {
                              notifyError('Failed to check for updates');
                            } finally {
                              setIsCheckingModUpdates(false);
                            }
                          }}
                        >
                          {isCheckingModUpdates ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {isCheckingModUpdates ? 'Checking…' : 'Check Updates'}
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
                          onChange={(e) => setModInstalledSearch(e.target.value)}
                        />
                      </div>
                      <select
                        className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground focus:border-primary-500 focus:outline-none"
                        value={modInstalledFilter}
                        onChange={(e) => setModInstalledFilter(e.target.value as typeof modInstalledFilter)}
                      >
                        <option value="all">All</option>
                        <option value="updates">Has Updates</option>
                        <option value="tracked">Tracked</option>
                        <option value="untracked">Untracked</option>
                      </select>
                      <select
                        className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground focus:border-primary-500 focus:outline-none"
                        value={modInstalledSort}
                        onChange={(e) => setModInstalledSort(e.target.value as typeof modInstalledSort)}
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
                          if (selectedModFiles.size === filteredInstalledMods.length) {
                            setSelectedModFiles(new Set());
                          } else {
                            setSelectedModFiles(new Set(filteredInstalledMods.map((m) => m.name)));
                          }
                        }}
                      >
                        {selectedModFiles.size === filteredInstalledMods.length && filteredInstalledMods.length > 0 ? (
                          <CheckSquare className="h-3.5 w-3.5 text-primary-500" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                        {selectedModFiles.size > 0 ? `${selectedModFiles.size} selected` : 'Select all'}
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
                        title={modInstalledSearch || modInstalledFilter !== 'all' ? 'No matching mods' : `No ${modTarget} installed`}
                        description={modInstalledSearch || modInstalledFilter !== 'all' ? 'Try adjusting your search or filter.' : 'Install mods from the Browse tab to see them here.'}
                      />
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-200 ">
                      {filteredInstalledMods.map((mod) => {
                        const isSelected = selectedModFiles.has(mod.name);
                        return (
                          <div
                            key={mod.name}
                            className={`group flex items-center gap-3 px-4 py-3 transition-colors ${isSelected ? 'bg-primary-50/40 dark:bg-primary-500/5' : 'hover:bg-surface-2 dark:hover:bg-surface-2/40'}`}
                          >
                            {/* Checkbox */}
                            <button
                              type="button"
                              className="shrink-0"
                              onClick={() => {
                                const next = new Set(selectedModFiles);
                                if (isSelected) next.delete(mod.name); else next.add(mod.name);
                                setSelectedModFiles(next);
                              }}
                            >
                              {isSelected ? (
                                <CheckSquare className="h-4 w-4 text-primary-500" />
                              ) : (
                                <Square className="h-4 w-4 text-foreground transition-colors group-hover:text-muted-foreground" />
                              )}
                            </button>

                            {/* Icon */}
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${mod.hasUpdate ? 'bg-warning-muted' : 'bg-surface-2'}`}>
                              <Package className={`h-4 w-4 ${mod.hasUpdate ? 'text-warning' : 'text-muted-foreground'}`} />
                            </div>

                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-foreground">{mod.projectName || mod.name}</span>
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
                                <span className="font-mono">{formatBytes(mod.size)}</span>
                                {mod.modifiedAt && <span>{new Date(mod.modifiedAt).toLocaleDateString()}</span>}
                                {mod.versionId && <span title={mod.versionId}>v{mod.versionId.length > 12 ? mod.versionId.slice(0, 8) + '…' : mod.versionId}</span>}
                                {mod.hasUpdate && mod.latestVersionName && (
                                  <span className="font-medium text-warning">→ {mod.latestVersionName}</span>
                                )}
                                {!mod.provider && <span className="italic text-foreground">untracked</span>}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              {mod.hasUpdate && (
                                <button
                                  type="button"
                                  className="rounded-lg p-1.5 text-warning transition-colors hover:bg-warning-muted"
                                  title="Update to latest version"
                                  disabled={isUpdatingMods}
                                  onClick={() => setUpdateConfirmMods([{
                                    name: mod.name,
                                    currentVersion: mod.versionId || 'unknown',
                                    latestVersion: mod.latestVersionName || mod.latestVersionId || 'latest',
                                  }])}
                                >
                                  <ArrowUpCircle className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-danger-muted hover:text-danger"
                                title="Remove"
                                onClick={() => { if (confirm(`Remove ${mod.projectName || mod.name}?`)) uninstallModMutation.mutate(mod.name); }}
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
            </>
          )}
        </div>
      ) : null}

      {activeTab === 'pluginManager' ? (
        <div className="space-y-4">
          {!pluginManagerConfig ? (
            <div className="rounded-xl border border-border/50 bg-card/80 p-8 shadow-sm backdrop-blur-sm">
              <EmptyState
                title="Plugin manager not available"
                description="This server template does not have a plugin manager configured."
              />
            </div>
          ) : (
            <>
              {/* Sub-tab toggle + title */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Puzzle className="h-5 w-5 text-primary-500" />
                  <h2 className="text-base font-semibold text-foreground">Plugin Manager</h2>
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
                    onClick={() => { setPluginSubTab('installed'); refetchInstalledPlugins(); }}
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
                  <div className="rounded-xl border border-border/50 bg-card/80 p-4 shadow-sm backdrop-blur-sm">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Provider</label>
                        <select
                          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                          value={pluginProvider}
                          onChange={(event) => setPluginProvider(event.target.value)}
                        >
                          {pluginManagerProviders.map((provider) => (
                            <option key={provider} value={provider}>
                              {provider === 'spiget' ? 'Spigot' : titleCase(provider)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Game Version</label>
                        <input
                          className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                          value={pluginGameVersion}
                          onChange={(event) => setPluginGameVersion(event.target.value)}
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
                          onKeyDown={(event) => { if (event.key === 'Enter') refetchPluginSearch(); }}
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
                  </div>

                  {/* Results */}
                  {pluginSearchLoading ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {Array.from({ length: 6 }).map((_, index) => (
                        <div key={index} className="animate-pulse rounded-xl border border-border bg-card p-4">
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
                      Unable to load search results. Check your provider API keys in admin settings.
                    </div>
                  ) : pluginResults.length === 0 ? (
                    <div className="rounded-xl border border-border/50 bg-card/80 p-8 shadow-sm backdrop-blur-sm">
                      <EmptyState
                        title="No results"
                        description={pluginQuery.trim() ? 'Try a different search term or adjust your filters.' : 'Search for a plugin to get started.'}
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {pluginResults.map((entry: any) => {
                        const hangarOwner = entry.owner?.name || entry.owner?.username || entry.namespace?.owner;
                        const hangarSlug = entry.slug || entry.namespace?.slug;
                        const hangarProjectId = hangarOwner && hangarSlug ? `${hangarOwner}/${hangarSlug}` : entry.slug || entry.id;
                        const id = pluginProvider === 'paper'
                          ? encodeURIComponent(hangarProjectId ?? '')
                          : entry.project_id || entry.id || entry.resourceId || entry.slug || entry.name;
                        const title = entry.name || entry.title || entry.tag || entry.slug || 'Untitled';
                        const summary = entry.description || entry.summary || entry.tag || '';
                        const isActive = selectedPlugin === String(id);
                        const imageUrl = pluginProvider === 'modrinth'
                          ? entry.icon_url
                          : pluginProvider === 'paper'
                            ? entry.avatarUrl
                            : entry.icon?.url || entry.icon?.data;
                        const fallbackLabel = title.split(/\s+/).filter(Boolean).slice(0, 2).map((segment: string) => segment[0]?.toUpperCase() ?? '').join('');
                        const downloads = entry.downloads ?? entry.stats?.downloads ?? 0;
                        const providerLabel = pluginProvider === 'modrinth' ? 'Modrinth' : pluginProvider === 'paper' ? 'Paper' : 'Spigot';
                        let externalUrl = '';
                        if (pluginProvider === 'modrinth') {
                          const slug = entry.slug || entry.project_id || entry.id;
                          externalUrl = slug ? `https://modrinth.com/plugin/${slug}` : '';
                        } else if (pluginProvider === 'paper') {
                          externalUrl = hangarProjectId ? `https://hangar.papermc.io/${hangarProjectId}` : '';
                        } else {
                          externalUrl = id ? `https://www.spigotmc.org/resources/${id}/` : '';
                        }
                        return (
                          <div
                            key={String(id)}
                            className={`group relative cursor-pointer rounded-xl border p-4 transition-all duration-200 ${isActive ? 'border-primary bg-primary-muted ring-1 ring-primary/20' : 'border-border/50 bg-card/80 backdrop-blur-sm hover:border-primary/30 hover:shadow-md'}`}
                            onClick={() => { setSelectedPlugin(String(id)); setSelectedPluginName(title); }}
                          >
                            <div className="flex gap-3">
                              {imageUrl ? (
                                <img src={imageUrl} alt="" loading="lazy" className="h-12 w-12 rounded-lg object-cover" />
                              ) : (
                                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-surface-2 text-xs font-bold text-muted-foreground dark:bg-surface-2">
                                  {fallbackLabel || 'PL'}
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <span className="text-sm font-semibold text-foreground">{title}</span>
                                  {externalUrl && (
                                    <a
                                      href={externalUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(event) => event.stopPropagation()}
                                      className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                                      title={`View on ${providerLabel}`}
                                    >
                                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-primary-500" />
                                    </a>
                                  )}
                                </div>
                                {summary && (
                                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{summary}</p>
                                )}
                                {downloads > 0 && (
                                  <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                                    <Download className="h-3 w-3" />
                                    {downloads >= 1000000 ? `${(downloads / 1000000).toFixed(1)}M` : downloads >= 1000 ? `${(downloads / 1000).toFixed(1)}K` : downloads}
                                  </div>
                                )}
                              </div>
                            </div>
                            {isActive && (
                              <div className="mt-3 border-t border-border pt-3">
                                <div className="flex items-end gap-2">
                                  <div className="flex-1">
                                    <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Version</label>
                                    <select
                                      className="w-full rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none"
                                      value={selectedPluginVersion}
                                      onChange={(event) => setSelectedPluginVersion(event.target.value)}
                                      disabled={pluginVersionsLoading}
                                    >
                                      <option value="">{pluginVersionsLoading ? 'Loading…' : 'Select version'}</option>
                                      {pluginVersionOptions.map((version: any) => {
                                        const vid = normalizeVersionId(version);
                                        const vlabel = normalizeVersionLabel(version);
                                        if (!vid) return null;
                                        return <option key={vid} value={String(vid)}>{vlabel}</option>;
                                      })}
                                    </select>
                                  </div>
                                  <button
                                    type="button"
                                    className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50"
                                    onClick={() => installPluginMutation.mutate()}
                                    disabled={!selectedPluginVersion || installPluginMutation.isPending}
                                  >
                                    {installPluginMutation.isPending ? 'Installing…' : 'Install'}
                                  </button>
                                </div>
                                {pluginVersionsError && (
                                  <p className="mt-2 text-xs text-danger">Failed to load versions.</p>
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
                /* Installed plugins */
                <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                  {/* Toolbar */}
                  <div className="space-y-3 border-b border-border px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {filteredInstalledPlugins.length}{filteredInstalledPlugins.length !== installedPlugins.length ? ` / ${installedPlugins.length}` : ''} plugin{installedPlugins.length !== 1 ? 's' : ''}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {installedPlugins.some((p) => p.hasUpdate) && (
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded-lg bg-warning-muted px-2.5 py-1.5 text-xs font-medium text-warning transition-colors hover:bg-warning-muted dark:bg-warning/10 dark:text-warning dark:hover:bg-warning/20"
                            disabled={isUpdatingPlugins}
                            onClick={() => {
                              const pluginsToUpdate = selectedPluginFiles.size > 0
                                ? installedPlugins.filter((p) => p.hasUpdate && selectedPluginFiles.has(p.name))
                                : installedPlugins.filter((p) => p.hasUpdate);
                              if (!pluginsToUpdate.length) return;
                              setUpdateConfirmPlugins(pluginsToUpdate.map((p) => ({
                                name: p.name,
                                currentVersion: p.versionId || 'unknown',
                                latestVersion: p.latestVersionName || p.latestVersionId || 'latest',
                              })));
                            }}
                          >
                            <ArrowUpCircle className="h-3 w-3" />
                            Update {selectedPluginFiles.size > 0 ? 'Selected' : 'All'} ({(selectedPluginFiles.size > 0 ? installedPlugins.filter((p) => p.hasUpdate && selectedPluginFiles.has(p.name)) : installedPlugins.filter((p) => p.hasUpdate)).length})
                          </button>
                        )}
                        {selectedPluginFiles.size > 0 && (
                          <button
                            type="button"
                            className="flex items-center gap-1 rounded-lg bg-danger-muted px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-muted dark:bg-danger/10 dark:text-danger dark:hover:bg-danger/20"
                            onClick={() => {
                              if (!confirm(`Remove ${selectedPluginFiles.size} selected plugin${selectedPluginFiles.size !== 1 ? 's' : ''}?`)) return;
                              selectedPluginFiles.forEach((name) => uninstallPluginMutation.mutate(name));
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
                          onClick={async () => {
                            if (!server?.id) return;
                            setIsCheckingPluginUpdates(true);
                            try {
                              const result = await pluginManagerApi.checkUpdates(server.id);
                              refetchInstalledPlugins();
                              if (result.updatesAvailable > 0) {
                                notifySuccess(`${result.updatesAvailable} update${result.updatesAvailable !== 1 ? 's' : ''} available`);
                              } else {
                                notifySuccess('All plugins are up to date');
                              }
                            } catch {
                              notifyError('Failed to check for updates');
                            } finally {
                              setIsCheckingPluginUpdates(false);
                            }
                          }}
                        >
                          {isCheckingPluginUpdates ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {isCheckingPluginUpdates ? 'Checking…' : 'Check Updates'}
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
                          onChange={(e) => setPluginInstalledSearch(e.target.value)}
                        />
                      </div>
                      <select
                        className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground focus:border-primary-500 focus:outline-none"
                        value={pluginInstalledFilter}
                        onChange={(e) => setPluginInstalledFilter(e.target.value as typeof pluginInstalledFilter)}
                      >
                        <option value="all">All</option>
                        <option value="updates">Has Updates</option>
                        <option value="tracked">Tracked</option>
                        <option value="untracked">Untracked</option>
                      </select>
                      <select
                        className="rounded-lg border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-foreground focus:border-primary-500 focus:outline-none"
                        value={pluginInstalledSort}
                        onChange={(e) => setPluginInstalledSort(e.target.value as typeof pluginInstalledSort)}
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
                          if (selectedPluginFiles.size === filteredInstalledPlugins.length) {
                            setSelectedPluginFiles(new Set());
                          } else {
                            setSelectedPluginFiles(new Set(filteredInstalledPlugins.map((p) => p.name)));
                          }
                        }}
                      >
                        {selectedPluginFiles.size === filteredInstalledPlugins.length && filteredInstalledPlugins.length > 0 ? (
                          <CheckSquare className="h-3.5 w-3.5 text-primary-500" />
                        ) : (
                          <Square className="h-3.5 w-3.5" />
                        )}
                        {selectedPluginFiles.size > 0 ? `${selectedPluginFiles.size} selected` : 'Select all'}
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
                        title={pluginInstalledSearch || pluginInstalledFilter !== 'all' ? 'No matching plugins' : 'No plugins installed'}
                        description={pluginInstalledSearch || pluginInstalledFilter !== 'all' ? 'Try adjusting your search or filter.' : 'Install plugins from the Browse tab to see them here.'}
                      />
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-200 ">
                      {filteredInstalledPlugins.map((plugin) => {
                        const isSelected = selectedPluginFiles.has(plugin.name);
                        return (
                          <div
                            key={plugin.name}
                            className={`group flex items-center gap-3 px-4 py-3 transition-colors ${isSelected ? 'bg-primary-50/40 dark:bg-primary-500/5' : 'hover:bg-surface-2 dark:hover:bg-surface-2/40'}`}
                          >
                            {/* Checkbox */}
                            <button
                              type="button"
                              className="shrink-0"
                              onClick={() => {
                                const next = new Set(selectedPluginFiles);
                                if (isSelected) next.delete(plugin.name); else next.add(plugin.name);
                                setSelectedPluginFiles(next);
                              }}
                            >
                              {isSelected ? (
                                <CheckSquare className="h-4 w-4 text-primary-500" />
                              ) : (
                                <Square className="h-4 w-4 text-foreground transition-colors group-hover:text-muted-foreground" />
                              )}
                            </button>

                            {/* Icon */}
                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${plugin.hasUpdate ? 'bg-warning-muted' : 'bg-surface-2'}`}>
                              <Puzzle className={`h-4 w-4 ${plugin.hasUpdate ? 'text-warning' : 'text-muted-foreground'}`} />
                            </div>

                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium text-foreground">{plugin.projectName || plugin.name}</span>
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
                                <span className="font-mono">{formatBytes(plugin.size)}</span>
                                {plugin.modifiedAt && <span>{new Date(plugin.modifiedAt).toLocaleDateString()}</span>}
                                {plugin.versionId && <span title={plugin.versionId}>v{plugin.versionId.length > 12 ? plugin.versionId.slice(0, 8) + '…' : plugin.versionId}</span>}
                                {plugin.hasUpdate && plugin.latestVersionName && (
                                  <span className="font-medium text-warning">→ {plugin.latestVersionName}</span>
                                )}
                                {!plugin.provider && <span className="italic text-foreground">untracked</span>}
                              </div>
                            </div>

                            {/* Actions */}
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              {plugin.hasUpdate && (
                                <button
                                  type="button"
                                  className="rounded-lg p-1.5 text-warning transition-colors hover:bg-warning-muted"
                                  title="Update to latest version"
                                  disabled={isUpdatingPlugins}
                                  onClick={() => setUpdateConfirmPlugins([{
                                    name: plugin.name,
                                    currentVersion: plugin.versionId || 'unknown',
                                    latestVersion: plugin.latestVersionName || plugin.latestVersionId || 'latest',
                                  }])}
                                >
                                  <ArrowUpCircle className="h-4 w-4" />
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-danger-muted hover:text-danger"
                                title="Remove"
                                onClick={() => { if (confirm(`Remove ${plugin.projectName || plugin.name}?`)) uninstallPluginMutation.mutate(plugin.name); }}
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
            </>
          )}
        </div>
      ) : null}

      {activeTab === 'users' ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-foreground">
                  Invite user
                </div>
                <div className="text-xs text-muted-foreground">
                  Send an invite to grant access to this server.
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-3">
              <input
                className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="user@example.com"
              />
              <select
                className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                value={invitePreset}
                onChange={(event) =>
                  setInvitePreset(event.target.value as 'readOnly' | 'power' | 'full' | 'custom')
                }
              >
                <option value="readOnly">Read-only</option>
                <option value="power">Power user</option>
                <option value="full">Full access</option>
                <option value="custom">Custom</option>
              </select>
              <button
                type="button"
                className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => createInviteMutation.mutate()}
                disabled={!inviteEmail.trim() || createInviteMutation.isPending}
              >
                Send invite
              </button>
            </div>
            {invitePreset === 'custom' ? (
              <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                {permissionOptions.map((perm) => (
                  <label key={perm} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border bg-card text-primary-600"
                      checked={invitePermissions.includes(perm)}
                      onChange={(event) => {
                        setInvitePermissions((current) =>
                          event.target.checked
                            ? [...current, perm]
                            : current.filter((entry) => entry !== perm),
                        );
                      }}
                    />
                    {perm}
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-3 text-xs text-muted-foreground">
                {permissionsData?.presets?.[invitePreset]?.join(', ') || 'No preset loaded.'}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
            <div className="text-sm font-semibold text-foreground">
              Active access
            </div>
            <div className="mt-4 space-y-3 text-xs text-muted-foreground">
              {permissionsData?.data?.length ? (
                permissionsData.data.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border bg-surface-2 px-4 py-3 transition-all duration-300 hover:border-primary/30"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-foreground">
                          {entry.user.username}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {entry.user.email}
                        </div>
                      </div>
                      {entry.userId !== server.ownerId ? (
                        <button
                          type="button"
                          className="rounded-md border border-danger/30 px-2 py-1 text-[10px] font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                          onClick={() => removeAccessMutation.mutate(entry.userId)}
                          disabled={removeAccessMutation.isPending}
                        >
                          Remove
                        </button>
                      ) : (
                        <span className="rounded-full border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Owner
                        </span>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                      {permissionOptions.map((perm) => (
                        <label key={`${entry.id}-${perm}`} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-border bg-card text-primary-600"
                            checked={(
                              accessPermissions[entry.userId] ?? entry.permissions
                            ).includes(perm)}
                            onChange={(event) => {
                              if (entry.userId === server.ownerId) return;
                              setAccessPermissions((current) => {
                                const next = new Set(current[entry.userId] ?? entry.permissions);
                                if (event.target.checked) {
                                  next.add(perm);
                                } else {
                                  next.delete(perm);
                                }
                                return { ...current, [entry.userId]: Array.from(next) };
                              });
                            }}
                            disabled={entry.userId === server.ownerId}
                          />
                          {perm}
                        </label>
                      ))}
                    </div>
                    {entry.userId !== server.ownerId ? (
                      <div className="mt-3">
                        <button
                          type="button"
                          className="rounded-md bg-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                          onClick={() => saveAccessMutation.mutate(entry)}
                          disabled={saveAccessMutation.isPending}
                        >
                          Save permissions
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface-2 px-6 py-6 text-center text-xs text-muted-foreground/50">
                  No additional users yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
            <div className="text-sm font-semibold text-foreground">
              Pending invites
            </div>
            <div className="mt-4 space-y-2 text-xs text-muted-foreground">
              {invites.length ? (
                invites.map((invite) => (
                  <div
                    key={invite.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 transition-all duration-300 hover:border-primary/30"
                  >
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {invite.email}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Expires {new Date(invite.expiresAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-danger/30 px-2 py-1 text-[10px] font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                      onClick={() => cancelInviteMutation.mutate(invite.id)}
                      disabled={cancelInviteMutation.isPending}
                    >
                      Cancel
                    </button>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface-2 px-6 py-6 text-center text-xs text-muted-foreground/50">
                  No pending invites.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'configuration' ? (
        <div className="space-y-6">
          {/* ── Startup & Environment ── */}
          {isAdmin && (
            <section>
              <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="h-px flex-1 bg-surface-3 dark:bg-surface-2/60" />
                Startup
                <span className="h-px flex-1 bg-surface-3 dark:bg-surface-2/60" />
              </h3>
              <div className="rounded-xl border border-border/50 bg-card/80 p-5 shadow-sm backdrop-blur-sm hover:shadow-md">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Startup command</div>
                    <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
                      Executed when the server starts.{' '}
                      <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] dark:bg-surface-2">{'{{MEMORY}}'}</code>,{' '}
                      <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] dark:bg-surface-2">{'{{PORT}}'}</code>{' '}
                      and other variables are substituted from the environment below.
                    </p>
                  </div>
                  {server.startupCommand && (
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                      onClick={() => {
                        setStartupCommand(server.template?.startup ?? '');
                        serversApi.update(serverId!, { startupCommand: null }).then(() => {
                          notifySuccess('Reset to template default');
                          queryClient.invalidateQueries({ queryKey: ['server', serverId] });
                        }).catch(() => notifyError('Failed to reset startup command'));
                      }}
                      disabled={isSuspended}
                    >
                      Reset to default
                    </button>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                    value={startupCommand}
                    onChange={(event) => setStartupCommand(event.target.value)}
                    placeholder="e.g. java -Xms128M -Xmx{{MEMORY}}M -jar server.jar --port {{PORT}}"
                    disabled={isSuspended}
                  />
                  <button
                    type="button"
                    className="shrink-0 rounded-lg bg-primary-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50"
                    onClick={() => startupCommandMutation.mutate()}
                    disabled={
                      isSuspended ||
                      startupCommandMutation.isPending ||
                      !startupCommand.trim() ||
                      startupCommand.trim() === (server.startupCommand ?? server.template?.startup ?? '')
                    }
                  >
                    Save
                  </button>
                </div>
                {server.template?.startup && startupCommand.trim() !== server.template.startup && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Template default:{' '}
                    <button
                      type="button"
                      className="font-mono underline decoration-dotted hover:text-primary-500"
                      onClick={() => setStartupCommand(server.template?.startup ?? '')}
                    >
                      {server.template.startup}
                    </button>
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ── Server Overview & Environment ── */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-surface-3 dark:bg-surface-2/60" />
              Server
              <span className="h-px flex-1 bg-surface-3 dark:bg-surface-2/60" />
            </h3>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Server info */}
              <div className="rounded-xl border border-border/50 bg-card/80 p-5 shadow-sm backdrop-blur-sm hover:shadow-md">
                <div className="text-sm font-semibold text-foreground">Overview</div>
                <div className="mt-4 divide-y divide-border">
                  {[
                    ['Template', server.template?.name ?? server.templateId],
                    ['Image', server.environment?.TEMPLATE_IMAGE || server.template?.defaultImage || server.template?.image || 'n/a'],
                    ['Memory', `${server.allocatedMemoryMb} MB`],
                    ['CPU', `${server.allocatedCpuCores} core${server.allocatedCpuCores === 1 ? '' : 's'}`],
                    ['Port', server.primaryPort],
                    ['Network', server.networkMode],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-medium text-foreground">{String(value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Environment variables */}
              <div className="rounded-xl border border-border/50 bg-card/80 p-5 shadow-sm backdrop-blur-sm hover:shadow-md">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-foreground">Environment</div>
                  {isAdmin && (
                    <button
                      type="button"
                      className="rounded-md bg-surface-2 px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:bg-primary-50 hover:text-primary-600 dark:bg-surface-2 dark:hover:bg-primary-500/10 dark:hover:text-primary-400"
                      onClick={() => { setEnvVars((prev) => [...prev, { key: '', value: '' }]); setEnvDirty(true); }}
                      disabled={isSuspended}
                    >
                      + Add variable
                    </button>
                  )}
                </div>
                {isAdmin ? (
                  <div className="mt-4 space-y-2">
                    {envVars.length === 0 && (
                      <p className="py-4 text-center text-xs text-muted-foreground">No environment variables. Click "+ Add variable" to begin.</p>
                    )}
                    {envVars.map((row, idx) => (
                      <div key={idx} className="group flex items-center gap-2">
                        <input
                          className="w-[130px] shrink-0 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] uppercase text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                          value={row.key}
                          onChange={(e) => { const next = [...envVars]; next[idx] = { ...next[idx], key: e.target.value }; setEnvVars(next); setEnvDirty(true); }}
                          placeholder="KEY"
                          disabled={isSuspended}
                        />
                        <span className="text-[10px] text-foreground">=</span>
                        <input
                          className="min-w-0 flex-1 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                          value={row.value}
                          onChange={(e) => { const next = [...envVars]; next[idx] = { ...next[idx], value: e.target.value }; setEnvVars(next); setEnvDirty(true); }}
                          placeholder="value"
                          disabled={isSuspended}
                        />
                        <button
                          type="button"
                          className="shrink-0 rounded-md p-1 text-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-danger dark:hover:text-danger"
                          onClick={() => { setEnvVars((prev) => prev.filter((_, i) => i !== idx)); setEnvDirty(true); }}
                          disabled={isSuspended}
                          title="Remove"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    ))}
                    {envDirty && (
                      <div className="pt-2">
                        <button
                          type="button"
                          className="rounded-lg bg-primary-600 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-500 disabled:opacity-50"
                          onClick={() => envMutation.mutate()}
                          disabled={isSuspended || envMutation.isPending}
                        >
                          {envMutation.isPending ? 'Saving…' : 'Save environment'}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-4 divide-y divide-border">
                    {server.environment && Object.keys(server.environment).length > 0 ? (
                      Object.entries(server.environment).map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                          <span className="font-mono text-[11px] uppercase text-muted-foreground">{key}</span>
                          <span className="text-xs font-medium text-foreground">{String(value)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="py-4 text-center text-xs text-muted-foreground">No environment variables set.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── Config Files ── */}
          <section>
            <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span className="h-px flex-1 bg-surface-3 dark:bg-surface-2/60" />
              Config files
              <span className="h-px flex-1 bg-surface-3 dark:bg-surface-2/60" />
            </h3>
            <div className="rounded-xl border border-border/50 bg-card/80 p-5 shadow-sm backdrop-blur-sm hover:shadow-md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {combinedConfigPaths.length
                    ? combinedConfigPaths.join(', ')
                    : 'No config files defined in template.'}
                </p>
              </div>
              <div className="mt-3">
                <input
                  className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                  placeholder="Search config keys or values…"
                  value={configSearch}
                  onChange={(event) => setConfigSearch(event.target.value)}
                />
              </div>
              <div className="mt-4 space-y-3">
                {!combinedConfigPaths.length ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    Add <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] dark:bg-surface-2">features.configFiles</code> to the template to enable dynamic settings.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {filteredConfigFiles.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">No matches found.</p>
                    ) : (
                      filteredConfigFiles.map((configFile) => (
                        <div
                          className="overflow-hidden rounded-lg border border-border bg-surface-2/50 transition-colors dark:bg-surface-2/40"
                          key={configFile.path}
                        >
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-surface-2/80 dark:hover:bg-surface-2/80"
                            onClick={() => {
                              if (configSearch) return;
                              const fileIndex = fileIndexByPath.get(configFile.path) ?? -1;
                              setOpenConfigIndex((current) =>
                                current === fileIndex ? -1 : fileIndex,
                              );
                            }}
                          >
                            <span className="font-semibold text-foreground">{configFile.path}</span>
                            <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide transition-colors ${
                              configSearch || openConfigIndex === (fileIndexByPath.get(configFile.path) ?? -1)
                                ? 'bg-primary-muted text-primary'
                                : 'bg-surface-2 text-muted-foreground dark:bg-surface-2'
                            }`}>
                              {configSearch
                                ? 'Filtered'
                                : openConfigIndex === (fileIndexByPath.get(configFile.path) ?? -1)
                                  ? 'Collapse'
                                  : 'Expand'}
                            </span>
                          </button>
                          {configSearch ||
                          openConfigIndex === (fileIndexByPath.get(configFile.path) ?? -1) ? (
                            <div className="border-t border-border px-4 py-4">
                              {!configFile.loaded ? (
                                <p className="text-xs text-muted-foreground">Loading config values…</p>
                              ) : configFile.error ? (
                                <div className="rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
                                  {configFile.error}
                                </div>
                              ) : (
                                <div className="space-y-3 text-xs text-muted-foreground">
                                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-surface-2">
                                    <div className="flex items-center gap-2">
                                      <span className="font-semibold">View</span>
                                      {configSearch ? (
                                        <span className="rounded-full bg-primary-muted px-2 py-0.5 text-[10px] font-semibold text-primary">
                                          Filtered
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="flex items-center overflow-hidden rounded-full border border-border">
                                      <button
                                        type="button"
                                        className={`px-3 py-1 text-[10px] font-semibold tracking-wide transition-colors ${
                                          configFile.viewMode === 'form'
                                            ? 'bg-primary-600 text-white'
                                            : 'bg-card text-muted-foreground hover:text-foreground'
                                        }`}
                                        onClick={() =>
                                          setConfigFiles((current) =>
                                            current.map((file) =>
                                              file.path === configFile.path
                                                ? { ...file, viewMode: 'form' }
                                                : file,
                                            ),
                                          )
                                        }
                                      >
                                        Form
                                      </button>
                                      <button
                                        type="button"
                                        className={`px-3 py-1 text-[10px] font-semibold tracking-wide transition-colors ${
                                          configFile.viewMode === 'raw'
                                            ? 'bg-primary-600 text-white'
                                            : 'bg-card text-muted-foreground hover:text-foreground'
                                        }`}
                                        onClick={() =>
                                          setConfigFiles((current) =>
                                            current.map((file) =>
                                              file.path === configFile.path
                                                ? { ...file, viewMode: 'raw' }
                                                : file,
                                            ),
                                          )
                                        }
                                      >
                                        Raw
                                      </button>
                                    </div>
                                  </div>
                                  {configFile.viewMode === 'raw' ? (
                                    <textarea
                                      className="min-h-[240px] w-full rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-foreground transition-colors focus:border-primary-500 focus:bg-card focus:outline-none dark:focus:border-primary-400"
                                      value={configFile.rawContent}
                                      onChange={(event) =>
                                        setConfigFiles((current) =>
                                          current.map((file) =>
                                            file.path === configFile.path
                                              ? { ...file, rawContent: event.target.value }
                                              : file,
                                          ),
                                        )
                                      }
                                    />
                                ) : (
                                  <div className="space-y-4">
                                    {configFile.sections.map((section, sectionIndex) => (
                                      <div
                                        key={`${configFile.path}-${section.title}`}
                                        className="rounded-xl border border-border bg-card p-4 dark:bg-surface-2/60"
                                      >
                                        <button
                                          type="button"
                                          className="flex w-full items-center justify-between text-left"
                                          onClick={() =>
                                            setConfigFiles((current) =>
                                              current.map((file) => {
                                                if (file.path !== configFile.path) return file;
                                                return {
                                                  ...file,
                                                  sections: file.sections.map(
                                                    (sectionItem, secIdx) =>
                                                      secIdx === sectionIndex
                                                        ? {
                                                            ...sectionItem,
                                                            collapsed: !sectionItem.collapsed,
                                                          }
                                                        : sectionItem,
                                                  ),
                                                };
                                              }),
                                            )
                                          }
                                        >
                                          <div className="flex items-center gap-3 text-sm font-semibold text-foreground">
                                            <span className="h-2 w-2 rounded-full bg-primary-500" />
                                            <span className="uppercase tracking-wide">
                                              {section.title}
                                            </span>
                                          </div>
                                          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-wide ${section.collapsed ? 'bg-surface-2 text-muted-foreground dark:bg-surface-2' : 'bg-primary-muted text-primary'}`}>
                                            {section.collapsed ? 'Expand' : 'Collapse'}
                                          </span>
                                        </button>
                                        {section.collapsed ? null : (
                                          <div className="mt-4 space-y-4">
                                            <div className="space-y-3">
                                              {section.entries.map((entry, entryIndex) =>
                                                entry.type === 'object' ? (
                                                  <div
                                                    key={`${entry.key}-${entryIndex}`}
                                                    className="p-3"
                                                  >
                                                    <div className="flex items-center justify-between">
                                                      <h4 className="text-sm font-semibold text-foreground">
                                                        {entry.key || 'Object'}
                                                      </h4>
                                                      <button
                                                        type="button"
                                                        className="text-[10px] font-semibold uppercase tracking-wide text-primary transition-all duration-300 hover:text-primary"
                                                        onClick={() =>
                                                          addConfigEntry(
                                                            fileIndexByPath.get(configFile.path) ??
                                                              0,
                                                            sectionIndex,
                                                            entryIndex,
                                                          )
                                                        }
                                                      >
                                                        Add entry
                                                      </button>
                                                    </div>
                                                    <div className="mt-3">
                                                      {(entry.children ?? []).map(
                                                        (child, childIndex) => (
                                                          <div
                                                            key={`${entry.key}-${child.key}-${childIndex}`}
                                                            className="space-y-3 border-b border-border/60 px-3 py-3 last:border-b-0"
                                                          >
                                                            <div className="flex items-start justify-between gap-3">
                                                              <div className="text-base font-semibold text-foreground">
                                                                {child.key || 'Key'}
                                                              </div>
                                                              <button
                                                                type="button"
                                                                className="flex h-6 w-6 items-center justify-center rounded-md border border-danger/30 bg-danger-muted text-[11px] font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                                                                onClick={() =>
                                                                  removeConfigEntry(
                                                                    fileIndexByPath.get(
                                                                      configFile.path,
                                                                    ) ?? 0,
                                                                    sectionIndex,
                                                                    entryIndex,
                                                                    childIndex,
                                                                  )
                                                                }
                                                              >
                                                                ✕
                                                              </button>
                                                            </div>
                                                            {renderValueInput(child, (value) =>
                                                              updateConfigEntry(
                                                                fileIndexByPath.get(
                                                                  configFile.path,
                                                                ) ?? 0,
                                                                sectionIndex,
                                                                entryIndex,
                                                                { value },
                                                                childIndex,
                                                              ),
                                                            )}
                                                          </div>
                                                        ),
                                                      )}
                                                    </div>
                                                  </div>
                                                ) : (
                                                  <div
                                                    key={`${entry.key}-${entryIndex}`}
                                                    className="space-y-3 border-b border-border px-3 py-3 last:border-b-0/60"
                                                  >
                                                    <div className="flex items-start justify-between gap-3">
                                                      <div className="text-base font-semibold text-foreground">
                                                        {entry.key || 'Key'}
                                                      </div>
                                                      <button
                                                        type="button"
                                                        className="flex h-6 w-6 items-center justify-center rounded-md border border-danger/30 bg-danger-muted text-[11px] font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                                                        onClick={() =>
                                                          removeConfigEntry(
                                                            fileIndexByPath.get(configFile.path) ??
                                                              0,
                                                            sectionIndex,
                                                            entryIndex,
                                                          )
                                                        }
                                                      >
                                                        ✕
                                                      </button>
                                                    </div>
                                                    {renderValueInput(entry, (value) =>
                                                      updateConfigEntry(
                                                        fileIndexByPath.get(configFile.path) ?? 0,
                                                        sectionIndex,
                                                        entryIndex,
                                                        { value },
                                                      ),
                                                    )}
                                                  </div>
                                                ),
                                              )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <button
                                                type="button"
                                                className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground"
                                                onClick={() =>
                                                  addConfigEntry(
                                                    fileIndexByPath.get(configFile.path) ?? 0,
                                                    sectionIndex,
                                                  )
                                                }
                                              >
                                                Add entry
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    className="rounded-md bg-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                                    onClick={() =>
                                      configMutation.mutate(
                                        fileIndexByPath.get(configFile.path) ?? 0,
                                      )
                                    }
                                    disabled={configMutation.isPending}
                                  >
                                    Save config
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                  </div>
                  )}
                </div>
              </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'admin' ? (
        isAdmin ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Suspension
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Suspend or restore access to the server.
                  </div>
                </div>
                {server.status === 'suspended' ? (
                  <button
                    type="button"
                    className="rounded-md border border-success/30 px-3 py-1 text-xs font-semibold text-success transition-all duration-300 hover:border-success/50 disabled:opacity-60"
                    onClick={() => unsuspendMutation.mutate()}
                    disabled={unsuspendMutation.isPending}
                  >
                    Unsuspend
                  </button>
                ) : null}
              </div>
              {server.status !== 'suspended' ? (
                <div className="mt-3 flex flex-wrap items-end gap-3 text-xs">
                  <div className="flex-1">
                    <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Reason (optional)
                    </label>
                    <input
                      className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                      value={suspendReason}
                      onChange={(event) => setSuspendReason(event.target.value)}
                      placeholder="Billing, abuse, or other admin notes"
                    />
                  </div>
                  <button
                    type="button"
                    className="rounded-md bg-danger px-3 py-2 font-semibold text-white shadow-lg shadow-danger/20 transition-all duration-300 hover:bg-danger disabled:opacity-60"
                    onClick={() => suspendMutation.mutate(suspendReason.trim() || undefined)}
                    disabled={suspendMutation.isPending}
                  >
                    Suspend
                  </button>
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Port allocations
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Add or remove host-to-container bindings.
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {server.status === 'stopped' ? 'Stopped' : 'Stop server to edit'}
                </span>
              </div>
              {allocationsError ? (
                <div className="mt-3 rounded-md border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
                  {allocationsError}
                </div>
              ) : null}
              <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                <input
                  className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                  value={newContainerPort}
                  onChange={(event) => setNewContainerPort(event.target.value)}
                  placeholder="Container port"
                  type="number"
                  min={1}
                  max={65535}
                  disabled={server.status !== 'stopped' || isSuspended}
                />
                <input
                  className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                  value={newHostPort}
                  onChange={(event) => setNewHostPort(event.target.value)}
                  placeholder="Host port (optional)"
                  type="number"
                  min={1}
                  max={65535}
                  disabled={server.status !== 'stopped' || isSuspended}
                />
                <button
                  type="button"
                  className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => addAllocationMutation.mutate()}
                  disabled={
                    server.status !== 'stopped' || isSuspended || addAllocationMutation.isPending
                  }
                >
                  Add allocation
                </button>
              </div>
              <div className="mt-4 space-y-2 text-xs">
                {allocations.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-surface-2 px-4 py-4 text-center text-muted-foreground/50">
                    No allocations configured.
                  </div>
                ) : (
                  allocations.map((allocation) => (
                    <div
                      key={`${allocation.containerPort}-${allocation.hostPort}`}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 transition-all duration-300 hover:border-primary/30"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-foreground">
                          {allocation.containerPort} → {allocation.hostPort}
                        </span>
                        {allocation.isPrimary ? (
                          <span className="rounded-full bg-primary-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                            Primary
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground disabled:opacity-60"
                          onClick={() => setPrimaryMutation.mutate(allocation.containerPort)}
                          disabled={
                            allocation.isPrimary ||
                            server.status !== 'stopped' ||
                            isSuspended ||
                            setPrimaryMutation.isPending
                          }
                        >
                          Make primary
                        </button>
                        <button
                          type="button"
                          className="rounded-md border border-danger/30 px-2 py-1 text-[10px] font-semibold text-danger transition-all duration-300 hover:border-danger/50 disabled:opacity-60"
                          onClick={() => removeAllocationMutation.mutate(allocation.containerPort)}
                          disabled={
                            allocation.isPrimary ||
                            server.status !== 'stopped' ||
                            isSuspended ||
                            removeAllocationMutation.isPending
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    Crash recovery
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Configure automatic restart behavior for crashes.
                  </div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Restart policy
                  </label>
                  <select
                    className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                    value={restartPolicy}
                    onChange={(event) => setRestartPolicy(event.target.value as 'always' | 'on-failure' | 'never')}
                    disabled={isSuspended}
                  >
                    <option value="always">Always</option>
                    <option value="on-failure">On failure</option>
                    <option value="never">Never</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Max crash count
                  </label>
                  <input
                    className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                    type="number"
                    min={0}
                    max={100}
                    value={maxCrashCount}
                    onChange={(event) => setMaxCrashCount(event.target.value)}
                    disabled={isSuspended}
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  className="rounded-md bg-primary-600 px-3 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => restartPolicyMutation.mutate()}
                  disabled={isSuspended || restartPolicyMutation.isPending}
                >
                  Save policy
                </button>
                <button
                  type="button"
                  className="rounded-md border border-border px-3 py-2 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary/30 hover:text-foreground disabled:opacity-60"
                  onClick={() => resetCrashCountMutation.mutate()}
                  disabled={isSuspended || resetCrashCountMutation.isPending}
                >
                  Reset crash count
                </button>
                <div className="text-[11px] text-muted-foreground">
                  Crashes: {server.crashCount ?? 0} / {server.maxCrashCount ?? 0}
                  {server.lastCrashAt
                    ? ` · Last crash ${new Date(server.lastCrashAt).toLocaleString()}`
                    : ''}
                  {server.lastExitCode !== null && server.lastExitCode !== undefined
                    ? ` · Exit ${server.lastExitCode}`
                    : ''}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
              <div className="text-sm font-semibold text-foreground">
                Resource allocation
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Adjust memory, CPU, disk, or primary IP assignments.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <UpdateServerModal serverId={server.id} disabled={isSuspended} />
                <TransferServerModal serverId={server.id} disabled={isSuspended} />
              </div>
            </div>

            <div className="rounded-xl border border-danger/30 bg-danger-muted px-4 py-4" >
              <div className="text-sm font-semibold text-danger">
                Danger zone
              </div>
              <p className="mt-2 text-xs text-danger">
                Deleting the server removes all data and cannot be undone.
              </p>
              <div className="mt-3">
                <DeleteServerDialog
                  serverId={server.id}
                  serverName={server.name}
                  disabled={isSuspended || !hasServerPerm('server.delete')}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-danger/30 bg-danger-muted px-4 py-6 text-danger">
            Admin access required.
          </div>
        )
      ) : null}

      {activeTab === 'settings' ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
              <div className="text-sm font-semibold text-foreground">
                Rename server
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Update how this server appears in your list.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <input
                  className="min-w-[220px] flex-1 rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
                  value={serverName}
                  onChange={(event) => setServerName(event.target.value)}
                  placeholder="Server name"
                  disabled={isSuspended}
                />
                <button
                  type="button"
                  className="rounded-md bg-primary-600 px-3 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => renameServerMutation.mutate()}
                  disabled={
                    isSuspended ||
                    renameServerMutation.isPending ||
                    !serverName.trim() ||
                    serverName.trim() === server.name
                  }
                >
                  Save
                </button>
              </div>
            </div>
            <div className="rounded-xl border border-border/50 bg-card/80 px-4 py-4 backdrop-blur-sm transition-all duration-300 hover:shadow-md hover:border-primary/30">
              <div className="text-sm font-semibold text-foreground">
                Maintenance
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Reinstalling will re-run the template install script and may overwrite files.
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  className="rounded-md bg-warning px-3 py-1 font-semibold text-white shadow-lg shadow-warning/20 transition-all duration-300 hover:bg-warning disabled:opacity-60"
                  disabled={server.status !== 'stopped' || isSuspended}
                  onClick={handleReinstall}
                >
                  Reinstall
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Mod Update Confirmation Modal */}
      {updateConfirmMods.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-muted">
                <ArrowUpCircle className="h-5 w-5 text-warning" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Confirm Mod Update{updateConfirmMods.length > 1 ? 's' : ''}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {updateConfirmMods.length} mod{updateConfirmMods.length !== 1 ? 's' : ''} will be updated
                </p>
              </div>
            </div>

            <div className="mb-4 rounded-lg border border-warning/30 bg-warning-muted p-3 ">
              <p className="text-xs text-warning">
                ⚠️ Updating mods may break compatibility with other mods or your world. Make sure to back up your server before proceeding.
              </p>
            </div>

            <div className="mb-4 max-h-60 space-y-2 overflow-y-auto">
              {updateConfirmMods.map((mod) => (
                <div key={mod.name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <span className="truncate text-sm font-medium text-foreground">{mod.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {mod.currentVersion.slice(0, 8)} → <span className="text-warning">{mod.latestVersion}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2"
                onClick={() => setUpdateConfirmMods([])}
                disabled={isUpdatingMods}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-warning disabled:opacity-50"
                disabled={isUpdatingMods}
                onClick={async () => {
                  if (!server?.id) return;
                  setIsUpdatingMods(true);
                  try {
                    const filenames = updateConfirmMods.map((m) => m.name);
                    const results = await modManagerApi.update(server.id, filenames);
                    const succeeded = results.filter((r) => r.success).length;
                    const failed = results.filter((r) => !r.success).length;
                    if (failed > 0) {
                      notifyError(`${failed} mod${failed !== 1 ? 's' : ''} failed to update`);
                    }
                    if (succeeded > 0) {
                      notifySuccess(`${succeeded} mod${succeeded !== 1 ? 's' : ''} updated successfully`);
                    }
                    refetchInstalledMods();
                    setUpdateConfirmMods([]);
                  } catch {
                    notifyError('Failed to update mods');
                  } finally {
                    setIsUpdatingMods(false);
                  }
                }}
              >
                {isUpdatingMods ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />}
                {isUpdatingMods ? 'Updating…' : `Update ${updateConfirmMods.length > 1 ? 'All' : 'Mod'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Plugin Update Confirmation Modal */}
      {updateConfirmPlugins.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-warning-muted">
                <ArrowUpCircle className="h-5 w-5 text-warning" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  Confirm Plugin Update{updateConfirmPlugins.length > 1 ? 's' : ''}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {updateConfirmPlugins.length} plugin{updateConfirmPlugins.length !== 1 ? 's' : ''} will be updated
                </p>
              </div>
            </div>

            <div className="mb-4 rounded-lg border border-warning/30 bg-warning-muted p-3 ">
              <p className="text-xs text-warning">
                ⚠️ Updating plugins may cause compatibility issues. Test on a staging server if possible, and always maintain backups.
              </p>
            </div>

            <div className="mb-4 max-h-60 space-y-2 overflow-y-auto">
              {updateConfirmPlugins.map((plugin) => (
                <div key={plugin.name} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <span className="truncate text-sm font-medium text-foreground">{plugin.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {plugin.currentVersion.slice(0, 8)} → <span className="text-warning">{plugin.latestVersion}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2"
                onClick={() => setUpdateConfirmPlugins([])}
                disabled={isUpdatingPlugins}
              >
                Cancel
              </button>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg bg-warning px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-warning disabled:opacity-50"
                disabled={isUpdatingPlugins}
                onClick={async () => {
                  if (!server?.id) return;
                  setIsUpdatingPlugins(true);
                  try {
                    const filenames = updateConfirmPlugins.map((p) => p.name);
                    const results = await pluginManagerApi.update(server.id, filenames);
                    const succeeded = results.filter((r) => r.success).length;
                    const failed = results.filter((r) => !r.success).length;
                    if (failed > 0) {
                      notifyError(`${failed} plugin${failed !== 1 ? 's' : ''} failed to update`);
                    }
                    if (succeeded > 0) {
                      notifySuccess(`${succeeded} plugin${succeeded !== 1 ? 's' : ''} updated successfully`);
                    }
                    refetchInstalledPlugins();
                    setUpdateConfirmPlugins([]);
                  } catch {
                    notifyError('Failed to update plugins');
                  } finally {
                    setIsUpdatingPlugins(false);
                  }
                }}
              >
                {isUpdatingPlugins ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpCircle className="h-4 w-4" />}
                {isUpdatingPlugins ? 'Updating…' : `Update ${updateConfirmPlugins.length > 1 ? 'All' : 'Plugin'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {eulaPrompt && (
        <EulaModal
          eulaText={eulaPrompt.eulaText}
          isLoading={eulaLoading}
          onAccept={() => respondEula(true)}
          onDecline={() => respondEula(false)}
        />
      )}
      </motion.div>
      </div>
    </motion.div>
  );
}

export default ServerDetailsPage;
