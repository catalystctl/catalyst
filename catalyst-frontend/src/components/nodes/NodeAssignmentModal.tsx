import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { cn } from '@/lib/utils';
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
  const { t } = useTranslation('nodes');
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
      notifySuccess(t('assign.success'));
      handleClose();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.nodeAssignments(nodeId) });
    },
    onError: (error: unknown) => {
      notifyError(error, 'nodes:assign.error');
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
          <DialogTitle>{t('assign.title')}</DialogTitle>
          <DialogDescription>
            {t('assign.description')}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="space-y-2">
            <Label compact>{t('assign.target')}</Label>
            <div className="flex items-center gap-0.5 border-b border-border/50">
              {(['user', 'role'] as AssignmentTarget[]).map((type) => (
                <button
                  key={type}
                  className={cn(
                    'relative h-7 px-3 text-mini transition-colors',
                    targetType === type
                      ? 'text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => {
                    setTargetType(type);
                    setTargetId('');
                  }}
                >
                  {type === 'user' ? t('assign.user') : t('assign.role')}
                  {targetType === type && (
                    <span className="absolute inset-x-1 bottom-0 h-[2px] bg-primary" aria-hidden />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label compact htmlFor="node-assign-search">
              {targetType === 'user' ? t('assign.searchUsers') : t('assign.searchRoles')}
            </Label>
            <Input
              id="node-assign-search"
              className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={targetType === 'user'
                ? t('assign.searchUsersPlaceholder')
                : t('assign.searchRolesPlaceholder')}
            />
          </div>

          <div className="max-h-48 overflow-y-auto rounded-sm border border-border/50">
            {targetType === 'user' ? (
              usersLoading ? (
                <div className="type-meta p-4 text-center">
                  {t('assign.loadingUsers')}
                </div>
              ) : filteredUsers.length === 0 ? (
                <div className="type-meta p-4 text-center">
                  {t('assign.noUsers')}
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-mini transition-colors hover:bg-surface-1/40',
                        targetId === user.id ? 'bg-primary/10 text-foreground' : 'text-muted-foreground',
                      )}
                      onClick={() => setTargetId(user.id)}
                    >
                      <span className="truncate font-medium">{user.username}</span>
                      <span className="truncate font-mono text-micro tabular-nums">{user.email}</span>
                    </button>
                  ))}
                </div>
              )
            ) : rolesLoading ? (
              <div className="type-meta p-4 text-center">
                {t('assign.loadingRoles')}
              </div>
            ) : filteredRoles.length === 0 ? (
              <div className="type-meta p-4 text-center">
                {t('assign.noRoles')}
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {filteredRoles.map((role) => (
                  <button
                    key={role.id}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-mini transition-colors hover:bg-surface-1/40',
                      targetId === role.id ? 'bg-primary/10 text-foreground' : 'text-muted-foreground',
                    )}
                    onClick={() => setTargetId(role.id)}
                  >
                    <span className="truncate font-medium">{role.name}</span>
                    {role.description && (
                      <span className="truncate text-micro">{role.description}</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {targetId && (
            <div className="rounded-sm border border-border/50 px-3 py-2 text-mini text-muted-foreground">
              {t('assign.selected', {
                name: targetType === 'user'
                  ? filteredUsers.find((u) => u.id === targetId)?.username || t('assign.unknownUser')
                  : filteredRoles.find((r) => r.id === targetId)?.name || t('assign.unknownRole'),
              })}
            </div>
          )}

          <div className="space-y-2">
            <Label compact htmlFor="node-assign-expires">{t('assign.expiration')}</Label>
            <Input
              id="node-assign-expires"
              className="h-8 rounded-sm border-border/60 bg-background/40 px-2.5 text-mini"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={new Date().toISOString().slice(0, 16)}
            />
            <p className="type-overline">
              {t('assign.expirationHint')}
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" className="h-8 px-3 text-mini" onClick={handleClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            size="sm"
            className="h-8 px-3 text-mini"
            onClick={handleSubmit}
            disabled={!targetId || assignMutation.isPending}
          >
            {assignMutation.isPending ? t('assign.assigning') : t('assign.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NodeAssignmentModal;
