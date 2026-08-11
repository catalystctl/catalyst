import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@/csync';
import { qk } from '@/lib/queryKeys';
import {
 Database,
 Plus,
 Settings,
 Trash2,
 Server,
 Shield,
 Globe,
 Hash,
 User,
 CheckCircle2,
 XCircle,
 RefreshCw,
 Loader2,
} from 'lucide-react';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import StatGrid from '../../components/servers/tabs/StatGrid';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import { Input } from '../../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useDatabaseHosts, useDatabaseHostPing, useDbStatus } from '../../hooks/useAdmin';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { ModalPortal } from '@/components/ui/modal-portal';
import type { DbStatusResult } from '../../types/admin';

// ── Helpers ──
function formatBytes(bytes: number): string {
 if (bytes === 0) return '0 B';
 const k = 1024;
 const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
 const i = Math.floor(Math.log(bytes) / Math.log(k));
 return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Modal Shell ──
function ModalShell({
 open, title, subtitle, children, footer,
}: {
 open: boolean;
 title: string;
 subtitle?: string;
 children: React.ReactNode;
 footer?: React.ReactNode;
}) {
 if (!open) return null;
 return (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
 <div className="mx-4 w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
 <div className="border-b border-border px-6 py-4">
 <h2 className="text-lg font-semibold text-foreground">{title}</h2>
 {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
 </div>
 <div className="px-6 py-5">{children}</div>
 {footer && (
 <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
 {footer}
 </div>
 )}
 </div>
 </div>
 </ModalPortal>
 );
}

// ── Catalyst DB Status Card ──
function CatalystDbCard({ status }: { status?: DbStatusResult }) {
 const connected = status?.connected ?? false;
 const statItems = connected && status
 ? [
 { label: 'Tables', value: status.tableCount },
 { label: 'Size', value: formatBytes(status.sizeBytes) },
 { label: 'Connections', value: status.activeConnections },
 { label: 'Records', value: `${status.rowCounts.users} users, ${status.rowCounts.servers} servers` },
 ]
 : [];

 return (
 <ServerTabCard>
 <div className="flex items-start justify-between gap-3">
 <div className="flex items-start gap-3 min-w-0 flex-1">
 <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
 <Database className="h-4 w-4 text-primary" />
 </div>
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2">
 <span className="font-semibold text-foreground">Catalyst Database</span>
 <Badge variant="outline" className="text-[10px] px-1.5 py-0">PostgreSQL</Badge>
 </div>
 <div className="mt-1 flex items-center gap-2">
 {connected ? (
 <Badge variant="success" className="gap-1 text-[10px] px-1.5 py-0">
 <CheckCircle2 className="h-2.5 w-2.5" /> Connected
 </Badge>
 ) : (
 <Badge variant="destructive" className="gap-1 text-[10px] px-1.5 py-0">
 <XCircle className="h-2.5 w-2.5" /> Disconnected
 </Badge>
 )}
 {status?.latency != null && (
 <span className="text-[11px] text-muted-foreground tabular-nums">{status.latency}ms</span>
 )}
 </div>
 </div>
 </div>
 </div>

 {connected && status && statItems.length > 0 && (
 <div className="mt-4">
 <StatGrid items={statItems} columns={4} />
 </div>
 )}

 {!connected && status?.error && (
 <div className="mt-2 text-[11px] text-destructive/80 truncate">{status.error}</div>
 )}
 </ServerTabCard>
 );
}

// ── Host Card ──
function HostCard({
 host,
 onEdit,
 onDelete,
 isDeleting,
}: {
 host: any;
 onEdit: () => void;
 onDelete: () => void;
 isDeleting: boolean;
}) {
 const dbCount = host._count?.databases ?? 0;

 const { data: pingResult, isLoading: pingLoading, refetch: refetchPing, isFetching: pingFetching } = useDatabaseHostPing(host.id);

 const connected = pingResult?.connected;
 const pingLatency = pingResult?.latency;

 return (
 <ServerTabCard>
 <div className="flex items-start justify-between gap-3">
 <div className="flex items-start gap-3 min-w-0 flex-1">
 <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
 connected === true
 ? 'bg-success/10'
 : connected === false
 ? 'bg-destructive/10'
 : 'bg-muted'
 }`}>
 <Server className={`h-4 w-4 ${
 connected === true
 ? 'text-success'
 : connected === false
 ? 'text-destructive'
 : 'text-muted-foreground'
 }`} />
 </div>
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-2">
 <span className="font-semibold text-foreground">{host.name}</span>
 {connected === true && (
 <Badge variant="success" className="gap-1 text-[10px] px-1.5 py-0">
 <CheckCircle2 className="h-2.5 w-2.5" /> Online
 </Badge>
 )}
 {connected === false && (
 <Badge variant="destructive" className="gap-1 text-[10px] px-1.5 py-0">
 <XCircle className="h-2.5 w-2.5" /> Offline
 </Badge>
 )}
 {pingLoading && (
 <Badge variant="outline" className="gap-1 text-[10px] px-1.5 py-0">
 <Loader2 className="h-2.5 w-2.5 animate-spin" /> Checking
 </Badge>
 )}
 </div>
 <div className="mt-0.5 text-xs text-muted-foreground font-mono">{host.host}:{host.port}</div>
 <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
 <Badge variant="outline" className="text-[10px] px-1.5 py-0">
 {host.engine === 'postgresql' ? 'PostgreSQL' : 'MySQL'}
 </Badge>
 <span className="flex items-center gap-1">
 <User className="h-3 w-3" />
 {host.username}
 </span>
 <span className="flex items-center gap-1">
 <Hash className="h-3 w-3" />
 Port {host.port}
 </span>
 {dbCount > 0 && (
 <span className="flex items-center gap-1">
 <Database className="h-3 w-3" />
 {dbCount} DB{dbCount !== 1 ? 's' : ''}
 </span>
 )}
 {pingLatency != null && connected === true && (
 <span className="tabular-nums">{pingLatency}ms</span>
 )}
 </div>

 {/* Connection details */}
 {connected === true && pingResult && (
 <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
 {pingResult.version && (
 <span className="flex items-center gap-1">
 {(pingResult.engine === 'postgresql' || host.engine === 'postgresql') ? 'PostgreSQL' : 'MySQL'} v{pingResult.version.split(',')[0]}
 </span>
 )}
 {pingResult.databaseCount != null && (
 <span>{pingResult.databaseCount} DBs, {pingResult.tableCount} tables</span>
 )}
 </div>
 )}
 {connected === false && pingResult?.error && (
 <div className="mt-2 text-[11px] text-destructive/80 truncate" title={pingResult.error}>
 {pingResult.error}
 </div>
 )}
 </div>
 </div>

 <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-30"
 onClick={() => refetchPing()}
 disabled={pingFetching}
 title="Test connection"
 >
 <RefreshCw className={`h-3.5 w-3.5 ${pingFetching ? 'animate-spin' : ''}`} />
 </button>
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary"
 onClick={onEdit}
 title="Edit"
 >
 <Settings className="h-3.5 w-3.5" />
 </button>
 <button
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
 onClick={onDelete}
 disabled={isDeleting}
 title="Delete"
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </div>
 </div>
 </ServerTabCard>
 );
}

// ── Main Page ──
function DatabasePage() {
 const { data: databaseHosts = [], isLoading } = useDatabaseHosts();
 const { data: dbStatus } = useDbStatus();
 const queryClient = useQueryClient();

 const [isCreateOpen, setIsCreateOpen] = useState(false);
 const [editingHost, setEditingHost] = useState<any>(null);
 const [deletingHost, setDeletingHost] = useState<any>(null);

 // Form state (shared between create & edit)
 const [dbName, setDbName] = useState('');
 const [dbHost, setDbHost] = useState('');
 const [dbPort, setDbPort] = useState('3306');
 const [dbUsername, setDbUsername] = useState('');
 const [dbPassword, setDbPassword] = useState('');
 const [dbEngine, setDbEngine] = useState<'mysql' | 'postgresql'>('mysql');
 const [dbDatabase, setDbDatabase] = useState('postgres');

 const resetForm = () => {
 setDbName('');
 setDbHost('');
 setDbPort('3306');
 setDbUsername('');
 setDbPassword('');
 setDbEngine('mysql');
 setDbDatabase('postgres');
 };

 const canSubmit = useMemo(
 () => dbName.trim() && dbHost.trim() && dbUsername.trim() && dbPassword.trim(),
 [dbName, dbHost, dbUsername, dbPassword],
 );

 const createMutation = useMutation({
 mutationKey: qk.mutation.adminDatabaseHostCreate(),
 mutationFn: () =>
 adminApi.createDatabaseHost({
 name: dbName.trim(),
 host: dbHost.trim(),
 port: dbPort ? Number(dbPort) : undefined,
 username: dbUsername.trim(),
 password: dbPassword,
 engine: dbEngine,
 database: dbDatabase || undefined,
 }),
 onSuccess: () => {
 notifySuccess('Database host created');
 resetForm();
 setIsCreateOpen(false);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminDatabaseHosts() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to create database host'),
 });

 const updateMutation = useMutation({
 mutationKey: qk.mutation.adminDatabaseHostUpdate(),
 mutationFn: (payload: { hostId: string }) =>
 adminApi.updateDatabaseHost(payload.hostId, {
 name: dbName.trim(),
 host: dbHost.trim(),
 port: dbPort ? Number(dbPort) : undefined,
 username: dbUsername.trim(),
 password: dbPassword || undefined,
 engine: dbEngine,
 database: dbDatabase || undefined,
 }),
 onSuccess: () => {
 notifySuccess('Database host updated');
 setEditingHost(null);
 resetForm();
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminDatabaseHosts() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update database host'),
 });

 const deleteMutation = useMutation({
 mutationKey: qk.mutation.adminDatabaseHostDelete(),
 mutationFn: (hostId: string) => adminApi.deleteDatabaseHost(hostId),
 onSuccess: () => {
 notifySuccess('Database host removed');
 setDeletingHost(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminDatabaseHosts() });
 },
 onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to delete database host'),
 });

 const startEdit = (host: any) => {
 setEditingHost(host);
 setDbName(host.name);
 setDbHost(host.host);
 setDbPort(String(host.port));
 setDbUsername(host.username);
 setDbPassword(host.password || '');
 setDbEngine(host.engine === 'postgresql' ? 'postgresql' : 'mysql');
 setDbDatabase(host.database || 'postgres');
 };

 // Shared form fields
 const formFields = (
 <div className="space-y-4">
 <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Database className="h-3 w-3" /> Name
 </span>
 <Input
 value={dbName}
 onChange={(e) => setDbName(e.target.value)}
 placeholder="primary-mysql"
 className="border-border/40 bg-card"
 />
 </label>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Globe className="h-3 w-3" /> Host
 </span>
 <Input
 value={dbHost}
 onChange={(e) => setDbHost(e.target.value)}
 placeholder="mysql.internal"
 className="border-border/40 bg-card"
 />
 </label>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Hash className="h-3 w-3" /> Port
 </span>
 <Input
 value={dbPort}
 onChange={(e) => setDbPort(e.target.value)}
 placeholder={dbEngine === 'postgresql' ? '5432' : '3306'}
 className="border-border/40 bg-card"
 />
 </label>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <User className="h-3 w-3" /> Username
 </span>
 <Input
 value={dbUsername}
 onChange={(e) => setDbUsername(e.target.value)}
 placeholder="catalyst_admin"
 className="border-border/40 bg-card"
 />
 </label>
 </div>
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Database className="h-3 w-3" /> Engine
 </span>
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => { setDbEngine('mysql'); setDbPort('3306'); }}
 className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
 dbEngine === 'mysql'
 ? 'border-primary bg-primary/10 text-primary'
 : 'border-border/40 bg-card text-muted-foreground hover:bg-muted'
 }`}
 >
 MySQL
 </button>
 <button
 type="button"
 onClick={() => { setDbEngine('postgresql'); setDbPort('5432'); }}
 className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
 dbEngine === 'postgresql'
 ? 'border-primary bg-primary/10 text-primary'
 : 'border-border/40 bg-card text-muted-foreground hover:bg-muted'
 }`}
 >
 PostgreSQL
 </button>
 </div>
 </label>
 {dbEngine === 'postgresql' && (
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Database className="h-3 w-3" /> Database
 </span>
 <Input
 value={dbDatabase}
 onChange={(e) => setDbDatabase(e.target.value)}
 placeholder="postgres"
 className="border-border/40 bg-card"
 />
 <span className="text-[10px] text-muted-foreground">The database to connect to for health checks and provisioning.</span>
 </label>
 )}
 <label className="block space-y-1">
 <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
 <Shield className="h-3 w-3" /> Password{editingHost ? ' (leave blank to keep)' : ''}
 </span>
 <Input
 type="password"
 value={dbPassword}
 onChange={(e) => setDbPassword(e.target.value)}
 placeholder="••••••••"
 className="border-border/40 bg-card"
 />
 </label>
 </div>
 );

 return (
 <div className="space-y-5">
 {/* ── Header ── */}
 <TabHeader
 icon={Database}
 title="Database"
 variant="success"
 description="Monitor database health and manage hosts for server provisioning."
 actions={
 <div className="flex items-center gap-2">
 <Badge variant="outline" className="text-xs">
 {databaseHosts.length} hosts
 </Badge>
 <Button
 size="sm"
 onClick={() => { resetForm(); setIsCreateOpen(true); }}
 className="gap-1.5"
 >
 <Plus className="h-3.5 w-3.5" />
 Add host
 </Button>
 </div>
 }
 />

 {/* ── Catalyst DB Status ── */}
 <CatalystDbCard status={dbStatus} />

 {/* ── Host Grid ── */}
 {isLoading ? (
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
 {[1, 2, 3].map((i) => (
 <ServerTabCard key={i}>
 <TabLoadingState rows={1} rowHeight="h-16" />
 </ServerTabCard>
 ))}
 </div>
 ) : databaseHosts.length === 0 ? (
 <TabEmptyState
 title="No database hosts yet"
 description="Create a host to provision databases for servers."
 action={
 <Button
 size="sm"
 onClick={() => { resetForm(); setIsCreateOpen(true); }}
 className="gap-1.5"
 >
 <Plus className="h-3.5 w-3.5" />
 Add host
 </Button>
 }
 />
 ) : (
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
 {databaseHosts.map((host: any) => (
 <HostCard
 key={host.id}
 host={host}
 onEdit={() => startEdit(host)}
 onDelete={() => setDeletingHost(host)}
 isDeleting={deleteMutation.isPending}
 />
 ))}
 </div>
 )}

 {/* ── Create Modal ── */}
 <ModalShell
 open={isCreateOpen}
 title="Add database host"
 subtitle="Register a MySQL host used to provision per-server databases."
 footer={
 <>
 <Button variant="outline" size="sm" onClick={() => { resetForm(); setIsCreateOpen(false); }}>
 Cancel
 </Button>
 <Button
 size="sm"
 disabled={!canSubmit || createMutation.isPending}
 onClick={() => createMutation.mutate()}
 className=""
 >
 {createMutation.isPending ? 'Creating…' : 'Create host'}
 </Button>
 </>
 }
 >
 {formFields}
 </ModalShell>

 {/* ── Edit Modal ── */}
 <ModalShell
 open={!!editingHost}
 title="Edit database host"
 subtitle="Update connection details for this database host."
 footer={
 <>
 <Button variant="outline" size="sm" onClick={() => { setEditingHost(null); resetForm(); }}>
 Cancel
 </Button>
 <Button
 size="sm"
 disabled={updateMutation.isPending}
 onClick={() => editingHost && updateMutation.mutate({ hostId: editingHost.id })}
 className=""
 >
 {updateMutation.isPending ? 'Saving…' : 'Save changes'}
 </Button>
 </>
 }
 >
 {formFields}
 </ModalShell>

 {/* ── Delete Confirmation ── */}
 <ConfirmDialog
 open={!!deletingHost}
 title="Delete database host?"
 message={`Are you sure you want to remove "${deletingHost?.name}"? Servers using this host for database provisioning may be affected.`}
 confirmText="Delete"
 cancelText="Cancel"
 variant="danger"
 loading={deleteMutation.isPending}
 onConfirm={() => {
 if (deletingHost) {
 deleteMutation.mutate(deletingHost.id, {
 onSuccess: () => setDeletingHost(null),
 });
 }
 }}
 onCancel={() => setDeletingHost(null)}
 />
 </div>
 );
}

export default DatabasePage;
