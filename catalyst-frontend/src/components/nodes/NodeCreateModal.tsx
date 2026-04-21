import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MapPin, ArrowRight, SkipForward } from 'lucide-react';
import { nodesApi } from '../../services/api/nodes';
import { locationsApi } from '../../services/api/locations';
import { qk } from '../../lib/queryKeys';
import { queryClient } from '../../lib/queryClient';
import { notifyError, notifySuccess } from '../../utils/notify';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { ModalPortal } from '@/components/ui/modal-portal';

type Props = {};

function NodeCreateModal(_props: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [locationId, setLocationId] = useState('');
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

  const { data: locations = [] } = useQuery({
    queryKey: qk.locations(),
    queryFn: locationsApi.list,
  });

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
      queryClient.invalidateQueries({ queryKey: qk.nodes() });
      queryClient.invalidateQueries({ predicate: (q: any) =>
        Array.isArray(q.queryKey) && q.queryKey[0] === 'admin-nodes'
      });
      notifySuccess('Node registered');
      setDeployInfo(info ?? null);
      setOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to register node';
      notifyError(message);
    },
  });

  const resetForm = () => {
    setStep(1);
    setLocationId('');
    setName('');
    setDescription('');
    setHostname('');
    setPublicAddress('');
    setMemory('16384');
    setCpu('8');
    setServerDataDir('/var/lib/catalyst/servers');
  };

  const disableSubmit =
    !name ||
    !locationId ||
    !hostname ||
    !publicAddress ||
    !Number(memory) ||
    !Number(cpu) ||
    mutation.isPending;

  return (
    <div>
      <button
        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
        onClick={() => {
          setStep(1);
          setOpen(true);
        }}
      >
        Register Node
      </button>

      {/* ── Main Modal ── */}
      {open ? (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10 backdrop-blur-sm">
            <div className="flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl transition-all duration-300 dark:border-border dark:bg-surface-1">
              {/* ── Header ── */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-5 dark:border-border">
                <div>
                  <h2 className="text-lg font-semibold text-foreground dark:text-white">
                    {step === 1 ? 'Register Node' : 'Node details'}
                  </h2>
                  <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                    {step === 1
                      ? 'Choose a location for this node.'
                      : 'Configure hostname, resources, and connection details.'}
                  </p>
                </div>
                <button
                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                  onClick={() => {
                    setOpen(false);
                    resetForm();
                  }}
                >
                  Close
                </button>
              </div>

              {/* ── Step indicator ── */}
              <div className="flex items-center gap-2 border-b border-border px-6 py-2.5 dark:border-border">
                <div
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${step === 1 ? 'bg-primary/10 text-primary-600 dark:text-primary-400' : 'text-muted-foreground'}`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${step === 1 ? 'bg-primary text-white' : 'bg-surface-3 text-muted-foreground'}`}
                  >
                    1
                  </span>
                  Location
                </div>
                <div className="h-px flex-1 bg-border" />
                <div
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${step === 2 ? 'bg-primary/10 text-primary-600 dark:text-primary-400' : 'text-muted-foreground'}`}
                >
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${step === 2 ? 'bg-primary text-white' : 'bg-surface-3 text-muted-foreground'}`}
                  >
                    2
                  </span>
                  Details
                </div>
              </div>

              {/* ── Step 1: Location Selection ── */}
              {step === 1 && (
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 dark:from-emerald-500/20 dark:to-cyan-500/20">
                    <MapPin className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h3 className="text-base font-semibold text-foreground dark:text-white">
                    Assign this node to a location?
                  </h3>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground dark:text-zinc-200">
                      Locations
                    </span>{' '}
                    represent where your nodes physically reside. For example,{' '}
                    <span className="font-medium">US-East</span> or{' '}
                    <span className="font-medium">EU-West</span>.
                  </p>

                  {locations.length > 0 ? (
                    <label className="mt-6 block w-full max-w-xs space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        Select a location
                      </span>
                      <Select
                        value={locationId || '__none__'}
                        onValueChange={(v) => setLocationId(v === '__none__' ? '' : v)}
                      >
                        <SelectTrigger className="w-full max-w-xs">
                          <SelectValue placeholder="Choose a location…" />
                        </SelectTrigger>
                        <SelectContent>
                          {locations.map((location) => (
                            <SelectItem key={location.id} value={location.id}>
                              <span className="flex items-center gap-2">
                                <MapPin className="h-3.5 w-3.5 text-emerald-500" />
                                {location.name}
                                {location.description && (
                                  <span className="text-muted-foreground">
                                    — {location.description}
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                  ) : (
                    <div className="mt-6 rounded-xl border border-dashed border-border bg-surface-2/50 px-5 py-4 dark:bg-surface-1/40">
                      <p className="text-sm text-muted-foreground">
                        No locations exist yet.{' '}
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 font-medium text-primary-600 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
                          onClick={() => {
                            setOpen(false);
                            setStep(1);
                            window.dispatchEvent(new CustomEvent('catalyst:open-locations-modal'));
                          }}
                        >
                          Create a location
                        </button>{' '}
                        first, or skip this step.
                      </p>
                    </div>
                  )}

                  <div className="mt-8 flex items-center gap-3">
                    <button
                      className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                      onClick={() => setStep(2)}
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      Skip and Continue
                    </button>
                    {locations.length > 0 && locationId && (
                      <button
                        className="flex items-center gap-1.5 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
                        onClick={() => setStep(2)}
                      >
                        Continue
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* ── Step 2: Node Details Form ── */}
              {step === 2 && (
                <>
                  <div className="space-y-3 overflow-y-auto px-6 py-4 text-sm text-muted-foreground dark:text-zinc-300">
                    {locationId && (
                      <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-900/20">
                        <MapPin className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          Location: {locations.find((l) => l.id === locationId)?.name || locationId}
                        </span>
                      </div>
                    )}
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
                      <span className="text-muted-foreground dark:text-muted-foreground">
                        Description
                      </span>
                      <input
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Primary node"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-muted-foreground dark:text-muted-foreground">
                        Server data directory
                      </span>
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
                      <span className="text-muted-foreground dark:text-muted-foreground">
                        Hostname
                      </span>
                      <input
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                        value={hostname}
                        onChange={(event) => setHostname(event.target.value)}
                        placeholder="node1.example.com"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-muted-foreground dark:text-muted-foreground">
                        Public address
                      </span>
                      <input
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                        value={publicAddress}
                        onChange={(event) => setPublicAddress(event.target.value)}
                        placeholder="203.0.113.10"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-muted-foreground dark:text-muted-foreground">
                          Memory (MB)
                        </span>
                        <input
                          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
                          value={memory}
                          onChange={(event) => setMemory(event.target.value)}
                          type="number"
                          min={256}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-muted-foreground dark:text-muted-foreground">
                          CPU cores
                        </span>
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
                  <div className="flex justify-between gap-2 border-t border-border px-6 py-4 text-xs dark:border-border">
                    <button
                      className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
                      onClick={() => setStep(1)}
                    >
                      &larr; Back
                    </button>
                    <button
                      className="rounded-full bg-primary-600 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                      onClick={() => mutation.mutate()}
                      disabled={disableSubmit}
                    >
                      {mutation.isPending ? 'Registering...' : 'Register node'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </ModalPortal>
      ) : null}

      {/* ── Deploy Info Modal ── */}
      {deployInfo ? (
        <ModalPortal>
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10 backdrop-blur-sm">
            <div className="flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-2xl transition-all duration-300 dark:border-border dark:bg-surface-1">
              <div className="flex items-center justify-between border-b border-border px-6 py-4 dark:border-border">
                <h2 className="text-lg font-semibold text-foreground dark:text-white">
                  Deploy agent
                </h2>
                <button
                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
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
                <div className="text-xs text-muted-foreground dark:text-muted-foreground">
                  Token expires: {new Date(deployInfo.expiresAt).toLocaleString()}
                </div>
              </div>
              <div className="flex justify-end border-t border-border px-6 py-4 text-xs dark:border-border">
                <button
                  className="rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
                  onClick={() => setDeployInfo(null)}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </ModalPortal>
      ) : null}
    </div>
  );
}

export default NodeCreateModal;
