import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { serversApi } from '../../services/api/servers';
import { nodesApi } from '../../services/api/nodes';
import { useAuthStore } from '../../stores/authStore';
import { notifyError, notifySuccess } from '../../utils/notify';
import { Button } from '@/components/ui/button';
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
 DialogTrigger,
} from '@/components/ui/dialog';
import type { Server } from '../../types/server';
import type { CloneServerPayload } from '../../types/server';

type Props = {
 server: Server;
 disabled?: boolean;
};

function CloneServerDialog({ server, disabled = false }: Props) {
 const navigate = useNavigate();
 const user = useAuthStore((s) => s.user);
 const [open, setOpen] = useState(false);

 const isAdmin =
 user?.permissions?.includes('*') ||
 user?.permissions?.includes('admin.write');

 // Fetch available nodes for the dropdown
 const { data: accessibleNodesData } = useQuery({
 queryKey: qk.accessibleNodes(),
 queryFn: async () => {
 const res = await fetch('/api/nodes/accessible', {
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 });
 if (!res.ok) throw new Error('Failed to fetch accessible nodes');
 return res.json();
 },
 enabled: open,
 });

 const { data: allNodes } = useQuery({
 queryKey: qk.nodes(),
 queryFn: () => nodesApi.list(),
 enabled: open && isAdmin,
 });

 const availableNodes: Array<{ id: string; name: string }> =
 isAdmin
 ? (allNodes || [])
 : (accessibleNodesData?.nodes || []);

 // Form state — pre-populated from source server
 const [name, setName] = useState(`${server.name} Copy`);
 const [nodeId, setNodeId] = useState(server.nodeId);
 const [memoryMb, setMemoryMb] = useState(server.allocatedMemoryMb ?? 1024);
 const [cpuCores, setCpuCores] = useState(server.allocatedCpuCores ?? 1);
 const [diskMb, setDiskMb] = useState(server.allocatedDiskMb ?? 1024);

 const canClone =
 user?.permissions?.includes('*') ||
 user?.permissions?.includes('server.create') ||
 isAdmin;

 const cloneMutation = useMutation({
 mutationFn: () => {
 const payload: CloneServerPayload = {
 name: name.trim() || undefined,
 nodeId: nodeId !== server.nodeId ? nodeId : undefined,
 allocatedMemoryMb: memoryMb !== server.allocatedMemoryMb ? memoryMb : undefined,
 allocatedCpuCores: cpuCores !== server.allocatedCpuCores ? cpuCores : undefined,
 allocatedDiskMb: diskMb !== server.allocatedDiskMb ? diskMb : undefined,
 };
 return serversApi.clone(server.id, payload);
 },
 onSuccess: (newServer) => {
 queryClient.invalidateQueries({ queryKey: ['servers'] });
 queryClient.invalidateQueries({ queryKey: qk.server(server.id) });
 if (newServer?.id) {
 queryClient.invalidateQueries({ queryKey: qk.server(newServer.id) });
 }
 notifySuccess('Server cloned successfully');
 setOpen(false);
 // Navigate to the new server's page
 if (newServer?.id) {
 navigate(`/servers/${newServer.id}`);
 }
 },
 onError: (error: any) => {
 notifyError(
 error?.response?.data?.error || 'Failed to clone server',
 );
 },
 });

 return (
 <Dialog open={open} onOpenChange={setOpen}>
 <DialogTrigger asChild>
 <Button
 variant="outline"
 size="sm"
 disabled={disabled || !canClone}
 onClick={() => setOpen(true)}
 >
 Clone
 </Button>
 </DialogTrigger>
 <DialogContent className="sm:max-w-md">
 <DialogHeader>
 <DialogTitle>Clone Server</DialogTitle>
 <DialogDescription>
 Create a new server with the same configuration as {server.name}.
 </DialogDescription>
 </DialogHeader>

 {/* Warning banner */}
 <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
 <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
 <span className="text-muted-foreground">
 This will create a new server with the same configuration. A fresh install will run on the new server.
 </span>
 </div>

 <div className="grid gap-4 py-2">
 {/* Name */}
 <div className="grid gap-2">
 <label htmlFor="clone-name" className="text-xs font-medium text-foreground">
 Name
 </label>
 <input
 id="clone-name"
 className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="Server name"
 />
 </div>

 {/* Node */}
 <div className="grid gap-2">
 <label htmlFor="clone-node" className="text-xs font-medium text-foreground">
 Node
 </label>
 <select
 id="clone-node"
 className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={nodeId}
 onChange={(e) => setNodeId(e.target.value)}
 >
 {availableNodes.map((node) => (
 <option key={node.id} value={node.id}>
 {node.name}
 </option>
 ))}
 </select>
 </div>

 {/* Resources */}
 <div className="grid grid-cols-3 gap-3">
 <div className="grid gap-2">
 <label htmlFor="clone-memory" className="text-xs font-medium text-foreground">
 Memory (MB)
 </label>
 <input
 id="clone-memory"
 type="number"
 min={512}
 className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={memoryMb}
 onChange={(e) => setMemoryMb(Number(e.target.value))}
 />
 </div>
 <div className="grid gap-2">
 <label htmlFor="clone-cpu" className="text-xs font-medium text-foreground">
 CPU Cores
 </label>
 <input
 id="clone-cpu"
 type="number"
 min={1}
 className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={cpuCores}
 onChange={(e) => setCpuCores(Number(e.target.value))}
 />
 </div>
 <div className="grid gap-2">
 <label htmlFor="clone-disk" className="text-xs font-medium text-foreground">
 Disk (MB)
 </label>
 <input
 id="clone-disk"
 type="number"
 min={1024}
 className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={diskMb}
 onChange={(e) => setDiskMb(Number(e.target.value))}
 />
 </div>
 </div>
 </div>

 <DialogFooter>
 <Button
 variant="outline"
 size="sm"
 onClick={() => setOpen(false)}
 disabled={cloneMutation.isPending}
 >
 Cancel
 </Button>
 <Button
 size="sm"
 onClick={() => cloneMutation.mutate()}
 disabled={cloneMutation.isPending || !name.trim()}
 >
 {cloneMutation.isPending ? 'Cloning...' : 'Clone Server'}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}

export default CloneServerDialog;
