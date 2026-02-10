import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminTabs from '../../components/admin/AdminTabs';
import EmptyState from '../../components/shared/EmptyState';
import Input from '../../components/ui/input';
import { rolesApi } from '../../services/api/roles';
import { notifyError, notifySuccess } from '../../utils/notify';

// Permission categories for organization
const PERMISSION_CATEGORIES = [
  {
    label: 'Server',
    permissions: [
      'server.read',
      'server.create',
      'server.start',
      'server.stop',
      'server.delete',
      'server.suspend',
      'server.transfer',
      'server.schedule',
    ],
  },
  {
    label: 'Node',
    permissions: [
      'node.read',
      'node.create',
      'node.update',
      'node.delete',
      'node.view_stats',
      'node.manage_allocation',
    ],
  },
  {
    label: 'Location',
    permissions: [
      'location.read',
      'location.create',
      'location.update',
      'location.delete',
    ],
  },
  {
    label: 'Template',
    permissions: [
      'template.read',
      'template.create',
      'template.update',
      'template.delete',
    ],
  },
  {
    label: 'User Management',
    permissions: [
      'user.read',
      'user.create',
      'user.update',
      'user.delete',
      'user.ban',
      'user.unban',
      'user.set_roles',
    ],
  },
  {
    label: 'Role Management',
    permissions: [
      'role.read',
      'role.create',
      'role.update',
      'role.delete',
    ],
  },
  {
    label: 'Backup',
    permissions: [
      'backup.read',
      'backup.create',
      'backup.delete',
      'backup.restore',
    ],
  },
  {
    label: 'File Management',
    permissions: ['file.read', 'file.write'],
  },
  {
    label: 'Console',
    permissions: ['console.read', 'console.write'],
  },
  {
    label: 'Database',
    permissions: [
      'database.create',
      'database.read',
      'database.delete',
      'database.rotate',
    ],
  },
  {
    label: 'Alerts',
    permissions: [
      'alert.read',
      'alert.create',
      'alert.update',
      'alert.delete',
    ],
  },
  {
    label: 'System Administration',
    permissions: ['admin.read', 'admin.write', 'apikey.manage'],
  },
];

// Permission presets
const PERMISSION_PRESETS = [
  {
    key: 'administrator',
    label: 'Administrator',
    description: 'Full system access',
    permissions: ['*'],
  },
  {
    key: 'moderator',
    label: 'Moderator',
    description: 'Can manage most resources but not users/roles',
    permissions: [
      'node.read',
      'node.update',
      'node.view_stats',
      'location.read',
      'template.read',
      'user.read',
      'server.read',
      'server.start',
      'server.stop',
      'file.read',
      'file.write',
      'console.read',
      'console.write',
      'alert.read',
      'alert.create',
      'alert.update',
      'alert.delete',
    ],
  },
  {
    key: 'user',
    label: 'User',
    description: 'Basic access to own servers',
    permissions: ['server.read'],
  },
  {
    key: 'support',
    label: 'Support',
    description: 'Read-only access for support staff',
    permissions: [
      'node.read',
      'node.view_stats',
      'location.read',
      'template.read',
      'server.read',
      'file.read',
      'console.read',
      'alert.read',
      'user.read',
    ],
  },
];

function RolesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [viewingRole, setViewingRole] = useState<any>(null);
  const editingRequestRef = useRef(0);

  // Form state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [permissionSearch, setPermissionSearch] = useState('');

  // Fetch roles
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: rolesApi.list,
  });

  // Fetch presets
  const { data: presets = [] } = useQuery({
    queryKey: ['role-presets'],
    queryFn: rolesApi.getPresets,
  });

  // Create role mutation
  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; permissions: string[] }) =>
      rolesApi.create(data),
    onSuccess: () => {
      notifySuccess('Role created');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      resetForm();
      setIsCreateOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to create role';
      notifyError(message);
    },
  });

  // Update role mutation
  const updateMutation = useMutation({
    mutationFn: ({ roleId, data }: { roleId: string; data: Partial<{ name: string; description?: string; permissions: string[] }> }) =>
      rolesApi.update(roleId, data),
    onSuccess: () => {
      notifySuccess('Role updated');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      resetForm();
      setEditingRole(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update role';
      notifyError(message);
    },
  });

  // Delete role mutation
  const deleteMutation = useMutation({
    mutationFn: (roleId: string) => rolesApi.delete(roleId),
    onSuccess: () => {
      notifySuccess('Role deleted');
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setViewingRole(null);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to delete role';
      notifyError(message);
    },
  });

  // Toggle permission selection
  const togglePermission = (permission: string) => {
    const newSet = new Set(selectedPermissions);
    if (newSet.has(permission)) {
      newSet.delete(permission);
    } else {
      newSet.add(permission);
    }
    setSelectedPermissions(newSet);
  };

  // Apply preset
  const applyPreset = (preset: typeof PERMISSION_PRESETS[0]) => {
    setName(preset.label);
    setDescription(preset.description);
    setSelectedPermissions(new Set(preset.permissions));
  };

  // Reset form
  const resetForm = () => {
    setName('');
    setDescription('');
    setSelectedPermissions(new Set());
    setPermissionSearch('');
  };

  // Start editing
  const startEdit = (role: any) => {
    const requestId = editingRequestRef.current + 1;
    editingRequestRef.current = requestId;
    setEditingRole(role);
    setName(role.name);
    setDescription(role.description || '');
    setSelectedPermissions(new Set(role.permissions || []));
    setIsCreateOpen(false);
    setViewingRole(null);
  };

  // Start viewing
  const startView = (role: any) => {
    setViewingRole(role);
    setEditingRole(null);
    setIsCreateOpen(false);
  };

  // Filter roles by search
  const filteredRoles = useMemo(
    () =>
      roles.filter(
        (role: any) =>
          role.name.toLowerCase().includes(search.toLowerCase()) ||
          (role.description?.toLowerCase().includes(search.toLowerCase()) ?? false)
      ),
    [roles, search]
  );

  // Filter permissions by search
  const filteredCategories = useMemo(() => {
    const searchLower = permissionSearch.toLowerCase();
    return PERMISSION_CATEGORIES.map((category) => ({
      ...category,
      permissions: category.permissions.filter((p) =>
        p.toLowerCase().includes(searchLower) || category.label.toLowerCase().includes(searchLower)
      ),
    })).filter((category) => category.permissions.length > 0);
  }, [permissionSearch]);

  // Format permission for display
  const formatPermission = (perm: string): string => {
    if (perm === '*') return '* (All Permissions)';
    return perm
      .split('.')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  // Check if form is valid
  const canSubmit = name.trim().length > 0 && selectedPermissions.size > 0;
  const canSubmitEdit = name.trim().length > 0 && selectedPermissions.size > 0;

  return (
    <div className="space-y-6">
      <AdminTabs />

      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Roles</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Manage user roles and their permissions.
            </p>
          </div>
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
            onClick={() => {
              resetForm();
              setIsCreateOpen(true);
              setEditingRole(null);
              setViewingRole(null);
            }}
          >
            Create role
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {roles.length} total roles
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {presets.length} presets available
          </span>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <label className="text-xs text-slate-600 dark:text-slate-300">
          Search
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search roles"
            className="mt-1 w-56"
          />
        </label>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Showing {filteredRoles.length} role{filteredRoles.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* Main Content Grid */}
      {isLoading ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-4 py-6 text-slate-600 dark:text-slate-200">
          Loading roles...
        </div>
      ) : filteredRoles.length === 0 ? (
        <EmptyState
          title={search.trim() ? 'No roles found' : 'No roles'}
          description={
            search.trim()
              ? 'Try a different role name or description.'
              : 'Create a role to define permissions for users.'
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filteredRoles.map((role: any) => (
            <div
              key={role.id}
              className={`rounded-2xl border p-5 shadow-surface-light transition-all duration-300 hover:-translate-y-1 dark:shadow-surface-dark ${
                viewingRole?.id === role.id
                  ? 'border-primary-500 bg-white dark:border-primary-500/30 dark:bg-slate-950/60'
                  : 'border-slate-200 bg-white hover:border-primary-500 dark:border-slate-800 dark:bg-slate-950/60 dark:hover:border-primary-500/30'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                    {role.name}
                  </div>
                  {role.description && (
                    <div className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      {role.description}
                    </div>
                  )}
                  <div className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                    {role.permissions?.length || 0} permission{role.permissions?.length === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() => startView(role)}
                  >
                    View
                  </button>
                  <button
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500/30"
                    onClick={() => startEdit(role)}
                  >
                    Edit
                  </button>
                  {role.userCount === 0 ? (
                    <button
                      className="rounded-md border border-rose-700 px-2 py-1 text-xs font-semibold text-rose-200 transition-all duration-300 hover:border-rose-500"
                      onClick={() => {
                        if (confirm(`Are you sure you want to delete "${role.name}"?`)) {
                          deleteMutation.mutate(role.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      Delete
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500 dark:text-slate-500">
                      {role.userCount} user{role.userCount === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </div>

              {/* Permission preview */}
              <div className="mt-4">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-500">
                  Permissions
                </div>
                <div className="mt-2 flex max-h-24 flex-col gap-1 overflow-y-auto">
                  {role.permissions?.slice(0, 3).map((permission: string) => (
                    <div
                      key={permission}
                      className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
                    >
                      {permission === '*' ? (
                        <span className="font-medium text-yellow-600 dark:text-yellow-400">* (All)</span>
                      ) : (
                        permission
                      )}
                    </div>
                  ))}
                  {role.permissions?.length > 3 && (
                    <div className="text-xs text-slate-500 dark:text-slate-500">
                      +{role.permissions.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {isCreateOpen || editingRole ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10">
          <div className="w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {editingRole ? 'Edit role' : 'Create role'}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {editingRole ? 'Update role name, description, and permissions.' : 'Define a new role with specific permissions.'}
                </p>
              </div>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => {
                  resetForm();
                  setIsCreateOpen(false);
                  setEditingRole(null);
                }}
              >
                Close
              </button>
            </div>

            <div className="space-y-6 px-6 py-5 text-sm text-slate-900 dark:text-slate-100">
              {/* Presets - only for create */}
              {!editingRole && presets.length > 0 && (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
                    Quick start
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {presets.map((preset) => (
                      <button
                        key={preset.key}
                        onClick={() => applyPreset(preset)}
                        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
                      >
                        {preset.label}
                        <span className="text-slate-500 dark:text-slate-400">({preset.permissions.length})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Basic Info */}
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Role details
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <label className="text-xs text-slate-600 dark:text-slate-300">
                    Name
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Moderator"
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                    />
                  </label>
                  <label className="text-xs text-slate-600 dark:text-slate-300">
                    Description
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Describe what this role can do..."
                      rows={1}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
                    />
                  </label>
                </div>
              </div>

              {/* Permissions */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Permissions ({selectedPermissions.size})
                  </div>
                  <Input
                    value={permissionSearch}
                    onChange={(e) => setPermissionSearch(e.target.value)}
                    placeholder="Search permissions..."
                    className="w-48"
                  />
                </div>

                <div className="space-y-3 max-h-64 overflow-y-auto">
                  {filteredCategories.map((category) => (
                    <div key={category.label}>
                      <h4 className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                        {category.label}
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        {category.permissions.map((permission) => (
                          <label
                            key={permission}
                            className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-all duration-300 ${
                              selectedPermissions.has(permission)
                                ? 'border-primary-500 bg-primary-500/10 dark:bg-primary-500/20 dark:border-primary-500/30'
                                : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedPermissions.has(permission)}
                              onChange={() => togglePermission(permission)}
                              className="h-4 w-4 rounded border-slate-200 bg-white text-primary-600 focus:ring-primary-500 dark:border-slate-700 dark:bg-slate-900 dark:text-primary-400"
                            />
                            <span className="text-slate-700 dark:text-slate-300">{formatPermission(permission)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Wildcard permission */}
                <label
                  className={`flex items-center gap-3 rounded-lg border px-3 py-2 mt-3 transition-all ${
                    selectedPermissions.has('*')
                      ? 'border-yellow-500/50 bg-yellow-500/10 dark:bg-yellow-500/20'
                      : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/60'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedPermissions.has('*')}
                    onChange={() => togglePermission('*')}
                    className="h-4 w-4 rounded border-slate-200 bg-white text-yellow-600 focus:ring-yellow-500 dark:border-slate-700 dark:bg-slate-900 dark:text-yellow-400"
                  />
                  <div>
                    <div className="text-xs font-medium text-yellow-700 dark:text-yellow-400">
                      Wildcard (*)
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">
                      Grants all permissions
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">
                {selectedPermissions.size} permission{selectedPermissions.size === 1 ? '' : 's'} selected
              </span>
              <div className="flex gap-2">
                <button
                  className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => {
                    resetForm();
                    setIsCreateOpen(false);
                    setEditingRole(null);
                  }}
                >
                  Cancel
                </button>
                <button
                  className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  disabled={!canSubmit || createMutation.isPending || updateMutation.isPending}
                  onClick={() => {
                    const data = {
                      name: name.trim(),
                      description: description.trim() || undefined,
                      permissions: Array.from(selectedPermissions),
                    };
                    if (editingRole) {
                      updateMutation.mutate({ roleId: editingRole.id, data });
                    } else {
                      createMutation.mutate(data);
                    }
                  }}
                >
                  {createMutation.isPending || updateMutation.isPending
                    ? 'Saving...'
                    : editingRole
                    ? 'Save changes'
                    : 'Create role'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Role Detail Modal */}
      {viewingRole && !editingRole && !isCreateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-6 py-5 dark:border-slate-800">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {viewingRole.name}
                </h2>
                {viewingRole.description && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {viewingRole.description}
                  </p>
                )}
              </div>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setViewingRole(null)}
              >
                Close
              </button>
            </div>

            <div className="px-6 py-5 text-sm text-slate-900 dark:text-slate-100">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-3">
                Permissions ({viewingRole.permissions?.length || 0})
              </div>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                {viewingRole.permissions?.map((permission: string) => (
                  <div
                    key={permission}
                    className={`rounded-md px-2 py-1 text-xs ${
                      permission === '*'
                        ? 'font-medium text-yellow-700 bg-yellow-500/10 dark:text-yellow-400 dark:bg-yellow-500/20'
                        : 'text-slate-700 bg-white dark:text-slate-300 dark:bg-slate-950'
                    }`}
                  >
                    {permission === '*' ? '* (All Permissions)' : permission}
                  </div>
                ))}
              </div>

              {/* Metadata */}
              <div className="mt-4 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                <div>Role ID: {viewingRole.id}</div>
                <div>
                  Created:{' '}
                  {new Date(viewingRole.createdAt).toLocaleDateString()} at{' '}
                  {new Date(viewingRole.createdAt).toLocaleTimeString()}
                </div>
                {viewingRole.updatedAt !== viewingRole.createdAt && (
                  <div>
                    Updated:{' '}
                    {new Date(viewingRole.updatedAt).toLocaleDateString()} at{' '}
                    {new Date(viewingRole.updatedAt).toLocaleTimeString()}
                  </div>
                )}
                {viewingRole.userCount !== undefined && viewingRole.userCount > 0 && (
                  <div className="text-slate-600 dark:text-slate-300">
                    Assigned to {viewingRole.userCount} user{viewingRole.userCount === 1 ? '' : 's'}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => startEdit(viewingRole)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                >
                  Edit role
                </button>
                {viewingRole.userCount === 0 && (
                  <button
                    onClick={() => {
                      if (confirm(`Are you sure you want to delete "${viewingRole.name}"?`)) {
                        deleteMutation.mutate(viewingRole.id);
                      }
                    }}
                    disabled={deleteMutation.isPending}
                    className="rounded-md border border-rose-700 px-3 py-1.5 text-xs font-semibold text-rose-200 transition-all duration-300 hover:border-rose-500 disabled:opacity-60"
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete role'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default RolesPage;
