import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { NodeInfo } from '../../types/node';
import { nodesApi } from '../../services/api/nodes';
import { qk } from '../../lib/queryKeys';
import { queryClient } from '../../lib/queryClient';
import { notifyError, notifySuccess } from '../../utils/notify';
import { ModalPortal } from '@/components/ui/modal-portal';

type Props = {
  node: NodeInfo;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function NodeUpdateModal({ node, open: controlledOpen, onOpenChange }: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    setInternalOpen(value);
    onOpenChange?.(value);
  };
  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState(node.description ?? '');
  const [hostname, setHostname] = useState(node.hostname ?? '');
  const [publicAddress, setPublicAddress] = useState(node.publicAddress ?? '');
  const [memory, setMemory] = useState(String(node.maxMemoryMb ?? 0));
  const [cpu, setCpu] = useState(String(node.maxCpuCores ?? 0));
  const [serverDataDir, setServerDataDir] = useState(node.serverDataDir ?? '/var/lib/catalyst/servers');

  const mutation = useMutation({
    mutationFn: () =>
      nodesApi.update(node.id, {
        name: name || undefined,
        description: description || undefined,
        hostname: hostname || undefined,
        publicAddress: publicAddress || undefined,
        maxMemoryMb: Number(memory) || undefined,
        maxCpuCores: Number(cpu) || undefined,
        serverDataDir: serverDataDir || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.nodes() });
      queryClient.invalidateQueries({ queryKey: qk.node(node.id) });
      notifySuccess('Node updated');
      setOpen(false);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to update node';
      notifyError(message);
    },
  });

  return (
    <>
      {controlledOpen === undefined && (
        <button
          className="w-full rounded-md border border-border bg-white px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:bg-surface-1 dark:text-zinc-300 dark:hover:border-primary/30"
          onClick={() => setOpen(true)}
        >
          Update
        </button>
      )}
      {open ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-zinc-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
            <div className="flex items-center justify-between border-b border-border px-6 py-4 dark:border-border">
              <h2 className="text-lg font-semibold text-foreground dark:text-white">Update node</h2>
              <button
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary-500 dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 px-6 py-4 text-sm text-muted-foreground dark:text-zinc-300">
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Name</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Description</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Server data directory</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-sm text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={serverDataDir}
                  onChange={(event) => setServerDataDir(event.target.value)}
                  placeholder="/var/lib/catalyst/servers"
                />
                <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                  Directory on the node where server files will be stored
                </p>
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Hostname</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value)}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Public address</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={publicAddress}
                  onChange={(event) => setPublicAddress(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">Memory (MB)</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    value={memory}
                    onChange={(event) => setMemory(event.target.value)}
                    type="number"
                    min={256}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-muted-foreground dark:text-muted-foreground">CPU cores</span>
                  <input
                    className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                    value={cpu}
                    onChange={(event) => setCpu(event.target.value)}
                    type="number"
                    min={1}
                    step={1}
                  />
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-6 py-4 text-xs dark:border-border">
              <button
                className="rounded-md border border-border px-3 py-1 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
              >
                {mutation.isPending ? 'Saving...' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </>
  );
}

export default NodeUpdateModal;
