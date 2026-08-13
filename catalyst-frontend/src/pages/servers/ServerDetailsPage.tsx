import { useCallback, useMemo, useState, lazy, Suspense } from 'react';

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
import { useTasks, normalizeTasks } from '../../hooks/useTasks';
import { useServerDatabases } from '../../hooks/useServerDatabases';
import { useDatabaseHosts } from '../../hooks/useAdmin';
import { useAuthStore } from '../../stores/authStore';
import { useConsole } from '../../hooks/useConsole';
import { useEulaPrompt } from '../../hooks/useEulaPrompt';
import { useMutation, useQuery, useQueryClient } from '@/csync';
import { qk } from '../../lib/queryKeys';
import { serversApi } from '../../services/api/servers';
import { nodesApi } from '../../services/api/nodes';
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
import ServerHeaderStats from '../../components/servers/ServerHeaderStats';
import ServerTabBar, { type ServerNavTab } from '../../components/servers/ServerTabBar';

import ErrorBoundary from '../../components/shared/ErrorBoundary';
import FileManager from '../../components/files/FileManager';
import BackupSection from '../../components/backups/BackupSection';
import { usePluginTabs } from '../../plugins/hooks';
import PluginErrorBoundary from '../../plugins/PluginErrorBoundary';
import { hasAnyPermission } from '../../components/auth/ProtectedRoute';
import EulaModal from '../../components/servers/EulaModal';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import TabErrorState from '../../components/servers/tabs/TabErrorState';




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
 // Initial logs load is owned by useConsole/useQuery — do NOT refetch on every
 // render via an effect on refetchConsole (unstable deps caused /logs spam).

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
 const { data: tasksData, isLoading: tasksLoading } = useTasks(serverId);
 const tasks = normalizeTasks(tasksData);

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
 // Always coerce to arrays — `?? []` only covers undefined, not object cache shapes.
 const allocationsQuery = useQuery({
 queryKey: qk.serverAllocations(serverId ?? ''),
 queryFn: () => serversApi.allocations(serverId ?? ''),
 enabled: Boolean(serverId),
 staleTime: 30_000,
 refetchInterval: 60_000 /* allocation SSE not dense; safety */,
 select: (data) => (Array.isArray(data) ? data : []),
 });
 const allocations = Array.isArray(allocationsQuery.data) ? allocationsQuery.data : [];
 const allocationsError = allocationsQuery.error
 ? getErrorMessage(allocationsQuery.error, 'Unable to load allocations')
 : null;

 // Free node allocations for the server's node (dropdown options)
 const nodeIdForAllocations = server?.nodeId;
 const nodeAllocationsQuery = useQuery({
 queryKey: qk.adminNodeAllocations(nodeIdForAllocations ?? ''),
 queryFn: () => nodesApi.allocations(nodeIdForAllocations ?? ''),
 enabled: Boolean(nodeIdForAllocations),
 staleTime: 30_000,
 select: (data) => (Array.isArray(data) ? data : []),
 });
 const availableNodeAllocations = (
 Array.isArray(nodeAllocationsQuery.data) ? nodeAllocationsQuery.data : []
 ).filter((allocation) => !allocation.serverId);
 const availableNodeAllocationsError = nodeAllocationsQuery.error
 ? getErrorMessage(nodeAllocationsQuery.error, 'Unable to load node allocations')
 : null;

 // ── State: Settings ──
 const [serverName, setServerName] = useState('');

 // ── State: Admin ──
 const [suspendReason, setSuspendReason] = useState('');
 const [newContainerPort, setNewContainerPort] = useState('');
 const [selectedAllocationId, setSelectedAllocationId] = useState('');
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
 if (!selectedAllocationId) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'No allocation selected', metadata: { context: 'addAllocationMutation' } });
 throw new Error('Select a node allocation');
 }
 const selected = availableNodeAllocations.find((a) => a.id === selectedAllocationId);
 const containerPort = Number(newContainerPort || selected?.port);
 if (!Number.isFinite(containerPort) || containerPort <= 0 || containerPort > 65535) {
 reportSystemError({ level: 'error', component: 'ServerDetailsPage', message: 'Invalid container port', metadata: { context: 'addAllocationMutation' } });
 throw new Error('Invalid container port');
 }
 return serversApi.addAllocation(serverId, {
 allocationId: selectedAllocationId,
 containerPort,
 });
 },
 onSuccess: () => {
 setNewContainerPort('');
 setSelectedAllocationId('');
 notifySuccess('Allocation added');
 },
 onSettled: () => {
 if (serverId) {
 queryClient.invalidateQueries({ queryKey: qk.serverAllocations(serverId) });
 queryClient.invalidateQueries({ queryKey: qk.server(serverId) });
 }
 if (nodeIdForAllocations) {
 queryClient.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeIdForAllocations) });
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
 if (nodeIdForAllocations) {
 queryClient.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeIdForAllocations) });
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

  const navTabs = useMemo<ServerNavTab[]>(() => {
    const id = server?.id;
    const built: ServerNavTab[] = visibleTabs.map(([key, label]) => ({
      key,
      label,
      icon: tabIcons[key as keyof typeof tabLabels],
      active: !isPluginTab && activeTab === key,
      onSelect: () => {
        if (id) navigate(`/servers/${id}/${key}`);
      },
    }));
    for (const ptab of filteredServerPluginTabs) {
      const pluginTabKey = `plugin:${ptab.id}`;
      built.push({
        key: pluginTabKey,
        label: ptab.label,
        icon: Plug,
        active: tab === pluginTabKey,
        onSelect: () => {
          if (id) navigate(`/servers/${id}/${pluginTabKey}`);
        },
      });
    }
    return built;
  }, [
    visibleTabs,
    filteredServerPluginTabs,
    isPluginTab,
    activeTab,
    tab,
    server?.id,
    navigate,
  ]);

  if (isError) {
    return (
      <div className="flex items-center justify-center p-8">
        <TabErrorState
          message="Unable to load server details."
          onRetry={() => {
            void refetch();
          }}
        />
      </div>
    );
  }



 // ── Derived values (nullable while server is loading) ──
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

  const templateLabel = server?.template?.name;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className={`min-w-0 overflow-hidden rounded-lg border ${
        isSuspended
          ? 'border-danger/25 bg-danger/5'
          : server?.status === 'running'
            ? 'border-success/20 bg-success/5'
            : 'border-border/70 bg-card'
      }`}>

        <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
              isSuspended
                ? 'border-danger/30 bg-danger/10 text-danger'
                : server?.status === 'running'
                  ? 'border-success/30 bg-success/10 text-success'
                  : 'border-border bg-surface-2 text-muted-foreground'
            }`}>
              <Terminal className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              {isLoading ? (
                <div className="h-5 w-40 animate-pulse rounded-md bg-muted" />
              ) : server ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                      {server.name}
                    </h1>
                    <ServerStatusBadge
                      status={server.status}
                      operationStage={server.operationStage}
                      operationProgress={server.operationProgress}
                    />
                  </div>
                  <p className="type-meta mt-0.5 truncate">
                    {[templateLabel, serverGameVersion].filter(Boolean).join(' · ') || '—'}
                  </p>
                  <button
                    type="button"
                    className="type-meta mt-0.5 inline-flex items-center gap-1 font-mono hover:text-foreground"
                    onClick={() => {
                      void navigator.clipboard.writeText(`${nodeIp}:${nodePort}`).then(
                        () => notifySuccess('Copied address'),
                        () => notifyError('Failed to copy'),
                      );
                    }}
                  >
                    {nodeIp}:{nodePort}
                    <Copy className="h-3 w-3" />
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <ServerHeaderStats
            metrics={liveMetrics}
            allocatedMemoryMb={server?.allocatedMemoryMb}
            allocatedDiskMb={diskLimitMb}
          />

          <div className="ml-auto">
            {server ? (
              <ServerControls
                serverId={server.id}
                status={server.status}
                permissions={server.effectivePermissions}
              />
            ) : null}
          </div>
        </div>

        {isSuspended && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-danger/30 bg-danger-muted px-2.5 py-1 text-xs text-danger">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span className="font-semibold">Suspended</span>
            {server?.suspensionReason && <span className="text-danger/80">— {server.suspensionReason}</span>}
          </div>
        )}

        {server?.status === 'cloning' && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-md border border-info/30 bg-info-muted px-2.5 py-1 text-xs text-info">
            <Copy className="h-3.5 w-3.5 shrink-0 animate-pulse" />
            <span className="font-semibold">Cloning</span>
            <span className="text-info/80">Cannot start until copy completes.</span>
          </div>
        )}

        {isLoading && navTabs.length === 0 ? (
          <div className="flex items-center gap-0.5 border-t border-border/40 px-1.5 py-1">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-7 w-16 shrink-0 animate-pulse rounded-md bg-surface-3/60" />
            ))}
          </div>
        ) : (
          <ServerTabBar tabs={navTabs} />
        )}

      </div>



      <ErrorBoundary
        resetKey={tab ?? activeTab}
        fallback={
          <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 rounded-xl border border-border/40 bg-card px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">This tab hit an error</p>
            <p className="type-meta max-w-md">
              Switch tabs or retry. The rest of the server page stays usable.
            </p>
          </div>
        }
      >
        <div
          className={
            !isPluginTab && activeTab === 'console'
              ? 'flex min-h-0 flex-1 flex-col overflow-hidden'
              : 'min-h-0 flex-1 overflow-y-auto'
          }
        >


          <Suspense fallback={<TabSkeleton />}>
            {!isPluginTab && activeTab === 'console' && (
              <ServerConsoleTab
                liveMetrics={liveMetrics}
                liveDiskUsageMb={liveDiskUsageMb}
                liveDiskTotalMb={liveDiskTotalMb ?? diskLimitMb}
                allocatedMemoryMb={server?.allocatedMemoryMb}
                allocatedDiskMb={server?.allocatedDiskMb}
                isConnected={isConnected}
                streamStatus={streamStatus}
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
 availableNodeAllocations={availableNodeAllocations}
 availableNodeAllocationsError={availableNodeAllocationsError}
 selectedAllocationId={selectedAllocationId}
 onSelectedAllocationIdChange={setSelectedAllocationId}
 newContainerPort={newContainerPort}
 onNewContainerPortChange={setNewContainerPort}
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
 </ErrorBoundary>

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
