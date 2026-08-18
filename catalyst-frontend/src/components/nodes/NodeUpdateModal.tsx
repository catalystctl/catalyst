import { useState } from 'react';
import { useMutation, useQuery } from '@/csync';
import { ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import type { NodeInfo } from '../../types/node';
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
import { Button } from '@/components/ui/button';
import {
 Dialog,
 DialogBody,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from '@/components/ui/dialog';

type Props = {
 node: NodeInfo;
 open?: boolean;
 onOpenChange?: (open: boolean) => void;
 /** ID of a newly-created location to auto-select (passed from parent after return-from-locations flow) */
 createdLocationId?: string | null;
};

function NodeUpdateModal({ node, open: controlledOpen, onOpenChange, createdLocationId }: Props) {
 const [internalOpen, setInternalOpen] = useState(false);
 const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
 const setOpen = (value: boolean) => {
 setInternalOpen(value);
 onOpenChange?.(value);
 };
 const [name, setName] = useState(node.name);
 const [description, setDescription] = useState(node.description ?? '');
 const [locationId, setLocationId] = useState(node.locationId ?? '');
 // Auto-select a newly created location when returning from the locations manager.
 // Use the "previous prop" pattern to sync state without an effect.
 const [prevCreatedLocationId, setPrevCreatedLocationId] = useState<string | null | undefined>(undefined);
 if (createdLocationId !== prevCreatedLocationId && createdLocationId) {
 setPrevCreatedLocationId(createdLocationId);
 setLocationId(createdLocationId);
 } else if (createdLocationId !== prevCreatedLocationId) {
 setPrevCreatedLocationId(createdLocationId);
 }
 const [hostname, setHostname] = useState(node.hostname ?? '');
 const [publicAddress, setPublicAddress] = useState(node.publicAddress ?? '');
 const [memory, setMemory] = useState(String(node.maxMemoryMb ?? 0));
 const [cpu, setCpu] = useState(String(node.maxCpuCores ?? 0));
 const [memoryOverallocate, setMemoryOverallocate] = useState(
 String(node.memoryOverallocatePercent ?? 0),
 );
 const [cpuOverallocate, setCpuOverallocate] = useState(
 String(node.cpuOverallocatePercent ?? 0),
 );
 const [serverDataDir, setServerDataDir] = useState(
 node.serverDataDir ?? '/var/lib/catalyst/servers',
 );
 const [consoleLogDir, setConsoleLogDir] = useState(node.consoleLogDir ?? '');
 const [cniDir, setCniDir] = useState(node.cniDir ?? '');
 const [cniBinDir, setCniBinDir] = useState(node.cniBinDir ?? '');
 const [cniDataDir, setCniDataDir] = useState(node.cniDataDir ?? '');
 const [cniResultsDir, setCniResultsDir] = useState(node.cniResultsDir ?? '');
 const [cniBridgeName, setCniBridgeName] = useState(node.cniBridgeName ?? '');
 const [cniBridgeSubnet, setCniBridgeSubnet] = useState(node.cniBridgeSubnet ?? '');
 const [systemdOverrideDir, setSystemdOverrideDir] = useState(node.systemdOverrideDir ?? '');
 const [agentConfigPath, setAgentConfigPath] = useState(node.agentConfigPath ?? '');
 const [agentReleaseRepo, setAgentReleaseRepo] = useState(node.agentReleaseRepo ?? '');
 const [sftpPort, setSftpPort] = useState(String(node.sftpPort ?? 2022));
 const [sftpEnabled, setSftpEnabled] = useState(node.sftpEnabled ?? true);
 const [showAdvanced, setShowAdvanced] = useState(false);

 const { data: locations = [] } = useQuery({
 queryKey: qk.locations(),
 queryFn: locationsApi.list,
 staleTime: 5 * 60 * 1000,
 });

 const mutation = useMutation({
 mutationFn: () =>
 nodesApi.update(node.id, {
 name: name || undefined,
 description: description || undefined,
 locationId: locationId || undefined,
 hostname: hostname || undefined,
 publicAddress: publicAddress || undefined,
 maxMemoryMb: Number(memory) || undefined,
 maxCpuCores: Number(cpu) || undefined,
 memoryOverallocatePercent:
 memoryOverallocate !== '' ? Number(memoryOverallocate) : undefined,
 cpuOverallocatePercent:
 cpuOverallocate !== '' ? Number(cpuOverallocate) : undefined,
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
 sftpPort: Number(sftpPort) || undefined,
 sftpEnabled,
 }),
 onSuccess: () => {
 notifySuccess('Node updated');
 setOpen(false);
 },
 onSettled: () => {
 Promise.all([
 queryClient.invalidateQueries({ queryKey: qk.nodes() }),
 queryClient.invalidateQueries({ queryKey: qk.node(node.id) }),
 queryClient.invalidateQueries({ queryKey: qk.adminNodes() }),
 ]);
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
 className="w-full rounded-md border border-border/40 bg-card px-3 py-1 text-xs font-semibold text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground"
 onClick={() => setOpen(true)}
 >
 Update
 </button>
 )}
 <Dialog open={open} onOpenChange={setOpen}>
 <DialogContent size="lg">
 <DialogHeader>
 <DialogTitle>Update node</DialogTitle>
 <DialogDescription>Change this node's identity, capacity, and agent paths.</DialogDescription>
 </DialogHeader>
 <DialogBody className="space-y-3 text-sm text-muted-foreground">
 <label className="block space-y-1">
 <span className="text-muted-foreground">Name</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={name}
 onChange={(event) => setName(event.target.value)}
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
 />
 </label>
 <label className="block space-y-1">
 <span className="text-xs font-medium text-muted-foreground">Location</span>
 {locations.length > 0 ? (
 <Select
 value={locationId || '__none__'}
 onValueChange={(v) => setLocationId(v === '__none__' ? '' : v)}
 >
 <SelectTrigger className="w-full border-border/40">
 <SelectValue placeholder="Select a location…" />
 </SelectTrigger>
 <SelectContent>
 {locations.map((location) => (
 <SelectItem key={location.id} value={location.id}>
 <span className="flex items-center gap-2">
 <MapPin className="h-3.5 w-3.5 text-success" />
 {location.name}
 </span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 ) : (
 <div className="rounded-lg border border-dashed border-border/40 bg-surface-2/50 px-3 py-2">
 <p className="text-xs text-muted-foreground">
 No locations exist yet.{' '}
 <button
 type="button"
 className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary/80"
 onClick={() => {
 setOpen(false);
 window.dispatchEvent(new CustomEvent('catalyst:open-locations-modal', { detail: { returnTo: 'node-update' } }));
 }}
 >
 Create a location
 </button>
 </p>
 </div>
 )}
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
 <span className="text-muted-foreground">Hostname</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={hostname}
 onChange={(event) => setHostname(event.target.value)}
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

 {/* SFTP Configuration */}
 <div className="rounded-lg border border-border/30 bg-surface-2/30 px-3 py-3">
 <div className="flex items-center justify-between">
 <span className="text-sm font-medium text-foreground">SFTP Access</span>
 <label className="flex items-center gap-2 text-xs text-muted-foreground">
 <input
 type="checkbox"
 checked={sftpEnabled}
 onChange={(e) => setSftpEnabled(e.target.checked)}
 className="rounded border-border/40 text-primary focus:ring-primary"
 />
 Enabled
 </label>
 </div>
 {sftpEnabled && (
 <div className="mt-2">
 <label className="block space-y-1">
 <span className="text-muted-foreground">SFTP port</span>
 <input
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all focus:border-primary focus:outline-none hover:border-border/60"
 value={sftpPort}
 onChange={(e) => setSftpPort(e.target.value)}
 type="number"
 min={1}
 max={65535}
 placeholder="2022"
 />
 <p className="text-xs text-muted-foreground">
 Port the SFTP server listens on (on this node). Default: 2022
 </p>
 </label>
 </div>
 )}
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
 </DialogBody>
 <DialogFooter>
 <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
 Cancel
 </Button>
 <Button
 size="sm"
 onClick={() => mutation.mutate()}
 disabled={mutation.isPending}
 >
 {mutation.isPending ? 'Saving…' : 'Save changes'}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}

export default NodeUpdateModal;
