import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { serversApi } from '../../services/api/servers';
import type { BackupStorageMode } from '../../types/server';
import { useNodes } from '../../hooks/useNodes';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  serverId: string;
  disabled?: boolean;
};

function TransferServerModal({ serverId, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const [targetNodeId, setTargetNodeId] = useState('');
  const [transferMode, setTransferMode] = useState<BackupStorageMode>('local');
  const queryClient = useQueryClient();
  const { data: nodes = [], isLoading: nodesLoading } = useNodes();
  const selectedTargetNodeId = targetNodeId || nodes[0]?.id || '';

  const mutation = useMutation({
    mutationFn: () => serversApi.transfer(serverId, {
      targetNodeId: selectedTargetNodeId,
      transferMode,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      notifySuccess('Transfer started');
      setOpen(false);
    },
    onError: () => notifyError('Failed to transfer server'),
  });

  return (
    <div>
      <button
        className="rounded-md border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 disabled:opacity-60 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30"
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        disabled={disabled}
      >
        Transfer
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Transfer server</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Target node</span>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={selectedTargetNodeId}
                  onChange={(e) => setTargetNodeId(e.target.value)}
                  disabled={nodesLoading || !nodes.length}
                >
                  {!nodes.length ? <option value="">No nodes available</option> : null}
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-slate-500 dark:text-slate-400">Transfer storage</span>
                <select
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  value={transferMode}
                  onChange={(e) => setTransferMode(e.target.value as BackupStorageMode)}
                  disabled={disabled}
                >
                  <option value="local">Shared filesystem</option>
                  <option value="s3">S3</option>
                  <option value="stream">Stream</option>
                </select>
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                Transferring will reschedule workloads on the selected node.
              </p>
            </div>
            <div className="mt-4 flex justify-end gap-2 text-xs">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
                <button
                  className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => mutation.mutate()}
                  disabled={mutation.isPending || !selectedTargetNodeId || !nodes.length || disabled}
                >
                  Transfer
                </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default TransferServerModal;
