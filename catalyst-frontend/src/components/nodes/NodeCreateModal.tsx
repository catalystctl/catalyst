import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MapPin, ArrowRight, CheckCircle, Loader2, Copy, ChevronDown, ChevronRight } from 'lucide-react';
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

// no props needed, but the type is kept for consistency
type Props = Record<string, never>;

/**
 * Event types used for inter-modal navigation.
 * NodeCreateModal listens for `catalyst:return-to-node-create` so the
 * LocationsManagerModal can re-open this modal after creating a location.
 */
const RETURN_EVENT = 'catalyst:return-to-node-create' as const;
const OPEN_LOCATIONS_EVENT = 'catalyst:open-locations-modal' as const;

function NodeCreateModal(_props: Props) {
 const [open, setOpen] = useState(false);
 const [step, setStep] = useState<1 | 2 | 3>(1);
 const [locationId, setLocationId] = useState('');
 const [name, setName] = useState('');
 const [description, setDescription] = useState('');
 const [hostname, setHostname] = useState('');
 const [publicAddress, setPublicAddress] = useState('');
 const [memory, setMemory] = useState('16384');
 const [cpu, setCpu] = useState('8');
 const [memoryOverallocate, setMemoryOverallocate] = useState('0');
 const [cpuOverallocate, setCpuOverallocate] = useState('0');
 const [serverDataDir, setServerDataDir] = useState('/var/lib/catalyst/servers');
 const [consoleLogDir, setConsoleLogDir] = useState('');
 const [cniDir, setCniDir] = useState('');
 const [cniBinDir, setCniBinDir] = useState('');
 const [cniDataDir, setCniDataDir] = useState('');
 const [cniResultsDir, setCniResultsDir] = useState('');
 const [cniBridgeName, setCniBridgeName] = useState('');
 const [cniBridgeSubnet, setCniBridgeSubnet] = useState('');
 const [systemdOverrideDir, setSystemdOverrideDir] = useState('');
 const [agentConfigPath, setAgentConfigPath] = useState('');
 const [agentReleaseRepo, setAgentReleaseRepo] = useState('');
 const [showAdvanced, setShowAdvanced] = useState(false);
 const [deployInfo, setDeployInfo] = useState<{
 deployUrl: string;
 deploymentToken: string;
 apiKey: string;
 expiresAt: string;
 } | null>(null);
 const [createdNodeId, setCreatedNodeId] = useState<string | null>(null);

 // Re-open this modal when a location manager sends the user back
 // If a location was just created, auto-select it and jump to step 2
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent).detail;
 const createdId = detail?.createdId as string | undefined;
 setOpen(true);
 if (createdId) {
 setLocationId(createdId);
 setStep(2);
 } else {
 setStep(1);
 }
 };
 window.addEventListener(RETURN_EVENT, handler);
 return () => window.removeEventListener(RETURN_EVENT, handler);
 }, []);

 const { data: locations = [] } = useQuery({
 queryKey: qk.locations(),
 queryFn: locationsApi.list,
 staleTime: 5 * 60 * 1000,
 });

 const createMutation = useMutation({
 mutationFn: async () => {
 const created = await nodesApi.create({
 name,
 description: description || undefined,
 locationId,
 hostname,
 publicAddress,
 maxMemoryMb: Number(memory),
 maxCpuCores: Number(cpu),
 memoryOverallocatePercent: Number(memoryOverallocate),
 cpuOverallocatePercent: Number(cpuOverallocate),
 serverDataDir: serverDataDir || undefined,
 consoleLogDir: consoleLogDir || undefined,
 cniDir: cniDir || undefined,
 cniBinDir: cniBinDir || undefined,
 cniDataDir: cniDataDir || undefined,
 cniResultsDir: cniResultsDir || undefined,
 cniBridgeName: cniBridgeName || undefined,
 cniBridgeSubnet: cniBridgeSubnet || undefined,
 systemdOverrideDir: systemdOverrideDir || undefined,
 agentConfigPath: agentConfigPath || undefined,
 agentReleaseRepo: agentReleaseRepo || undefined,
 });
 return created;
 },
 onSuccess: (created) => {
 notifySuccess('Node registered');
 setCreatedNodeId(created?.id ?? null);
 // Move to step 3 (deploy script) and immediately fetch the deployment token
 setStep(3);
 if (created?.id) {
 deployTokenMutation.mutate(created.id);
 }
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to register node';
 notifyError(message);
 },
 });

 const deployTokenMutation = useMutation({
 mutationFn: async (nodeId: string) => {
 const info = await nodesApi.deploymentToken(nodeId);
 return info;
 },
 onSuccess: (info) => {
 setDeployInfo(info ?? null);
 },
 onError: () => {
 // Don't show a separate error — step 3 already has a retry button
 setDeployInfo(null);
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
 setMemoryOverallocate('0');
 setCpuOverallocate('0');
 setServerDataDir('/var/lib/catalyst/servers');
 setConsoleLogDir('');
 setCniDir('');
 setCniBinDir('');
 setCniDataDir('');
 setCniResultsDir('');
 setCniBridgeName('');
 setCniBridgeSubnet('');
 setSystemdOverrideDir('');
 setAgentConfigPath('');
 setAgentReleaseRepo('');
 setShowAdvanced(false);
 setDeployInfo(null);
 setCreatedNodeId(null);
 createMutation.reset();
 deployTokenMutation.reset();
 };

 const disableSubmit =
 !name ||
 !locationId ||
 !hostname ||
 !publicAddress ||
 !Number(memory) ||
 !Number(cpu) ||
 createMutation.isPending;

 return (
 <div>
 <button
 className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
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
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 py-10 backdrop-blur-sm">
 <div className="flex w-full max-w-4xl max-h-[90vh] flex-col overflow-hidden rounded-xl border border-border/40 bg-card shadow-xl">
 {/* ── Header ── */}
 <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 px-6 py-5">
 <div>
 <h2 className="text-lg font-semibold text-foreground">
 {step === 1 ? 'Register Node' : step === 2 ? 'Node details' : 'Deploy agent'}
 </h2>
 <p className="text-xs text-muted-foreground">
 {step === 1
 ? 'Choose a location for this node.'
 : step === 2
 ? 'Configure hostname, resources, and connection details.'
 : 'Install the agent on your node using the script below.'}
 </p>
 </div>
 <button
 className="rounded-full border border-border/40 px-3 py-1 text-xs font-semibold text-muted-foreground transition-all hover:border-primary/50"
 onClick={() => {
 setOpen(false);
 resetForm();
 }}
 >
 Close
 </button>
 </div>

 {/* ── Step indicator ── */}
 <div className="flex items-center gap-2 border-b border-border/30 px-6 py-2.5">
 <div
 className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${step === 1 ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
 >
 <span
 className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${step === 1 ? 'bg-primary text-primary-foreground' : 'bg-surface-3 text-muted-foreground'}`}
 >
 1
 </span>
 Location
 </div>
 <div className="h-px flex-1 bg-border/30" />
 <div
 className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${step === 2 || step === 3 ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
 >
 <span
 className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${step === 2 || step === 3 ? 'bg-primary text-primary-foreground' : 'bg-surface-3 text-muted-foreground'}`}
 >
 2
 </span>
 Details
 </div>
 <div className="h-px flex-1 bg-border/30" />
 <div
 className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${step === 3 ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
 >
 <span
 className={`flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold ${step === 3 ? 'bg-primary text-primary-foreground' : 'bg-surface-3 text-muted-foreground'}`}
 >
 3
 </span>
 Deploy
 </div>
 </div>

 {/* ── Step 1: Location Selection ── */}
 {step === 1 && (
 <div className="flex flex-col items-center px-6 py-10 text-center">
 <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10">
 <MapPin className="h-7 w-7 text-success" />
 </div>
 <h3 className="text-base font-semibold text-foreground">
 Assign this node to a location?
 </h3>
 <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
 <span className="font-medium text-foreground">
 Locations
 </span>{' '}
 represent where your nodes physically reside. For example,{' '}
 <span className="font-medium">US-East</span> or{' '}
 <span className="font-medium">EU-West</span>.
 </p>

 {locations.length > 0 ? (
 <label className="mt-6 block w-full max-w-xs space-y-1.5">
 <span className="text-xs font-medium text-muted-foreground">
 Select a location <span className="text-red-500">*</span>
 </span>
 <Select
 value={locationId || '__none__'}
 onValueChange={(v) => setLocationId(v === '__none__' ? '' : v)}
 >
 <SelectTrigger className="w-full max-w-xs border-border/40">
 <SelectValue placeholder="Choose a location…" />
 </SelectTrigger>
 <SelectContent>
 {locations.map((location) => (
 <SelectItem key={location.id} value={location.id}>
 <span className="flex items-center gap-2">
 <MapPin className="h-3.5 w-3.5 text-success" />
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
 <div className="mt-6 rounded-xl border border-dashed border-border/40 bg-surface-2/50 px-5 py-4">
 <p className="text-sm text-muted-foreground">
 No locations exist yet.{' '}
 <button
 type="button"
 className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80"
 onClick={() => {
 setOpen(false);
 setStep(1);
 window.dispatchEvent(new CustomEvent(OPEN_LOCATIONS_EVENT, { detail: { returnTo: 'node-create' } }));
 }}
 >
 Create a location
 </button>{' '}
 first before registering a node.
 </p>
 </div>
 )}

 <div className="mt-8 flex items-center gap-3">
 {locations.length > 0 && locationId && (
 <button
 className="flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
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
 <div className="space-y-3 overflow-y-auto px-6 py-4 text-sm text-muted-foreground">
 {locationId && (
 <div className="flex items-center gap-2 rounded-lg bg-success/5 px-3 py-2">
 <MapPin className="h-4 w-4 text-success" />
 <span className="text-xs font-medium text-success">
 Location: {locations.find((l) => l.id === locationId)?.name || locationId}
 </span>
 </div>
 )}
 <label className="block space-y-1">
 <span className="text-muted-foreground">Name</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={name}
 onChange={(event) => setName(event.target.value)}
 placeholder="production-1"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Description
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={description}
 onChange={(event) => setDescription(event.target.value)}
 placeholder="Primary node"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Server data directory
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={serverDataDir}
 onChange={(event) => setServerDataDir(event.target.value)}
 placeholder="/var/lib/catalyst/servers"
 />
 <p className="text-xs text-muted-foreground">
 Directory on the node where server files will be stored
 </p>
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Hostname
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={hostname}
 onChange={(event) => setHostname(event.target.value)}
 placeholder="node1.example.com"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Public address
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={publicAddress}
 onChange={(event) => setPublicAddress(event.target.value)}
 placeholder="203.0.113.10 or 2001:db8::1"
 />
 </label>
 <div className="grid grid-cols-2 gap-3">
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Memory (MB)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={memory}
 onChange={(event) => setMemory(event.target.value)}
 type="number"
 min={256}
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 CPU cores
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={cpu}
 onChange={(event) => setCpu(event.target.value)}
 type="number"
 min={1}
 step={1}
 />
 </label>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 Memory Over-allocation (%)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={memoryOverallocate}
 onChange={(event) => setMemoryOverallocate(event.target.value)}
 type="number"
 min={-1}
 />
 <p className="text-xs text-muted-foreground">
 0 = no over-allocation, -1 = unlimited
 </p>
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">
 CPU Over-allocation (%)
 </span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={cpuOverallocate}
 onChange={(event) => setCpuOverallocate(event.target.value)}
 type="number"
 min={-1}
 />
 <p className="text-xs text-muted-foreground">
 0 = no over-allocation, -1 = unlimited
 </p>
 </label>
 </div>

 {/* Advanced Agent Paths — collapsed by default */}
 <div className="space-y-1">
 <button
 type="button"
 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
 onClick={() => setShowAdvanced(!showAdvanced)}
 >
 {showAdvanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
 Advanced agent paths
 </button>
 {showAdvanced && (
 <div className="space-y-3 rounded-lg border border-border/30 bg-surface-2/30 px-3 py-3">
 <label className="block space-y-1">
 <span className="text-muted-foreground">Console log directory</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={consoleLogDir}
 onChange={(e) => setConsoleLogDir(e.target.value)}
 placeholder="Defaults to {data_dir}/console"
 />
 </label>
 <div className="grid grid-cols-2 gap-3">
 <label className="block space-y-1">
 <span className="text-muted-foreground">CNI config dir</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={cniDir}
 onChange={(e) => setCniDir(e.target.value)}
 placeholder="/etc/cni/net.d"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">CNI bin dir</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={cniBinDir}
 onChange={(e) => setCniBinDir(e.target.value)}
 placeholder="/opt/cni/bin"
 />
 </label>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <label className="block space-y-1">
 <span className="text-muted-foreground">CNI data dir</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={cniDataDir}
 onChange={(e) => setCniDataDir(e.target.value)}
 placeholder="/var/lib/cni/networks"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">CNI results dir</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={cniResultsDir}
 onChange={(e) => setCniResultsDir(e.target.value)}
 placeholder="/var/lib/cni/results"
 />
 </label>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <label className="block space-y-1">
 <span className="text-muted-foreground">CNI bridge name</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={cniBridgeName}
 onChange={(e) => setCniBridgeName(e.target.value)}
 placeholder="catalyst0"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">CNI bridge subnet</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={cniBridgeSubnet}
 onChange={(e) => setCniBridgeSubnet(e.target.value)}
 placeholder="10.42.0.0/16"
 />
 </label>
 </div>
 <label className="block space-y-1">
 <span className="text-muted-foreground">Systemd override dir</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={systemdOverrideDir}
 onChange={(e) => setSystemdOverrideDir(e.target.value)}
 placeholder="/etc/systemd/system/containerd.service.d"
 />
 </label>
 <div className="grid grid-cols-2 gap-3">
 <label className="block space-y-1">
 <span className="text-muted-foreground">Agent config path</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={agentConfigPath}
 onChange={(e) => setAgentConfigPath(e.target.value)}
 placeholder="/opt/catalyst-agent/config.toml"
 />
 </label>
 <label className="block space-y-1">
 <span className="text-muted-foreground">Agent release repo</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 font-mono text-sm text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={agentReleaseRepo}
 onChange={(e) => setAgentReleaseRepo(e.target.value)}
 placeholder="catalystctl/catalyst"
 />
 </label>
 </div>
 <p className="text-xs text-muted-foreground">
 Leave blank to use agent defaults. These paths are written into the node's config.toml during deployment.
 </p>
 </div>
 )}
 </div>
 </div>
 <div className="flex justify-between gap-2 border-t border-border/30 px-6 py-4 text-xs">
 <button
 className="rounded-full border border-border/40 px-4 py-2 text-sm font-semibold text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground"
 onClick={() => setStep(1)}
 >
 &larr; Back
 </button>
 <button
 className="rounded-full bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-60"
 onClick={() => createMutation.mutate()}
 disabled={disableSubmit}
 >
 {createMutation.isPending ? 'Registering...' : 'Register node'}
 </button>
 </div>
 </>
 )}

 {/* ── Step 3: Deploy Script ── */}
 {step === 3 && (
 <>
 <div className="flex flex-col items-center px-6 py-8 text-center">
 <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-success/10">
 <CheckCircle className="h-7 w-7 text-success" />
 </div>
 <h3 className="text-base font-semibold text-foreground">
 Node registered successfully
 </h3>
 <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
 Run the script below on <span className="font-medium text-foreground">{hostname}</span> to install and register the agent.
 </p>

 {deployTokenMutation.isPending ? (
 <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
 <Loader2 className="h-4 w-4 animate-spin" />
 Generating deployment script…
 </div>
 ) : deployInfo ? (
 <div className="mt-6 w-full space-y-3 text-left">
 <div className="rounded-lg border border-border/40 bg-surface-2 px-4 py-3 font-mono text-xs text-foreground">
 <code className="whitespace-pre-wrap break-all">
{`curl -s '${deployInfo.deployUrl}?apiKey=${encodeURIComponent(deployInfo.apiKey)}' | sudo bash -x`}
 </code>
 </div>
 <div className="flex items-center justify-between text-xs text-muted-foreground">
 <span>Token expires: {new Date(deployInfo.expiresAt).toLocaleString()}</span>
 <button
 className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80"
 onClick={() => {
 navigator.clipboard.writeText(
 `curl -s '${deployInfo.deployUrl}?apiKey=${encodeURIComponent(deployInfo.apiKey)}' | sudo bash -x`
 );
 notifySuccess('Copied to clipboard');
 }}
 >
 <Copy className="h-3.5 w-3.5" />
 Copy
 </button>
 </div>
 </div>
 ) : deployTokenMutation.isError ? (
 <div className="mt-6 w-full space-y-3 text-left">
 <div className="rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-warning">
 Failed to generate deployment script automatically.
 </div>
 <button
 className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
 onClick={() => {
 if (createdNodeId) {
 deployTokenMutation.mutate(createdNodeId);
 }
 }}
 >
 Retry
 </button>
 {createdNodeId && (
 <p className="text-xs text-muted-foreground">
 Or go to{' '}
 <a href={`/admin/nodes/${createdNodeId}`} className="font-medium text-primary hover:text-primary/80">
 node settings
 </a>{' '}
 to generate the deploy script manually.
 </p>
 )}
 </div>
 ) : null}
 </div>
 <div className="flex justify-end border-t border-border/30 px-6 py-4 text-xs">
 <button
 className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90"
 onClick={() => {
 setOpen(false);
 resetForm();
 }}
 >
 Done
 </button>
 </div>
 </>
 )}
 </div>
 </div>
 </ModalPortal>
 ) : null}
 </div>
 );
}

export default NodeCreateModal;
