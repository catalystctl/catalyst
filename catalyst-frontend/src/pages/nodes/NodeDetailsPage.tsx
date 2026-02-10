import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNode, useNodeStats } from '../../hooks/useNodes';
import NodeStatusBadge from '../../components/nodes/NodeStatusBadge';
import NodeUpdateModal from '../../components/nodes/NodeUpdateModal';
import NodeDeleteDialog from '../../components/nodes/NodeDeleteDialog';
import NodeMetricsCard from '../../components/nodes/NodeMetricsCard';
import NodeAssignmentsList from '../../components/nodes/NodeAssignmentsList';
import NodeAssignmentModal from '../../components/nodes/NodeAssignmentModal';
import { nodesApi } from '../../services/api/nodes';
import { useAuthStore } from '../../stores/authStore';
import { notifyError, notifySuccess } from '../../utils/notify';

function NodeDetailsPage() {
  const { nodeId } = useParams();
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const { data: node, isLoading, isError } = useNode(nodeId);
  const { data: stats } = useNodeStats(nodeId);
  const [deployInfo, setDeployInfo] = useState<{
    deployUrl: string;
    deploymentToken: string;
    secret: string;
    apiKey: string | null;
    expiresAt: string;
  } | null>(null);
  const [generatedApiKey, setGeneratedApiKey] = useState<string | null>(null);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);

  // Check if API key exists for this node
  const { data: apiKeyStatus } = useQuery({
    queryKey: ['node-api-key', nodeId],
    queryFn: () => nodesApi.checkApiKey(nodeId!),
    enabled: !!nodeId,
  });

  const deployMutation = useMutation({
    mutationFn: async () => {
      if (!node?.id) {
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
    mutationFn: async (regenerate?: boolean) => {
      if (!node?.id) {
        throw new Error('Missing node id');
      }
      return nodesApi.generateApiKey(node.id, regenerate);
    },
    onSuccess: (info) => {
      setGeneratedApiKey(info?.apiKey ?? null);
      setShowRegenerateConfirm(false);
      // Invalidate and refetch the API key status query
      queryClient.invalidateQueries({ queryKey: ['node-api-key', nodeId] });
      notifySuccess(info?.regenerated ? 'API key regenerated' : 'API key generated');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to generate API key';
      notifyError(message);
    },
  });

  const handleApiKeyClick = () => {
    if (apiKeyStatus?.exists) {
      // Key exists - show info modal
      setShowApiKeyModal(true);
    } else {
      // No key - generate one
      apiKeyMutation.mutate(false);
    }
  };

  const handleRegenerateConfirm = () => {
    apiKeyMutation.mutate(true);
  };

  const canWrite = useMemo(
    () => user?.permissions?.includes('admin.write') || user?.permissions?.includes('*'),
    [user?.permissions],
  );
  const canAssignNodes = useMemo(
    () => user?.permissions?.includes('node.assign') || user?.permissions?.includes('*') || user?.permissions?.includes('admin.write'),
    [user?.permissions],
  );
  const lastSeen = node?.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString() : 'n/a';
  const serverList = useMemo(() => node?.servers ?? [], [node]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-slate-600 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-primary-500/30">
        Loading node...
      </div>
    );
  }

  if (isError || !node) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-100/60 px-4 py-6 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        Unable to load node details.
      </div>
    );
  }

  const resourceSummary = stats?.resources ?? null;
  const serverCount = stats?.servers.total ?? node._count?.servers ?? serverList.length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
                {node.name}
              </h1>
              <NodeStatusBadge isOnline={node.isOnline} />
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-400">
              {node.hostname ?? 'hostname n/a'} · {node.publicAddress ?? 'address n/a'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">Last seen: {lastSeen}</div>
          </div>
          {canWrite ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Link
                to={`/admin/nodes/${node.id}/allocations`}
                className="col-span-2 rounded-lg border-2 border-primary-500 bg-primary-600 px-4 py-2 text-center font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
              >
                Manage Allocations
              </Link>
              <button
                className={`rounded-md border px-3 py-1 font-semibold transition-all duration-300 disabled:opacity-60 ${
                  apiKeyStatus?.exists
                    ? 'border-amber-300 text-amber-700 hover:border-amber-500 dark:border-amber-500/30 dark:text-amber-400 dark:hover:border-amber-500/50'
                    : 'border-slate-200 text-slate-600 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30'
                }`}
                onClick={handleApiKeyClick}
                disabled={apiKeyMutation.isPending}
              >
                {apiKeyMutation.isPending ? 'Processing...' : apiKeyStatus?.exists ? 'View API Key' : 'Generate API Key'}
              </button>
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 disabled:opacity-60 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => deployMutation.mutate()}
                disabled={deployMutation.isPending}
              >
                {deployMutation.isPending ? 'Generating...' : 'Regenerate deploy script'}
              </button>
              <div className="contents">
                <NodeUpdateModal node={node} />
              </div>
              <div className="contents">
                <NodeDeleteDialog nodeId={node.id} nodeName={node.name} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {stats ? <NodeMetricsCard stats={stats} /> : null}
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30 lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Capacity</div>
            <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
              {serverCount} servers
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs text-slate-600 dark:text-slate-300">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
              <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">CPU cores</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {node.maxCpuCores ?? 0}
              </div>
              {resourceSummary ? (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 dark:text-slate-500">
                  Allocated: {resourceSummary.allocatedCpuCores} · Available: {resourceSummary.availableCpuCores}
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
              <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Memory</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {node.maxMemoryMb ?? 0} MB
              </div>
              {resourceSummary ? (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 dark:text-slate-500">
                  Allocated: {resourceSummary.allocatedMemoryMb} · Available: {resourceSummary.availableMemoryMb}
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
              <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Disk</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {resourceSummary ? `${resourceSummary.actualDiskUsageMb} / ${resourceSummary.actualDiskTotalMb} MB` : 'n/a'}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
              <div className="text-slate-500 dark:text-slate-400 dark:text-slate-500">Uptime</div>
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {stats?.lastMetricsUpdate ? 'Active' : 'Unknown'}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 dark:text-slate-500">
                Metrics refresh every 30s
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Servers on node</h2>
          <Link
            to="/servers"
            className="text-xs font-medium text-primary-600 transition-all duration-300 hover:text-primary-500 dark:text-primary-400"
          >
            View all servers
          </Link>
          </div>
        {serverList.length ? (
          <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            {serverList.map((server) => (
              <li
                key={server.id}
                className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30"
              >
                <div>
                  <div className="text-slate-900 dark:text-slate-100">{server.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                    {server.status}
                  </div>
                </div>
                <Link
                  to={`/servers/${server.id}`}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                >
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-sm text-slate-600 dark:text-slate-400">
            No servers assigned yet.
          </div>
        )}
      </div>

      {/* Node Assignments Section */}
      {canWrite || canAssignNodes ? (
        <>
          <NodeAssignmentsList nodeId={nodeId!} canManage={canAssignNodes} />
          {canAssignNodes && (
            <div className="flex justify-center">
              <button
                className="rounded-lg border-2 border-dashed border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-surface-light transition-all duration-300 hover:border-primary-500 hover:text-primary-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:shadow-surface-dark dark:hover:border-primary-500/30 dark:hover:text-primary-400"
                onClick={() => setShowAssignmentModal(true)}
              >
                + Assign Node to User or Role
              </button>
            </div>
          )}
        </>
      ) : null}

      {deployInfo ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Deploy agent</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setDeployInfo(null)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
              <div className="text-slate-600 dark:text-slate-300">
                Run this on the node to install and register the agent (valid for 24 hours).
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-100">
                <code className="whitespace-pre-wrap">
                  {`curl -s '${deployInfo.deployUrl}?apiKey=${encodeURIComponent(deployInfo.apiKey ?? '')}' | sudo bash -x`}
                </code>
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
                Token expires: {new Date(deployInfo.expiresAt).toLocaleString()}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setDeployInfo(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {generatedApiKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Agent API Key</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setGeneratedApiKey(null)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
              <div className="text-slate-600 dark:text-slate-300">
                Add this API key to your agent's <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">config.toml</code> file:
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-100">
                <code className="whitespace-pre-wrap break-all">api_key = "{generatedApiKey}"</code>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <strong>Important:</strong> Save this key now. It will not be shown again.
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => {
                  navigator.clipboard.writeText(generatedApiKey);
                  notifySuccess('API key copied to clipboard');
                }}
              >
                Copy to clipboard
              </button>
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setGeneratedApiKey(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* API Key Info Modal (when key exists) */}
      {showApiKeyModal && apiKeyStatus?.apiKey ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Existing Agent API Key</h2>
              <button
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setShowApiKeyModal(false)}
              >
                Close
              </button>
            </div>
            <div className="space-y-3 px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
              <div className="text-slate-600 dark:text-slate-300">
                An API key already exists for this node's agent.
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Name:</span>
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {apiKeyStatus.apiKey.name}
                  </div>
                </div>
                <div>
                  <span className="text-slate-500 dark:text-slate-400">Created:</span>
                  <div className="font-medium text-slate-900 dark:text-slate-100">
                    {new Date(apiKeyStatus.apiKey.createdAt).toLocaleString()}
                  </div>
                </div>
              </div>
              {apiKeyStatus.apiKey.preview && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-900 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-100">
                  <code className="whitespace-pre-wrap break-all">{apiKeyStatus.apiKey.preview}</code>
                </div>
              )}
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                <strong>Note:</strong> The full API key cannot be displayed as it was only shown once when created.
                If you need to update the agent's key, you must regenerate it.
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <button
                className="rounded-md border border-red-300 px-3 py-1 font-semibold text-red-600 transition-all duration-300 hover:border-red-500 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:border-red-500/50 dark:hover:bg-red-500/10"
                onClick={() => {
                  setShowApiKeyModal(false);
                  setShowRegenerateConfirm(true);
                }}
              >
                Regenerate Key
              </button>
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setShowApiKeyModal(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* Regenerate Confirmation Modal */}
      {showRegenerateConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-slate-950/60 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border-2 border-red-500 bg-white shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-red-200 bg-red-50 px-6 py-4 dark:border-red-500/30 dark:bg-red-500/10">
              <h2 className="text-lg font-semibold text-red-900 dark:text-red-300">⚠️ Regenerate API Key</h2>
            </div>
            <div className="space-y-3 px-6 py-4 text-sm text-slate-600 dark:text-slate-300">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-900/20">
                <p className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">
                  This action will:
                </p>
                <ul className="text-sm text-red-700 dark:text-red-400 list-disc list-inside space-y-1">
                  <li><strong>Delete</strong> the current API key immediately</li>
                  <li><strong>Disconnect</strong> the agent from Catalyst</li>
                  <li>Require <strong>manual reconfiguration</strong> of the agent with the new key</li>
                </ul>
              </div>
              <p className="text-slate-600 dark:text-slate-400">
                The agent will be <strong>unable to communicate</strong> with Catalyst until you update its
                <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-slate-800">config.toml</code>
                with the new API key.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4 text-xs dark:border-slate-800">
              <button
                className="rounded-md border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => setShowRegenerateConfirm(false)}
                disabled={apiKeyMutation.isPending}
              >
                Cancel
              </button>
              <button
                className="rounded-md border border-red-500 bg-red-600 px-3 py-1 font-semibold text-white transition-all duration-300 hover:bg-red-700 disabled:opacity-60"
                onClick={handleRegenerateConfirm}
                disabled={apiKeyMutation.isPending}
              >
                {apiKeyMutation.isPending ? 'Regenerating...' : 'Yes, Regenerate Key'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Node Assignment Modal */}
      <NodeAssignmentModal
        nodeId={nodeId!}
        open={showAssignmentModal}
        onClose={() => setShowAssignmentModal(false)}
      />
    </div>
  );
}

export default NodeDetailsPage;
