import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { nodesApi } from '../../services/api/nodes';
import { adminApi } from '../../services/api/admin';
import { rolesApi } from '../../services/api/roles';
import { notifyError, notifySuccess } from '../../utils/notify';
import { reportSystemError } from '../../services/api/systemErrors';
import { ModalPortal } from '@/components/ui/modal-portal';

type Props = {
  nodeId: string;
  open: boolean;
  onClose: () => void;
};

type AssignmentTarget = 'user' | 'role';

function NodeAssignmentModal({ nodeId, open, onClose }: Props) {
  const [targetType, setTargetType] = useState<AssignmentTarget>('user');
  const [targetId, setTargetId] = useState('');
  const [search, setSearch] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

  // Fetch users for selection
  const { data: usersData, isLoading: usersLoading } = useQuery({
    queryKey: ['admin', 'users', 'list', search],
    queryFn: () => adminApi.listUsers({ search, limit: 50 }),
    enabled: open && targetType === 'user',
    refetchInterval: 10000,
  });

  // Fetch roles for selection
  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: ['roles', 'list'],
    queryFn: () => rolesApi.list(),
    enabled: open && targetType === 'role',
    refetchInterval: 10000,
  });

  // Create assignment mutation
  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!targetId) {
        reportSystemError({ level: 'error', component: 'NodeAssignmentModal', message: 'Please select a target', metadata: { context: 'assign mutation' } });
        throw new Error('Please select a target');
      }
      return nodesApi.assignNode(nodeId, {
        targetType,
        targetId,
        expiresAt: expiresAt || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.nodeAssignments(nodeId) });
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
    <ModalPortal>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-zinc-950/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-border bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 dark:border-border">
          <h2 className="text-lg font-semibold text-foreground dark:text-white">Assign Node</h2>
          <button
            className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary-500 dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
            onClick={handleClose}
          >
            Close
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 px-6 py-4 text-sm text-muted-foreground dark:text-zinc-300">
          {/* Target Type Selection */}
          <div>
            <span className="text-muted-foreground dark:text-muted-foreground">Assign to</span>
            <div className="mt-2 flex gap-2">
              <button
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                  targetType === 'user'
                    ? 'border-primary-500 bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                    : 'border-border text-muted-foreground hover:border-border dark:border-border dark:text-zinc-300 dark:hover:border-border'
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
                    : 'border-border text-muted-foreground hover:border-border dark:border-border dark:text-zinc-300 dark:hover:border-border'
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
            <span className="text-muted-foreground dark:text-muted-foreground">
              Search {targetType === 'user' ? 'users' : 'roles'}
            </span>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={targetType === 'user' ? 'Search by username or email...' : 'Search roles...'}
            />
          </div>

          {/* Target List */}
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border dark:border-border">
            {targetType === 'user' ? (
              usersLoading ? (
                <div className="p-4 text-center text-muted-foreground dark:text-muted-foreground">
                  Loading users...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground dark:text-muted-foreground">
                  No users found
                </div>
              ) : (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      className={`w-full px-4 py-2 text-left transition-all duration-200 hover:bg-surface-2 dark:hover:bg-surface-2/50 ${
                        targetId === user.id
                          ? 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                          : 'text-muted-foreground dark:text-zinc-300'
                      }`}
                      onClick={() => setTargetId(user.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{user.username}</span>
                        <span className="text-xs text-muted-foreground">{user.email}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )
            ) : rolesLoading ? (
              <div className="p-4 text-center text-muted-foreground dark:text-muted-foreground">
                Loading roles...
              </div>
            ) : filteredRoles.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground dark:text-muted-foreground">
                No roles found
              </div>
            ) : (
              <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredRoles.map((role) => (
                  <button
                    key={role.id}
                    className={`w-full px-4 py-2 text-left transition-all duration-200 hover:bg-surface-2 dark:hover:bg-surface-2/50 ${
                      targetId === role.id
                        ? 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-400'
                        : 'text-muted-foreground dark:text-zinc-300'
                    }`}
                    onClick={() => setTargetId(role.id)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{role.name}</span>
                      {role.description && (
                        <span className="text-xs text-muted-foreground">{role.description}</span>
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
              <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                Selected: {targetType === 'user'
                  ? filteredUsers.find((u) => u.id === targetId)?.username || 'Unknown user'
                  : filteredRoles.find((r) => r.id === targetId)?.name || 'Unknown role'
                }
              </span>
            </div>
          )}

          {/* Optional Expiration */}
          <div>
            <span className="text-muted-foreground dark:text-muted-foreground">Expiration (optional)</span>
            <input
              className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
            <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
              Leave empty for no expiration
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4 text-xs dark:border-border">
          <button
            className="rounded-md border border-border px-3 py-1 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
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
    </ModalPortal>
  );
}

export default NodeAssignmentModal;
