import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { useParams, Link } from 'react-router-dom';
import {
 Network,
 Plug,
 Globe,
 Search,
 Trash2,
 Plus,
 ArrowLeft,
 Info,
} from 'lucide-react';
import apiClient from '../../services/api/client';
import { notifyError, notifySuccess } from '../../utils/notify';
import { useNodes } from '../../hooks/useNodes';
import { adminApi } from '../../services/api/admin';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import StatGrid from '../../components/servers/tabs/StatGrid';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import DataField from '../../components/servers/tabs/DataField';

interface NodeAllocation {
 id: string;
 nodeId: string;
 serverId: string | null;
 ip: string;
 port: number;
 alias: string | null;
 notes: string | null;
 createdAt: string;
 updatedAt: string;
}

interface IpPool {
 id: string;
 nodeId: string;
 nodeName: string;
 networkName: string;
 cidr: string;
 gateway: string | null;
 rangeStart: string;
 rangeEnd: string;
 total: number;
 availableCount: number;
 usedCount: number;
 reservedCount: number;
 allocations?: Array<{
 id: string;
 ip: string;
 serverId: string | null;
 serverName?: string;
 serverStatus?: string;
 createdAt: string;
 }>;
}

const parseReserved = (value: string) =>
 value
 .split(/[\s,]+/)
 .map((entry) => entry.trim())
 .filter(Boolean);

function NodeAllocationsPage() {
 const { nodeId } = useParams<{ nodeId: string }>();

 // Tab state
 const [activeTab, setActiveTab] = useState<'ports' | 'ips'>('ports');

 // Port allocations state
 const [search, setSearch] = useState('');
 const [showCreatePortModal, setShowCreatePortModal] = useState(false);
 const [ipInput, setIpInput] = useState('');
 const [portsInput, setPortsInput] = useState('');
 const [aliasInput, setAliasInput] = useState('');

 // IP pool state
 const [showCreatePoolModal, setShowCreatePoolModal] = useState(false);
 const [networkName, setNetworkName] = useState('mc-lan');
 const [cidr, setCidr] = useState('');
 const [gateway, setGateway] = useState('');
 const [startIp, setStartIp] = useState('');
 const [endIp, setEndIp] = useState('');
 const [reserved, setReserved] = useState('');
 const [autoFillIp, setAutoFillIp] = useState('');

 const { data: nodes = [] } = useNodes();
 const node = nodes.find((n) => n.id === nodeId);

 // Fetch port allocations (NodeAllocation)
 const { data: allocations = [], isLoading: allocationsLoading } = useQuery<NodeAllocation[]>({
 queryKey: qk.adminNodeAllocations(nodeId!),
 queryFn: async () => {
 const response = await apiClient.get<{ success: boolean; data: NodeAllocation[] }>(`/api/nodes/${nodeId}/allocations`);
 return response.data ?? [];
 },
 enabled: !!nodeId,
 staleTime: 5 * 60 * 1000,
 });

 // Fetch IP pools (IpAllocation via pools)
 const { data: allPools = [], isLoading: poolsLoading } = useQuery({
 queryKey: qk.adminIpPools(nodeId!),
 queryFn: adminApi.listIpPools,
 staleTime: 5 * 60 * 1000,
 });

 const nodePools = useMemo(() => (allPools as IpPool[]).filter((p: IpPool) => p.nodeId === nodeId), [allPools, nodeId]);

 // Port allocation mutations
 const createPortMutation = useMutation({
 mutationFn: async () => {
 return apiClient.post<{ success: boolean; data: { created: number } }>(`/api/nodes/${nodeId}/allocations`, {
 ip: ipInput.trim(),
 ports: portsInput.trim(),
 alias: aliasInput.trim() || undefined,
 });
 },
 onSuccess: (response) => {
 const created = response.data?.created || 0;
 notifySuccess(`Created ${created} port allocation${created !== 1 ? 's' : ''}`);
 setShowCreatePortModal(false);
 setIpInput('');
 setPortsInput('');
 setAliasInput('');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId!) });
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to create port allocations';
 notifyError(message);
 },
 });

 const deletePortMutation = useMutation({
 mutationFn: async (allocationId: string) => {
 return apiClient.delete(`/api/nodes/${nodeId}/allocations/${allocationId}`);
 },
 onSuccess: () => {
 notifySuccess('Port allocation deleted');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminNodeAllocations(nodeId!) });
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to delete port allocation';
 notifyError(message);
 },
 });

 // IP pool mutations
 const createPoolMutation = useMutation({
 mutationFn: () =>
 adminApi.createIpPool({
 nodeId: nodeId!,
 networkName,
 cidr,
 gateway: gateway || undefined,
 startIp: startIp || undefined,
 endIp: endIp || undefined,
 reserved: reserved ? parseReserved(reserved) : undefined,
 }),
 onSuccess: () => {
 notifySuccess('IP pool created');
 setShowCreatePoolModal(false);
 setCidr('');
 setGateway('');
 setStartIp('');
 setEndIp('');
 setReserved('');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminIpPools(nodeId!) });
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to create IP pool';
 notifyError(message);
 },
 });

 const deletePoolMutation = useMutation({
 mutationFn: (poolId: string) => adminApi.deleteIpPool(poolId),
 onSuccess: () => {
 notifySuccess('IP pool deleted');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminIpPools(nodeId!) });
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to delete IP pool';
 notifyError(message);
 },
 });

 // Filtered port allocations
 const filteredAllocations = useMemo(() => {
 if (!search.trim()) return allocations;
 const query = search.toLowerCase();
 return allocations.filter(
 (a) =>
 a.ip.includes(query) ||
 a.port.toString().includes(query) ||
 a.alias?.toLowerCase().includes(query) ||
 a.notes?.toLowerCase().includes(query),
 );
 }, [allocations, search]);

 // Port allocation stats
 const portStats = useMemo(() => {
 const assigned = allocations.filter((a) => a.serverId).length;
 const available = allocations.length - assigned;
 const uniqueIps = new Set(allocations.map((a) => a.ip)).size;
 return { total: allocations.length, assigned, available, uniqueIps };
 }, [allocations]);

 // IP pool stats
 const ipPoolStats = useMemo(() => {
 const totals = nodePools.reduce(
 (acc: { available: number; used: number; total: number; reserved: number }, pool: IpPool) => {
 acc.available += pool.availableCount;
 acc.used += pool.usedCount;
 acc.reserved += pool.reservedCount;
 acc.total += pool.total;
 return acc;
 },
 { available: 0, used: 0, reserved: 0, total: 0 },
 );
 return { ...totals, pools: nodePools.length };
 }, [nodePools]);

 const handleQuickFillPorts = () => {
 if (node?.publicAddress) {
 setIpInput(node.publicAddress);
 setPortsInput('25565-25664');
 }
 };

 const handleAutoFillPool = () => {
 if (!autoFillIp) return;
 const parts = autoFillIp.trim().split('.');
 if (parts.length < 3) return;
 const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
 setCidr(`${base}.0/24`);
 setGateway(`${base}.1`);
 setStartIp(`${base}.10`);
 setEndIp(`${base}.250`);
 };

 const allPortStatItems = [
 { label: 'Total Ports', value: portStats.total },
 { label: 'Available', value: portStats.available },
 { label: 'Assigned', value: portStats.assigned },
 { label: 'Unique IPs', value: portStats.uniqueIps },
 ];

 const allIpStatItems = [
 { label: 'Total IPs', value: ipPoolStats.total },
 { label: 'Available', value: ipPoolStats.available },
 { label: 'Used', value: ipPoolStats.used },
 { label: 'Reserved', value: ipPoolStats.reserved },
 ];

 return (
 <div className="space-y-5">
 {/* Breadcrumb */}
 <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
 <Link to="/admin/nodes" className="flex items-center gap-1 hover:text-foreground transition-colors">
 <ArrowLeft className="h-3 w-3" />
 Nodes
 </Link>
 <span className="text-muted-foreground/30">/</span>
 <span className="text-foreground font-medium">{node?.name || 'Loading...'}</span>
 <span className="text-muted-foreground/30">/</span>
 <span className="text-foreground">Network Allocations</span>
 </div>

 {/* Header */}
 <TabHeader
 icon={Network}
 title="Network Allocations"
 description={`Manage port bindings and IP pools for ${node?.name || 'this node'}`}
 actions={
 <div className="flex items-center gap-2">
 <div className="hidden sm:flex items-center gap-1.5 rounded-md border border-border/30 bg-surface-2/30 px-2.5 py-1 text-[11px] text-muted-foreground">
 <Plug className="h-3 w-3" />
 {portStats.total} ports
 </div>
 <div className="hidden sm:flex items-center gap-1.5 rounded-md border border-border/30 bg-surface-2/30 px-2.5 py-1 text-[11px] text-muted-foreground">
 <Globe className="h-3 w-3" />
 {ipPoolStats.pools} pools
 </div>
 </div>
 }
 />

 {/* Info note */}
 <ServerTabCard className="!border-info/15 !bg-info/[0.02]">
 <div className="flex items-start gap-2.5">
 <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
 <div className="space-y-1">
 <p className="text-[11px] font-medium text-foreground">Two allocation types:</p>
 <ul className="ml-3 list-disc space-y-0.5 text-[11px] text-muted-foreground">
 <li><strong>Port Allocations</strong> — Track IP:Port combinations for proxy/NAT setups (like Pterodactyl)</li>
 <li><strong>IP Pools</strong> — Automatic MACVLAN networking with dedicated IPs per server (advanced)</li>
 </ul>
 </div>
 </div>
 </ServerTabCard>

 {/* Tabs */}
 <div className="flex gap-1 rounded-xl border border-border/40 bg-surface-2/40 p-1.5 ">
 <button
 onClick={() => setActiveTab('ports')}
 className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
 activeTab === 'ports'
 ? 'bg-primary text-primary-foreground '
 : 'text-muted-foreground hover:text-foreground'
 }`}
 >
 <Plug className="h-3.5 w-3.5" />
 Port Allocations
 <span className={`text-[10px] tabular-nums ${activeTab === 'ports' ? 'text-primary-foreground/70' : 'text-muted-foreground/50'}`}>
 {portStats.total}
 </span>
 </button>
 <button
 onClick={() => setActiveTab('ips')}
 className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
 activeTab === 'ips'
 ? 'bg-primary text-primary-foreground '
 : 'text-muted-foreground hover:text-foreground'
 }`}
 >
 <Globe className="h-3.5 w-3.5" />
 IP Pools
 <span className={`text-[10px] tabular-nums ${activeTab === 'ips' ? 'text-primary-foreground/70' : 'text-muted-foreground/50'}`}>
 {ipPoolStats.pools}
 </span>
 </button>
 </div>

 {/* Port Allocations Tab */}
 {activeTab === 'ports' && (
 <div className="space-y-4">
 <StatGrid items={allPortStatItems} columns={4} />

 {/* Search and Create */}
 <div className="flex items-center gap-2">
 <div className="relative flex-1 max-w-sm">
 <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
 <input
 type="text"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="Search by IP, port, alias..."
 className="h-8 w-full rounded-lg border border-border/40 bg-card px-8 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 transition-colors focus:border-primary/40 focus:outline-none"
 />
 </div>
 <button
 onClick={() => setShowCreatePortModal(true)}
 className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
 >
 <Plus className="h-3.5 w-3.5" />
 Create Allocations
 </button>
 </div>

 {/* Port Allocations List */}
 {allocationsLoading ? (
 <TabLoadingState rows={5} />
 ) : filteredAllocations.length === 0 ? (
 <TabEmptyState
 title={search.trim() ? 'No port allocations match your search' : 'No port allocations yet'}
 description={search.trim() ? undefined : 'Create allocations to assign IP:Port combinations to servers.'}
 action={
 !search.trim() ? (
 <button
 onClick={() => setShowCreatePortModal(true)}
 className="rounded-md border border-border/40 bg-card px-3 py-1.5 text-[11px] font-medium text-primary transition-colors hover:border-primary/20"
 >
 Create your first allocations
 </button>
 ) : undefined
 }
 />
 ) : (
 <div className="space-y-2">
 {filteredAllocations.map((allocation) => (
 <div
 key={allocation.id}
 className="group relative rounded-lg border border-border/30 px-4 py-3 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
 >
 <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />
 <div className="flex items-center justify-between gap-3">
 <div className="flex items-center gap-4 min-w-0 flex-1">
 <DataField
 label="IP"
 value={allocation.ip}
 copyable
 />
 <DataField
 label="Port"
 value={String(allocation.port)}
 copyable
 />
 {allocation.alias && (
 <span className="hidden sm:inline text-xs text-muted-foreground truncate">
 {allocation.alias}
 </span>
 )}
 </div>
 <div className="flex items-center gap-2 shrink-0">
 {allocation.serverId ? (
 <span className="inline-flex items-center rounded-full border border-border/30 bg-surface-2/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
 Assigned
 </span>
 ) : (
 <span className="inline-flex items-center rounded-full border border-success/20 bg-success/5 px-2 py-0.5 text-[10px] font-medium text-success">
 Available
 </span>
 )}
 {!allocation.serverId && (
 <button
 onClick={() => deletePortMutation.mutate(allocation.id)}
 disabled={deletePortMutation.isPending}
 className="rounded p-1 text-muted-foreground/40 transition-colors hover:text-destructive hover:bg-destructive/5"
 title="Delete"
 >
 <Trash2 className="h-3 w-3" />
 </button>
 )}
 </div>
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 )}

 {/* IP Pools Tab */}
 {activeTab === 'ips' && (
 <div className="space-y-4">
 <StatGrid items={allIpStatItems} columns={4} />

 {/* Create Pool Button */}
 <div className="flex justify-end">
 <button
 onClick={() => setShowCreatePoolModal(true)}
 className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
 >
 <Plus className="h-3.5 w-3.5" />
 Create IP Pool
 </button>
 </div>

 {/* IP Pools List */}
 {poolsLoading ? (
 <TabLoadingState rows={4} />
 ) : nodePools.length === 0 ? (
 <TabEmptyState
 title="No IP pools for this node"
 description="Create an IP pool to enable MACVLAN networking with automatic IPAM."
 action={
 <button
 onClick={() => setShowCreatePoolModal(true)}
 className="rounded-md border border-border/40 bg-card px-3 py-1.5 text-[11px] font-medium text-primary transition-colors hover:border-primary/20"
 >
 Create your first IP pool
 </button>
 }
 />
 ) : (
 <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
 {nodePools.map((pool: IpPool) => (
 <ServerTabCard key={pool.id} className="relative">
 <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />
 <div className="flex items-start justify-between gap-3">
 <div className="min-w-0">
 <SectionHeader
 icon={Globe}
 title={pool.networkName}
 />
 <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
 <code className="rounded bg-surface-2/50 px-1.5 py-0.5 font-mono">{pool.cidr}</code>
 <span>·</span>
 <span>{pool.rangeStart} → {pool.rangeEnd}</span>
 </div>
 </div>
 <button
 onClick={() => deletePoolMutation.mutate(pool.id)}
 disabled={deletePoolMutation.isPending}
 className="rounded p-1.5 text-muted-foreground/40 transition-colors hover:text-destructive hover:bg-destructive/5"
 title="Delete"
 >
 <Trash2 className="h-3.5 w-3.5" />
 </button>
 </div>

 <div className="mt-3 grid grid-cols-3 gap-2">
 <div className="rounded-md border border-border/30 bg-surface-2/30 px-3 py-2">
 <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Available</div>
 <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-foreground">{pool.availableCount}</div>
 </div>
 <div className="rounded-md border border-border/30 bg-surface-2/30 px-3 py-2">
 <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Used</div>
 <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-foreground">{pool.usedCount}</div>
 </div>
 <div className="rounded-md border border-border/30 bg-surface-2/30 px-3 py-2">
 <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Reserved</div>
 <div className="mt-0.5 text-sm font-semibold font-mono tabular-nums text-foreground">{pool.reservedCount}</div>
 </div>
 </div>

 <div className="mt-2 text-[11px] text-muted-foreground">
 Total: {pool.total} · Gateway: {pool.gateway ?? 'n/a'}
 </div>

 {pool.allocations && pool.allocations.length > 0 && (
 <div className="mt-3 border-t border-border/30 pt-3">
 <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50 mb-2">
 Assigned IPs ({pool.allocations.length})
 </div>
 <div className="max-h-32 space-y-1 overflow-y-auto">
 {pool.allocations.map((alloc: any) => (
 <div key={alloc.id} className="flex items-center justify-between text-[11px]">
 <code className="font-mono text-muted-foreground text-[10px]">{alloc.ip}</code>
 <span className="text-muted-foreground/30">→</span>
 <span className="text-foreground truncate max-w-[120px]">{alloc.serverName}</span>
 </div>
 ))}
 </div>
 </div>
 )}
 </ServerTabCard>
 ))}
 </div>
 )}
 </div>
 )}

 {/* Create Port Allocations Modal */}
<Dialog open={showCreatePortModal} onOpenChange={setShowCreatePortModal}>
 <DialogContent size="lg">
 <DialogHeader icon={<Plug className="h-4 w-4" />}>
 <DialogTitle>Create port allocations</DialogTitle>
 <DialogDescription>Bulk create IP:Port allocations for this node.</DialogDescription>
 </DialogHeader>

 <DialogBody className="space-y-4">
 <ServerTabCard className="!bg-surface-2/20 !border-border/20">
 <p className="text-[11px] text-muted-foreground leading-relaxed">
 <strong>IP format:</strong> Single IP (192.168.1.100), multiple IPs (192.168.1.100, 192.168.1.101), or CIDR (192.168.1.0/24)
 </p>
 <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
 <strong>Port format:</strong> Single port (25565), range (25565-25664), or multiple (25565, 25566, 25567)
 </p>
 </ServerTabCard>

 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">IP Address(es)</span>
 <Input
 type="text"
 value={ipInput}
 onChange={(e) => setIpInput(e.target.value)}
 placeholder="192.168.1.100, 2001:db8::1, or 192.168.1.0/24"
 />
 </label>

 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Port(s)</span>
 <Input
 type="text"
 value={portsInput}
 onChange={(e) => setPortsInput(e.target.value)}
 placeholder="25565-25664 or 25565, 25566"
 />
 </label>

 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Alias (optional)</span>
 <Input
 type="text"
 value={aliasInput}
 onChange={(e) => setAliasInput(e.target.value)}
 placeholder="e.g., Main network"
 />
 </label>

 <Button variant="link" className="h-auto p-0 text-[11px]" onClick={handleQuickFillPorts}>
 Quick fill: Use node IP + ports 25565-25664
 </Button>
 </DialogBody>

 <DialogFooter>
 <Button variant="outline" onClick={() => setShowCreatePortModal(false)}>
 Cancel
 </Button>
 <Button
 onClick={() => createPortMutation.mutate()}
 disabled={!ipInput.trim() || !portsInput.trim() || createPortMutation.isPending}
 >
 {createPortMutation.isPending ? 'Creating…' : 'Create allocations'}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>

 {/* Create IP Pool Modal */}
 <Dialog open={showCreatePoolModal} onOpenChange={setShowCreatePoolModal}>
 <DialogContent size="xl">
 <DialogHeader icon={<Globe className="h-4 w-4" />}>
 <DialogTitle>Create IP pool</DialogTitle>
 <DialogDescription>Configure MACVLAN network with automatic IPAM.</DialogDescription>
 </DialogHeader>

 <DialogBody className="space-y-4">
 <ServerTabCard className="!bg-surface-2/20 !border-border/20">
 <p className="text-[11px] text-muted-foreground leading-relaxed">
 IP pools enable servers to get dedicated IP addresses on the network via MACVLAN. Each server automatically receives one IP from the pool.
 </p>
 </ServerTabCard>

 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Network Name</span>
 <Input
 type="text"
 value={networkName}
 onChange={(e) => setNetworkName(e.target.value)}
 placeholder="mc-lan"
 />
 </label>

 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">CIDR</span>
 <Input
 type="text"
 value={cidr}
 onChange={(e) => setCidr(e.target.value)}
 placeholder="192.168.50.0/24 or 2001:db8::/64"
 />
 </label>

 <div className="grid grid-cols-2 gap-4">
 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Gateway</span>
 <Input
 type="text"
 value={gateway}
 onChange={(e) => setGateway(e.target.value)}
 placeholder="192.168.50.1"
 />
 </label>
 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Start IP (optional)</span>
 <Input
 type="text"
 value={startIp}
 onChange={(e) => setStartIp(e.target.value)}
 placeholder="192.168.50.10"
 />
 </label>
 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">End IP (optional)</span>
 <Input
 type="text"
 value={endIp}
 onChange={(e) => setEndIp(e.target.value)}
 placeholder="192.168.50.200"
 />
 </label>
 <div className="flex items-end">
 <Button
 variant="outline"
 onClick={handleAutoFillPool}
 disabled={!autoFillIp.trim()}
 className="h-8 w-full"
 >
 Autofill /24
 </Button>
 </div>
 </div>

 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Quick Setup IP</span>
 <Input
 type="text"
 value={autoFillIp}
 onChange={(e) => setAutoFillIp(e.target.value)}
 placeholder={node?.publicAddress || '0.0.0.0'}
 />
 </label>

 <label className="block space-y-1.5">
 <span className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">Reserved IPs (optional, comma-separated)</span>
 <Textarea
 value={reserved}
 onChange={(e) => setReserved(e.target.value)}
 rows={2}
 placeholder="192.168.50.20, 192.168.50.21"
 className="resize-none"
 />
 </label>
 </DialogBody>

 <DialogFooter>
 <Button variant="outline" onClick={() => setShowCreatePoolModal(false)}>
 Cancel
 </Button>
 <Button
 onClick={() => createPoolMutation.mutate()}
 disabled={!networkName || !cidr || createPoolMutation.isPending}
 >
 {createPoolMutation.isPending ? 'Creating…' : 'Create pool'}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}

export default NodeAllocationsPage;
