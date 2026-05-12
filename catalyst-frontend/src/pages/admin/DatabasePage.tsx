import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { motion, type Variants } from 'framer-motion';
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
  Layers,
  HardDrive,
  Cable,
  Table2,
} from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '../../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useDatabaseHosts, useDatabaseHostPing, useDbStatus } from '../../hooks/useAdmin';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import { ModalPortal } from '@/components/ui/modal-portal';
import type { DatabaseHostPingResult, DbStatusResult } from '../../types/admin';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

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
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="mx-4 w-full max-w-lg rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold text-foreground ">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            {footer}
          </div>
        )}
      </motion.div>
    </div>
    </ModalPortal>
  );
}

// ── Catalyst DB Status Card ──
function CatalystDbCard({ status }: { status?: DbStatusResult }) {
  const connected = status?.connected ?? false;
  return (
    <motion.div
      variants={itemVariants}
      className="group relative overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
    >
      {/* Decorative gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/5 via-cyan-500/3 to-transparent pointer-events-none" />

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 dark:bg-violet-500/20">
              <Database className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground dark:text-foreground">Catalyst Database</span>
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

        {connected && status && (
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Table2 className="h-3 w-3 shrink-0" />
              <span>{status.tableCount} tables</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <HardDrive className="h-3 w-3 shrink-0" />
              <span>{formatBytes(status.sizeBytes)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Cable className="h-3 w-3 shrink-0" />
              <span>{status.activeConnections} connections</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Layers className="h-3 w-3 shrink-0" />
              <span>{status.rowCounts.users} users, {status.rowCounts.servers} servers, {status.rowCounts.nodes} nodes</span>
            </div>
          </div>
        )}

        {!connected && status?.error && (
          <div className="mt-2 text-[11px] text-destructive/80 truncate">{status.error}</div>
        )}
      </div>
    </motion.div>
  );
}

// ── Host Card ──
function HostCard({
  host,
  onEdit,
  onDelete,
  isDeleting,
  index,
}: {
  host: any;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  index: number;
}) {
  const dbCount = host._count?.databases ?? 0;

  const { data: pingResult, isLoading: pingLoading, refetch: refetchPing, isFetching: pingFetching } = useDatabaseHostPing(host.id);

  const connected = pingResult?.connected;
  const pingLatency = pingResult?.latency;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24, delay: index * 0.03 }}
      className="group relative overflow-hidden rounded-xl border border-border bg-card/80 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              connected === true
                ? 'bg-success/10 dark:bg-success/20'
                : connected === false
                  ? 'bg-destructive/10 dark:bg-destructive/20'
                  : 'bg-muted dark:bg-muted/50'
            }`}>
              <Server className={`h-4 w-4 ${
                connected === true
                  ? 'text-success dark:text-success'
                  : connected === false
                    ? 'text-destructive dark:text-destructive'
                    : 'text-muted-foreground'
              }`} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground dark:text-foreground">{host.name}</span>
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
      </div>
    </motion.div>
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

  const resetForm = () => {
    setDbName('');
    setDbHost('');
    setDbPort('3306');
    setDbUsername('');
    setDbPassword('');
    setDbEngine('mysql');
  };

  const canSubmit = useMemo(
    () => dbName.trim() && dbHost.trim() && dbUsername.trim() && dbPassword.trim(),
    [dbName, dbHost, dbUsername, dbPassword],
  );

  const createMutation = useMutation({
    mutationKey: ['admin-database-host-create'],
    mutationFn: () =>
      adminApi.createDatabaseHost({
        name: dbName.trim(),
        host: dbHost.trim(),
        port: dbPort ? Number(dbPort) : undefined,
        username: dbUsername.trim(),
        password: dbPassword,
        engine: dbEngine,
      }),
    onSuccess: () => {
      notifySuccess('Database host created');
      queryClient.invalidateQueries({ queryKey: qk.adminDatabaseHosts() });
      resetForm();
      setIsCreateOpen(false);
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to create database host'),
  });

  const updateMutation = useMutation({
    mutationKey: ['admin-database-host-update'],
    mutationFn: (payload: { hostId: string }) =>
      adminApi.updateDatabaseHost(payload.hostId, {
        name: dbName.trim(),
        host: dbHost.trim(),
        port: dbPort ? Number(dbPort) : undefined,
        username: dbUsername.trim(),
        password: dbPassword || undefined,
        engine: dbEngine,
      }),
    onSuccess: () => {
      notifySuccess('Database host updated');
      queryClient.invalidateQueries({ queryKey: qk.adminDatabaseHosts() });
      setEditingHost(null);
      resetForm();
    },
    onError: (error: any) => notifyError(error?.response?.data?.error || 'Failed to update database host'),
  });

  const deleteMutation = useMutation({
    mutationKey: ['admin-database-host-delete'],
    mutationFn: (hostId: string) => adminApi.deleteDatabaseHost(hostId),
    onSuccess: () => {
      notifySuccess('Database host removed');
      queryClient.invalidateQueries({ queryKey: qk.adminDatabaseHosts() });
      setDeletingHost(null);
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
  };

  // Shared form fields
  const formFields = (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Database className="h-3 w-3" /> Name
          </span>
          <Input value={dbName} onChange={(e) => setDbName(e.target.value)} placeholder="primary-mysql" />
        </label>
        <label className="block space-y-1">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Globe className="h-3 w-3" /> Host
          </span>
          <Input value={dbHost} onChange={(e) => setDbHost(e.target.value)} placeholder="mysql.internal" />
        </label>
        <label className="block space-y-1">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <Hash className="h-3 w-3" /> Port
          </span>
          <Input value={dbPort} onChange={(e) => setDbPort(e.target.value)} placeholder={dbEngine === 'postgresql' ? '5432' : '3306'} />
        </label>
        <label className="block space-y-1">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <User className="h-3 w-3" /> Username
          </span>
          <Input value={dbUsername} onChange={(e) => setDbUsername(e.target.value)} placeholder="catalyst_admin" />
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
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
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
                : 'border-border bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            PostgreSQL
          </button>
        </div>
      </label>
      <label className="block space-y-1">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Shield className="h-3 w-3" /> Password{editingHost ? ' (leave blank to keep)' : ''}
        </span>
        <Input type="password" value={dbPassword} onChange={(e) => setDbPassword(e.target.value)} placeholder="••••••••" />
      </label>
    </div>
  );

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-emerald-500/8 to-teal-500/8 blur-3xl dark:from-emerald-500/15 dark:to-teal-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-blue-500/8 to-indigo-500/8 blur-3xl dark:from-blue-500/15 dark:to-indigo-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-500 opacity-20 blur-sm" />
                <Database className="relative h-7 w-7 text-success dark:text-success" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground ">
                Database
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Monitor database health and manage hosts for server provisioning.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {databaseHosts.length} hosts
            </Badge>
            <Button size="sm" onClick={() => { resetForm(); setIsCreateOpen(true); }} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add host
            </Button>
          </div>
        </motion.div>

        {/* ── Catalyst DB Status ── */}
        <CatalystDbCard status={dbStatus} />

        {/* ── Host Grid ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card/80 p-5">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-3" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-28 animate-pulse rounded bg-surface-3" />
                    <div className="h-3 w-40 animate-pulse rounded bg-surface-2 font-mono" />
                    <div className="flex gap-3">
                      <div className="h-3 w-20 animate-pulse rounded bg-surface-2" />
                      <div className="h-3 w-16 animate-pulse rounded bg-surface-2" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        ) : databaseHosts.length === 0 ? (
          <motion.div variants={itemVariants}>
            <EmptyState
              title="No database hosts yet"
              description="Create a host to provision databases for servers."
              action={
                <Button size="sm" onClick={() => { resetForm(); setIsCreateOpen(true); }} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  Add host
                </Button>
              }
            />
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {databaseHosts.map((host: any, i: number) => (
              <HostCard
                key={host.id}
                host={host}
                index={i}
                onEdit={() => startEdit(host)}
                onDelete={() => setDeletingHost(host)}
                isDeleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Create Modal ── */}
      <ModalShell
        open={isCreateOpen}
        onClose={() => { resetForm(); setIsCreateOpen(false); }}
        title="Add database host"
        subtitle="Register a MySQL host used to provision per-server databases."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => { resetForm(); setIsCreateOpen(false); }}>
              Cancel
            </Button>
            <Button size="sm" disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate()}>
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
        onClose={() => { setEditingHost(null); resetForm(); }}
        title="Edit database host"
        subtitle="Update connection details for this database host."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => { setEditingHost(null); resetForm(); }}>
              Cancel
            </Button>
            <Button size="sm" disabled={updateMutation.isPending} onClick={() => editingHost && updateMutation.mutate({ hostId: editingHost.id })}>
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
    </motion.div>
  );
}

export default DatabasePage;
