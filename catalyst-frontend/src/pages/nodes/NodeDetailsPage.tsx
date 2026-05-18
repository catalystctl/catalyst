import { useMemo, useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
 Server,
 Cpu,
 HardDrive,
 Activity,
 ArrowLeft,
 Key,
 Terminal,
 Settings,
 Trash2,
 ExternalLink,
 Copy,
 AlertTriangle,
 Clock,
 Shield,
 Download,
 CheckCircle,
 RefreshCw,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useNode, useNodeStats } from '../../hooks/useNodes';
import { useUpdateCheck } from '../../hooks/useUpdateCheck';
import NodeUpdateModal from '../../components/nodes/NodeUpdateModal';
import NodeDeleteDialog from '../../components/nodes/NodeDeleteDialog';
import NodeMetricsCard from '../../components/nodes/NodeMetricsCard';
import NodeAssignmentsList from '../../components/nodes/NodeAssignmentsList';
import NodeAssignmentModal from '../../components/nodes/NodeAssignmentModal';
import { nodesApi } from '../../services/api/nodes';
import { useAuthStore } from '../../stores/authStore';
import { notifyError, notifySuccess } from '../../utils/notify';
import ServerImportModal from '../../components/nodes/ServerImportModal';
import { reportSystemError } from '../../services/api/systemErrors';
import { ModalPortal } from '@/components/ui/modal-portal';

import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import StatGrid from '../../components/servers/tabs/StatGrid';

import TabErrorState from '../../components/servers/tabs/TabErrorState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';

// ── Inline Modal Shell ──
function ModalShell({
 open,
 onClose,
 title,
 children,
 footer,
 variant,
}: {
 open: boolean;
 onClose: () => void;
 title: string;
 children: React.ReactNode;
 footer?: React.ReactNode;
 variant?: 'default' | 'danger';
}) {
 if (!open) return null;
 return (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 px-4 backdrop-blur-sm">
 <div
 className={`w-full max-w-2xl rounded-xl border bg-card shadow-xl ${
 variant === 'danger' ? 'border-destructive/50' : 'border-border/40'
 }`}
 >
 <div
 className={`flex items-center justify-between border-b px-6 py-4 ${
 variant === 'danger' ? 'border-destructive/30 bg-destructive/5' : 'border-border/30'
 }`}
 >
 <h2 className="text-lg font-semibold text-foreground">{title}</h2>
 <button
 className="rounded-md border border-border/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
 onClick={onClose}
 >
 Close
 </button>
 </div>
 <div className="space-y-3 px-6 py-4 text-sm text-muted-foreground">
 {children}
 </div>
 {footer && (
 <div className="flex justify-end gap-2 border-t border-border/30 px-6 py-4 text-xs">
 {footer}
 </div>
 )}
 </div>
 </div>
 </ModalPortal>
 );
}

function NodeDetailsPage() {
 const { nodeId } = useParams();
 const user = useAuthStore((s) => s.user);
 const queryClient = useQueryClient();
 const { data: node, isLoading, isError, refetch } = useNode(nodeId);
 const { data: stats } = useNodeStats(nodeId);
 const { data: updateData } = useUpdateCheck();
 const [deployInfo, setDeployInfo] = useState<{
 deployUrl: string;
 deploymentToken: string;
 apiKey: string;
 expiresAt: string;
 } | null>(null);
 const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
 const [showAssignmentModal, setShowAssignmentModal] = useState(false);
 const [showUpdateModal, setShowUpdateModal] = useState(false);
 const [pendingCreatedLocationId, setPendingCreatedLocationId] = useState<string | null>(null);

 // Re-open the update modal after creating a location from within it
 useEffect(() => {
 const handler = (e: Event) => {
 const detail = (e as CustomEvent).detail;
 const createdId = detail?.createdId as string | undefined;
 if (createdId) setPendingCreatedLocationId(createdId);
 setShowUpdateModal(true);
 };
 window.addEventListener('catalyst:return-to-node-update', handler);
 return () => window.removeEventListener('catalyst:return-to-node-update', handler);
 }, []);
 const [showDeleteModal, setShowDeleteModal] = useState(false);
 const [showImportModal, setShowImportModal] = useState(false);

 // Check if API key exists for this node
 const { data: apiKeyStatus } = useQuery({
 queryKey: ['node-api-key', nodeId],
 queryFn: () => nodesApi.checkApiKey(nodeId!),
 enabled: !!nodeId,
 refetchInterval: 30000,
 });

 const deployMutation = useMutation({
 mutationFn: async () => {
 if (!node?.id) {
 reportSystemError({ level: 'error', component: 'NodeDetailsPage', message: 'Missing node id', metadata: { context: 'deploy mutation' } });
 throw new Error('Missing node id');
 }
 return nodesApi.deploymentToken(node.id);
 },
 onSuccess: (info) => {
 setDeployInfo(info ?? null);
 notifySuccess('Deployment script regenerated');
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to regenerate deployment script';
 notifyError(message);
 },
 });

 const apiKeyMutation = useMutation({
 mutationFn: async () => {
 if (!node?.id) {
 reportSystemError({ level: 'error', component: 'NodeDetailsPage', message: 'Missing node id', metadata: { context: 'api key mutation' } });
 throw new Error('Missing node id');
 }
 const regenerate = apiKeyStatus?.exists === true;
 return nodesApi.generateApiKey(node.id, regenerate);
 },
 onSuccess: (info) => {
 setGeneratedApiKey(info?.apiKey ?? null);
 queryClient.invalidateQueries({ queryKey: ['node-api-key', nodeId] });
 notifySuccess(info?.regenerated ? 'API key regenerated' : 'API key generated');
 },
 onError: (error: any) => {
 const message = error?.response?.data?.error || 'Failed to generate API key';
 notifyError(message);
 },
 });

 const handleApiKeyClick = () => {
 apiKeyMutation.mutate();
 };

 const canWrite = useMemo(
 () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
 [user?.permissions],
 );

 const { data: unregisteredContainers = [] } = useQuery({
 queryKey: ['unregistered-containers', nodeId],
 queryFn: () => nodesApi.getUnregisteredContainers(nodeId!),
 enabled: !!nodeId,
 refetchInterval: 30000,
 });

 const canAssignNodes = useMemo(
 () =>
 !!(
 user?.permissions?.includes('node.assign') ||
 user?.permissions?.includes('*') ||
 user?.permissions?.includes('admin.write')
 ),
 [user?.permissions],
 );
 const lastSeen = node?.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
 const serverList = useMemo(() => node?.servers ?? [], [node]);

 if (isLoading) {
 return (
 <div className="flex items-center justify-center py-20">
 <div className="text-sm text-muted-foreground">Loading node…</div>
 </div>
 );
 }

 if (isError || !node) {
 return (
 <div className="flex items-center justify-center py-20">
 <TabErrorState
 message="Unable to load node details."
 onRetry={() => refetch()}
 />
 </div>
 );
 }

 const resourceSummary = stats?.resources ?? null;
 const serverCount = stats?.servers.total ?? node._count?.servers ?? serverList.length;

 return (
 <div className="space-y-4">
 {/* ── Breadcrumb ── */}
 <div>
 <Link
 to="/admin/nodes"
 className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
 >
 <ArrowLeft className="h-3 w-3" />
 Back to Nodes
 </Link>
 </div>

 {/* ── Node Hero ── */}
 <ServerTabCard className={node.isOnline ? 'border-success/20' : ''}>
 {/* Subtle top accent line */}
 <div className={`h-0.5 w-full ${
 node.isOnline
 ? 'bg-gradient-to-r from-transparent via-success/60 to-transparent'
 : 'bg-gradient-to-r from-transparent via-muted-foreground/30 to-transparent'
 }`} />

 <div className="p-6">
 {/* Top row: name + status + actions */}
 <div className="flex flex-wrap items-start justify-between gap-4">
 <div className="flex items-center gap-3 min-w-0">
 <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${
 node.isOnline
 ? 'border-success/30 bg-success/10 text-success'
 : 'border-border/30 bg-surface-2 text-muted-foreground'
 }`}>
 <Server className="h-5 w-5" />
 </div>
 <div className="min-w-0">
 <div className="flex flex-wrap items-center gap-2.5">
 <h1 className="font-display text-2xl font-bold tracking-tight text-foreground truncate">
 {node.name}
 </h1>
 <Badge
 variant={node.isOnline ? 'success' : 'secondary'}
 className="shrink-0 gap-1.5"
 >
 <span className="relative flex h-1.5 w-1.5">
 {node.isOnline && (
 <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
 )}
 <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
 node.isOnline ? 'bg-success/50' : 'bg-muted-foreground'
 }`} />
 </span>
 {node.isOnline ? 'Online' : 'Offline'}
 </Badge>
 </div>
 {/* Metadata */}
 <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
 <span className="font-mono opacity-70">{node.hostname ?? 'hostname n/a'}</span>
 {node.publicAddress && (
 <>
 <span className="text-border/60">·</span>
 <span>{node.publicAddress}</span>
 </>
 )}
 {node.location && (
 <>
 <span className="text-border/60">·</span>
 <span>{node.location.name}</span>
 </>
 )}
 <span className="text-border/60">·</span>
 <span className="inline-flex items-center gap-1">
 <Clock className="h-2.5 w-2.5" />
 {lastSeen}
 </span>
 </div>
 </div>
 </div>

 {/* Action buttons */}
 {canWrite && (
 <div className="flex flex-wrap items-center gap-1.5">
 <Button
 variant={apiKeyStatus?.exists ? 'outline' : 'default'}
 size="sm"
 onClick={handleApiKeyClick}
 disabled={apiKeyMutation.isPending}
 className="gap-1.5"
 >
 <Key className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">
 {apiKeyMutation.isPending
 ? 'Generating…'
 : apiKeyStatus?.exists
 ? 'Regenerate Key'
 : 'Generate Key'}
 </span>
 <span className="sm:hidden">
 <RefreshCw className="h-3.5 w-3.5" />
 </span>
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => deployMutation.mutate()}
 disabled={deployMutation.isPending}
 className="gap-1.5"
 >
 <Terminal className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{deployMutation.isPending ? 'Generating…' : 'Deploy Script'}</span>
 </Button>
 <Button asChild size="sm" variant="outline">
 <Link to={`/admin/nodes/${node.id}/allocations`} className="gap-1.5">
 <Shield className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">Allocations</span>
 </Link>
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => setShowUpdateModal(true)}
 className="gap-1.5"
 >
 <Settings className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">Settings</span>
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={() => setShowDeleteModal(true)}
 className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/30"
 >
 <Trash2 className="h-3.5 w-3.5" />
 </Button>
 </div>
 )}
 </div>

 {/* Agent version strip */}
 <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
 {node.agentVersion && (
 <Badge
 variant={stats?.agentUpdateAvailable ? 'warning' : 'outline'}
 className="gap-1 font-mono text-[10px]"
 >
 {stats?.agentUpdateAvailable ? (
 <AlertTriangle className="h-2.5 w-2.5" />
 ) : (
 <CheckCircle className="h-2.5 w-2.5" />
 )}
 Agent v{node.agentVersion}
 {stats?.agentUpdateAvailable && stats.latestAgentVersion && (
 <span className="text-muted-foreground"> → v{stats.latestAgentVersion}</span>
 )}
 </Badge>
 )}
 {stats?.agentUpdateAvailable && (
 <span className="text-amber-500">Update available</span>
 )}
 {!stats?.agentUpdateAvailable && node.agentVersion && node.isOnline && (
 <span className="text-emerald-500/70">Up to date</span>
 )}
 {!node.agentVersion && node.isOnline && (
 <span className="text-muted-foreground/60">Agent version unknown</span>
 )}
 </div>
 </div>
 </ServerTabCard>

 {/* ── Resource Grid ── */}
 <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
 {stats ? <NodeMetricsCard stats={stats} /> : null}

 <ServerTabCard className="lg:col-span-2">
 <div className="mb-4 flex items-center justify-between">
 <SectionHeader icon={HardDrive} title="Capacity" />
 <Badge variant="outline" className="text-xs">
 {serverCount} servers
 </Badge>
 </div>

 <StatGrid
 columns={2}
 items={[
 {
 label: 'CPU cores',
 value: node.cpuOverallocatePercent && node.cpuOverallocatePercent !== 0
 ? node.cpuOverallocatePercent === -1
 ? `${node.maxCpuCores ?? 0} (effective: ∞)`
 : `${node.maxCpuCores ?? 0} (eff: ${resourceSummary?.effectiveMaxCpuCores ?? ((node.maxCpuCores ?? 0) * (1 + node.cpuOverallocatePercent / 100)).toFixed(1)})`
 : String(node.maxCpuCores ?? 0),
 },
 {
 label: 'Memory',
 value: node.memoryOverallocatePercent && node.memoryOverallocatePercent !== 0
 ? node.memoryOverallocatePercent === -1
 ? `${node.maxMemoryMb ?? 0} MB (effective: ∞)`
 : `${node.maxMemoryMb ?? 0} MB (eff: ${resourceSummary?.effectiveMaxMemoryMb ?? ((node.maxMemoryMb ?? 0) * (1 + node.memoryOverallocatePercent / 100)).toFixed(0)} MB)`
 : `${node.maxMemoryMb ?? 0} MB`,
 },
 {
 label: 'Disk',
 value: resourceSummary
 ? `${resourceSummary.actualDiskUsageMb} / ${resourceSummary.actualDiskTotalMb} MB`
 : 'n/a',
 },
 {
 label: 'Uptime',
 value: stats?.lastMetricsUpdate ? 'Active' : 'Unknown',
 },
 ]}
 />
 </ServerTabCard>
 </div>

 {/* ── Servers on Node ── */}
 <ServerTabCard>
 <div className="mb-4 flex items-center justify-between">
 <SectionHeader icon={Server} title="Servers on node" />
 <Link
 to="/servers"
 className="text-xs font-medium text-primary hover:text-primary/80"
 >
 View all
 </Link>
 </div>

 {serverList.length > 0 ? (
 <div className="divide-y divide-border/30">
 {serverList.map((server) => (
 <div
 key={server.id}
 className="group flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
 >
 <div className="min-w-0 flex-1">
 <Link
 to={`/servers/${server.id}`}
 className="truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
 >
 {server.name}
 </Link>
 <div className="text-xs text-muted-foreground">{server.status}</div>
 </div>
 <Link
 to={`/servers/${server.id}`}
 className="ml-3 flex shrink-0 items-center gap-1 rounded-md border border-border/30 px-2.5 py-1 text-xs text-muted-foreground opacity-0 transition-all hover:border-primary/50 hover:text-primary group-hover:opacity-100"
 >
 Open
 <ExternalLink className="h-3 w-3" />
 </Link>
 </div>
 ))}
 </div>
 ) : (
 <TabEmptyState title="No servers assigned yet." />
 )}
 </ServerTabCard>

 {/* ── Discovered Servers ── */}
 {canWrite && unregisteredContainers.length > 0 && (
 <ServerTabCard className="border-warning/30">
 <div className="mb-4 flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Download className="h-4 w-4 text-warning" />
 <SectionHeader icon={Download} title="Discovered Servers" />
 </div>
 <Button size="sm" onClick={() => setShowImportModal(true)} className="gap-1.5">
 <Download className="h-3.5 w-3.5" />
 Import Servers
 </Button>
 </div>
 <div className="text-xs text-muted-foreground">
 {unregisteredContainers.length} container(s) found on this node that are not registered in the panel.
 These may be servers from a previous panel installation.
 </div>
 <div className="mt-3 divide-y divide-border/30">
 {unregisteredContainers.map((c: any) => (
 <div key={c.containerId} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
 <div className="min-w-0 flex-1 overflow-hidden">
 <div className="font-mono text-xs font-medium text-foreground">{c.containerId}</div>
 <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
 <span>{c.image || 'Unknown image'}</span>
 <Badge
 variant={c.status?.includes('Up') ? 'success' : 'secondary'}
 className="text-[10px]"
 >
 {c.status?.includes('Up') ? 'Running' : 'Stopped'}
 </Badge>
 {c.networkMode && (
 <Badge
 variant={c.networkMode === 'host' ? 'warning' : 'outline'}
 className="text-[10px]"
 >
 {c.networkMode === 'host' ? 'Host Network' : 'Bridge'}
 </Badge>
 )}
 </div>
 {c.startupCommand && (
 <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground/60" title={c.startupCommand}>
 {c.startupCommand.length > 120 ? c.startupCommand.slice(0, 120) + '…' : c.startupCommand}
 </div>
 )}
 {c.envVarNames && c.envVarNames.length > 0 && (
 <div className="mt-1 flex flex-wrap gap-1">
 {c.envVarNames.slice(0, 6).map((name: string) => (
 <span key={name} className="rounded bg-surface-2/50 px-1 py-0.5 text-[9px] text-muted-foreground">
 {name}
 </span>
 ))}
 {c.envVarNames.length > 6 && (
 <span className="text-[9px] text-muted-foreground">+{c.envVarNames.length - 6} more</span>
 )}
 </div>
 )}
 </div>
 </div>
 ))}
 </div>
 </ServerTabCard>
 )}

 {/* ── Node Assignments ── */}
 {canWrite || canAssignNodes ? (
 <div className="space-y-4">
 <NodeAssignmentsList nodeId={nodeId!} canManage={canAssignNodes} />
 {canAssignNodes && (
 <div className="flex justify-center">
 <Button
 variant="outline"
 size="sm"
 onClick={() => setShowAssignmentModal(true)}
 className="gap-1.5 border-dashed border-border/40"
 >
 <Shield className="h-3.5 w-3.5" />
 Assign Node to User or Role
 </Button>
 </div>
 )}
 </div>
 ) : null}

 {/* ── Deploy Script Modal ── */}
 <ModalShell open={!!deployInfo} onClose={() => setDeployInfo(null)} title="Deploy agent">
 <div>Run this on the node to install and register the agent (valid for 24 hours).</div>
 <div className="rounded-lg border border-border/40 bg-surface-2 px-4 py-3 font-mono text-xs text-foreground">
 <code className="whitespace-pre-wrap">
 {deployInfo
 ? `curl -s '${deployInfo.deployUrl}?apiKey=${encodeURIComponent(deployInfo.apiKey)}' | sudo bash -x`
 : ''}
 </code>
 </div>
 <div className="text-xs text-muted-foreground">
 Token expires: {deployInfo ? new Date(deployInfo.expiresAt).toLocaleString() : ''}
 </div>
 <div className="flex justify-end gap-2 border-t border-border/30 pt-4 text-xs">
 <Button variant="outline" size="sm" onClick={() => setDeployInfo(null)}>
 Done
 </Button>
 </div>
 </ModalShell>

 {/* ── Generated / Regenerated API Key Modal ── */}
 <ModalShell
 open={!!generatedApiKey}
 onClose={() => setGeneratedApiKey(null)}
 title="Agent API Key"
 >
 {apiKeyStatus?.exists && (
 <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-warning">
 <AlertTriangle className="h-4 w-4 shrink-0" />
 <span>
 The previous API key has been revoked. Update the agent's{' '}
 <code className="rounded bg-warning/10 px-1">config.toml</code>{' '}
 with the new key below.
 </span>
 </div>
 )}
 <div>
 Add this API key to your agent's{' '}
 <code className="rounded bg-surface-2 px-1">config.toml</code> file:
 </div>
 <div className="rounded-lg border border-border/40 bg-surface-2 px-4 py-3 font-mono text-xs text-foreground">
 <code className="whitespace-pre-wrap break-all">
 api_key = &quot;{generatedApiKey}&quot;
 </code>
 </div>
 <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-warning">
 <AlertTriangle className="h-4 w-4 shrink-0" />
 <strong>Important:</strong> Save this key now. It will not be shown again.
 </div>
 <div className="flex justify-end gap-2 border-t border-border/30 pt-4 text-xs">
 <Button
 variant="outline"
 size="sm"
 onClick={() => {
 if (generatedApiKey) {
 navigator.clipboard.writeText(generatedApiKey);
 notifySuccess('API key copied to clipboard');
 }
 }}
 className="gap-1.5"
 >
 <Copy className="h-3 w-3" />
 Copy
 </Button>
 <Button variant="outline" size="sm" onClick={() => setGeneratedApiKey(null)}>
 Done
 </Button>
 </div>
 </ModalShell>

 {/* ── Controlled Update & Delete Modals ── */}
 {showUpdateModal && node && (
 <NodeUpdateModal
 node={node}
 open
 onOpenChange={(open) => {
 if (!open) {
 setShowUpdateModal(false);
 setPendingCreatedLocationId(null);
 }
 }}
 createdLocationId={pendingCreatedLocationId}
 />
 )}
 {showDeleteModal && (
 <NodeDeleteDialog
 nodeId={node.id}
 nodeName={node.name}
 open
 onOpenChange={(open) => {
 if (!open) setShowDeleteModal(false);
 }}
 />
 )}

 {/* ── Assignment Modal ── */}
 <NodeAssignmentModal
 nodeId={nodeId!}
 open={showAssignmentModal}
 onClose={() => setShowAssignmentModal(false)}
 />

 {/* ── Server Import Modal ── */}
 <ServerImportModal
 open={showImportModal}
 onClose={() => setShowImportModal(false)}
 nodeId={nodeId!}
 containers={unregisteredContainers}
 />
 </div>
 );
}

export default NodeDetailsPage;
