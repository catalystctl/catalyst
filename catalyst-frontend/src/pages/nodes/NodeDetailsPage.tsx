import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
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
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useNode, useNodeStats } from '../../hooks/useNodes';
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

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring', stiffness: 300, damping: 24 },
  },
};

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
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          className={`w-full max-w-2xl rounded-xl border bg-card shadow-xl ${
            variant === 'danger' ? 'border-destructive/50' : 'border-border'
          }`}
        >
          <div
            className={`flex items-center justify-between border-b px-6 py-4 ${
              variant === 'danger' ? 'border-destructive/30 bg-destructive/50/5' : 'border-border'
            }`}
          >
            <h2 className="text-lg font-semibold text-foreground ">{title}</h2>
            <button
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground dark:text-foreground"
              onClick={onClose}
            >
              Close
            </button>
          </div>
          <div className="space-y-3 px-6 py-4 text-sm text-muted-foreground dark:text-foreground">
            {children}
          </div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border px-6 py-4 text-xs">
              {footer}
            </div>
          )}
        </motion.div>
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
  const [deployInfo, setDeployInfo] = useState<{
    deployUrl: string;
    deploymentToken: string;
    apiKey: string;
    expiresAt: string;
  } | null>(null);
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
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
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center py-20"
      >
        <div className="text-sm text-muted-foreground">Loading node…</div>
      </motion.div>
    );
  }

  if (isError || !node) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="flex items-center justify-center py-20"
      >
        <div className="rounded-xl border border-destructive/30 bg-destructive/50/5 px-6 py-4 text-center">
          <p className="text-sm font-medium text-destructive dark:text-destructive">
            Unable to load node details.
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="gap-1.5 text-xs"
            >
              Retry
            </Button>
            <Link to="/admin/nodes" className="text-xs text-muted-foreground hover:text-foreground">
              ← Back to nodes
            </Link>
          </div>
        </div>
      </motion.div>
    );
  }

  const resourceSummary = stats?.resources ?? null;
  const serverCount = stats?.servers.total ?? node._count?.servers ?? serverList.length;

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-emerald-500/8 to-cyan-500/8 blur-3xl dark:from-emerald-500/15 dark:to-cyan-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-sky-500/8 to-violet-500/8 blur-3xl dark:from-sky-500/15 dark:to-violet-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Breadcrumb ── */}
        <motion.div variants={itemVariants}>
          <Link
            to="/admin/nodes"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Back to Nodes
          </Link>
        </motion.div>

        {/* ── Header ── */}
        <motion.div variants={itemVariants}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div
                    className={`absolute -inset-1 rounded-lg opacity-20 blur-sm ${
                      node.isOnline
                        ? 'bg-gradient-to-r from-emerald-500 to-cyan-500'
                        : 'bg-gradient-to-r from-zinc-400 to-zinc-500'
                    }`}
                  />
                  <Server
                    className={`relative h-7 w-7 ${
                      node.isOnline
                        ? 'text-success dark:text-success'
                        : 'text-muted-foreground dark:text-muted-foreground'
                    }`}
                  />
                </div>
                <h1 className="font-display text-3xl font-bold tracking-tight text-foreground ">
                  {node.name}
                </h1>
                <Badge variant={node.isOnline ? 'success' : 'secondary'} className="gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    {node.isOnline && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                    )}
                    <span
                      className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                        node.isOnline ? 'bg-success/50' : 'bg-muted-foreground'
                      }`}
                    />
                  </span>
                  {node.isOnline ? 'Online' : 'Offline'}
                </Badge>
              </div>
              <div className="ml-10 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="font-mono text-xs opacity-70">
                  {node.hostname ?? 'hostname n/a'}
                </span>
                <span className="text-border">·</span>
                <span>{node.publicAddress ?? 'address n/a'}</span>
                {node.location && (
                  <>
                    <span className="text-border">·</span>
                    <span>{node.location.name}</span>
                  </>
                )}
              </div>
              <div className="ml-10 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Last seen {lastSeen}
              </div>
            </div>

            {canWrite && (
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild size="sm">
                  <Link to={`/admin/nodes/${node.id}/allocations`} className="gap-1.5">
                    <Shield className="h-3.5 w-3.5" />
                    Allocations
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowUpdateModal(true)}
                  className="gap-1.5"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Update
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteModal(true)}
                  className="gap-1.5 text-destructive hover:bg-destructive/5 hover:text-destructive hover:border-destructive/20 dark:text-destructive dark:hover:bg-destructive/30 dark:hover:border-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Agent Actions ── */}
        {canWrite && (
          <motion.div variants={itemVariants} className="flex flex-wrap items-center gap-2">
            <Button
              variant={apiKeyStatus?.exists ? 'outline' : 'default'}
              size="sm"
              onClick={handleApiKeyClick}
              disabled={apiKeyMutation.isPending}
              className="gap-1.5"
            >
              <Key className="h-3.5 w-3.5" />
              {apiKeyMutation.isPending
                ? 'Generating…'
                : apiKeyStatus?.exists
                  ? 'Regenerate API Key'
                  : 'Generate API Key'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => deployMutation.mutate()}
              disabled={deployMutation.isPending}
              className="gap-1.5"
            >
              <Terminal className="h-3.5 w-3.5" />
              {deployMutation.isPending ? 'Generating…' : 'Deploy Script'}
            </Button>
          </motion.div>
        )}

        {/* ── Resource Grid ── */}
        <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {stats ? <NodeMetricsCard stats={stats} /> : null}

          <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-foreground ">
                Capacity
              </h2>
              <Badge variant="outline" className="text-xs">
                {serverCount} servers
              </Badge>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <CapacityBlock
                icon={Cpu}
                label="CPU cores"
                value={
                  node.cpuOverallocatePercent && node.cpuOverallocatePercent !== 0
                    ? node.cpuOverallocatePercent === -1
                      ? `${node.maxCpuCores ?? 0} (effective: ∞)`
                      : `${node.maxCpuCores ?? 0} (effective: ${resourceSummary?.effectiveMaxCpuCores ?? ((node.maxCpuCores ?? 0) * (1 + node.cpuOverallocatePercent / 100)).toFixed(1)})`
                    : String(node.maxCpuCores ?? 0)
                }
                detail={
                  resourceSummary
                    ? (() => {
                        const effective = resourceSummary.effectiveMaxCpuCores ?? node.maxCpuCores ?? 0;
                        const pct = effective > 0 ? Math.round((resourceSummary.allocatedCpuCores / effective) * 100) : 0;
                        return `Allocated: ${resourceSummary.allocatedCpuCores} · Available: ${resourceSummary.availableCpuCores}${
                          node.cpuOverallocatePercent && node.cpuOverallocatePercent !== 0
                            ? ` · ${node.cpuOverallocatePercent === -1 ? 'Unlimited over-allocation' : `${node.cpuOverallocatePercent}% over-allocation`}`
                            : ''
                        } · ${pct}% used`;
                      })()
                    : node.cpuOverallocatePercent && node.cpuOverallocatePercent !== 0
                      ? node.cpuOverallocatePercent === -1
                        ? 'Unlimited over-allocation'
                        : `${node.cpuOverallocatePercent}% over-allocation`
                      : undefined
                }
              />
              <CapacityBlock
                icon={HardDrive}
                label="Memory"
                value={
                  node.memoryOverallocatePercent && node.memoryOverallocatePercent !== 0
                    ? node.memoryOverallocatePercent === -1
                      ? `${node.maxMemoryMb ?? 0} MB (effective: ∞)`
                      : `${node.maxMemoryMb ?? 0} MB (effective: ${resourceSummary?.effectiveMaxMemoryMb ?? ((node.maxMemoryMb ?? 0) * (1 + node.memoryOverallocatePercent / 100)).toFixed(0)} MB)`
                    : `${node.maxMemoryMb ?? 0} MB`
                }
                detail={
                  resourceSummary
                    ? (() => {
                        const effective = resourceSummary.effectiveMaxMemoryMb ?? node.maxMemoryMb ?? 0;
                        const pct = effective > 0 ? Math.round((resourceSummary.allocatedMemoryMb / effective) * 100) : 0;
                        return `Allocated: ${resourceSummary.allocatedMemoryMb} MB · Available: ${resourceSummary.availableMemoryMb} MB${
                          node.memoryOverallocatePercent && node.memoryOverallocatePercent !== 0
                            ? ` · ${node.memoryOverallocatePercent === -1 ? 'Unlimited over-allocation' : `${node.memoryOverallocatePercent}% over-allocation`}`
                            : ''
                        } · ${pct}% used`;
                      })()
                    : node.memoryOverallocatePercent && node.memoryOverallocatePercent !== 0
                      ? node.memoryOverallocatePercent === -1
                        ? 'Unlimited over-allocation'
                        : `${node.memoryOverallocatePercent}% over-allocation`
                      : undefined
                }
              />
              <CapacityBlock
                icon={HardDrive}
                label="Disk"
                value={
                  resourceSummary
                    ? `${resourceSummary.actualDiskUsageMb} / ${resourceSummary.actualDiskTotalMb} MB`
                    : 'n/a'
                }
              />
              <CapacityBlock
                icon={Activity}
                label="Uptime"
                value={stats?.lastMetricsUpdate ? 'Active' : 'Unknown'}
                detail="Metrics refresh every 30s"
              />
            </div>
          </div>
        </motion.div>

        {/* ── Servers on Node ── */}
        <motion.div variants={itemVariants}>
          <div className="rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-sm font-semibold text-foreground ">
                Servers on node
              </h2>
              <Link
                to="/servers"
                className="text-xs font-medium text-primary-600 transition-colors hover:text-primary dark:text-primary-400"
              >
                View all
              </Link>
            </div>

            {serverList.length > 0 ? (
              <div className="divide-y divide-border/50">
                {serverList.map((server) => (
                  <div
                    key={server.id}
                    className="group flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/servers/${server.id}`}
                        className="truncate text-sm font-medium text-foreground transition-colors hover:text-primary dark:hover:text-primary-400"
                      >
                        {server.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{server.status}</div>
                    </div>
                    <Link
                      to={`/servers/${server.id}`}
                      className="ml-3 flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground opacity-0 transition-all hover:border-primary/50 hover:text-primary group-hover:opacity-100 dark:hover:text-primary-400"
                    >
                      Open
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No servers assigned yet.
              </div>
            )}
          </div>
        </motion.div>

        {/* ── Discovered Servers ── */}
        {canWrite && unregisteredContainers.length > 0 && (
          <motion.div variants={itemVariants}>
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-5 backdrop-blur-sm">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Download className="h-4 w-4 text-warning" />
                  <h2 className="font-display text-sm font-semibold text-foreground">
                    Discovered Servers
                  </h2>
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
              <div className="mt-3 divide-y divide-warning/10">
                {unregisteredContainers.map((c: any) => (
                  <div key={c.containerId} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                    <div>
                      <div className="font-mono text-xs font-medium text-foreground">{c.containerId}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
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
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Node Assignments ── */}
        {canWrite || canAssignNodes ? (
          <motion.div variants={itemVariants} className="space-y-4">
            <NodeAssignmentsList nodeId={nodeId!} canManage={canAssignNodes} />
            {canAssignNodes && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAssignmentModal(true)}
                  className="gap-1.5 border-dashed"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Assign Node to User or Role
                </Button>
              </div>
            )}
          </motion.div>
        ) : null}
      </div>

      {/* ── Deploy Script Modal ── */}
      <ModalShell open={!!deployInfo} onClose={() => setDeployInfo(null)} title="Deploy agent">
        <div>Run this on the node to install and register the agent (valid for 24 hours).</div>
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 font-mono text-xs text-foreground dark:bg-surface-0/40 dark:text-foreground">
          <code className="whitespace-pre-wrap">
            {deployInfo
              ? `curl -s '${deployInfo.deployUrl}?apiKey=${encodeURIComponent(deployInfo.apiKey)}' | sudo bash -x`
              : ''}
          </code>
        </div>
        <div className="text-xs text-muted-foreground">
          Token expires: {deployInfo ? new Date(deployInfo.expiresAt).toLocaleString() : ''}
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4 text-xs">
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
          <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/50/5 px-4 py-3 text-xs text-warning dark:text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              The previous API key has been revoked. Update the agent's{' '}
              <code className="rounded bg-warning/10 px-1 dark:bg-warning/30">config.toml</code>{' '}
              with the new key below.
            </span>
          </div>
        )}
        <div>
          Add this API key to your agent's{' '}
          <code className="rounded bg-surface-2 px-1 dark:bg-surface-2">config.toml</code> file:
        </div>
        <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 font-mono text-xs text-foreground dark:bg-surface-0/40 dark:text-foreground">
          <code className="whitespace-pre-wrap break-all">
            api_key = &quot;{generatedApiKey}&quot;
          </code>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/50/5 px-4 py-3 text-xs text-warning dark:text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <strong>Important:</strong> Save this key now. It will not be shown again.
        </div>
        <div className="flex justify-end gap-2 border-t border-border pt-4 text-xs">
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
            if (!open) setShowUpdateModal(false);
          }}
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
    </motion.div>
  );
}

// ── Capacity Block ──
function CapacityBlock({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-surface-2/50 p-3 dark:bg-surface-2/30">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
      {detail && <div className="mt-0.5 text-[11px] text-muted-foreground">{detail}</div>}
    </div>
  );
}

export default NodeDetailsPage;
