import { useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import EmptyState from '../../components/shared/EmptyState';
import { Input } from '../../components/ui/input';
import { useAdminRoles, useAdminServers, useAdminUsers } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { notifyError, notifySuccess } from '../../utils/notify';
import { NodeAssignmentsSelector } from '../../components/admin/NodeAssignmentsSelector';
import type { NodeAssignmentWithExpiration } from '../../components/admin/NodeAssignmentsSelector';
import { ConfirmDialog } from '../../components/shared/ConfirmDialog';

const pageSize = 20;

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
      const message = error?.response?.data?.error || 'Failed to create user';
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
      const message = error?.response?.data?.error || 'Failed to update user';
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
      const message = error?.response?.data?.error || 'Failed to delete user';
      notifyError(message);
    },
  });

  const users = data?.users ?? [];
  const pagination = data?.pagination;

  const toggleItem = (items: string[], value: string) =>
    items.includes(value) ? items.filter((item) => item !== value) : [...items, value];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">User Management</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Create and manage administrator accounts with role-based access.
            </p>
          </div>
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
            onClick={() => {
              setIsCreateOpen(true);
              setRoleSearch('');
              setServerSearch('');
            }}
          >
            Create user
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {data?.pagination?.total ?? users.length} total users
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {roles.length} roles available
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {servers.length} servers assignable
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Search
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search users"
            className="mt-1 w-56"
          />
        </label>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Showing {users.length} of {data?.pagination?.total ?? users.length}
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
          Loading users...
        </div>
      ) : users.length ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {users.map((user) => (
              <div
                key={user.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-surface-light transition-all duration-300 hover:-translate-y-1 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/60 dark:shadow-surface-dark dark:hover:border-primary-500/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {user.username}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-500">
                      Created {new Date(user.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500/30"
                      onClick={async () => {
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

                        // Load user's server selections
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

                        // Load user's node assignments
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
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-md border border-rose-700 px-2 py-1 text-xs font-semibold text-rose-200 transition-all duration-300 hover:border-rose-500"
                      onClick={() => setDeletingUser({ id: user.id, username: user.username })}
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                    {user.email}
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                      Roles
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {user.roles.length ? (
                        user.roles.map((role) => (
                          <span
                            key={role.id}
                            className="rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300"
                          >
                            {role.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-500 dark:text-slate-500">No roles</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {pagination ? (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500 shadow-surface-light dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400 dark:shadow-surface-dark">
              <span>
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-200 disabled:opacity-50"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                >
                  Previous
                </button>
                <button
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-200 disabled:opacity-50"
                  onClick={() =>
                    setPage((prev) => (pagination.page < pagination.totalPages ? prev + 1 : prev))
                  }
                  disabled={pagination.page >= pagination.totalPages}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title={search.trim() ? 'No users found' : 'No users'}
          description={
            search.trim()
              ? 'Try a different username or email.'
              : 'Create a user account to grant dashboard access.'
          }
        />
      )}
      {isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 md:m-4 md:h-auto md:max-h-[90vh]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  Create user
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Assign credentials, roles, and server access.
                </p>
              </div>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setIsCreateOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-slate-900 dark:text-slate-100">
              <div className="space-y-6">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Account details
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="text-xs text-slate-600 dark:text-slate-300">
                    Email
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="user@example.com"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                    />
                  </label>
                  <label className="text-xs text-slate-600 dark:text-slate-300">
                    Username
                    <input
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      placeholder="username"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                    />
                  </label>
                  <label className="text-xs text-slate-600 dark:text-slate-300">
                    Password (min 8 chars)
                    <input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="********"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                    />
                  </label>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Roles
                  </div>
                  <Input
                    value={roleSearch}
                    onChange={(event) => setRoleSearch(event.target.value)}
                    placeholder="Search roles"
                    className="mt-2 w-full"
                  />
                  <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                    {filteredRoles.map((role) => (
                      <label
                        key={role.id}
                        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={roleIds.includes(role.id)}
                          onChange={() => setRoleIds((prev) => toggleItem(prev, role.id))}
                          className="h-4 w-4 rounded border-slate-200 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
                        />
                        {role.name}
                      </label>
                    ))}
                    {!filteredRoles.length ? (
                      <span className="text-xs text-slate-500 dark:text-slate-500">No roles match</span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Server access
                  </div>
                  <Input
                    value={serverSearch}
                    onChange={(event) => setServerSearch(event.target.value)}
                    placeholder="Search servers"
                    className="mt-2 w-full"
                  />
                  <div className="mt-3 flex max-h-36 flex-col gap-2 overflow-y-auto">
                    {filteredServers.map((server) => (
                      <label
                        key={server.id}
                        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={serverIds.includes(server.id)}
                          onChange={() => setServerIds((prev) => toggleItem(prev, server.id))}
                          className="h-4 w-4 rounded border-slate-200 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
                        />
                        <span>{server.name}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-500">
                          ({server.id})
                        </span>
                      </label>
                    ))}
                    {!filteredServers.length ? (
                      <span className="text-xs text-slate-500 dark:text-slate-500">
                        No servers match
                      </span>
                    ) : null}
                  </div>
                </div>
                {/* Node Assignments for new user */}
                <NodeAssignmentsSelector
                  selectedNodes={[]} // Empty for new user
                  onSelectionChange={() => {}}
                  disabled={false}
                  label="Node Access (optional)"
                />
              </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Passwords must be at least 8 characters.
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setRoleSearch('');
                    setServerSearch('');
                  }}
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  disabled={!canSubmit || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  Create user
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {editingUserId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950 md:m-4 md:h-auto md:max-h-[90vh]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Edit user</h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Update profile details, roles, and server access.
                </p>
              </div>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setEditingUserId(null)}
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-slate-900 dark:text-slate-100">
              <div className="space-y-6">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Account details
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                      Email
                      <input
                        type="email"
                        value={editEmail}
                        onChange={(event) => setEditEmail(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                      />
                    </label>
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                      Username
                      <input
                        value={editUsername}
                        onChange={(event) => setEditUsername(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                      />
                    </label>
                    <label className="text-xs text-slate-600 dark:text-slate-300">
                      Password (leave blank to keep)
                      <input
                        type="password"
                        value={editPassword}
                        onChange={(event) => setEditPassword(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                      />
                    </label>
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Roles
                  </div>
                  <Input
                    value={editRoleSearch}
                    onChange={(event) => setEditRoleSearch(event.target.value)}
                    placeholder="Search roles"
                    className="mt-2 w-full"
                  />
                  <div className="mt-3 flex max-h-36 flex-wrap gap-2 overflow-y-auto">
                    {filteredEditRoles.map((role) => (
                      <label
                        key={role.id}
                        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={editRoleIds.includes(role.id)}
                          onChange={() => setEditRoleIds((prev) => toggleItem(prev, role.id))}
                          className="h-4 w-4 rounded border-slate-200 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
                        />
                        {role.name}
                      </label>
                    ))}
                    {!filteredEditRoles.length ? (
                      <span className="text-xs text-slate-500 dark:text-slate-500">No roles match</span>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Server access
                  </div>
                  <Input
                    value={editServerSearch}
                    onChange={(event) => setEditServerSearch(event.target.value)}
                    placeholder="Search servers"
                    className="mt-2 w-full"
                  />
                  <div className="mt-3 flex max-h-36 flex-col gap-2 overflow-y-auto">
                    {filteredEditServers.map((server) => (
                      <label
                        key={server.id}
                        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                      >
                        <input
                          type="checkbox"
                          checked={editServerIds.includes(server.id)}
                          onChange={() => setEditServerIds((prev) => toggleItem(prev, server.id))}
                          className="h-4 w-4 rounded border-slate-200 bg-white text-primary-600 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
                        />
                        <span>{server.name}</span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-500">
                          ({server.id})
                        </span>
                      </label>
                    ))}
                    {!filteredEditServers.length ? (
                      <span className="text-xs text-slate-500 dark:text-slate-500">
                        No servers match
                      </span>
                    ) : null}
                  </div>
                </div>
                </div>
                {/* Node Assignments */}
                <NodeAssignmentsSelector
                  userId={editingUserId}
                  selectedNodes={selectedNodeIds}
                  onSelectionChange={setSelectedNodeIds}
                  disabled={updateMutation.isPending}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Leave password blank to keep current credentials.
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => {
                    setEditingUserId(null);
                    setEditRoleSearch('');
                    setEditServerSearch('');
                    setSelectedNodeIds([]);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => editingUserId && updateMutation.mutate(editingUserId)}
                  disabled={!canSubmitEdit || updateMutation.isPending}
                >
                  Save changes
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Delete user confirmation dialog */}
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
    </div>
  );
}

export default UsersPage;
