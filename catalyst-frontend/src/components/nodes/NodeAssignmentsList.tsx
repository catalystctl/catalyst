import { motion } from 'framer-motion';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { Shield, User, X } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  nodeId: string;
  canManage: boolean;
};

function NodeAssignmentsList({ nodeId, canManage }: Props) {

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['nodes', nodeId, 'assignments'],
    queryFn: () => nodesApi.getAssignments(nodeId),
    refetchInterval: 10000,
  });

  const removeMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return nodesApi.removeAssignment(nodeId, assignmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.nodeAssignments(nodeId) });
      notifySuccess('Assignment removed');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to remove assignment';
      notifyError(message);
    },
  });

  const handleRemove = (assignmentId: string) => {
    if (confirm('Are you sure you want to remove this assignment?')) {
      removeMutation.mutate(assignmentId);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24 }}
      className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm"
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold text-foreground dark:text-white">
          Node Assignments
          {assignments.length > 0 && (
            <Badge variant="default" className="ml-2">
              {assignments.length}
            </Badge>
          )}
        </h2>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-2/50" />
          ))}
        </div>
      ) : assignments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-8 text-center">
          <Shield className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            No assignments yet. Assign this node to users or roles to grant them access.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="group flex items-center justify-between rounded-lg border border-border/50 bg-surface-2/50 px-3 py-2.5 transition-colors hover:bg-surface-2 dark:bg-surface-2/30"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {assignment.source === 'user' ? (
                  <>
                    <Badge variant="outline" className="shrink-0 gap-1 text-[11px]">
                      <User className="h-3 w-3" />
                      User
                    </Badge>
                    <span className="truncate text-sm font-medium text-foreground dark:text-white">
                      {assignment.userId}
                    </span>
                  </>
                ) : (
                  <>
                    <Badge variant="outline" className="shrink-0 gap-1 text-[11px]">
                      <Shield className="h-3 w-3" />
                      Role
                    </Badge>
                    <span className="truncate text-sm font-medium text-foreground dark:text-white">
                      {assignment.roleName || assignment.roleId}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden text-xs text-muted-foreground sm:block">
                  <span>Assigned {new Date(assignment.assignedAt).toLocaleDateString()}</span>
                  {assignment.expiresAt && (
                    <span
                      className={`ml-2 ${
                        new Date(assignment.expiresAt) < new Date()
                          ? 'text-rose-500 dark:text-rose-400'
                          : ''
                      }`}
                    >
                      · Exp {new Date(assignment.expiresAt).toLocaleDateString()}
                      {new Date(assignment.expiresAt) < new Date() && ' (expired)'}
                    </span>
                  )}
                </div>

                {canManage && (
                  <button
                    className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-rose-950/30 dark:hover:text-rose-400"
                    onClick={() => handleRemove(assignment.id)}
                    disabled={removeMutation.isPending}
                    title="Remove assignment"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export default NodeAssignmentsList;
