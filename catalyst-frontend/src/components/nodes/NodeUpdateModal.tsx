import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MapPin } from 'lucide-react';
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
import { ModalPortal } from '@/components/ui/modal-portal';

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
 {open ? (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
 <div className="w-full max-w-lg rounded-xl border border-border/40 bg-card shadow-xl transition-all">
 <div className="flex items-center justify-between border-b border-border/30 px-6 py-4">
 <h2 className="text-lg font-semibold text-foreground">
 Update node
 </h2>
 <button
 className="rounded-md border border-border/40 px-2 py-1 text-xs text-muted-foreground transition-all hover:border-primary/50"
 onClick={() => setOpen(false)}
 >
 Close
 </button>
 </div>
 <div className="space-y-3 px-6 py-4 text-sm text-muted-foreground">
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
 </div>
 <div className="flex justify-end gap-2 border-t border-border/30 px-6 py-4 text-xs">
 <button
 className="rounded-md border border-border/40 px-3 py-1 font-semibold text-muted-foreground transition-all hover:border-primary/50 hover:text-foreground"
 onClick={() => setOpen(false)}
 >
 Cancel
 </button>
 <button
 className="rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-60"
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
