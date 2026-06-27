import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { nodesApi } from '../../services/api/nodes';
import { qk } from '../../lib/queryKeys';
import { queryClient } from '../../lib/queryClient';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ModalPortal } from '@/components/ui/modal-portal';

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
 <button
 className="w-full rounded-md bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground shadow-destructive/20 transition-all hover:bg-destructive/90"
 onClick={() => setOpen(true)}
 >
 Delete
 </button>
 )}
 {open ? (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
 <div className="w-full max-w-sm rounded-xl border border-border/40 bg-card p-6 shadow-xl">
 <div className="text-lg font-semibold text-foreground">Delete node</div>
 <p className="mt-2 text-sm text-muted-foreground">
 Are you sure you want to delete <span className="font-semibold">{nodeName}</span>? This
 action cannot be undone.
 </p>
 <div className="mt-4 flex justify-end gap-2 text-xs">
 <button
 className="rounded-md border border-border/40 px-3 py-1 font-semibold text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground"
 onClick={() => setOpen(false)}
 >
 Cancel
 </button>
 <button
 className="rounded-md bg-destructive px-4 py-2 font-semibold text-destructive-foreground shadow-destructive/20 transition-all hover:bg-destructive/90 disabled:opacity-60"
 onClick={() => mutation.mutate()}
 disabled={mutation.isPending}
 >
 Delete
 </button>
 </div>
 </div>
 </div>
 </ModalPortal>
 ) : null}
 </>
 );
}

export default NodeDeleteDialog;
