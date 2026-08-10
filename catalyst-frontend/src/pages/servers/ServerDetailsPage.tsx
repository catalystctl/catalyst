import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import {
 Package,
 Puzzle,
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
 Activity,
 AlertTriangle,
 Copy,
 Plug,
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
import { reportSystemError } from '../../services/api/systemErrors';
import type {
 ServerInvite,
 ServerPermissionsResponse,
} from '../../types/server';

import ServerControls from '../../components/servers/ServerControls';
import ServerStatusBadge from '../../components/servers/ServerStatusBadge';
import FileManager from '../../components/files/FileManager';
import BackupSection from '../../components/backups/BackupSection';
import { usePluginTabs } from '../../plugins/hooks';
import PluginErrorBoundary from '../../plugins/PluginErrorBoundary';
import { hasAnyPermission } from '../../components/auth/ProtectedRoute';
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
const ServerActivityLogTab = lazy(() => import('../../components/servers/tabs/ServerActivityLogTab'));
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
 activity: 'Activity',
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
 activity: Activity,
 modManager: Package,
 pluginManager: Puzzle,
 configuration: Wrench,
 users: Users,
 settings: Settings,
 admin: Shield,
};

function TabSkeleton() {
 return (
 <div className="flex h-96 items-center justify-center">
 <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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
 const serverPluginTabs = usePluginTabs('server');
 const userPermissions = user?.permissions ?? [];

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
 Boolean(
 user?.permissions?.includes('*') ||
 user?.permissions?.includes('admin.read') ||
 user?.permissions?.includes('admin.write'),
 ),
 [user?.permissions],
 );
 const canAdminWrite = useMemo(
 () =>
 Boolean(
 user?.permissions?.includes('*') ||
 user?.permissions?.includes('admin.write'),
 ),
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
 const isPluginTab = Boolean(tab?.startsWith('plugin:'));
 const activePluginTabId = isPluginTab ? tab!.slice('plugin:'.length) : null;
 const activeTab = useMemo(() => {
 const key = tab ?? 'console';
 if (key in tabLabels) return key as keyof typeof tabLabels;
 // Plugin tabs use raw `tab` param; keep a built-in default for header logic only
 return 'console';
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
 staleTime: 5 * 60 * 1000,
 });
 const { data: invites = [] } = useQuery<ServerInvite[]>({
 queryKey: qk.serverInvites(serverId ?? ''),
 queryFn: () => serversApi.listInvites(serverId ?? ''),
 enabled: Boolean(serverId),
 staleTime: 10 * 60 * 1000,
 });

 // ── Allocations (admin) ──
 const allocationsQuery = useQuery({
 queryKey: qk.serverAllocations(serverId ?? ''),
 queryFn: () => serversApi.allocations(serverId ?? ''),
 enabled: Boolean(serverId),
 staleTime: 30_000,
 refetchInterval: 30_000,
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

 // ── Sync server data to local state via render-time state adjustment ──
 const [prevServer, setPrevServer] = useState(server);
 if (server !== prevServer) {
 setPrevServer(server);
 if (server?.name) setServerName(server.name);
 if (server) {
 setRestartPolicy(server.restartPolicy ?? 'on-failure');
 setMaxCrashCount(
 server.maxCrashCount !== undefined && server.maxCrashCount !== null
 ? String(server.maxCrashCount)
 : '5',
 );
 setStartupCommand(server.startupCommand ?? server.template?.startup ?? '');
 }
 }

 const [prevPermissionsData, setPrevPermissionsData] = useState(permissionsData?.data);
 if (permissionsData?.data !== prevPermissionsData) {
 setPrevPermissionsData(permissionsData?.data);
 if (permissionsData?.data) {
 const nextPermissions: Record<string, string[]> = {};
 permissionsData.data.forEach((entry) => {
 nextPermissions[entry.userId] = entry.permissions;
 });
 setAccessPermissions(nextPermissions);
 }
 }

 const [prevPresets, setPrevPresets] = useState(permissionsData?.presets);
 const [prevInvitePreset, setPrevInvitePreset] = useState(invitePreset);
 if (permissionsData?.presets !== prevPresets || invitePreset !== prevInvitePreset) {
 setPrevPresets(permissionsData?.presets);
 setPrevInvitePreset(invitePreset);
 if (permissionsData?.presets && invitePreset !== 'custom') {
 setInvitePermissions(permissionsData.presets[invitePreset]);
 }
 }

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
 if (!server?.id) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Server not loaded', metadata: { context: 'pauseMutation' } });
 throw new Error('Server not loaded');
 }
 return tasksApi.update(server.id, task.id, { enabled: !task.enabled });
 },
 onSuccess: () => notifySuccess('Task updated'),
 onSettled: () => {
 if (server?.id)
 queryClient.invalidateQueries({ queryKey: qk.tasks(server.id) });
 },
 onError: (error: any) =>
 notifyError(error?.response?.data?.error || 'Failed to update task'),
 });

 const deleteTaskMutation = useMutation({
 mutationFn: (taskId: string) => {
 if (!server?.id) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Server not loaded', metadata: { context: 'deleteTaskMutation' } });
 throw new Error('Server not loaded');
 }
 return tasksApi.remove(server.id, taskId);
 },
 onSuccess: () => notifySuccess('Task deleted'),
 onSettled: () => {
 if (server?.id)
 queryClient.invalidateQueries({ queryKey: qk.tasks(server.id) });
 },
 onError: (error: any) =>
 notifyError(error?.response?.data?.error || 'Failed to delete task'),
 });

 const createDatabaseMutation = useMutation({
 mutationFn: () => {
 if (!server?.id) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Server not loaded', metadata: { context: 'createDatabaseMutation' } });
 throw new Error('Server not loaded');
 }
 if (!databaseHostId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Database host required', metadata: { context: 'createDatabaseMutation' } });
 throw new Error('Database host required');
 }
 return databasesApi.create(server.id, {
 hostId: databaseHostId,
 name: databaseName.trim() || undefined,
 });
 },
 onSuccess: () => {
 setDatabaseName('');
 notifySuccess('Database created');
 },
 onSettled: () => {
 if (server?.id)
 queryClient.invalidateQueries({
 queryKey: qk.serverDatabases(server.id),
 });
 },
 onError: (error: any) =>
 notifyError(error?.response?.data?.error || 'Failed to create database'),
 });

 const rotateDatabaseMutation = useMutation({
 mutationFn: (databaseId: string) => {
 if (!server?.id) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Server not loaded', metadata: { context: 'rotateDatabaseMutation' } });
 throw new Error('Server not loaded');
 }
 return databasesApi.rotatePassword(server.id, databaseId);
 },
 onSuccess: () => notifySuccess('Database password rotated'),
 onSettled: () => {
 if (server?.id)
 queryClient.invalidateQueries({
 queryKey: qk.serverDatabases(server.id),
 });
 },
 onError: (error: any) =>
 notifyError(
 error?.response?.data?.error || 'Failed to rotate password',
 ),
 });

 const deleteDatabaseMutation = useMutation({
 mutationFn: (databaseId: string) => {
 if (!server?.id) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Server not loaded', metadata: { context: 'deleteDatabaseMutation' } });
 throw new Error('Server not loaded');
 }
 return databasesApi.remove(server.id, databaseId);
 },
 onSuccess: () => notifySuccess('Database deleted'),
 onSettled: () => {
 if (server?.id)
 queryClient.invalidateQueries({
 queryKey: qk.serverDatabases(server.id),
 });
 },
 onError: (error: any) =>
 notifyError(error?.response?.data?.error || 'Failed to delete database'),
 });

 const suspendMutation = useMutation({
 mutationFn: (reason?: string) => {
 if (!server?.id) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Server not loaded', metadata: { context: 'suspendMutation' } });
 throw new Error('Server not loaded');
 }
 return serversApi.suspend(server.id, reason);
 },
 onSuccess: () => {
 notifySuccess('Server suspended');
 setSuspendReason('');
 },
 onSettled: () => {
 if (server?.id) queryClient.invalidateQueries({ queryKey: qk.server(server.id) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 },
 onError: (error: any) =>
 notifyError(
 error?.response?.data?.error || 'Failed to suspend server',
 ),
 });

 const unsuspendMutation = useMutation({
 mutationFn: () => {
 if (!server?.id) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Server not loaded', metadata: { context: 'unsuspendMutation' } });
 throw new Error('Server not loaded');
 }
 return serversApi.unsuspend(server.id);
 },
 onSuccess: () => notifySuccess('Server unsuspended'),
 onSettled: () => {
 if (server?.id) queryClient.invalidateQueries({ queryKey: qk.server(server.id) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
 },
 onError: (error: any) =>
 notifyError(
 error?.response?.data?.error || 'Failed to unsuspend server',
 ),
 });

 const addAllocationMutation = useMutation({
 mutationFn: async () => {
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'addAllocationMutation' } });
 throw new Error('Missing server id');
 }
 const containerPort = Number(newContainerPort);
 const hostPort = Number(newHostPort || newContainerPort);
 if (!Number.isFinite(containerPort) || containerPort <= 0) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Invalid container port', metadata: { context: 'addAllocationMutation' } });
 throw new Error('Invalid container port');
 }
 if (!Number.isFinite(hostPort) || hostPort <= 0) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Invalid host port', metadata: { context: 'addAllocationMutation' } });
 throw new Error('Invalid host port');
 }
 return serversApi.addAllocation(serverId, {
 containerPort,
 hostPort,
 });
 },
 onSuccess: () => {
 setNewContainerPort('');
 setNewHostPort('');
 notifySuccess('Allocation added');
 },
 onSettled: () => {
 if (serverId) {
 queryClient.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 }
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
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'removeAllocationMutation' } });
 throw new Error('Missing server id');
 }
 return serversApi.removeAllocation(serverId, containerPort);
 },
 onSuccess: () => notifySuccess('Allocation removed'),
 onSettled: () => {
 if (serverId) {
 queryClient.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 }
 },
 onError: (error: any) =>
 notifyError(
 error?.response?.data?.error || 'Failed to remove allocation',
 ),
 });

 const setPrimaryMutation = useMutation({
 mutationFn: async (containerPort: number) => {
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'setPrimaryMutation' } });
 throw new Error('Missing server id');
 }
 return serversApi.setPrimaryAllocation(serverId, containerPort);
 },
 onSuccess: () => notifySuccess('Primary allocation updated'),
 onSettled: () => {
 if (serverId) {
 queryClient.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 }
 },
 onError: (error: any) =>
 notifyError(
 error?.response?.data?.error ||
 'Failed to update primary allocation',
 ),
 });

 const restartPolicyMutation = useMutation({
 mutationFn: async () => {
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'restartPolicyMutation' } });
 throw new Error('Missing server id');
 }
 const parsedMax =
 maxCrashCount.trim() === '' ? undefined : Number(maxCrashCount);
 const minCrashCount = restartPolicy === 'always' ? 1 : 0;
 if (
 parsedMax !== undefined &&
 (!Number.isFinite(parsedMax) ||
 parsedMax < minCrashCount ||
 parsedMax > 100)
 ) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: `Max crash count must be between ${minCrashCount} and 100`, metadata: { context: 'restartPolicyMutation' } });
 throw new Error(
 `Max crash count must be between ${minCrashCount} and 100`,
 );
 }
 return serversApi.updateRestartPolicy(serverId, {
 restartPolicy,
 maxCrashCount: parsedMax,
 });
 },
 onSuccess: () => notifySuccess('Restart policy updated'),
 onSettled: () => {
 if (serverId) queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
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
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'resetCrashCountMutation' } });
 throw new Error('Missing server id');
 }
 return serversApi.resetCrashCount(serverId);
 },
 onSuccess: () => notifySuccess('Crash count reset'),
 onSettled: () => {
 if (serverId) queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
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
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'renameServerMutation' } });
 throw new Error('Missing server id');
 }
 const nextName = serverName.trim();
 if (!nextName) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Server name is required', metadata: { context: 'renameServerMutation' } });
 throw new Error('Server name is required');
 }
 return serversApi.update(serverId, { name: nextName });
 },
 onSuccess: () => notifySuccess('Server name updated'),
 onSettled: () => {
 if (serverId) queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.servers() });
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
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'startupCommandMutation' } });
 throw new Error('Missing server id');
 }
 const trimmed = startupCommand.trim();
 const templateDefault = server?.template?.startup ?? '';
 return serversApi.update(serverId, {
 startupCommand: trimmed === templateDefault ? null : trimmed || null,
 });
 },
 onSuccess: () => notifySuccess('Startup command updated'),
 onSettled: () => {
 if (serverId) queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 },
 onError: (error: any) =>
 notifyError(
 error?.response?.data?.error ||
 error?.message ||
 'Failed to update startup command',
 ),
 });

 const createInviteMutation = useMutation({
 mutationFn: () => {
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'createInviteMutation' } });
 throw new Error('Missing server id');
 }
 return serversApi.createInvite(serverId, {
 email: inviteEmail.trim(),
 permissions:
 invitePreset === 'custom'
 ? invitePermissions
 : (permissionsData?.presets[invitePreset] ?? []),
 });
 },
 onSuccess: () => {
 setInviteEmail('');
 notifySuccess('Invite sent');
 },
 onSettled: () => {
 if (serverId)
 queryClient.invalidateQueries({
 queryKey: qk.serverInvites(serverId),
 });
 },
 onError: (error: any) =>
 notifyError(error?.response?.data?.error || 'Failed to send invite'),
 });

 const cancelInviteMutation = useMutation({
 mutationFn: (inviteId: string) => {
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'cancelInviteMutation' } });
 throw new Error('Missing server id');
 }
 return serversApi.cancelInvite(serverId, inviteId);
 },
 onSuccess: () => notifySuccess('Invite cancelled'),
 onSettled: () => {
 if (serverId)
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
 mutationFn: (entry: { userId: string }) => {
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'saveAccessMutation' } });
 throw new Error('Missing server id');
 }
 const permissions = accessPermissions[entry.userId] ?? [];
 return serversApi.upsertAccess(serverId, {
 targetUserId: entry.userId,
 permissions,
 });
 },
 onSuccess: () => notifySuccess('Permissions updated'),
 onSettled: () => {
 if (serverId)
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
 if (!serverId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Missing server id', metadata: { context: 'removeAccessMutation' } });
 throw new Error('Missing server id');
 }
 return serversApi.removeAccess(serverId, targetUserId);
 },
 onSuccess: () => notifySuccess('Access removed'),
 onSettled: () => {
 if (serverId)
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
 // Tab key is `tasks` (not legacy `schedules`)
 if (key === 'tasks') return hasServerPerm('server.schedule');
 if (key === 'sftp') return hasServerPerm('file.read');
 if (key === 'metrics') return hasServerPerm('server.read');
 if (key === 'alerts')
 return hasServerPerm('alert.read') || hasServerPerm('server.read');
 if (key === 'users')
 return hasServerPerm('server.delete') || isAdmin || canAdminWrite;
 if (key === 'settings')
 return (
 hasServerPerm('server.install') ||
 hasServerPerm('server.reinstall') ||
 hasServerPerm('server.start') ||
 hasServerPerm('server.stop') ||
 hasServerPerm('file.write') ||
 isAdmin
 );
 if (key === 'configuration')
 return (
 isAdmin ||
 canAdminWrite ||
 hasServerPerm('server.update') ||
 hasServerPerm('server.install') ||
 hasServerPerm('file.write')
 );
 if (key === 'modManager') return Boolean(modManagerConfig);
 if (key === 'pluginManager') return Boolean(pluginManagerConfig);
 if (key === 'activity') return hasServerPerm('server.read');
 return true;
 });
 }, [
 canAdminWrite,
 hasServerPerm,
 isAdmin,
 modManagerConfig,
 pluginManagerConfig,
 ]);

 const filteredServerPluginTabs = useMemo(() => {
 return serverPluginTabs.filter((t) => {
 if (!t.requiredPermissions || t.requiredPermissions.length === 0) return true;
 // Server-scoped tabs: allow if global perms match OR any required perm is on the server
 if (hasAnyPermission(userPermissions, t.requiredPermissions)) return true;
 return t.requiredPermissions.some((p) => hasServerPerm(p));
 });
 }, [serverPluginTabs, userPermissions, hasServerPerm]);

 // ── Error state (fatal — don't render anything) ──
 if (isError) {
 return (
 <div className="flex items-center justify-center p-8">
 <div className="rounded-lg border border-danger/30 bg-danger-muted px-6 py-4 text-center">
 <p className="text-sm text-danger">Unable to load server details.</p>
 <div className="mt-3 flex items-center justify-center gap-2">
 <button
 onClick={() => refetch()}
 className="rounded-md border border-border/40 px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
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
 <div>
 <div className="space-y-4">
 {/* ── Header ── */}
 <div>
 <div className={`relative overflow-hidden rounded-2xl border backdrop-blur-sm ${
 isSuspended
 ? 'border-danger/20 bg-gradient-to-br from-danger/5 via-card/90 to-card/80'
 : server?.status === 'running'
 ? 'border-success/20 bg-gradient-to-br from-success/5 via-card/90 to-card/80'
 : 'border-border bg-card/80'
 }`}>
 {/* Subtle top accent */}
 <div className={`h-0.5 w-full ${
 isSuspended
 ? 'bg-gradient-to-r from-transparent via-danger/60 to-transparent'
 : server?.status === 'running'
 ? 'bg-gradient-to-r from-transparent via-success/60 to-transparent'
 : 'bg-gradient-to-r from-transparent via-muted-foreground/30 to-transparent'
 }`} />

 <div className="p-5">
 <div className="flex flex-wrap items-center justify-between gap-3">
 <div className="flex items-center gap-3 min-w-0">
 <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
 isSuspended
 ? 'border-danger/30 bg-danger/10 text-danger'
 : server?.status === 'running'
 ? 'border-success/30 bg-success/10 text-success'
 : 'border-border bg-surface-2 text-muted-foreground'
 }`}>
 <Terminal className="h-4.5 w-4.5" />
 </div>
 <div className="min-w-0">
 <div className="flex flex-wrap items-center gap-2.5">
 {isLoading ? (
 <div className="h-6 w-48 animate-pulse rounded-md bg-muted" />
 ) : server ? (
 <>
 <h1 className="font-display truncate text-xl font-bold tracking-tight text-foreground">
 {server.name}
 </h1>
 <ServerStatusBadge status={server.status} />
 </>
 ) : null}
 </div>
 <p className="mt-1 text-xs text-muted-foreground">
 {isLoading ? 'Loading…' : `${nodeLabel} · ${nodeIp}:${nodePort}`}
 </p>
 </div>
 </div>
 {server ? (
 <ServerControls
 serverId={server.id}
 status={server.status}
 permissions={server.effectivePermissions}
 />
 ) : (
 <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
 )}
 </div>

 {isSuspended && (
 <div className="mt-3 flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-muted px-3 py-2 text-xs text-danger">
 <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
 <span className="font-semibold">Suspended</span>
 {server?.suspensionReason && (
 <span className="text-danger/80">— {server.suspensionReason}</span>
 )}
 </div>
 )}
 {server?.status === 'cloning' && (
 <div className="mt-3 flex items-center gap-3 rounded-lg border border-info/30 bg-info-muted px-3 py-2 text-xs text-info">
 <Copy className="h-3.5 w-3.5 shrink-0 animate-pulse" />
 <span className="font-semibold">Cloning Files</span>
 <span className="text-info/80">— Server files are being copied from the source server. The server cannot be started until the copy completes.</span>
 <div className="ml-auto flex items-center gap-2">
 <div className="h-1.5 w-24 overflow-hidden rounded-full bg-info/20">
 <div className="h-full w-2/3 animate-pulse rounded-full bg-info/60" />
 </div>
 <span className="text-[10px] text-info/60">Copying...</span>
 </div>
 </div>
 )}
 </div>
 </div>
 </div>

 {/* ── Tab navigation ── */}
 <div className="flex flex-wrap gap-1 rounded-xl border border-border/40 bg-surface-2/40 p-1.5 ">
 {visibleTabs.map(([key, label]) => {
 const isActive = !isPluginTab && activeTab === key;
 const Icon = tabIcons[key as keyof typeof tabLabels];
 return (
 <button
 key={key}
 type="button"
 title={label}
 className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
 isActive
 ? 'bg-primary text-primary-foreground '
 : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground'
 }`}
 onClick={() => server && navigate(`/servers/${server.id}/${key}`)}
 >
 <Icon className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{label}</span>
 </button>
 );
 })}
 {filteredServerPluginTabs.map((ptab) => {
 const pluginTabKey = `plugin:${ptab.id}`;
 const isActive = tab === pluginTabKey;
 return (
 <button
 key={ptab.id}
 type="button"
 title={ptab.label}
 className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200 ${
 isActive
 ? 'bg-primary text-primary-foreground '
 : 'text-muted-foreground hover:bg-surface-2/60 hover:text-foreground'
 }`}
 onClick={() => server && navigate(`/servers/${server.id}/${pluginTabKey}`)}
 >
 <Plug className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{ptab.label}</span>
 </button>
 );
 })}
 </div>

 {/* ── Tab Content ── */}
 <div>
 <Suspense fallback={<TabSkeleton />}>
 {!isPluginTab && activeTab === 'console' && (
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

 {!isPluginTab && activeTab === 'files' && server && (
 <ServerTabCard>
 <FileManager
 serverId={server.id}
 isSuspended={isSuspended}
 canWrite={hasServerPerm('file.write')}
 />
 </ServerTabCard>
 )}

 {!isPluginTab && activeTab === 'sftp' && server && (
 <ServerSftpTab
 serverId={server.id}
 ownerId={server.ownerId ?? ''}
 currentUserId={user?.id}
 />
 )}

 {!isPluginTab && activeTab === 'backups' && server && (
 <ServerTabCard>
 <BackupSection
 serverId={server.id}
 serverStatus={server.status}
 isSuspended={isSuspended}
 />
 </ServerTabCard>
 )}

 {!isPluginTab && activeTab === 'tasks' && server && (
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

 {!isPluginTab && activeTab === 'databases' && server && (
 <ServerDatabasesTab
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

 {!isPluginTab && activeTab === 'metrics' && server && (
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

 {!isPluginTab && activeTab === 'alerts' && server && (
 <div className="space-y-4">
 <AlertsPage serverId={server.id} />
 </div>
 )}

 {!isPluginTab && activeTab === 'activity' && server && (
 <ServerActivityLogTab serverId={server.id} />
 )}

 {!isPluginTab && activeTab === 'modManager' && (
 <ServerModManagerTab
 serverId={serverId}
 serverGameVersion={serverGameVersion}
 modManagerConfig={modManagerConfig}
 />
 )}

 {!isPluginTab && activeTab === 'pluginManager' && (
 <ServerPluginManagerTab
 serverId={serverId}
 serverGameVersion={serverGameVersion}
 pluginManagerConfig={pluginManagerConfig}
 />
 )}

 {!isPluginTab && activeTab === 'users' && server && (
 <ServerUsersTab
 ownerId={server.ownerId ?? ''}
 inviteEmail={inviteEmail}
 onInviteEmailChange={setInviteEmail}
 invitePreset={invitePreset}
 onInvitePresetChange={setInvitePreset}
 invitePermissions={invitePermissions}
 onInvitePermissionsChange={setInvitePermissions}
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

 {!isPluginTab && activeTab === 'configuration' && server && (
 <ServerConfigurationTab
 serverId={serverId}
 isSuspended={isSuspended}
 canEdit={
 isAdmin ||
 canAdminWrite ||
 hasServerPerm('server.update') ||
 hasServerPerm('server.install') ||
 hasServerPerm('file.write')
 }
 server={server}
 startupCommand={startupCommand}
 onStartupCommandChange={setStartupCommand}
 startupCommandPending={startupCommandMutation.isPending}
 onSaveStartupCommand={() => startupCommandMutation.mutate()}
 onResetStartupCommand={handleResetStartupCommand}
 />
 )}

 {!isPluginTab && activeTab === 'admin' && server && (
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

 {!isPluginTab && activeTab === 'settings' && server && (
 <ServerSettingsTab
 serverId={server.id}
 serverName={serverName}
 onServerNameChange={setServerName}
 renamePending={renameServerMutation.isPending}
 onRename={() => renameServerMutation.mutate()}
 isSuspended={isSuspended}
 serverStatus={server.status}
 subdomain={server.subdomain ?? null}
 server={server}
 permissions={server.effectivePermissions}
 />
 )}
 {isPluginTab && server && activePluginTabId && (() => {
 const ptab = filteredServerPluginTabs.find((t) => t.id === activePluginTabId);
 if (!ptab) {
 return (
 <div className="rounded-lg border border-border bg-card p-12 text-center">
 <h2 className="mb-2 text-xl font-semibold text-foreground">Plugin Tab Not Found</h2>
 <p className="text-muted-foreground">
 The requested plugin tab could not be found or is not enabled.
 </p>
 </div>
 );
 }
 const TabComponent = ptab.component;
 const pluginName = ptab.id.replace(/-(admin|server)$/, '');
 return (
 <PluginErrorBoundary pluginName={pluginName}>
 <TabComponent serverId={server.id} />
 </PluginErrorBoundary>
 );
 })()}
 </Suspense>
 </div>
 </div>

 {eulaPrompt && (
 <EulaModal
 eulaText={eulaPrompt.eulaText}
 isLoading={eulaLoading}
 onAccept={() => respondEula(true)}
 onDecline={() => respondEula(false)}
 />
 )}
 </div>
 );
}

export default ServerDetailsPage;
