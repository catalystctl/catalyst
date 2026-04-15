import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import {
  Users,
  UserPlus,
  Search,
  Filter,
  ArrowUpDown,
  Settings,
  Trash2,
  Shield,
  Mail,
  X,
  Ban,
  CheckCircle,
  MoreHorizontal,
} from 'lucide-react';
import EmptyState from '../../components/shared/EmptyState';
import ConfirmDialog from '../../components/shared/ConfirmDialog';
import Pagination from '../../components/shared/Pagination';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { useAdminRoles, useAdminServers, useAdminUsers } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { NodeAssignmentsSelector } from '../../components/admin/NodeAssignmentsSelector';
import type { NodeAssignmentWithExpiration } from '../../components/admin/NodeAssignmentsSelector';
import type { AdminUser } from '../../types/admin';

const pageSize = 20;

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.03, delayChildren: 0.05 },
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

const rowVariants: Variants = {
  hidden: { opacity: 0, x: -8 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring', stiffness: 400, damping: 30 },
  },
};

// ── Skeleton Loader ──
function TableSkeleton() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-lg px-4 py-3.5"
        >
          <div className="h-4 w-4 animate-pulse rounded bg-surface-3" />
          <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-3" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-surface-3" />
            <div className="h-3 w-48 animate-pulse rounded bg-surface-2" />
          </div>
          <div className="hidden h-5 w-20 animate-pulse rounded-full bg-surface-3 sm:block" />
          <div className="hidden h-4 w-24 animate-pulse rounded bg-surface-3 md:block" />
          <div className="flex gap-1">
            <div className="h-7 w-16 animate-pulse rounded-md bg-surface-3" />
            <div className="h-7 w-16 animate-pulse rounded-md bg-surface-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

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

// ── Main Component ──
function UsersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('username-asc');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  // Create user state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState('');
  const [createUsername, setCreateUsername] = useState('');
  const [createPassword, setCreatePassword] = useState('');
  const [createRoleIds, setCreateRoleIds] = useState<string[]>([]);
  const [createServerIds, setCreateServerIds] = useState<string[]>([]);
  const [roleSearch, setRoleSearch] = useState('');
  const [serverSearch, setServerSearch] = useState('');

  // Edit user state
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const editingRequestRef = useRef(0);
  const [editEmail, setEditEmail] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [editServerIds, setEditServerIds] = useState<string[]>([]);
  const [editRoleSearch, setEditRoleSearch] = useState('');
  const [editServerSearch, setEditServerSearch] = useState('');
  const [selectedNodeIds, setSelectedNodeIds] = useState<NodeAssignmentWithExpiration[]>([]);

  // Delete/ban confirmation state
  const [deletingUser, setDeletingUser] = useState<{ id: string; username: string } | null>(null);
  const [banTargets, setBanTargets] = useState<{ userIds: string[]; label: string } | null>(null);
  const [unbanTargets, setUnbanTargets] = useState<{ userIds: string[]; label: string } | null>(null);
  const [banReason, setBanReason] = useState('');

  const queryClient = useQueryClient();

  const { data, isLoading } = useAdminUsers({
    page,
    limit: pageSize,
    search: search.trim() || undefined,
  });
  const { data: roles = [] } = useAdminRoles();
  const { data: serversResponse } = useAdminServers({ page: 1, limit: 200 });

  const users = data?.users ?? [];
  const pagination = data?.pagination;
  const servers = serversResponse?.servers ?? [];

  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => a.name.localeCompare(b.name)),
    [roles],
  );

  const sortedServers = useMemo(
    () => servers.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [servers],
  );

  const hasActiveFilters = roleFilter || statusFilter;

  const clearFilters = () => {
    setRoleFilter('');
    setStatusFilter('');
    setPage(1);
  };

  const filteredUsers = useMemo(() => {
    let filtered = users;
    if (roleFilter) {
      filtered = filtered.filter((user) =>
        user.roles.some((role) => role.id === roleFilter),
      );
    }
    if (statusFilter === 'banned') {
      filtered = filtered.filter((user) => user.banned);
    } else if (statusFilter === 'active') {
      filtered = filtered.filter((user) => !user.banned);
    }
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'username-desc':
          return b.username.localeCompare(a.username);
        case 'email-asc':
          return a.email.localeCompare(b.email);
        case 'email-desc':
          return b.email.localeCompare(a.email);
        case 'created':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'roles':
          return a.roles.length - b.roles.length;
        default:
          return a.username.localeCompare(b.username);
      }
    });
    return sorted;
  }, [users, roleFilter, statusFilter, sort]);

  const filteredIds = useMemo(() => filteredUsers.map((user) => user.id), [filteredUsers]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));

  const currentUserIds = useMemo(() => new Set(users.map((u) => u.id)), [users]);
  const validSelectedIds = useMemo(
    () => selectedIds.filter((id) => currentUserIds.has(id)),
    [selectedIds, currentUserIds],
  );

  if (validSelectedIds.length !== selectedIds.length) {
    setSelectedIds(validSelectedIds);
  }

  // ── Derived filter lists ──
  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const user of users) {
      for (const role of user.roles) {
        counts[role.id] = (counts[role.id] || 0) + 1;
      }
    }
    return counts;
  }, [users]);

  const bannedCount = useMemo(
    () => users.filter((u) => u.banned).length,
    [users],
  );

  // ── Filtered role/server lists for modals ──
  const filteredModalRoles = useMemo(
    () =>
      roles.filter((role) =>
        role.name.toLowerCase().includes(roleSearch.trim().toLowerCase()),
      ),
    [roles, roleSearch],
  );

  const filteredModalServers = useMemo(
    () =>
      sortedServers.filter(
        (server) =>
          server.name.toLowerCase().includes(serverSearch.trim().toLowerCase()) ||
          server.id.toLowerCase().includes(serverSearch.trim().toLowerCase()),
      ),
    [sortedServers, serverSearch],
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
      sortedServers.filter(
        (server) =>
          server.name.toLowerCase().includes(editServerSearch.trim().toLowerCase()) ||
          server.id.toLowerCase().includes(editServerSearch.trim().toLowerCase()),
      ),
    [sortedServers, editServerSearch],
  );

  // ── Mutations ──
  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.createUser({
        email: createEmail.trim(),
        username: createUsername.trim(),
        password: createPassword.trim(),
        roleIds: createRoleIds,
        serverIds: createServerIds,
      }),
    onSuccess: () => {
      notifySuccess('User created');
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setCreateEmail('');
      setCreateUsername('');
      setCreatePassword('');
      setCreateRoleIds([]);
      setCreateServerIds([]);
      setRoleSearch('');
      setServerSearch('');
      setIsCreateOpen(false);
    },
    onError: (error: any) => {
      const rawError = error?.response?.data?.error;
      const message =
        (typeof rawError === 'string'
          ? rawError
          : rawError?.message || rawError?.error) || 'Failed to create user';
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
      const message =
        (typeof rawError === 'string'
          ? rawError
          : rawError?.message || rawError?.error) || 'Failed to update user';
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
      const message =
        (typeof rawError === 'string'
          ? rawError
          : rawError?.message || rawError?.error) || 'Failed to delete user';
      notifyError(message);
    },
  });

  const banMutation = useMutation({
    mutationFn: (payload: { userIds: string[]; reason?: string }) => {
      return Promise.all(
        payload.userIds.map((userId) =>
          adminApi.banUser(userId, payload.reason),
        ),
      );
    },
    onSuccess: (_data, variables) => {
      notifySuccess(
        `${variables.userIds.length} user${variables.userIds.length === 1 ? '' : 's'} banned`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setSelectedIds([]);
      setBanTargets(null);
      setBanReason('');
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error || 'Failed to ban user(s)';
      notifyError(message);
    },
  });

  const unbanMutation = useMutation({
    mutationFn: (userIds: string[]) => {
      return Promise.all(userIds.map((userId) => adminApi.unbanUser(userId)));
    },
    onSuccess: (_data, userIds) => {
      notifySuccess(
        `${userIds.length} user${userIds.length === 1 ? '' : 's'} unbanned`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setSelectedIds([]);
      setUnbanTargets(null);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error || 'Failed to unban user(s)';
      notifyError(message);
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (userIds: string[]) => {
      return Promise.all(userIds.map((userId) => adminApi.deleteUser(userId)));
    },
    onSuccess: (_data, userIds) => {
      notifySuccess(
        `${userIds.length} user${userIds.length === 1 ? '' : 's'} deleted`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setSelectedIds([]);
      setDeletingUser(null);
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error || 'Failed to delete user(s)';
      notifyError(message);
    },
  });

  // ── Helpers ──
  const toggleItem = (items: string[], value: string) =>
    items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

  const canSubmitCreate = useMemo(
    () => createEmail.trim() && createUsername.trim() && createPassword.trim().length >= 8,
    [createEmail, createUsername, createPassword],
  );

  const canSubmitEdit = useMemo(
    () =>
      editEmail.trim() &&
      editUsername.trim() &&
      (!editPassword || editPassword.length >= 8),
    [editEmail, editUsername, editPassword],
  );

  const handleEditUser = async (user: AdminUser) => {
    const nextId = user.id;
    const requestId = editingRequestRef.current + 1;
    editingRequestRef.current = requestId;
    setEditingUserId(nextId);
    setEditEmail(user.email);
    setEditUsername(user.username);
    setEditPassword('');
    setEditRoleIds(user.roles.map((role) => role.id));
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
        setSelectedNodeIds(
          nodes.map((n: any) => ({
            nodeId: n.nodeId,
            nodeName: n.name,
            source: n.source || 'user',
            roleName: n.roleName,
            expiresAt: n.expiresAt,
          })),
        );
      }
    } catch {
      setSelectedNodeIds([]);
    }
  };

  const handleBulkBan = (userIds: string[], label: string) => {
    if (!userIds.length) return;
    setBanTargets({ userIds, label });
    setBanReason('');
  };

  const handleBulkUnban = (userIds: string[], label: string) => {
    if (!userIds.length) return;
    setUnbanTargets({ userIds, label });
  };

  const handleBulkDelete = (userIds: string[], label: string) => {
    if (!userIds.length) return;
    setDeletingUser({ id: userIds.join(','), username: label });
  };

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
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
        <motion.div
          variants={itemVariants}
          className="flex flex-wrap items-end justify-between gap-4"
        >
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

          {/* Summary stats */}
          <div className="flex flex-wrap gap-2">
            {isLoading ? (
              <>
                <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
                <div className="h-8 w-24 animate-pulse rounded-lg bg-surface-3" />
              </>
            ) : (
              <>
                <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                  <span className="h-2 w-2 rounded-full bg-zinc-400" />
                  {data?.pagination?.total ?? 0} users
                </Badge>
                {roles.length > 0 && (
                  <Badge variant="outline" className="h-8 gap-1.5 px-3 text-xs">
                    <Shield className="h-2.5 w-2.5" />
                    {roles.length} roles
                  </Badge>
                )}
                {bannedCount > 0 && (
                  <Badge variant="destructive" className="h-8 gap-1.5 px-3 text-xs">
                    <Ban className="h-2.5 w-2.5" />
                    {bannedCount} banned
                  </Badge>
                )}
              </>
            )}
            <Button
              size="sm"
              onClick={() => {
                setIsCreateOpen(true);
                setRoleSearch('');
                setServerSearch('');
              }}
              className="gap-1.5"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Create user
            </Button>
          </div>
        </motion.div>

        {/* ── Search & Controls Bar ── */}
        <motion.div
          variants={itemVariants}
          className="flex flex-wrap items-center gap-2.5"
        >
          {/* Search input */}
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Search users by name, email, or ID…"
              className="pl-9"
            />
          </div>

          {/* Filter toggle */}
          <Button
            variant={hasActiveFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-2"
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {hasActiveFilters && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-bold">
                {[roleFilter, statusFilter].filter(Boolean).length}
              </span>
            )}
          </Button>

          {/* Sort */}
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-40 gap-2 text-xs">
              <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="username-asc">Username A→Z</SelectItem>
              <SelectItem value="username-desc">Username Z→A</SelectItem>
              <SelectItem value="email-asc">Email A→Z</SelectItem>
              <SelectItem value="email-desc">Email Z→A</SelectItem>
              <SelectItem value="created">Newest first</SelectItem>
              <SelectItem value="roles">Most roles</SelectItem>
            </SelectContent>
          </Select>

          {/* Results count */}
          <span className="text-xs text-muted-foreground">
            {filteredUsers.length} of {data?.pagination?.total ?? users.length}
          </span>
        </motion.div>

        {/* ── Expandable Filter Panel ── */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="rounded-xl border border-border bg-card/80 p-4 backdrop-blur-sm">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Role</span>
                    <Select
                      value={roleFilter || 'all'}
                      onValueChange={(value) => {
                        setRoleFilter(value === 'all' ? '' : value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="All roles" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All roles</SelectItem>
                        {sortedRoles.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.name}
                            {roleCounts[role.id] ? ` (${roleCounts[role.id]})` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Status</span>
                    <Select
                      value={statusFilter || 'all'}
                      onValueChange={(value) => {
                        setStatusFilter(value === 'all' ? '' : value);
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="w-44">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="active">
                          Active
                          {bannedCount > 0 ? ` (${users.length - bannedCount})` : ''}
                        </SelectItem>
                        <SelectItem value="banned">
                          Banned{bannedCount > 0 ? ` (${bannedCount})` : ''}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="gap-1.5 text-xs"
                    >
                      <X className="h-3 w-3" />
                      Clear all
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Bulk Actions Bar ── */}
        <AnimatePresence>
          {selectedIds.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0, y: -8 }}
              animate={{ height: 'auto', opacity: 1, y: 0 }}
              exit={{ height: 0, opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="flex items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5 dark:bg-primary/10">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">
                    {selectedIds.length} selected
                  </span>
                  <button
                    onClick={() => setSelectedIds([])}
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleBulkBan(selectedIds, `${selectedIds.length} users`)
                    }
                    disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending}
                    className="gap-1.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 dark:text-rose-400 dark:hover:bg-rose-950/30 dark:hover:border-rose-800"
                  >
                    <Ban className="h-3 w-3" />
                    Ban
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleBulkUnban(selectedIds, `${selectedIds.length} users`)
                    }
                    disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending}
                    className="gap-1.5 text-xs text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 dark:text-emerald-400 dark:hover:bg-emerald-950/30 dark:hover:border-emerald-800"
                  >
                    <CheckCircle className="h-3 w-3" />
                    Unban
                  </Button>
                  <div className="mx-1 h-4 w-px bg-border" />
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      handleBulkDelete(selectedIds, `${selectedIds.length} users`)
                    }
                    disabled={banMutation.isPending || unbanMutation.isPending || bulkDeleteMutation.isPending}
                    className="gap-1.5 text-xs"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── User List ── */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border border-border bg-card/80 shadow-sm backdrop-blur-sm">
            {isLoading ? (
              <div className="p-4">
                <TableSkeleton />
              </div>
            ) : filteredUsers.length > 0 ? (
              <>
                {/* Select-all header */}
                <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() =>
                        setSelectedIds((prev) => {
                          if (allSelected) {
                            return prev.filter((id) => !filteredIds.includes(id));
                          }
                          return Array.from(new Set([...prev, ...filteredIds]));
                        })
                      }
                      className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                    />
                    <span className="text-xs font-medium text-muted-foreground">
                      Select all
                    </span>
                  </label>
                </div>

                {/* User rows */}
                <div className="divide-y divide-border/50">
                  {filteredUsers.map((user: AdminUser) => {
                    const isSelected = selectedIds.includes(user.id);

                    return (
                      <motion.div
                        key={user.id}
                        variants={rowVariants}
                        className={`group relative flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/50 ${
                          isSelected ? 'bg-primary/5' : ''
                        }`}
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() =>
                            setSelectedIds((prev) =>
                              prev.includes(user.id)
                                ? prev.filter((id) => id !== user.id)
                                : [...prev, user.id],
                            )
                          }
                          className="h-4 w-4 flex-shrink-0 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                        />

                        {/* Avatar icon */}
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/30">
                          <Users className="h-4 w-4 text-primary-600 dark:text-primary-400" />
                        </div>

                        {/* User info — primary column */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2.5">
                            <span className="truncate font-semibold text-foreground transition-colors dark:text-zinc-100">
                              {user.username}
                            </span>
                            {user.banned ? (
                              <Badge variant="destructive" className="gap-1 text-[11px]">
                                <Ban className="h-2.5 w-2.5" />
                                Banned
                              </Badge>
                            ) : (
                              <Badge variant="success" className="gap-1 text-[11px]">
                                <span className="relative flex h-1.5 w-1.5">
                                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                </span>
                                Active
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <Mail className="h-3 w-3 shrink-0" />
                              <span className="truncate">{user.email}</span>
                            </span>
                            <span className="hidden font-mono text-[11px] opacity-60 sm:inline">
                              {user.id}
                            </span>
                            {user.roles.length > 0 && (
                              <span className="hidden items-center gap-1 sm:flex">
                                <Shield className="h-3 w-3 shrink-0" />
                                {user.roles.map((role) => role.name).join(', ')}
                              </span>
                            )}
                            <span className="hidden md:inline">
                              Created {new Date(user.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                          {user.banned ? (
                            <button
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-emerald-50 hover:text-emerald-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-400"
                              onClick={() =>
                                handleBulkUnban([user.id], user.username)
                              }
                              disabled={
                                banMutation.isPending ||
                                unbanMutation.isPending
                              }
                              title="Unban"
                            >
                              <CheckCircle className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
                              onClick={() =>
                                handleBulkBan([user.id], user.username)
                              }
                              disabled={
                                banMutation.isPending ||
                                unbanMutation.isPending
                              }
                              title="Ban"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </button>
                          )}

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                                title="More"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => handleEditUser(user)}
                                disabled={updateMutation.isPending}
                                className="gap-2 text-xs"
                              >
                                <Settings className="h-3.5 w-3.5" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {user.banned ? (
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleBulkUnban([user.id], user.username)
                                  }
                                  disabled={
                                    banMutation.isPending ||
                                    unbanMutation.isPending
                                  }
                                  className="gap-2 text-xs text-emerald-600 dark:text-emerald-400"
                                >
                                  <CheckCircle className="h-3.5 w-3.5" />
                                  Unban
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() =>
                                    handleBulkBan([user.id], user.username)
                                  }
                                  disabled={
                                    banMutation.isPending ||
                                    unbanMutation.isPending
                                  }
                                  className="gap-2 text-xs text-rose-600 dark:text-rose-400"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                  Ban
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  setDeletingUser({
                                    id: user.id,
                                    username: user.username,
                                  })
                                }
                                disabled={deleteMutation.isPending}
                                className="gap-2 text-xs text-rose-600 dark:text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {pagination && pagination.totalPages > 1 ? (
                  <div className="border-t border-border px-4 py-3">
                    <Pagination
                      page={pagination.page}
                      totalPages={pagination.totalPages}
                      onPageChange={setPage}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="p-6">
                <EmptyState
                  title={
                    search.trim() || hasActiveFilters
                      ? 'No users found'
                      : 'No users'
                  }
                  description={
                    search.trim() || hasActiveFilters
                      ? 'Try adjusting your search or filters.'
                      : 'Create a user account to grant dashboard access.'
                  }
                  action={
                    hasActiveFilters ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearFilters}
                      >
                        <X className="mr-1.5 h-3.5 w-3.5" />
                        Clear filters
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => {
                          setIsCreateOpen(true);
                          setRoleSearch('');
                          setServerSearch('');
                        }}
                        className="gap-1.5"
                      >
                        <UserPlus className="h-3.5 w-3.5" />
                        Create user
                      </Button>
                    )
                  }
                />
              </div>
            )}
          </div>
        </motion.div>
      </div>

      {/* ── Create User Modal ── */}
      <ModalShell
        open={isCreateOpen}
        onClose={() => {
          setIsCreateOpen(false);
          setRoleSearch('');
          setServerSearch('');
        }}
        title="Create user"
        subtitle="Assign credentials, roles, and server access."
        footer={
          <>
            <span className="text-muted-foreground">
              Passwords must be at least 8 characters.
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsCreateOpen(false);
                  setRoleSearch('');
                  setServerSearch('');
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!canSubmitCreate || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Creating…' : 'Create user'}
              </Button>
            </div>
          </>
        }
      >
        <div className="space-y-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Account details
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Email</span>
                <Input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  placeholder="user@example.com"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Username</span>
                <Input
                  value={createUsername}
                  onChange={(e) => setCreateUsername(e.target.value)}
                  placeholder="username"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">
                  Password (min 8 chars)
                </span>
                <Input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="********"
                />
              </label>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Roles
              </div>
              <Input
                value={roleSearch}
                onChange={(e) => setRoleSearch(e.target.value)}
                placeholder="Search roles"
                className="mt-2 w-full"
              />
              <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {filteredModalRoles.map((role) => (
                  <label
                    key={role.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50 dark:border-border dark:bg-zinc-950 dark:text-zinc-200"
                  >
                    <input
                      type="checkbox"
                      checked={createRoleIds.includes(role.id)}
                      onChange={() =>
                        setCreateRoleIds((prev) => toggleItem(prev, role.id))
                      }
                      className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                    />
                    {role.name}
                  </label>
                ))}
                {!filteredModalRoles.length && (
                  <span className="text-xs text-muted-foreground">
                    No roles match
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Server access
              </div>
              <Input
                value={serverSearch}
                onChange={(e) => setServerSearch(e.target.value)}
                placeholder="Search servers"
                className="mt-2 w-full"
              />
              <div className="mt-3 flex max-h-36 flex-col gap-2 overflow-y-auto">
                {filteredModalServers.map((server) => (
                  <label
                    key={server.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50 dark:border-border dark:bg-zinc-950 dark:text-zinc-200"
                  >
                    <input
                      type="checkbox"
                      checked={createServerIds.includes(server.id)}
                      onChange={() =>
                        setCreateServerIds((prev) => toggleItem(prev, server.id))
                      }
                      className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                    />
                    <span>{server.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      ({server.id})
                    </span>
                  </label>
                ))}
                {!filteredModalServers.length && (
                  <span className="text-xs text-muted-foreground">
                    No servers match
                  </span>
                )}
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
        onClose={() => {
          setEditingUserId(null);
          setEditRoleSearch('');
          setEditServerSearch('');
          setSelectedNodeIds([]);
        }}
        title="Edit user"
        subtitle="Update profile details, roles, and server access."
        footer={
          <>
            <span className="text-muted-foreground">
              Leave password blank to keep current credentials.
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingUserId(null);
                  setEditRoleSearch('');
                  setEditServerSearch('');
                  setSelectedNodeIds([]);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!canSubmitEdit || updateMutation.isPending}
                onClick={() =>
                  editingUserId && updateMutation.mutate(editingUserId)
                }
              >
                {updateMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </>
        }
      >
        <div className="space-y-6">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Account details
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Email</span>
                <Input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">Username</span>
                <Input
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">
                  Password (leave blank to keep)
                </span>
                <Input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                />
              </label>
            </div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Roles
              </div>
              <Input
                value={editRoleSearch}
                onChange={(e) => setEditRoleSearch(e.target.value)}
                placeholder="Search roles"
                className="mt-2 w-full"
              />
              <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                {filteredEditRoles.map((role) => (
                  <label
                    key={role.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50 dark:border-border dark:bg-zinc-950 dark:text-zinc-200"
                  >
                    <input
                      type="checkbox"
                      checked={editRoleIds.includes(role.id)}
                      onChange={() =>
                        setEditRoleIds((prev) => toggleItem(prev, role.id))
                      }
                      className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                    />
                    {role.name}
                  </label>
                ))}
                {!filteredEditRoles.length && (
                  <span className="text-xs text-muted-foreground">
                    No roles match
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-border/50 bg-surface-2/50 p-4 dark:bg-surface-2/30">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Server access
              </div>
              <Input
                value={editServerSearch}
                onChange={(e) => setEditServerSearch(e.target.value)}
                placeholder="Search servers"
                className="mt-2 w-full"
              />
              <div className="mt-3 flex max-h-36 flex-col gap-2 overflow-y-auto">
                {filteredEditServers.map((server) => (
                  <label
                    key={server.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-white px-2 py-1 text-xs text-foreground transition-colors hover:border-primary/50 dark:border-border dark:bg-zinc-950 dark:text-zinc-200"
                  >
                    <input
                      type="checkbox"
                      checked={editServerIds.includes(server.id)}
                      onChange={() =>
                        setEditServerIds((prev) => toggleItem(prev, server.id))
                      }
                      className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-border dark:bg-surface-1 dark:text-primary-400"
                    />
                    <span>{server.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      ({server.id})
                    </span>
                  </label>
                ))}
                {!filteredEditServers.length && (
                  <span className="text-xs text-muted-foreground">
                    No servers match
                  </span>
                )}
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

      {/* ── Ban Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!banTargets}
        title="Ban Users"
        message={
          <div className="space-y-3">
            <p>
              You are about to ban{' '}
              <span className="font-semibold">{banTargets?.label}</span>.
            </p>
            <label className="block space-y-1">
              <span className="text-sm text-muted-foreground dark:text-zinc-300">
                Reason (optional)
              </span>
              <input
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-2 dark:text-zinc-200"
                value={banReason}
                onChange={(event) => setBanReason(event.target.value)}
                placeholder="e.g., Terms of service violation"
                onClick={(e) => e.stopPropagation()}
              />
            </label>
          </div>
        }
        confirmText="Ban"
        cancelText="Cancel"
        onConfirm={() =>
          banTargets &&
          banMutation.mutate({
            userIds: banTargets.userIds,
            reason: banReason.trim() || undefined,
          })
        }
        onCancel={() => {
          setBanTargets(null);
          setBanReason('');
        }}
        variant="warning"
        loading={banMutation.isPending}
      />

      {/* ── Unban Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!unbanTargets}
        title="Unban Users"
        message={
          <p>
            You are about to unban{' '}
            <span className="font-semibold">{unbanTargets?.label}</span>.
          </p>
        }
        confirmText="Unban"
        cancelText="Cancel"
        onConfirm={() =>
          unbanTargets && unbanMutation.mutate(unbanTargets.userIds)
        }
        onCancel={() => setUnbanTargets(null)}
        variant="warning"
        loading={unbanMutation.isPending}
      />

      {/* ── Delete Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!deletingUser}
        title="Delete user?"
        message={
          <div className="space-y-2">
            <p>
              Are you sure you want to delete{' '}
              <span className="font-semibold">"{deletingUser?.username}"</span>?
              This action cannot be undone and all associated data will be
              removed.
            </p>
          </div>
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        loading={
          deleteMutation.isPending || bulkDeleteMutation.isPending
        }
        onConfirm={() => {
          if (deletingUser) {
            const ids = deletingUser.id.split(',');
            if (ids.length > 1) {
              bulkDeleteMutation.mutate(ids, {
                onSuccess: () => setDeletingUser(null),
              });
            } else {
              deleteMutation.mutate(deletingUser.id, {
                onSuccess: () => setDeletingUser(null),
              });
            }
          }
        }}
        onCancel={() => setDeletingUser(null)}
      />
    </motion.div>
  );
}

export default UsersPage;
