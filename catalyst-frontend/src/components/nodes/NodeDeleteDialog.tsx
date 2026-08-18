import { useState } from 'react';
import { useMutation } from '@/csync';
import { nodesApi } from '../../services/api/nodes';
import { qk } from '../../lib/queryKeys';
import { queryClient } from '../../lib/queryClient';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

type Props = {
  nodeId: string;
  nodeName: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function NodeDeleteDialog({ nodeId, nodeName, open: controlledOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };

  const mutation = useMutation({
    mutationFn: () => nodesApi.remove(nodeId),
    onMutate: async () => {
      await queryClient.cancelQueries({
        predicate: (q: any) => Array.isArray(q.queryKey) && q.queryKey[0] === 'nodes',
      });
      const prev = queryClient.getQueriesData({
        predicate: (q: any) => Array.isArray(q.queryKey) && q.queryKey[0] === 'nodes',
      });
      queryClient.setQueriesData(
        { predicate: (q: any) => Array.isArray(q.queryKey) && q.queryKey[0] === 'nodes' },
        (nodes: any[]) => Array.isArray(nodes) ? nodes.filter((n: any) => n.id !== nodeId) : nodes,
      );
      return { prev };
    },
    onError: (_err: { response?: { data?: { error?: string } }; message?: string }, _vars, ctx) => {
      if (ctx?.prev) {
        for (const [queryKey, data] of ctx.prev) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      const message = _err?.response?.data?.error || 'Failed to delete node';
      notifyError(message);
    },
    onSettled: () => {
      Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.nodes() }),
        queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
      ]);
    },
    onSuccess: () => {
      notifySuccess('Node deleted');
      setOpen(false);
    },
  });

  return (
    <>
      {controlledOpen === undefined && (
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => setOpen(true)}
        >
          Delete
        </Button>
      )}
      <ConfirmDialog
        open={open}
        title="Delete node"
        message={
          <>
            Are you sure you want to delete <span className="font-semibold text-foreground">{nodeName}</span>?
            This action cannot be undone.
          </>
        }
        confirmText="Delete"
        variant="danger"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

export default NodeDeleteDialog;
