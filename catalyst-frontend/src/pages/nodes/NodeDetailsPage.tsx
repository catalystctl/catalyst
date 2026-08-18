import { useMemo, useState, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@/csync';
import { qk } from '../../lib/queryKeys';
import {
  Server,
  ArrowLeft,
  Key,
  Terminal,
  Settings,
  Trash2,
  ExternalLink,
  Copy,
  AlertTriangle,
  Shield,
  Download,
} from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { useNode, useNodeStats } from '../../hooks/useNodes';
import NodeUpdateModal from '../../components/nodes/NodeUpdateModal';
import NodeDeleteDialog from '../../components/nodes/NodeDeleteDialog';
import NodeAssignmentsList from '../../components/nodes/NodeAssignmentsList';
import NodeAssignmentModal from '../../components/nodes/NodeAssignmentModal';
import { nodesApi } from '../../services/api/nodes';
import { useAuthStore } from '../../stores/authStore';
import { notifyError, notifySuccess } from '../../utils/notify';
import ServerImportModal from '../../components/nodes/ServerImportModal';
import { reportSystemError } from '../../services/api/systemErrors';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

import AgentControlPanel from '../../components/nodes/AgentControlPanel';
import TabErrorState from '../../components/servers/tabs/TabErrorState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import WorkspaceHeader from '../../components/layout/WorkspaceHeader';

function ModalShell({
  open,
  onClose,
  title,
  description,
  children,
  variant,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: React.ReactNode;
  variant?: 'default' | 'danger';
}) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogContent size="lg">
        <DialogHeader
          icon={variant === 'danger' ? <AlertTriangle className="h-4 w-4" /> : <Key className="h-4 w-4" />}
          iconClassName={variant === 'danger'
            ? 'border-destructive/20 bg-destructive/10 text-destructive'
            : 'border-primary/20 bg-primary/10 text-primary'}
        >
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">{children}</DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    queryKey: qk.nodeApiKey(nodeId!),
    queryFn: () => nodesApi.checkApiKey(nodeId!),
    enabled: !!nodeId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.nodeApiKey(nodeId!) });
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
      notifySuccess(info?.regenerated ? 'API key regenerated' : 'API key generated');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.nodeApiKey(nodeId!) });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to generate API key';
      notifyError(message);
    },
  });

  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );

  const { data: unregisteredContainers = [] } = useQuery({
    queryKey: qk.unregisteredContainers(nodeId!),
    queryFn: () => nodesApi.getUnregisteredContainers(nodeId!),
    enabled: !!nodeId,
    staleTime: 60_000,
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

  const serverCount = stats?.servers.total ?? node._count?.servers ?? serverList.length;

  return (
    <div className="space-y-5">
      {/* ── Breadcrumb ── */}
      <Link
        to="/admin/nodes"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to Nodes
      </Link>

      <WorkspaceHeader
        icon={Server}
        variant={node.isOnline ? 'success' : 'default'}
        title={node.name}
        titleAddon={
          <>
            <Badge
              variant={node.isOnline ? 'success' : 'secondary'}
              className="shrink-0 gap-1 text-[10px]"
            >
              {node.isOnline ? 'Online' : 'Offline'}
            </Badge>
            {node.agentVersion && stats?.agentUpdateAvailable && (
              <Badge variant="warning" className="shrink-0 gap-1 font-mono text-[10px]">
                <AlertTriangle className="h-2.5 w-2.5" />
                v{node.agentVersion} → v{stats.latestAgentVersion}
              </Badge>
            )}
          </>
        }
        description={[
          node.hostname,
          node.publicAddress,
          node.location?.name,
          node.lastSeenAt ? `Seen ${new Date(node.lastSeenAt).toLocaleString()}` : 'Never seen',
          node.agentVersion && !stats?.agentUpdateAvailable ? `Agent v${node.agentVersion}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          canWrite ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant={apiKeyStatus?.exists ? 'outline' : 'default'}
                size="sm"
                onClick={() => apiKeyMutation.mutate()}
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
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => deployMutation.mutate()}
                disabled={deployMutation.isPending}
                className="gap-1.5"
              >
                <Terminal className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">
                  {deployMutation.isPending ? 'Generating…' : 'Deploy'}
                </span>
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
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowDeleteModal(true)}
                className="gap-1.5 text-destructive hover:border-destructive/30 hover:bg-destructive/5 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : null
        }
      />

      {/* ══════════════════════════════════════════════════════════════════
          AGENT CONTROL PANEL
          The main content area — status, logs, update, config, actions.
          Also contains live resource bars and capacity info
          (previously duplicated in the hero + separate cards).
      ══════════════════════════════════════════════════════════════════ */}
      <AgentControlPanel node={node} stats={stats ?? null} />

      {/* ══════════════════════════════════════════════════════════════════
          SERVERS ON NODE
          Compact server list with count badge.
      ══════════════════════════════════════════════════════════════════ */}
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card px-3 py-2.5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-primary" />
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
              Servers
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] tabular-nums">
              {serverCount}
            </Badge>
            <Link
              to="/servers"
              className="text-[10px] font-medium text-primary hover:text-primary/80"
            >
              View all
            </Link>
          </div>
        </div>

        {serverList.length > 0 ? (
          <div className="divide-y divide-border/20">
            {serverList.map((server) => (
              <div
                key={server.id}
                className="group flex items-center justify-between py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/servers/${server.id}`}
                    className="truncate text-sm font-medium text-foreground transition-colors hover:text-primary"
                  >
                    {server.name}
                  </Link>
                  <div className="text-[11px] text-muted-foreground/50">{server.status}</div>
                </div>
                <Link
                  to={`/servers/${server.id}`}
                  className="ml-3 flex shrink-0 items-center gap-1 rounded-md border border-border/30 px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-all hover:border-primary/50 hover:text-primary group-hover:opacity-100"
                >
                  Open
                  <ExternalLink className="h-2.5 w-2.5" />
                </Link>
              </div>
            ))}
          </div>
        ) : (
          <TabEmptyState title="No servers assigned yet." />
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          DISCOVERED SERVERS
      ══════════════════════════════════════════════════════════════════ */}
      {canWrite && unregisteredContainers.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-warning/30 bg-card px-3 py-2.5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download className="h-3.5 w-3.5 text-warning" />
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
                Discovered Servers
              </h3>
            </div>
            <Button size="sm" onClick={() => setShowImportModal(true)} className="gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Import
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground/50">
            {unregisteredContainers.length} container(s) not registered in the panel.
          </div>
          <div className="mt-2 divide-y divide-border/20">
            {unregisteredContainers.map((c: any) => (
              <div key={c.containerId} className="flex items-center justify-between py-1.5 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="font-mono text-[11px] font-medium text-foreground">{c.containerId}</div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/50">
                    <span>{c.image || 'Unknown image'}</span>
                    <Badge
                      variant={c.status?.includes('Up') ? 'success' : 'secondary'}
                      className="text-[9px]"
                    >
                      {c.status?.includes('Up') ? 'Running' : 'Stopped'}
                    </Badge>
                    {c.networkMode && (
                      <Badge
                        variant={c.networkMode === 'host' ? 'warning' : 'outline'}
                        className="text-[9px]"
                      >
                        {c.networkMode === 'host' ? 'Host' : 'Bridge'}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          NODE ASSIGNMENTS
      ══════════════════════════════════════════════════════════════════ */}
      {canWrite || canAssignNodes ? (
        <div className="space-y-3">
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

      {/* ══════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════ */}

      {/* Deploy Script Modal */}
      <ModalShell
        open={!!deployInfo}
        onClose={() => setDeployInfo(null)}
        title="Deploy agent"
        description="Run this on the node to install and register the agent (valid for 24 hours)."
      >
        <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-border/40 bg-surface-2 px-4 py-3 font-mono text-xs text-foreground">
          <code className="block max-w-full break-all whitespace-pre-wrap">
            {deployInfo
              ? `curl -s '${deployInfo.deployUrl}?apiKey=${encodeURIComponent(deployInfo.apiKey)}' | sudo bash -x`
              : ''}
          </code>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="min-w-0">
            Token expires: {deployInfo ? new Date(deployInfo.expiresAt).toLocaleString() : ''}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => {
              if (!deployInfo) return;
              navigator.clipboard.writeText(
                `curl -s '${deployInfo.deployUrl}?apiKey=${encodeURIComponent(deployInfo.apiKey)}' | sudo bash -x`,
              );
              notifySuccess('Copied to clipboard');
            }}
          >
            <Copy className="h-3 w-3" />
            Copy
          </Button>
        </div>
      </ModalShell>

      {/* API Key Modal */}
      <ModalShell
        open={!!generatedApiKey}
        onClose={() => setGeneratedApiKey(null)}
        title="Agent API key"
        description="Add this key to the agent's config.toml. It will not be shown again."
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
        <div className="min-w-0 max-w-full overflow-x-auto rounded-lg border border-border/40 bg-surface-2 px-4 py-3 font-mono text-xs text-foreground">
          <code className="block max-w-full break-all whitespace-pre-wrap">
            api_key = &quot;{generatedApiKey}&quot;
          </code>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <strong>Important:</strong> Save this key now. It will not be shown again.
        </div>
        <div className="flex justify-end">
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
        </div>
      </ModalShell>

      {/* Controlled Update & Delete Modals */}
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

      {/* Assignment Modal */}
      <NodeAssignmentModal
        nodeId={nodeId!}
        open={showAssignmentModal}
        onClose={() => setShowAssignmentModal(false)}
      />

      {/* Server Import Modal */}
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
