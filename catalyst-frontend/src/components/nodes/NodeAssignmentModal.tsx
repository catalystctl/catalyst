import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '../../services/api/nodes';
import { adminApi } from '../../services/api/admin';
import { rolesApi } from '../../services/api/roles';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  nodeId: string;
  open: boolean;
  onClose: () => void;
};

type AssignmentTarget = 'user' | 'role';

function NodeAssignmentModal({ nodeId, open, onClose }: Props) {
  const queryClient = useQueryClient();
  const [targetType, setTargetType] = useState<AssignmentTarget>('user');
  const [targetId, setTargetId] = useState('');
  const [search, setSearch] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  // Fetch users for selection
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users', 'list', search],
    queryFn: () => adminApi.listUsers({ search, limit: 50 }),
    enabled: open && targetType === 'user',
  });

  // Fetch roles for selection
  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ['roles', 'list'],
    queryFn: () => rolesApi.list(),
    enabled: open && targetType === 'role',
  });

  // Create assignment mutation
  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!targetId) {
        throw new Error('Please select a target');
      }
      return nodesApi.assignNode(nodeId, {
        targetType,
        targetId,
        expiresAt: expiresAt || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes', nodeId, 'assignments'] });
      notifySuccess('Node assigned successfully');
      handleClose();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to assign node';
      notifyError(message);
    },
  });

  const users = usersData?.users || [];
  const roles = rolesData || [];

  const handleSubmit = () => {
    assignMutation.mutate();
  };

  const handleClose = () => {
    setTargetType('user');
    setTargetId('');
    setSearch('');
    setExpiresAt('');
    onClose();
  };

  // Filter targets based on search
  const filteredUsers = search
    ? users.filter((u) =>
        u.username?.toLowerCase().includes(search.toLowerCase()) ||
        u.email?.toLowerCase().includes(search.toLowerCase())
      )
    : users;

  const filteredRoles = search
    ? roles.filter((r) =>
        r.name?.toLowerCase().includes(search.toLowerCase()) ||
        r.description?.toLowerCase().includes(search.toLowerCase())
      )
    : roles;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Assign Node</h2>
          <button
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
            onClick={handleClose}
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
          {/* Target Type Selection */}
          <div>
            <span className="text-slate-500 dark:text-slate-400">Assign to</span>
            <div className="mt-2 flex gap-2">
              <button
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                  targetType === 'user'
                    ? 'border-primary-500 bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-700'
                }`}
                onClick={() => {
                  setTargetType('user');
                  setTargetId('');
                }}
              >
                User
              </button>
              <button
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                  targetType === 'role'
                    ? 'border-primary-500 bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:text-slate-300 dark:hover:border-slate-700'
                }`}
                onClick={() => {
                  setTargetType('role');
                  setTargetId('');
                }}
              >
                Role
              </button>
            </div>
          </div>

          {/* Search */}
          <div>
            <span className="text-slate-500 dark:text-slate-400">
              Search {targetType === 'user' ? 'users' : 'roles'}
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={targetType === 'user' ? 'Search by username or email...' : 'Search roles...'}
            />
          </div>

          {/* Target List */}
          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            {targetType === 'user' ? (
              usersLoading ? (
                <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                  Loading users...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                  No users found
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      className={`w-full px-4 py-2 text-left transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                        targetId === user.id
                          ? 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                      onClick={() => setTargetId(user.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{user.username}</span>
                        <span className="text-xs text-slate-400">{user.email}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : rolesLoading ? (
              <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                Loading roles...
              </div>
            ) : filteredRoles.length === 0 ? (
              <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                No roles found
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredRoles.map((role) => (
                  <button
                    key={role.id}
                    className={`w-full px-4 py-2 text-left transition-all duration-200 hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                      targetId === role.id
                        ? 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                    onClick={() => setTargetId(role.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{role.name}</span>
                      {role.description && (
                        <span className="text-xs text-slate-400">{role.description}</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected Target Display */}
          {targetId && (
            <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 dark:border-primary-500/30 dark:bg-primary-500/10">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Selected: {targetType === 'user'
                  ? filteredUsers.find((u) => u.id === targetId)?.username || 'Unknown user'
                  : filteredRoles.find((r) => r.id === targetId)?.name || 'Unknown role'
                }
              </span>
            </div>
          )}

          {/* Optional Expiration */}
          <div>
            <span className="text-slate-500 dark:text-slate-400">Expiration (optional)</span>
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              Leave empty for no expiration
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
          <button
            className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={handleSubmit}
            disabled={!targetId || assignMutation.isPending}
          >
            {assignMutation.isPending ? 'Assigning...' : 'Assign Node'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default NodeAssignmentModal;
