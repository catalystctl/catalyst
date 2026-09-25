import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate } from '@/i18n/format';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { Shield, User, X } from 'lucide-react';
import { Segmented } from '../deck/primitives';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';
import ConfirmDialog from '../shared/ConfirmDialog';
import ServerTabCard from '../servers/tabs/ServerTabCard';
import SectionHeader from '../servers/tabs/SectionHeader';
import TabLoadingState from '../servers/tabs/TabLoadingState';

type Props = {
  nodeId: string;
  canManage: boolean;
};

function NodeAssignmentsList({ nodeId, canManage }: Props) {
  const { t } = useTranslation('nodes');
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: qk.nodeAssignments(nodeId),
    queryFn: () => nodesApi.getAssignments(nodeId),
    staleTime: 30_000,
  });

  const removeMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return nodesApi.removeAssignment(nodeId, assignmentId);
    },
    onSuccess: () => {
      notifySuccess(t('assignments.removed'));
      setPendingRemoveId(null);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.nodeAssignments(nodeId) });
    },
    onError: (error: unknown) => {
      notifyError(error, 'nodes:assignments.removeError');
    },
  });

  const handleRemove = (assignmentId: string) => {
    setPendingRemoveId(assignmentId);
  };

  const confirmRemove = () => {
    if (pendingRemoveId) {
      removeMutation.mutate(pendingRemoveId);
    }
  };

  return (
    <ServerTabCard>
      <div className="mb-2 flex items-center justify-between">
        <SectionHeader icon={Shield} title={t('assignments.title')} />
        {assignments.length > 0 && <Segmented muted>{assignments.length}</Segmented>}
      </div>

      {isLoading ? (
        <TabLoadingState rows={2} />
      ) : assignments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <p className="type-meta">{t('assignments.empty')}</p>
        </div>
      ) : (
        <div className="divide-y divide-border/50">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex items-center justify-between gap-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {assignment.source === 'user' ? (
                  <>
                    <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="type-overline shrink-0">{t('assign.user')}</span>
                    <span className="truncate font-mono text-mini tabular-nums text-foreground">
                      {assignment.userId}
                    </span>
                  </>
                ) : (
                  <>
                    <Shield className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="type-overline shrink-0">{t('assign.role')}</span>
                    <span className="truncate text-mini font-medium text-foreground">
                      {assignment.roleName || assignment.roleId}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="type-meta hidden sm:block">
                  <span className="font-mono tabular-nums">{t('assignments.assigned', { date: formatDate(assignment.assignedAt) })}</span>
                  {assignment.expiresAt && (
                    <span
                      className={`ml-2 font-mono tabular-nums ${
                        new Date(assignment.expiresAt) < new Date()
                          ? 'text-danger'
                          : ''
                      }`}
                    >
                      {t('assignments.expires', { date: formatDate(assignment.expiresAt) })}
                      {new Date(assignment.expiresAt) < new Date() ? t('assignments.expired') : ''}
                    </span>
                  )}
                </div>

                {canManage && (
                  <button
                    className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-danger/5 hover:text-danger disabled:pointer-events-none disabled:opacity-30"
                    onClick={() => handleRemove(assignment.id)}
                    disabled={removeMutation.isPending}
                    title={t('assignments.removeTitle')}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingRemoveId !== null}
        title={t('assignments.removeTitle')}
        message={t('assignments.removeConfirm')}
        confirmText={t('common:actions.remove')}
        variant="danger"
        loading={removeMutation.isPending}
        onConfirm={confirmRemove}
        onCancel={() => {
          if (!removeMutation.isPending) setPendingRemoveId(null);
        }}
      />
    </ServerTabCard>
  );
}

export default NodeAssignmentsList;
