import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, type Variants } from 'framer-motion';
import {
  ArrowUpCircle,
  CheckSquare,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Puzzle,
  RefreshCw,
  Search,
  Square,
  Trash2,
  Terminal,
  FolderOpen,
  HardDrive,
  Clock,
  Database,
  BarChart3,
  Bell,
  Wrench,
  Users,
  Settings,
  Shield,
  FolderSync,
} from 'lucide-react';
import { useServer } from '../../hooks/useServer';
import { useServerMetrics } from '../../hooks/useServerMetrics';
import {
  useServerMetricsHistory,
  type MetricsTimeRange,
} from '../../hooks/useServerMetricsHistory';
import { useTasks } from '../../hooks/useTasks';
import { useServerDatabases } from '../../hooks/useServerDatabases';
import { useDatabaseHosts } from '../../hooks/useAdmin';
import { useAuthStore } from '../../stores/authStore';
import { useConsole } from '../../hooks/useConsole';
import { useEulaPrompt } from '../../hooks/useEulaPrompt';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { qk } from '../../lib/queryKeys';
import { serversApi } from '../../services/api/servers';
import { databasesApi } from '../../services/api/databases';
import { tasksApi } from '../../services/api/tasks';
import { getErrorMessage } from '../../utils/errors';
import { notifyError, notifySuccess } from '../../utils/notify';
import type {
  ServerAccessEntry,
  ServerInvite,
  ServerPermissionsResponse,
} from '../../types/server';

import ServerControls from '../../components/servers/ServerControls';
import ServerStatusBadge from '../../components/servers/ServerStatusBadge';
import FileManager from '../../components/files/FileManager';
import BackupSection from '../../components/backups/BackupSection';
import EulaModal from '../../components/servers/EulaModal';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';

const ServerConsoleTab = lazy(() => import('../../components/servers/ServerConsoleTab'));
const ServerSftpTab = lazy(() => import('../../components/servers/tabs/ServerSftpTab'));
const ServerTasksTab = lazy(() => import('../../components/servers/tabs/ServerTasksTab'));
const ServerDatabasesTab = lazy(() => import('../../components/servers/tabs/ServerDatabasesTab'));
const ServerMetricsTab = lazy(() => import('../../components/servers/tabs/ServerMetricsTab'));
const ServerSettingsTab = lazy(() => import('../../components/servers/tabs/ServerSettingsTab'));
const ServerAdminTab = lazy(() => import('../../components/servers/tabs/ServerAdminTab'));
const ServerUsersTab = lazy(() => import('../../components/servers/tabs/ServerUsersTab'));
const ServerConfigurationTab = lazy(() => import('../../components/servers/tabs/ServerConfigurationTab'));
const ServerModManagerTab = lazy(() => import('../../components/servers/tabs/ServerModManagerTab'));
const ServerPluginManagerTab = lazy(() => import('../../components/servers/tabs/ServerPluginManagerTab'));
const AlertsPage = lazy(() => import('../alerts/AlertsPage'));

// ── Tab labels & icons ──
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

const tabIcons: Record<
  keyof typeof tabLabels,
  React.ComponentType<{ className?: string }>
> = {
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
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

function TabSkeleton() {
  return (
    <div className="flex h-96 items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
    </div>
  );
}

function ServerDetailsPage() {
  const { serverId, tab } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: server, isLoading, isError, refetch } = useServer(serverId);
  const liveMetrics = useServerMetrics(serverId, server?.allocatedMemoryMb);
  const user = useAuthStore((s) => s.user);

  // ── Metrics ──
  const [metricsTimeRange, setMetricsTimeRange] = useState<MetricsTimeRange>({
    hours: 1,
    limit: 60,
    label: '1 hour',
  });
  const { data: metricsHistory } = useServerMetricsHistory(
    serverId,
    metricsTimeRange,
  );

  // ── Console ──
  const consoleScrollback = 2000;
  const {
    entries,
    send,
    isConnected,
    streamStatus,
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
    refetchConsole().catch(() => {});
  }, [refetchConsole, serverId]);

  // ── EULA ──
  const { eulaPrompt, isLoading: eulaLoading, respond: respondEula } =
    useEulaPrompt(serverId);

  // ── Auth / permissions ──
  const isAdmin = useMemo(
    () =>
      user?.permissions?.includes('*') ||
      user?.permissions?.includes('admin.read') ||
      user?.permissions?.includes('admin.write'),
    [user?.permissions],
  );
  const canAdminWrite = useMemo(
    () =>
      user?.permissions?.includes('*') ||
      user?.permissions?.includes('admin.write'),
    [user?.permissions],
  );
  const serverPerms = useMemo(
    () => new Set(server?.effectivePermissions ?? []),
    [server?.effectivePermissions],
  );
  const hasServerPerm = useCallback(
    (perm: string) => {
      if (serverPerms.size === 0) return isAdmin;
      return serverPerms.has(perm);
    },
    [serverPerms, isAdmin],
  );

  // ── Derived state ──
  const isSuspended = server?.status === 'suspended';
  const activeTab = useMemo(() => {
    const key = tab ?? 'console';
    return key in tabLabels ? (key as keyof typeof tabLabels) : 'console';
  }, [tab]);

  // canSend: allow commands when SSE is connected (or reconnecting) AND server is running
  const canSend =
    (isConnected || streamStatus === 'reconnecting') &&
    Boolean(serverId) &&
    server?.status === 'running' &&
    !isSuspended &&
    hasServerPerm('console.write');

  const serverGameVersion =
    server?.environment?.MC_VERSION ||
    server?.environment?.MINECRAFT_VERSION ||
    server?.environment?.GAME_VERSION ||
    server?.environment?.SERVER_VERSION ||
    server?.environment?.VERSION;

  // ── Tasks ──
  const { data: tasks = [], isLoading: tasksLoading } = useTasks(serverId);

  // ── Databases ──
  const {
    data: databases = [],
    isLoading: databasesLoading,
    isError: databasesError,
  } = useServerDatabases(serverId);
  const { data: databaseHosts = [] } = useDatabaseHosts();
  const canManageDatabases =
    user?.permissions?.includes('*') ||
    user?.permissions?.includes('admin.read') ||
    user?.permissions?.includes('database.create') ||
    user?.permissions?.includes('database.read') ||
    user?.permissions?.includes('database.rotate') ||
    user?.permissions?.includes('database.delete') ||
    Boolean(server && user?.id && server.ownerId === user.id);
  const databaseAllocation = server?.databaseAllocation ?? 0;

  // ── Permissions / Users ──
  const { data: permissionsData } = useQuery<ServerPermissionsResponse>({
    queryKey: qk.serverPermissions(serverId ?? ''),
    queryFn: () => serversApi.permissions(serverId ?? ''),
    enabled: Boolean(serverId),
  });
  const { data: invites = [] } = useQuery<ServerInvite[]>({
    queryKey: qk.serverInvites(serverId ?? ''),
    queryFn: () => serversApi.listInvites(serverId ?? ''),
    enabled: Boolean(serverId),
  });

  // ── Allocations (admin) ──
  const allocationsQuery = useQuery({
    queryKey: qk.serverAllocations(serverId ?? ''),
    queryFn: () => serversApi.allocations(serverId ?? ''),
    enabled: Boolean(serverId),
  });
  const allocations = allocationsQuery.data ?? [];
  const allocationsError = allocationsQuery.error
    ? getErrorMessage(allocationsQuery.error, 'Unable to load allocations')
    : null;

  // ── State: Settings ──
  const [serverName, setServerName] = useState('');

  // ── State: Admin ──
  const [suspendReason, setSuspendReason] = useState('');
  const [newContainerPort, setNewContainerPort] = useState('');
  const [newHostPort, setNewHostPort] = useState('');
  const [restartPolicy, setRestartPolicy] = useState<
    'always' | 'on-failure' | 'never'
  >('on-failure');
  const [maxCrashCount, setMaxCrashCount] = useState('5');

  // ── State: Configuration ──
  const [startupCommand, setStartupCommand] = useState('');
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [envDirty, setEnvDirty] = useState(false);

  // ── State: Users ──
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePreset, setInvitePreset] = useState<
    'readOnly' | 'power' | 'full' | 'custom'
  >('readOnly');
  const [invitePermissions, setInvitePermissions] = useState<string[]>([]);
  const [accessPermissions, setAccessPermissions] = useState<
    Record<string, string[]>
  >({});

  // ── State: Databases ──
  const [databaseHostId, setDatabaseHostId] = useState('');
  const [databaseName, setDatabaseName] = useState('');

  // ── Sync server data to local state ──
  useEffect(() => {
    if (!server?.name) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initializing form from server data
    setServerName(server.name);
  }, [server?.name]);

  useEffect(() => {
    if (!server) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initializing form from server data
    setRestartPolicy(server.restartPolicy ?? 'on-failure');
    setMaxCrashCount(
      server.maxCrashCount !== undefined && server.maxCrashCount !== null
        ? String(server.maxCrashCount)
        : '5',
    );
  }, [server?.id, server?.restartPolicy, server?.maxCrashCount]);

  useEffect(() => {
    if (!server) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initializing form from server data
    setStartupCommand(
      server.startupCommand ?? server.template?.startup ?? '',
    );
  }, [server?.id, server?.startupCommand, server?.template?.startup]);

  useEffect(() => {
    if (!server?.environment) return;
    const entries = Object.entries(
      server.environment as Record<string, string>,
    ).map(([key, value]) => ({ key, value: String(value) }));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initializing form from server data
    setEnvVars(entries.length ? entries : [{ key: '', value: '' }]);
    setEnvDirty(false);
  }, [server?.id, server?.environment]);

  useEffect(() => {
    if (!permissionsData?.data) return;
    const nextPermissions: Record<string, string[]> = {};
    permissionsData.data.forEach((entry) => {
      nextPermissions[entry.userId] = entry.permissions;
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing permissions from API
    setAccessPermissions(nextPermissions);
  }, [permissionsData?.data]);

  useEffect(() => {
    if (!permissionsData?.presets) return;
    if (invitePreset !== 'custom') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- applying preset from API
      setInvitePermissions(permissionsData.presets[invitePreset]);
    }
  }, [invitePreset, permissionsData?.presets]);

  // ── Permission options ──
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
    permissionsData?.data?.forEach((entry) =>
      entry.permissions.forEach((perm) => all.add(perm)),
    );
    if (permissionsData?.presets) {
      Object.values(permissionsData.presets).forEach((list) =>
        list.forEach((perm) => all.add(perm)),
      );
    }
    return Array.from(all).sort();
  }, [permissionsData]);

  // ── Mutations ──
  const pauseMutation = useMutation({
    mutationFn: (task: { id: string; enabled: boolean }) => {
      if (!server?.id) throw new Error('Server not loaded');
      return tasksApi.update(server.id, task.id, { enabled: !task.enabled });
    },
    onSuccess: () => {
      if (server?.id)
        queryClient.invalidateQueries({ queryKey: qk.tasks(server.id) });
      notifySuccess('Task updated');
    },
    onError: (error: any) =>
      notifyError(error?.response?.data?.error || 'Failed to update task'),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return tasksApi.remove(server.id, taskId);
    },
    onSuccess: () => {
      if (server?.id)
        queryClient.invalidateQueries({ queryKey: qk.tasks(server.id) });
      notifySuccess('Task deleted');
    },
    onError: (error: any) =>
      notifyError(error?.response?.data?.error || 'Failed to delete task'),
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
      if (server?.id)
        queryClient.invalidateQueries({
          queryKey: qk.serverDatabases(server.id),
        });
      setDatabaseName('');
      notifySuccess('Database created');
    },
    onError: (error: any) =>
      notifyError(error?.response?.data?.error || 'Failed to create database'),
  });

  const rotateDatabaseMutation = useMutation({
    mutationFn: (databaseId: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return databasesApi.rotatePassword(server.id, databaseId);
    },
    onSuccess: () => {
      if (server?.id)
        queryClient.invalidateQueries({
          queryKey: qk.serverDatabases(server.id),
        });
      notifySuccess('Database password rotated');
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error || 'Failed to rotate password',
      ),
  });

  const deleteDatabaseMutation = useMutation({
    mutationFn: (databaseId: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return databasesApi.remove(server.id, databaseId);
    },
    onSuccess: () => {
      if (server?.id)
        queryClient.invalidateQueries({
          queryKey: qk.serverDatabases(server.id),
        });
      notifySuccess('Database deleted');
    },
    onError: (error: any) =>
      notifyError(error?.response?.data?.error || 'Failed to delete database'),
  });

  const suspendMutation = useMutation({
    mutationFn: (reason?: string) => {
      if (!server?.id) throw new Error('Server not loaded');
      return serversApi.suspend(server.id, reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.server(server?.id) });
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'servers' });
      notifySuccess('Server suspended');
      setSuspendReason('');
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error || 'Failed to suspend server',
      ),
  });

  const unsuspendMutation = useMutation({
    mutationFn: () => {
      if (!server?.id) throw new Error('Server not loaded');
      return serversApi.unsuspend(server.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.server(server?.id) });
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'servers' });
      notifySuccess('Server unsuspended');
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error || 'Failed to unsuspend server',
      ),
  });

  const addAllocationMutation = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Missing server id');
      const containerPort = Number(newContainerPort);
      const hostPort = Number(newHostPort || newContainerPort);
      if (!Number.isFinite(containerPort) || containerPort <= 0)
        throw new Error('Invalid container port');
      if (!Number.isFinite(hostPort) || hostPort <= 0)
        throw new Error('Invalid host port');
      return serversApi.addAllocation(serverId, {
        containerPort,
        hostPort,
      });
    },
    onSuccess: () => {
      notifySuccess('Allocation added');
      setNewContainerPort('');
      setNewHostPort('');
      queryClient.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error ||
          error?.message ||
          'Failed to add allocation',
      ),
  });

  const removeAllocationMutation = useMutation({
    mutationFn: async (containerPort: number) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.removeAllocation(serverId, containerPort);
    },
    onSuccess: () => {
      notifySuccess('Allocation removed');
      queryClient.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error || 'Failed to remove allocation',
      ),
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (containerPort: number) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.setPrimaryAllocation(serverId, containerPort);
    },
    onSuccess: () => {
      notifySuccess('Primary allocation updated');
      queryClient.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error ||
          'Failed to update primary allocation',
      ),
  });

  const restartPolicyMutation = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Missing server id');
      const parsedMax =
        maxCrashCount.trim() === '' ? undefined : Number(maxCrashCount);
      const minCrashCount = restartPolicy === 'always' ? 1 : 0;
      if (
        parsedMax !== undefined &&
        (!Number.isFinite(parsedMax) ||
          parsedMax < minCrashCount ||
          parsedMax > 100)
      ) {
        throw new Error(
          `Max crash count must be between ${minCrashCount} and 100`,
        );
      }
      return serversApi.updateRestartPolicy(serverId, {
        restartPolicy,
        maxCrashCount: parsedMax,
      });
    },
    onSuccess: () => {
      notifySuccess('Restart policy updated');
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'servers' });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error ||
          error?.message ||
          'Failed to update restart policy',
      ),
  });

  const resetCrashCountMutation = useMutation({
    mutationFn: async () => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.resetCrashCount(serverId);
    },
    onSuccess: () => {
      notifySuccess('Crash count reset');
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'servers' });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error ||
          error?.message ||
          'Failed to reset crash count',
      ),
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
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'servers' });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error ||
          error?.message ||
          'Failed to rename server',
      ),
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
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error ||
          error?.message ||
          'Failed to update startup command',
      ),
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
      queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error ||
          error?.message ||
          'Failed to update environment',
      ),
  });

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
      queryClient.invalidateQueries({
        queryKey: qk.serverInvites(serverId),
      });
    },
    onError: (error: any) =>
      notifyError(error?.response?.data?.error || 'Failed to send invite'),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (inviteId: string) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.cancelInvite(serverId, inviteId);
    },
    onSuccess: () => {
      notifySuccess('Invite cancelled');
      queryClient.invalidateQueries({
        queryKey: qk.serverInvites(serverId),
      });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error || 'Failed to cancel invite',
      ),
  });

  const saveAccessMutation = useMutation({
    mutationFn: (entry: ServerAccessEntry) => {
      if (!serverId) throw new Error('Missing server id');
      const permissions = accessPermissions[entry.userId] ?? [];
      return serversApi.upsertAccess(serverId, {
        targetUserId: entry.userId,
        permissions,
      });
    },
    onSuccess: () => {
      notifySuccess('Permissions updated');
      queryClient.invalidateQueries({
        queryKey: qk.serverPermissions(serverId),
      });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error || 'Failed to update permissions',
      ),
  });

  const removeAccessMutation = useMutation({
    mutationFn: (targetUserId: string) => {
      if (!serverId) throw new Error('Missing server id');
      return serversApi.removeAccess(serverId, targetUserId);
    },
    onSuccess: () => {
      notifySuccess('Access removed');
      queryClient.invalidateQueries({
        queryKey: qk.serverPermissions(serverId),
      });
    },
    onError: (error: any) =>
      notifyError(
        error?.response?.data?.error || 'Failed to remove access',
      ),
  });

  const handleResetStartupCommand = () => {
    if (!serverId || !server) return;
    setStartupCommand(server.template?.startup ?? '');
    serversApi
      .update(serverId, { startupCommand: null })
      .then(() => {
        notifySuccess('Reset to template default');
        queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
      })
      .catch(() => notifyError('Failed to reset startup command'));
  };

  // ── Tab visibility filter (BEFORE early returns so hook count is always the same) ──
  const modManagerConfig = server?.template?.features?.modManager;
  const pluginManagerConfig = server?.template?.features?.pluginManager;
  const visibleTabs = useMemo(() => {
    return Object.entries(tabLabels).filter(([key]) => {
      if (key === 'admin')
        return canAdminWrite || hasServerPerm('server.delete');
      if (key === 'console') return hasServerPerm('console.read');
      if (key === 'files') return hasServerPerm('file.read');
      if (key === 'backups') return hasServerPerm('backup.read');
      if (key === 'databases') return hasServerPerm('database.read');
      if (key === 'schedules') return hasServerPerm('server.schedule');
      if (key === 'modManager') return Boolean(modManagerConfig);
      if (key === 'pluginManager') return Boolean(pluginManagerConfig);
      return true;
    });
  }, [
    canAdminWrite,
    hasServerPerm,
    modManagerConfig,
    pluginManagerConfig,
  ]);

  // ── Error state (fatal — don't render anything) ──
  if (isError) {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-primary-500/8 to-primary-300/8 blur-3xl dark:from-primary-500/15 dark:to-primary-300/15" />
          <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-primary-400/8 to-primary-200/8 blur-3xl dark:from-primary-400/15 dark:to-primary-200/15" />
        </div>
        <div className="relative z-10 flex items-center justify-center p-8">
          <div className="rounded-xl border border-danger/30 bg-danger-muted px-6 py-4 text-center">
            <p className="text-sm text-danger">
              Unable to load server details.
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button
                onClick={() => refetch()}
                className="rounded-md border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              >
                Retry
              </button>
              <button
                onClick={() => navigate('/servers')}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ← Back to servers
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Derived values (nullable while server is loading) ──
  const nodeLabel = server?.node?.name ?? server?.nodeName ?? server?.nodeId ?? '…';
  const nodeIp =
    server?.connection?.host ??
    server?.primaryIp ??
    server?.node?.publicAddress ??
    server?.node?.hostname ??
    'n/a';
  const nodePort = server?.primaryPort ?? 'n/a';
  const diskLimitMb = server?.allocatedDiskMb ?? 0;
  const liveDiskUsageMb = liveMetrics?.diskUsageMb;
  const liveDiskTotalMb = liveMetrics?.diskTotalMb;

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-primary-500/8 to-primary-300/8 blur-3xl dark:from-primary-500/15 dark:to-primary-300/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-primary-400/8 to-primary-200/8 blur-3xl dark:from-primary-400/15 dark:to-primary-200/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div
          variants={itemVariants}
          className="overflow-hidden rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-primary-500 to-primary-400 opacity-20 blur-sm" />
                  <Terminal className="relative h-7 w-7 text-primary" />
                </div>
                {isLoading ? (
                  <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
                ) : (
                  <>
                    <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
                      {server.name}
                    </h1>
                    <ServerStatusBadge status={server.status} />
                  </>
                )}
              </div>
              <p className="ml-10 text-sm text-muted-foreground">
                {isLoading ? 'Loading…' : `Node: ${nodeLabel} (IP: ${nodeIp}, Port: ${nodePort})`}
              </p>
            </div>
            {server ? (
              <ServerControls
                serverId={server.id}
                status={server.status}
                permissions={server.effectivePermissions}
              />
            ) : (
              <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
            )}
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
        <motion.div
          variants={itemVariants}
          className="flex flex-wrap gap-1.5 rounded-xl border border-border/50 bg-surface-2/40 p-1.5 backdrop-blur-sm"
        >
          {visibleTabs.map(([key, label]) => {
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
                onClick={() => server && navigate(`/servers/${server.id}/${key}`)}
              >
                <Icon className="h-4 w-4" />
                <span className="font-medium">{label}</span>
              </button>
            );
          })}
        </motion.div>

        {/* ── Tab Content ── */}
        <motion.div variants={itemVariants}>
          <Suspense fallback={<TabSkeleton />}>
          {activeTab === 'console' && (
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
          )}

          {activeTab === 'files' && server && (
            <ServerTabCard>
              <FileManager
                serverId={server.id}
                isSuspended={isSuspended}
              />
            </ServerTabCard>
          )}

          {activeTab === 'sftp' && server && (
            <ServerSftpTab
              serverId={server.id}
              ownerId={server.ownerId}
              currentUserId={user?.id}
            />
          )}

          {activeTab === 'backups' && server && (
            <ServerTabCard>
              <BackupSection
                serverId={server.id}
                serverStatus={server.status}
                isSuspended={isSuspended}
              />
            </ServerTabCard>
          )}

          {activeTab === 'tasks' && server && (
            <ServerTasksTab
              serverId={server.id}
              isSuspended={isSuspended}
              tasks={tasks}
              tasksLoading={tasksLoading}
              onPause={(task) => pauseMutation.mutate(task)}
              pausePending={pauseMutation.isPending}
              onDelete={(taskId) => deleteTaskMutation.mutate(taskId)}
              deletePending={deleteTaskMutation.isPending}
            />
          )}

          {activeTab === 'databases' && server && (
            <ServerDatabasesTab
              serverId={server.id}
              isSuspended={isSuspended}
              databases={databases}
              databasesLoading={databasesLoading}
              databasesError={databasesError}
              databaseHosts={databaseHosts}
              databaseAllocation={databaseAllocation}
              canManageDatabases={canManageDatabases}
              databaseHostId={databaseHostId}
              onDatabaseHostIdChange={setDatabaseHostId}
              databaseName={databaseName}
              onDatabaseNameChange={setDatabaseName}
              createPending={createDatabaseMutation.isPending}
              onCreate={() => createDatabaseMutation.mutate()}
              rotatePending={rotateDatabaseMutation.isPending}
              onRotate={(id) => rotateDatabaseMutation.mutate(id)}
              deletePending={deleteDatabaseMutation.isPending}
              onDelete={(id) => deleteDatabaseMutation.mutate(id)}
            />
          )}

          {activeTab === 'metrics' && server && (
            <ServerMetricsTab
              serverCpuPercent={server.cpuPercent ?? 0}
              serverMemoryPercent={server.memoryPercent ?? 0}
              allocatedMemoryMb={server.allocatedMemoryMb ?? 0}
              allocatedDiskMb={diskLimitMb}
              liveMetrics={liveMetrics}
              isConnected={isConnected}
              metricsHistory={metricsHistory}
              metricsTimeRange={metricsTimeRange}
              onMetricsTimeRangeChange={setMetricsTimeRange}
            />
          )}

          {activeTab === 'alerts' && server && (
            <div className="space-y-4">
              <AlertsPage serverId={server.id} />
            </div>
          )}

          {activeTab === 'modManager' && (
            <ServerModManagerTab
              serverId={serverId}
              serverGameVersion={serverGameVersion}
              modManagerConfig={modManagerConfig}
            />
          )}

          {activeTab === 'pluginManager' && (
            <ServerPluginManagerTab
              serverId={serverId}
              serverGameVersion={serverGameVersion}
              pluginManagerConfig={pluginManagerConfig}
            />
          )}

          {activeTab === 'users' && server && (
            <ServerUsersTab
              serverId={server.id}
              ownerId={server.ownerId}
              inviteEmail={inviteEmail}
              onInviteEmailChange={setInviteEmail}
              invitePreset={invitePreset}
              onInvitePresetChange={setInvitePreset}
              invitePermissions={invitePermissions}
              onInvitePermissionsChange={setInvitePermissions}
              permissionPresets={permissionsData?.presets ?? {}}
              permissionOptions={permissionOptions}
              createInvitePending={createInviteMutation.isPending}
              onCreateInvite={() => createInviteMutation.mutate()}
              permissionsData={permissionsData?.data}
              accessPermissions={accessPermissions}
              onAccessPermissionsChange={setAccessPermissions}
              saveAccessPending={saveAccessMutation.isPending}
              onSaveAccess={(entry) => saveAccessMutation.mutate(entry)}
              removeAccessPending={removeAccessMutation.isPending}
              onRemoveAccess={(userId) =>
                removeAccessMutation.mutate(userId)
              }
              invites={invites}
              cancelInvitePending={cancelInviteMutation.isPending}
              onCancelInvite={(inviteId) =>
                cancelInviteMutation.mutate(inviteId)
              }
            />
          )}

          {activeTab === 'configuration' && server && (
            <ServerConfigurationTab
              serverId={serverId}
              isSuspended={isSuspended}
              isAdmin={isAdmin}
              server={server}
              startupCommand={startupCommand}
              onStartupCommandChange={setStartupCommand}
              startupCommandPending={startupCommandMutation.isPending}
              onSaveStartupCommand={() => startupCommandMutation.mutate()}
              onResetStartupCommand={handleResetStartupCommand}
              envVars={envVars}
              onEnvVarsChange={setEnvVars}
              envDirty={envDirty}
              onEnvDirtyChange={setEnvDirty}
              envPending={envMutation.isPending}
              onSaveEnv={() => envMutation.mutate()}
            />
          )}

          {activeTab === 'admin' && server && (
            <ServerAdminTab
              serverId={server.id}
              serverName={server.name}
              server={server}
              isSuspended={isSuspended}
              canAdminWrite={canAdminWrite}
              suspendReason={suspendReason}
              onSuspendReasonChange={setSuspendReason}
              suspendPending={suspendMutation.isPending}
              onSuspend={(reason) => suspendMutation.mutate(reason)}
              unsuspendPending={unsuspendMutation.isPending}
              onUnsuspend={() => unsuspendMutation.mutate()}
              allocations={allocations}
              allocationsError={allocationsError}
              newContainerPort={newContainerPort}
              onNewContainerPortChange={setNewContainerPort}
              newHostPort={newHostPort}
              onNewHostPortChange={setNewHostPort}
              addAllocationPending={addAllocationMutation.isPending}
              onAddAllocation={() => addAllocationMutation.mutate()}
              removeAllocationPending={removeAllocationMutation.isPending}
              onRemoveAllocation={(port) =>
                removeAllocationMutation.mutate(port)
              }
              setPrimaryPending={setPrimaryMutation.isPending}
              onSetPrimary={(port) => setPrimaryMutation.mutate(port)}
              restartPolicy={restartPolicy}
              onRestartPolicyChange={setRestartPolicy}
              maxCrashCount={maxCrashCount}
              onMaxCrashCountChange={setMaxCrashCount}
              crashCount={server.crashCount ?? 0}
              maxCrashCountValue={server.maxCrashCount ?? 0}
              lastCrashAt={server.lastCrashAt}
              lastExitCode={server.lastExitCode}
              restartPolicyPending={restartPolicyMutation.isPending}
              onSaveRestartPolicy={() => restartPolicyMutation.mutate()}
              resetCrashCountPending={resetCrashCountMutation.isPending}
              onResetCrashCount={() => resetCrashCountMutation.mutate()}
              canDelete={hasServerPerm('server.delete')}
            />
          )}

          {activeTab === 'settings' && server && (
            <ServerSettingsTab
              serverId={server.id}
              serverName={serverName}
              onServerNameChange={setServerName}
              renamePending={renameServerMutation.isPending}
              onRename={() => renameServerMutation.mutate()}
              isSuspended={isSuspended}
              serverStatus={server.status}
            />
          )}
          </Suspense>
        </motion.div>
      </div>

      {eulaPrompt && (
        <EulaModal
          eulaText={eulaPrompt.eulaText}
          isLoading={eulaLoading}
          onAccept={() => respondEula(true)}
          onDecline={() => respondEula(false)}
        />
      )}
    </motion.div>
  );
}

export default ServerDetailsPage;
