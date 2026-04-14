import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
import {
  Users,
  Search,
  UserPlus,
  Settings,
  Trash2,
  Shield,
  Mail,
} from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useAdminRoles, useAdminServers, useAdminUsers } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { NodeAssignmentsSelector } from '../../components/admin/NodeAssignmentsSelector';
import type { NodeAssignmentWithExpiration } from '../../components/admin/NodeAssignmentsSelector';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';
import Pagination from '../../components/shared/Pagination';

const pageSize = 20;

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
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

// ── Modal Shell ──
function ModalShell({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl md:m-4 md:h-auto md:max-h-[90vh]"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground dark:text-white">{title}</h2>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <button
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground dark:text-zinc-300"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-foreground dark:text-zinc-100">
          {children}
        </div>
        {footer && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-4 text-xs">
            {footer}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── User Card ──
function UserCard({
  user,
  onEdit,
  onDelete,
  isDeleting,
  index,
}: {
  user: any;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: 'spring',
        stiffness: 300,
        damping: 24,
        delay: index * 0.03,
      }}
      className="group relative overflow-hidden rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/30">
              <Users className="h-4 w-4 text-primary-600 dark:text-primary-400" />
            </div>
            <div className="min-w-0">
              <div className="truncate font-semibold text-foreground dark:text-zinc-100">
                {user.username}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{user.email}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {user.roles.length > 0 ? (
              user.roles.map((role: any) => (
                <Badge key={role.id} variant="outline" className="text-[11px]">
                  <Shield className="mr-1 h-2.5 w-2.5" />
                  {role.name}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No roles</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary disabled:pointer-events-none disabled:opacity-30"
            onClick={onEdit}
            title="Edit"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-30"
            onClick={onDelete}
            disabled={isDeleting}
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>Created {new Date(user.createdAt).toLocaleDateString()}</span>
        {user.banned && (
          <Badge variant="destructive" className="text-[10px]">
            Banned
          </Badge>
        )}
      </div>
    </motion.div>
  );
}

function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [serverIds, setServerIds] = useState<string[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [roleSearch, setRoleSearch] = useState('');
  const [serverSearch, setServerSearch] = useState('');
  const [editRoleSearch, setEditRoleSearch] = useState('');
  const [editServerSearch, setEditServerSearch] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const editingRequestRef = useRef(0);
  const [editEmail, setEditEmail] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [editServerIds, setEditServerIds] = useState<string[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<NodeAssignmentWithExpiration[]>([]);
  const [deletingUser, setDeletingUser] = useState<{ id: string; username: string } | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useAdminUsers({ page, limit: pageSize, search: search.trim() || undefined });
  const { data: roles = [] } = useAdminRoles();
  const { data: serversResponse } = useAdminServers({ page: 1, limit: 200 });
  const servers = serversResponse?.servers ?? [];
  const serverOptions = useMemo(
    () => servers.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [servers],
  );
  const filteredRoles = useMemo(
    () =>
      roles.filter((role) => role.name.toLowerCase().includes(roleSearch.trim().toLowerCase())),
    [roles, roleSearch],
  );
  const filteredServers = useMemo(
    () =>
      serverOptions.filter(
        (server) =>
          server.name.toLowerCase().includes(serverSearch.trim().toLowerCase()) ||
          server.id.toLowerCase().includes(serverSearch.trim().toLowerCase()),
      ),
    [serverOptions, serverSearch],
  );
  const filteredEditRoles = useMemo(
    () =>
      roles.filter((role) =>
        role.name.toLowerCase().includes(editRoleSearch.trim().toLowerCase()),
      ),
    [roles, editRoleSearch],
  );
  const filteredEditServers = useMemo(
    () =>
      serverOptions.filter(
        (server) =>
          server.name.toLowerCase().includes(editServerSearch.trim().toLowerCase()) ||
          server.id.toLowerCase().includes(editServerSearch.trim().toLowerCase()),
      ),
    [serverOptions, editServerSearch],
  );

  const canSubmit = useMemo(
    () => email.trim() && username.trim() && password.trim().length >= 8,
    [email, username, password],
  );
  const canSubmitEdit = useMemo(
    () => editEmail.trim() && editUsername.trim() && (!editPassword || editPassword.length >= 8),
    [editEmail, editUsername, editPassword],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.createUser({
        email: email.trim(),
        username: username.trim(),
        password: password.trim(),
        roleIds,
        serverIds,
      }),
    onSuccess: () => {
      notifySuccess('User created');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setEmail('');
      setUsername('');
      setPassword('');
      setRoleIds([]);
      setServerIds([]);
      setRoleSearch('');
      setServerSearch('');
      setIsCreateOpen(false);
    },
    onError: (error: any) => {
      const rawError = error?.response?.data?.error;
      const message = (typeof rawError === 'string' ? rawError : rawError?.message || rawError?.error) || 'Failed to create user';
      notifyError(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (userId: string) =>
      adminApi.updateUser(userId, {
        email: editEmail.trim(),
        username: editUsername.trim(),
        password: editPassword.trim() ? editPassword.trim() : undefined,
        roleIds: editRoleIds,
        serverIds: editServerIds,
      }),
    onSuccess: () => {
      notifySuccess('User updated');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setEditingUserId(null);
      setEditRoleSearch('');
      setEditServerSearch('');
    },
    onError: (error: any) => {
      const rawError = error?.response?.data?.error;
      const message = (typeof rawError === 'string' ? rawError : rawError?.message || rawError?.error) || 'Failed to update user';
      notifyError(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: () => {
      notifySuccess('User deleted');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error: any) => {
      const rawError = error?.response?.data?.error;
      const message = (typeof rawError === 'string' ? rawError : rawError?.message || rawError?.error) || 'Failed to delete user';
      notifyError(message);
    },
  });

  const users = data?.users ?? [];
  const pagination = data?.pagination;

  const toggleItem = (items: string[], value: string) =>
    items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

  const handleEditUser = async (user: any) => {
    const nextId = user.id;
    const requestId = editingRequestRef.current + 1;
    editingRequestRef.current = requestId;
    setEditingUserId(nextId);
    setEditEmail(user.email);
    setEditUsername(user.username);
    setEditPassword('');
    setEditRoleIds(user.roles.map((role: any) => role.id));
    setEditServerIds([]);
    setEditRoleSearch('');
    setEditServerSearch('');

    adminApi
      .getUserServers(nextId)
      .then((serverSelection) => {
        if (editingRequestRef.current === requestId) {
          setEditServerIds(serverSelection);
        }
      })
      .catch(() => {
        notifyError('Failed to load user servers');
      });

    try {
      const response = await fetch(`/api/roles/users/${nextId}/nodes`, {
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await response.json();
      const nodes = data.data || [];
      if (editingRequestRef.current === requestId) {
        setSelectedNodeIds(nodes.map((n: any) => ({
          nodeId: n.nodeId,
          nodeName: n.name,
          source: n.source || 'user',
          roleName: n.roleName,
          expiresAt: n.expiresAt,
        })));
      }
    } catch {
      setSelectedNodeIds([]);
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-cyan-500/8 to-blue-500/8 blur-3xl dark:from-cyan-500/15 dark:to-blue-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-violet-500/8 to-rose-500/8 blur-3xl dark:from-violet-500/15 dark:to-rose-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-500 opacity-20 blur-sm" />
                <Users className="relative h-7 w-7 text-cyan-600 dark:text-cyan-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                User Management
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Create and manage accounts with role-based access.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => { setIsCreateOpen(true); setRoleSearch(''); setServerSearch(''); }} className="gap-1.5">
              <UserPlus className="h-3.5 w-3.5" />
              Create user
            </Button>
          </div>
        </motion.div>

        {/* ── Search Bar ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Search users…"
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {data?.pagination?.total ?? users.length} users
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {roles.length} roles
            </Badge>
          </div>
        </motion.div>

        {/* ── User Grid ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card/80 p-5">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-3" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-28 animate-pulse rounded bg-surface-3" />
                    <div className="h-3 w-44 animate-pulse rounded bg-surface-2" />
                    <div className="flex gap-1.5">
                      <div className="h-5 w-16 animate-pulse rounded-full bg-surface-2" />
                      <div className="h-5 w-20 animate-pulse rounded-full bg-surface-2" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        ) : users.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {users.map((user, i) => (
                <UserCard
                  key={user.id}
                  user={user}
                  index={i}
                  onEdit={() => handleEditUser(user)}
                  onDelete={() => setDeletingUser({ id: user.id, username: user.username })}
                  isDeleting={deleteMutation.isPending}
                />
              ))}
            </div>
            {pagination && pagination.totalPages > 1 && (
              <div className="flex justify-center">
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        ) : (
          <motion.div variants={itemVariants}>
            <EmptyState
              title={search.trim() ? 'No users found' : 'No users'}
              description={
                search.trim()
                  ? 'Try a different username or email.'
                  : 'Create a user account to grant dashboard access.'
              }
              action={
                <Button size="sm" onClick={() => { setIsCreateOpen(true); setRoleSearch(''); setServerSearch(''); }} className="gap-1.5">
                  <UserPlus className="h-3.5 w-3.5" />
                  Create user
                </Button>
              }
            />
          </motion.div>
        )}
      </div>

      {/* ── Create User Modal ── */}
      <ModalShell
        open={isCreateOpen}
        onClose={() => { setIsCreateOpen(false); setRoleSearch(''); setServerSearch(''); }}
        title="Create user"
        subtitle="Assign credentials, roles, and server access."
        footer={
          <>
            <span className="text-muted-foreground">Passwords must be at least 8 characters.</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setIsCreateOpen(false); setRoleSearch(''); setServerSearch(''); }}>
                Cancel
              </Button>
              <Button size="sm" disabled={!canSubmit || createMutation.isPending} onClick={() => createMutation.mutate()}>
                {createMutation.isPending ? 'Creating…' : 'Create user'}
              </Button>
            </div>
          </>
        }
      >
        <div className="space-y-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account details</div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Email</span>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Username</span>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Password (min 8 chars)</span>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="********" />
              </label>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roles</div>
              <Input value={roleSearch} onChange={(e) => setRoleSearch(e.target.value)} placeholder="Search roles" className="mt-2 w-full" />
              <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {filteredRoles.map((role) => (
                  <label key={role.id} className="flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50 dark:border-border dark:bg-zinc-950 dark:text-zinc-200">
                    <input type="checkbox" checked={roleIds.includes(role.id)} onChange={() => setRoleIds((prev) => toggleItem(prev, role.id))} className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400" />
                    {role.name}
                  </label>
                ))}
                {!filteredRoles.length && <span className="text-xs text-muted-foreground">No roles match</span>}
              </div>
            </div>
            <div className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Server access</div>
              <Input value={serverSearch} onChange={(e) => setServerSearch(e.target.value)} placeholder="Search servers" className="mt-2 w-full" />
              <div className="mt-3 flex max-h-36 flex-col gap-2 overflow-y-auto">
                {filteredServers.map((server) => (
                  <label key={server.id} className="flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50 dark:border-border dark:bg-zinc-950 dark:text-zinc-200">
                    <input type="checkbox" checked={serverIds.includes(server.id)} onChange={() => setServerIds((prev) => toggleItem(prev, server.id))} className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400" />
                    <span>{server.name}</span>
                    <span className="text-[10px] text-muted-foreground">({server.id})</span>
                  </label>
                ))}
                {!filteredServers.length && <span className="text-xs text-muted-foreground">No servers match</span>}
              </div>
            </div>
            <NodeAssignmentsSelector
              selectedNodes={[]}
              onSelectionChange={() => {}}
              disabled={false}
              label="Node Access (optional)"
            />
          </div>
        </div>
      </ModalShell>

      {/* ── Edit User Modal ── */}
      <ModalShell
        open={!!editingUserId}
        onClose={() => { setEditingUserId(null); setEditRoleSearch(''); setEditServerSearch(''); setSelectedNodeIds([]); }}
        title="Edit user"
        subtitle="Update profile details, roles, and server access."
        footer={
          <>
            <span className="text-muted-foreground">Leave password blank to keep current credentials.</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setEditingUserId(null); setEditRoleSearch(''); setEditServerSearch(''); setSelectedNodeIds([]); }}>
                Cancel
              </Button>
              <Button size="sm" disabled={!canSubmitEdit || updateMutation.isPending} onClick={() => editingUserId && updateMutation.mutate(editingUserId)}>
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </>
        }
      >
        <div className="space-y-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account details</div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Email</span>
                <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Username</span>
                <Input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Password (leave blank to keep)</span>
                <Input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} />
              </label>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Roles</div>
              <Input value={editRoleSearch} onChange={(e) => setEditRoleSearch(e.target.value)} placeholder="Search roles" className="mt-2 w-full" />
              <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {filteredEditRoles.map((role) => (
                  <label key={role.id} className="flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50 dark:border-border dark:bg-zinc-950 dark:text-zinc-200">
                    <input type="checkbox" checked={editRoleIds.includes(role.id)} onChange={() => setEditRoleIds((prev) => toggleItem(prev, role.id))} className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400" />
                    {role.name}
                  </label>
                ))}
                {!filteredEditRoles.length && <span className="text-xs text-muted-foreground">No roles match</span>}
              </div>
            </div>
            <div className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Server access</div>
              <Input value={editServerSearch} onChange={(e) => setEditServerSearch(e.target.value)} placeholder="Search servers" className="mt-2 w-full" />
              <div className="mt-3 flex max-h-36 flex-col gap-2 overflow-y-auto">
                {filteredEditServers.map((server) => (
                  <label key={server.id} className="flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50 dark:border-border dark:bg-zinc-950 dark:text-zinc-200">
                    <input type="checkbox" checked={editServerIds.includes(server.id)} onChange={() => setEditServerIds((prev) => toggleItem(prev, server.id))} className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400" />
                    <span>{server.name}</span>
                    <span className="text-[10px] text-muted-foreground">({server.id})</span>
                  </label>
                ))}
                {!filteredEditServers.length && <span className="text-xs text-muted-foreground">No servers match</span>}
              </div>
            </div>
          </div>
          <NodeAssignmentsSelector
            userId={editingUserId ?? undefined}
            selectedNodes={selectedNodeIds}
            onSelectionChange={setSelectedNodeIds}
            disabled={updateMutation.isPending}
          />
        </div>
      </ModalShell>

      {/* ── Delete Confirmation ── */}
      <ConfirmDialog
        open={!!deletingUser}
        title="Delete user?"
        message={`Are you sure you want to delete "${deletingUser?.username}"? This action cannot be undone and all associated data will be removed.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deletingUser) {
            deleteMutation.mutate(deletingUser.id, {
              onSuccess: () => setDeletingUser(null),
            });
          }
        }}
        onCancel={() => setDeletingUser(null)}
      />
    </motion.div>
  );
}

export default UsersPage;
