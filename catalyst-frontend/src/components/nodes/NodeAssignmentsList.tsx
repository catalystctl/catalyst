import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  nodeId: string;
  canManage: boolean;
};

function NodeAssignmentsList({ nodeId, canManage }: Props) {
  const queryClient = useQueryClient();

  // Fetch assignments
  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['nodes', nodeId, 'assignments'],
    queryFn: () => nodesApi.getAssignments(nodeId),
  });

  // Remove assignment mutation
  const removeMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return nodesApi.removeAssignment(nodeId, assignmentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['nodes', nodeId, 'assignments'] });
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

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:hover:border-primary/30">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground dark:text-white">Node Assignments</h2>
        </div>
        <div className="mt-4 text-center text-sm text-muted-foreground dark:text-muted-foreground">
          Loading assignments...
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:hover:border-primary/30">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground dark:text-white">
          Node Assignments
          {assignments.length > 0 && (
            <span className="ml-2 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-600 dark:bg-primary-500/10 dark:text-primary-400">
              {assignments.length}
            </span>
          )}
        </h2>
      </div>

      {assignments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center dark:border-border">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            No assignments yet. Assign this node to users or roles to grant them access.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {assignments.map((assignment) => (
            <div
              key={assignment.id}
              className="flex items-center justify-between rounded-lg border border-border bg-surface-2 px-3 py-2 transition-all duration-200 hover:border-border dark:border-border dark:bg-zinc-950/40 dark:hover:border-border"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {assignment.source === 'user' ? (
                    <>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                        User
                      </span>
                      <span className="text-sm font-medium text-foreground dark:text-white">
                        {assignment.userId}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-600 dark:bg-purple-500/10 dark:text-purple-400">
                        Role
                      </span>
                      <span className="text-sm font-medium text-foreground dark:text-white">
                        {assignment.roleName || assignment.roleId}
                      </span>
                    </>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground dark:text-muted-foreground">
                  <span>
                    Assigned: {new Date(assignment.assignedAt).toLocaleDateString()}
                  </span>
                  {assignment.expiresAt && (
                    <span className={
                      new Date(assignment.expiresAt) < new Date()
                        ? 'text-red-500 dark:text-red-400'
                        : ''
                    }>
                      Expires: {new Date(assignment.expiresAt).toLocaleDateString()}
                      {new Date(assignment.expiresAt) < new Date() && ' (expired)'}
                    </span>
                  )}
                </div>
              </div>
              {canManage && (
                <button
                  className="ml-2 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-red-500 hover:text-red-600 dark:border-border dark:text-muted-foreground dark:hover:border-red-500/30 dark:hover:text-red-400"
                  onClick={() => handleRemove(assignment.id)}
                  disabled={removeMutation.isPending}
                >
                  {removeMutation.isPending ? 'Removing...' : 'Remove'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default NodeAssignmentsList;
