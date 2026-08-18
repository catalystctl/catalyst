import { useState } from 'react';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { nodesApi } from '../../services/api/nodes';
import { adminApi } from '../../services/api/admin';
import { rolesApi } from '../../services/api/roles';
import { notifyError, notifySuccess } from '../../utils/notify';
import { reportSystemError } from '../../services/api/systemErrors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

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
    queryKey: qk.adminUsers({ search }),
    queryFn: () => adminApi.listUsers({ search, limit: 50 }),
    enabled: open && targetType === 'user',
    staleTime: 60_000,
  });

  // Fetch roles for selection
  const { data: rolesData, isLoading: rolesLoading } = useQuery({
    queryKey: qk.adminRoles(),
    queryFn: () => rolesApi.list(),
    enabled: open && targetType === 'role',
    staleTime: 60_000,
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
      notifySuccess('Node assigned successfully');
      handleClose();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.nodeAssignments(nodeId) });
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

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Assign node</DialogTitle>
          <DialogDescription>
            Grant a user or role access to this node.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Label>Assign to</Label>
            <div className="flex gap-2">
              <button
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-all ${
                  targetType === 'user'
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border/40 text-muted-foreground hover:border-border/60'
                }`}
                onClick={() => {
                  setTargetType('user');
                  setTargetId('');
                }}
              >
                User
              </button>
              <button
                className={`rounded-lg border px-4 py-2 text-sm font-semibold transition-all ${
                  targetType === 'role'
                    ? 'border-primary/50 bg-primary/10 text-primary'
                    : 'border-border/40 text-muted-foreground hover:border-border/60'
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

          <div className="space-y-2">
            <Label htmlFor="node-assign-search">
              Search {targetType === 'user' ? 'users' : 'roles'}
            </Label>
            <Input
              id="node-assign-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={targetType === 'user' ? 'Search by username or email...' : 'Search roles...'}
            />
          </div>

          <div className="max-h-48 overflow-y-auto rounded-lg border border-border/30">
            {targetType === 'user' ? (
              usersLoading ? (
                <div className="p-4 text-center text-muted-foreground">
                  Loading users...
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">
                  No users found
                </div>
              ) : (
                <div className="divide-y divide-border/30">
                  {filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      className={`w-full px-4 py-2 text-left transition-all hover:bg-surface-2/50 ${
                        targetId === user.id
                          ? 'bg-primary/10 text-primary'
                          : 'text-muted-foreground'
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
              <div className="p-4 text-center text-muted-foreground">
                Loading roles...
              </div>
            ) : filteredRoles.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground">
                No roles found
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {filteredRoles.map((role) => (
                  <button
                    key={role.id}
                    className={`w-full px-4 py-2 text-left transition-all hover:bg-surface-2/50 ${
                      targetId === role.id
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground'
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

          {targetId && (
            <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2">
              <span className="text-xs text-muted-foreground">
                Selected: {targetType === 'user'
                  ? filteredUsers.find((u) => u.id === targetId)?.username || 'Unknown user'
                  : filteredRoles.find((r) => r.id === targetId)?.name || 'Unknown role'
                }
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="node-assign-expires">Expiration (optional)</Label>
            <Input
              id="node-assign-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
            <p className="text-xs text-muted-foreground">
              Leave empty for no expiration
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!targetId || assignMutation.isPending}>
            {assignMutation.isPending ? 'Assigning...' : 'Assign node'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NodeAssignmentModal;
