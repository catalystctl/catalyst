import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@/csync';
import { qk } from '@/lib/queryKeys';
import {
 Database,
 Plus,
 Settings,
 Trash2,
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
import { BracketLabel, StatusLed } from '../../components/deck/primitives';
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
import {
 Dialog,
 DialogBody,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';
import type { DbStatusResult } from '../../types/admin';

// ── Helpers ──
function formatBytes(bytes: number): string {
 if (bytes === 0) return '0 B';
 const k = 1024;
 const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
 const i = Math.floor(Math.log(bytes) / Math.log(k));
 return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ── Host dialog ──
function HostDialog({
 open,
 title,
 subtitle,
 children,
 footer,
 onOpenChange,
}: {
 open: boolean;
 title: string;
 subtitle: string;
 children: React.ReactNode;
 footer: React.ReactNode;
 onOpenChange: (open: boolean) => void;
}) {
 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent size="lg">
 <DialogHeader icon={<Database className="h-4 w-4" />}>
 <DialogTitle>{title}</DialogTitle>
 <DialogDescription>{subtitle}</DialogDescription>
 </DialogHeader>
 <DialogBody>{children}</DialogBody>
 <DialogFooter>{footer}</DialogFooter>
 </DialogContent>
 </Dialog>
 );
}

// ── Catalyst DB Status Card ──
function CatalystDbCard({ status }: { status?: DbStatusResult }) {
 const { t } = useTranslation('admin-infra');
 const connected = status?.connected ?? false;
 const statItems = connected && status
 ? [
 { label: t('database.stats.tables'), value: status.tableCount },
 { label: t('database.stats.size'), value: formatBytes(status.sizeBytes) },
 { label: t('database.stats.connections'), value: status.activeConnections },
 { label: t('database.stats.records'), value: t('database.recordsValue', { users: status.rowCounts.users, servers: status.rowCounts.servers }) },
 ]
 : [];

 return (
 <div className="deck-panel">
 <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
 <BracketLabel>{t('database.catalystDatabase')}</BracketLabel>
 <Badge variant="outline" className="font-mono text-micro">PostgreSQL</Badge>
 <span className="ml-auto flex items-center gap-2">
 {connected ? (
 <Badge variant="success" className="gap-1 text-micro">
 <CheckCircle2 className="h-2.5 w-2.5" /> {t('database.host.connected')}
 </Badge>
 ) : (
 <Badge variant="destructive" className="gap-1 text-micro">
 <XCircle className="h-2.5 w-2.5" /> {t('database.host.disconnected')}
 </Badge>
 )}
 {status?.latency != null && (
 <span className="font-mono text-micro tabular-nums text-muted-foreground">{status.latency}ms</span>
 )}
 </span>
 </div>

 <div className="p-3">
 {connected && status && statItems.length > 0 && (
 <StatGrid items={statItems} columns={4} />
 )}

 {!connected && status?.error && (
 <div className="truncate font-mono text-micro text-destructive/80">{status.error}</div>
 )}
 </div>
 </div>
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
 const { t } = useTranslation('admin-infra');
 const dbCount = host._count?.databases ?? 0;

 const { data: pingResult, isLoading: pingLoading, refetch: refetchPing, isFetching: pingFetching } = useDatabaseHostPing(host.id);

 const connected = pingResult?.connected;
 const pingLatency = pingResult?.latency;

 return (
 <div className="group flex items-start justify-between gap-3 px-3 py-2 transition-colors hover:bg-surface-1/40">
 <div className="flex min-w-0 flex-1 items-start gap-2.5">
 <StatusLed
 tone={connected === true ? 'go' : connected === false ? 'alarm' : 'idle'}
 className="mt-1.5"
 />
 <div className="min-w-0 flex-1">
 <div className="flex flex-wrap items-center gap-2">
 <span className="font-display text-data font-semibold text-foreground">{host.name}</span>
 {connected === true && (
 <Badge variant="success" className="gap-1 text-micro">
 <CheckCircle2 className="h-2.5 w-2.5" /> {t('common:status.online')}
 </Badge>
 )}
 {connected === false && (
 <Badge variant="destructive" className="gap-1 text-micro">
 <XCircle className="h-2.5 w-2.5" /> {t('common:status.offline')}
 </Badge>
 )}
 {pingLoading && (
 <Badge variant="outline" className="gap-1 text-micro">
 <Loader2 className="h-2.5 w-2.5 animate-spin" /> {t('database.host.checking')}
 </Badge>
 )}
 </div>
 <div className="mt-0.5 font-mono text-mini tabular-nums text-muted-foreground">{host.host}:{host.port}</div>
 <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground">
 <Badge variant="outline" className="font-mono text-micro">
 {host.engine === 'postgresql' ? 'PostgreSQL' : 'MySQL'}
 </Badge>
 <span className="flex items-center gap-1">
 <User className="h-3 w-3" />
 {host.username}
 </span>
 <span className="flex items-center gap-1">
 <Hash className="h-3 w-3" />
 {t('database.host.port', { port: host.port })}
 </span>
 {dbCount > 0 && (
 <span className="flex items-center gap-1">
 <Database className="h-3 w-3" />
 {t('database.host.databaseCount', { count: dbCount })}
 </span>
 )}
 {pingLatency != null && connected === true && (
 <span className="font-mono tabular-nums">{pingLatency}ms</span>
 )}
 </div>

 {/* Connection details */}
 {connected === true && pingResult && (
 <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-muted-foreground">
 {pingResult.version && (
 <span className="flex items-center gap-1">
 {(pingResult.engine === 'postgresql' || host.engine === 'postgresql') ? 'PostgreSQL' : 'MySQL'} v{pingResult.version.split(',')[0]}
 </span>
 )}
 {pingResult.databaseCount != null && (
 <span>{t('database.host.pingCounts', { databases: pingResult.databaseCount, tables: pingResult.tableCount })}</span>
 )}
 </div>
 )}
 {connected === false && pingResult?.error && (
 <div className="mt-1 truncate font-mono text-micro text-destructive/80" title={pingResult.error}>
 {pingResult.error}
 </div>
 )}
 </div>
 </div>

 <div className="flex shrink-0 items-center gap-1 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-primary disabled:pointer-events-none disabled:opacity-30"
 onClick={() => refetchPing()}
 disabled={pingFetching}
 title={t('database.host.testConnection')}
 >
 <RefreshCw className={`h-3.5 w-3.5 ${pingFetching ? 'animate-spin' : ''}`} />
 </button>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-primary"
 onClick={onEdit}
 title={t('common:actions.edit')}
 >
 <Settings className="h-3.5 w-3.5" />
 </button>
 <button
 className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/5 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
 onClick={onDelete}
 disabled={isDeleting}
 title={t('common:actions.delete')}
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </div>
 </div>
 );
}

// ── Main Page ──
function DatabasePage() {
 const { t } = useTranslation('admin-infra');
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
 notifySuccess(t('database.toast.created'));
 resetForm();
 setIsCreateOpen(false);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminDatabaseHosts() });
 },
 onError: (error: any) => notifyError(error),
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
 notifySuccess(t('database.toast.updated'));
 setEditingHost(null);
 resetForm();
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminDatabaseHosts() });
 },
 onError: (error: any) => notifyError(error),
 });

 const deleteMutation = useMutation({
 mutationKey: qk.mutation.adminDatabaseHostDelete(),
 mutationFn: (hostId: string) => adminApi.deleteDatabaseHost(hostId),
 onSuccess: () => {
 notifySuccess(t('database.toast.removed'));
 setDeletingHost(null);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminDatabaseHosts() });
 },
 onError: (error: any) => notifyError(error),
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
 <span className="type-overline flex items-center gap-1">
 <Database className="h-3 w-3" /> {t('database.form.name')}
 </span>
 <Input
 value={dbName}
 onChange={(e) => setDbName(e.target.value)}
 placeholder="primary-mysql"
 className="h-8 rounded-sm border-border/40 bg-card text-mini"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Globe className="h-3 w-3" /> {t('database.form.host')}
 </span>
 <Input
 value={dbHost}
 onChange={(e) => setDbHost(e.target.value)}
 placeholder="mysql.internal"
 className="h-8 rounded-sm border-border/40 bg-card text-mini"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Hash className="h-3 w-3" /> {t('database.form.port')}
 </span>
 <Input
 value={dbPort}
 onChange={(e) => setDbPort(e.target.value)}
 placeholder={dbEngine === 'postgresql' ? '5432' : '3306'}
 className="h-8 rounded-sm border-border/40 bg-card text-mini"
 />
 </label>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <User className="h-3 w-3" /> {t('database.form.username')}
 </span>
 <Input
 value={dbUsername}
 onChange={(e) => setDbUsername(e.target.value)}
 placeholder="catalyst_admin"
 className="h-8 rounded-sm border-border/40 bg-card text-mini"
 />
 </label>
 </div>
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Database className="h-3 w-3" /> {t('database.form.engine')}
 </span>
 <div className="flex gap-2">
 <button
 type="button"
 onClick={() => { setDbEngine('mysql'); setDbPort('3306'); }}
 className={`h-8 flex-1 rounded-sm border px-3 text-mini font-medium transition-colors ${
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
 className={`h-8 flex-1 rounded-sm border px-3 text-mini font-medium transition-colors ${
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
 <span className="type-overline flex items-center gap-1">
 <Database className="h-3 w-3" /> {t('database.form.database')}
 </span>
 <Input
 value={dbDatabase}
 onChange={(e) => setDbDatabase(e.target.value)}
 placeholder="postgres"
 className="h-8 rounded-sm border-border/40 bg-card text-mini"
 />
 <span className="text-micro text-muted-foreground">{t('database.form.databaseHint')}</span>
 </label>
 )}
 <label className="block space-y-1">
 <span className="type-overline flex items-center gap-1">
 <Shield className="h-3 w-3" /> {t('database.form.password')}{editingHost ? t('database.form.passwordEditHint') : ''}
 </span>
 <Input
 type="password"
 autoComplete={editingHost ? 'current-password' : 'new-password'}
 value={dbPassword}
 onChange={(e) => setDbPassword(e.target.value)}
 placeholder="••••••••"
 className="h-8 rounded-sm border-border/40 bg-card text-mini"
 />
 </label>
 </div>
 );

 return (
 <div className="space-y-5">
 {/* ── Header ── */}
  <TabHeader
    icon={Database}
    title={t('database.title')}
    variant="success"
    description={t('database.description')}
    actions={
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => { resetForm(); setIsCreateOpen(true); }}
          className="h-8 gap-1.5 px-3 text-mini"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('database.addHost')}
        </Button>
      </div>
    }
  />

 {/* ── Catalyst DB Status ── */}
 <CatalystDbCard status={dbStatus} />

 {/* ── Hosts ── */}
 <div className="deck-panel">
 <div className="flex items-center border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
 <BracketLabel>{t('database.hostCount', { value: databaseHosts.length })}</BracketLabel>
 </div>
 {isLoading ? (
 <div className="p-3">
 <TabLoadingState rows={1} rowHeight="h-16" />
 </div>
 ) : databaseHosts.length === 0 ? (
 <TabEmptyState
 title={t('database.empty.title')}
 description={t('database.empty.description')}
 action={
 <Button
 size="sm"
 onClick={() => { resetForm(); setIsCreateOpen(true); }}
 className="h-8 gap-1.5 px-3 text-mini"
 >
 <Plus className="h-3.5 w-3.5" />
 {t('database.addHost')}
 </Button>
 }
 />
 ) : (
 <div className="divide-y divide-border/40">
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
 </div>

 {/* ── Create Modal ── */}
 <HostDialog
 open={isCreateOpen}
 onOpenChange={(next) => {
 if (!next) {
 resetForm();
 setIsCreateOpen(false);
 }
 }}
    title={t('database.createDialog.title')}
    subtitle={t('database.createDialog.subtitle')}
    footer={
      <>
        <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => { resetForm(); setIsCreateOpen(false); }}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          size="sm"
          className="h-8 px-3 text-mini"
          disabled={!canSubmit || createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          {createMutation.isPending ? t('database.creating') : t('database.createDialog.submit')}
        </Button>
      </>
    }
 >
 {formFields}
 </HostDialog>

 {/* ── Edit Modal ── */}
 <HostDialog
 open={!!editingHost}
 onOpenChange={(next) => {
 if (!next) {
 setEditingHost(null);
 resetForm();
 }
 }}
    title={t('database.editDialog.title')}
    subtitle={t('database.editDialog.subtitle')}
    footer={
      <>
        <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={() => { setEditingHost(null); resetForm(); }}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          size="sm"
          className="h-8 px-3 text-mini"
          disabled={updateMutation.isPending}
          onClick={() => editingHost && updateMutation.mutate({ hostId: editingHost.id })}
        >
          {updateMutation.isPending ? t('database.saving') : t('database.editDialog.submit')}
        </Button>
      </>
    }
 >
 {formFields}
 </HostDialog>

 {/* ── Delete Confirmation ── */}
 <ConfirmDialog
 open={!!deletingHost}
 title={t('database.deleteDialog.title')}
 message={t('database.deleteDialog.message', { name: deletingHost?.name })}
 confirmText={t('common:actions.delete')}
 cancelText={t('common:actions.cancel')}
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
