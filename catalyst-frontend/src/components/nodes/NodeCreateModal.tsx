import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { nodesApi } from '../../services/api/nodes';
import { notifyError, notifySuccess } from '../../utils/notify';

type Props = {
  locationId: string;
};

function NodeCreateModal({ locationId }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hostname, setHostname] = useState('');
  const [publicAddress, setPublicAddress] = useState('');
  const [memory, setMemory] = useState('16384');
  const [cpu, setCpu] = useState('8');
  const [serverDataDir, setServerDataDir] = useState('/var/lib/catalyst/servers');
  const [deployInfo, setDeployInfo] = useState<{
    deployUrl: string;
    deploymentToken: string;
    apiKey: string;
    expiresAt: string;
  } | null>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      const created = await nodesApi.create({
        name,
        description: description || undefined,
        locationId,
        hostname,
        publicAddress,
        maxMemoryMb: Number(memory),
        maxCpuCores: Number(cpu),
        serverDataDir: serverDataDir || undefined,
      });
      const info = created?.id ? await nodesApi.deploymentToken(created.id) : null;
      return info;
    },
    onSuccess: (info) => {
      queryClient.invalidateQueries({ queryKey: ['nodes'] });
      notifySuccess('Node registered');
      setDeployInfo(info ?? null);
      setOpen(false);
      setName('');
      setDescription('');
      setHostname('');
      setPublicAddress('');
      setMemory('16384');
      setCpu('8');
      setServerDataDir('/var/lib/catalyst/servers');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to register node';
      notifyError(message);
    },
  });

  const disableSubmit =
    !name ||
    !locationId ||
    !hostname ||
    !publicAddress ||
    !Number(memory) ||
    !Number(cpu) ||
    mutation.isPending;

  if (!locationId) {
    return (
      <button
        className="rounded-lg bg-surface-2 px-4 py-2 text-sm font-semibold text-muted-foreground dark:text-muted-foreground shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:bg-surface-2 dark:text-muted-foreground"
        disabled
      >
        Register Node
      </button>
    );
  }

  return (
    <div>
      <button
        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
        onClick={() => setOpen(true)}
      >
        Register Node
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-zinc-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-border bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
            <div className="flex items-center justify-between border-b border-border px-6 py-4 dark:border-border">
              <h2 className="text-lg font-semibold text-foreground dark:text-white">Register node</h2>
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
                  placeholder="production-1"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Description</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Primary node"
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
                  placeholder="node1.example.com"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-muted-foreground dark:text-muted-foreground">Public address</span>
                <input
                  className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                  value={publicAddress}
                  onChange={(event) => setPublicAddress(event.target.value)}
                  placeholder="203.0.113.10"
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
                disabled={disableSubmit}
              >
                {mutation.isPending ? 'Registering...' : 'Register node'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {deployInfo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-zinc-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
            <div className="flex items-center justify-between border-b border-border px-6 py-4 dark:border-border">
              <h2 className="text-lg font-semibold text-foreground dark:text-white">Deploy agent</h2>
              <button
                className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-all duration-300 hover:border-primary-500 dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                onClick={() => setDeployInfo(null)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 px-6 py-4 text-sm text-muted-foreground dark:text-zinc-300">
              <div className="text-muted-foreground dark:text-zinc-300">
                Run this on the node to install and register the agent (valid for 24 hours).
              </div>
              <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs text-foreground dark:border-border dark:bg-zinc-950/40 dark:text-zinc-100">
                <code className="whitespace-pre-wrap">
                  {`curl -s '${deployInfo.deployUrl}?apiKey=${encodeURIComponent(deployInfo.apiKey)}' | sudo bash -x`}
                </code>
              </div>
              <div className="text-xs text-muted-foreground dark:text-muted-foreground dark:text-muted-foreground">
                Token expires: {new Date(deployInfo.expiresAt).toLocaleString()}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-6 py-4 text-xs dark:border-border">
              <button
                className="rounded-md border border-border px-3 py-1 font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                onClick={() => setDeployInfo(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NodeCreateModal;
