import { useState, useMemo } from 'react';
import { Plus, Key, Trash2, Copy, Server, Filter } from 'lucide-react';
import { useApiKeys, useDeleteApiKey } from '../hooks/useApiKeys';
import { ApiKey } from '../services/apiKeys';
import { CreateApiKeyDialog } from '../components/apikeys/CreateApiKeyDialog';
import EmptyState from '../components/shared/EmptyState';
import { Input } from '../components/ui/input';

// Helper to parse metadata which may be double-stringified
const parseMetadata = (metadata: Record<string, any> | string | null): Record<string, any> | null => {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch {
      return null;
    }
  }
  return metadata;
};

// Helper to check if an API key is for an agent
const isAgentKey = (apiKey: ApiKey) => {
  const meta = parseMetadata(apiKey.metadata);
  return meta?.purpose === 'agent';
};

// Helper to get nodeId from metadata
const getNodeId = (apiKey: ApiKey): string | null => {
  const meta = parseMetadata(apiKey.metadata);
  return meta?.nodeId || null;
};

export function ApiKeysPage() {
  const { data: apiKeys, isLoading } = useApiKeys();
  const deleteApiKey = useDeleteApiKey();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);
  const [confirmAgentDelete, setConfirmAgentDelete] = useState(false);
  const [search, setSearch] = useState('');
  const [showAgentKeys, setShowAgentKeys] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'expired'>('all');

  const handleDelete = () => {
    if (deleteKey) {
      // For agent keys, require extra confirmation
      if (isAgentKey(deleteKey) && !confirmAgentDelete) {
        setConfirmAgentDelete(true);
        return;
      }
      deleteApiKey.mutate(deleteKey.id);
      setDeleteKey(null);
      setConfirmAgentDelete(false);
    }
  };

  const handleCancelDelete = () => {
    setDeleteKey(null);
    setConfirmAgentDelete(false);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString();
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const filteredApiKeys = useMemo(() => {
    if (!apiKeys) return [];
    
    return apiKeys.filter((apiKey) => {
      // Filter by agent keys
      if (!showAgentKeys && isAgentKey(apiKey)) return false;
      
      // Filter by search
      if (search.trim()) {
        const searchLower = search.toLowerCase();
        const name = (apiKey.name || '').toLowerCase();
        const nodeId = getNodeId(apiKey)?.toLowerCase() || '';
        const keyStart = (apiKey.start || '').toLowerCase();
        
        if (!name.includes(searchLower) && !nodeId.includes(searchLower) && !keyStart.includes(searchLower)) {
          return false;
        }
      }
      
      // Filter by status
      if (statusFilter === 'active' && !apiKey.enabled) return false;
      if (statusFilter === 'disabled' && apiKey.enabled) return false;
      if (statusFilter === 'expired' && !isExpired(apiKey.expiresAt)) return false;
      
      return true;
    });
  }, [apiKeys, showAgentKeys, search, statusFilter]);

  const stats = useMemo(() => {
    if (!apiKeys) return { total: 0, active: 0, agent: 0, expired: 0 };
    
    return {
      total: apiKeys.length,
      active: apiKeys.filter(k => k.enabled).length,
      agent: apiKeys.filter(isAgentKey).length,
      expired: apiKeys.filter(k => isExpired(k.expiresAt)).length,
    };
  }, [apiKeys]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-surface-light dark:border-slate-800 dark:bg-slate-900/70 dark:shadow-surface-dark">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">API Keys</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Manage API keys for automated access to Catalyst
            </p>
          </div>
          <button
            onClick={() => setCreateDialogOpen(true)}
            className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all hover:bg-primary-500"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create API Key
          </button>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap gap-2 text-xs text-slate-600 dark:text-slate-400 mb-6">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {stats.total} total
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {stats.active} active
          </span>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 dark:border-slate-800 dark:bg-slate-950/60">
            {stats.agent} agent keys
          </span>
          {stats.expired > 0 && (
            <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 dark:border-red-500/30 dark:bg-red-900/20 text-red-600 dark:text-red-400">
              {stats.expired} expired
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/60 p-4 mb-6 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300">
            <Filter className="w-4 h-4" />
            Filters
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Search */}
            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Search
              </label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, node ID, or key..."
                className="w-full"
              />
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Status
              </label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="expired">Expired</option>
              </select>
            </div>

            {/* Show Agent Keys Toggle */}
            <div>
              <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                Agent Keys
              </label>
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer hover:border-primary-500 dark:hover:border-primary-500/30 transition-all">
                <input
                  type="checkbox"
                  checked={showAgentKeys}
                  onChange={(e) => setShowAgentKeys(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                />
                <span className="text-sm text-slate-900 dark:text-slate-200">
                  Show agent keys ({stats.agent})
                </span>
              </label>
            </div>
          </div>

          {/* Active Filters Display */}
          {(search || !showAgentKeys || statusFilter !== 'all') && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">Active filters:</span>
              {!showAgentKeys && (
                <span className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400">
                  Hiding {stats.agent} agent keys
                </span>
              )}
              {statusFilter !== 'all' && (
                <span className="text-xs px-2 py-1 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">
                  Status: {statusFilter}
                </span>
              )}
              {search && (
                <span className="text-xs px-2 py-1 rounded bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400">
                  Search: {search}
                </span>
              )}
              <button
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                }}
                className="ml-auto text-xs text-slate-600 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400"
              >
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* API Keys List */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : filteredApiKeys && filteredApiKeys.length > 0 ? (
          <div className="space-y-4">
            {filteredApiKeys.map((apiKey) => (
              <div
                key={apiKey.id}
                className={`rounded-xl border p-5 ${
                  isAgentKey(apiKey)
                    ? 'border-amber-300 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-900/10'
                    : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/50'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-3">
                    {/* Name and Status */}
                    <div className="flex items-center gap-3">
                      {isAgentKey(apiKey) ? (
                        <Server className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <Key className="w-5 h-5 text-slate-500 dark:text-slate-400" />
                      )}
                      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {apiKey.name || 'Unnamed Key'}
                      </h3>
                      {isAgentKey(apiKey) && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-amber-700 bg-amber-100 rounded-full dark:bg-amber-900/30 dark:text-amber-400">
                          Agent
                        </span>
                      )}
                      {apiKey.enabled ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-green-700 bg-green-100 rounded-full dark:bg-green-900/30 dark:text-green-400">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-slate-700 bg-slate-200 rounded-full dark:bg-slate-800 dark:text-slate-400">
                          Disabled
                        </span>
                      )}
                      {isExpired(apiKey.expiresAt) && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold text-red-700 bg-red-100 rounded-full dark:bg-red-900/30 dark:text-red-400">
                          Expired
                        </span>
                      )}
                    </div>

                    {/* Node ID for agent keys */}
                    {isAgentKey(apiKey) && getNodeId(apiKey) && (
                      <div className="text-sm text-amber-700 dark:text-amber-400">
                        Node: <code className="bg-amber-100 dark:bg-amber-900/30 px-1.5 py-0.5 rounded">{getNodeId(apiKey)}</code>
                      </div>
                    )}

                    {/* Created By */}
                    {apiKey.user && (
                      <div className="text-sm text-slate-600 dark:text-slate-400">
                        Created by: <span className="font-medium text-slate-900 dark:text-slate-100">{apiKey.user.username || apiKey.user.email}</span>
                      </div>
                    )}

                    {/* Key Preview */}
                    {apiKey.prefix && apiKey.start && (
                      <div className="flex items-center gap-2 font-mono text-sm bg-white dark:bg-slate-900 px-3 py-2 rounded border border-slate-200 dark:border-slate-800">
                        <code className="text-slate-700 dark:text-slate-300">
                          {apiKey.start}{'*'.repeat(40)}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(apiKey.start || '')}
                          className="ml-auto p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Created:</span>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {formatDate(apiKey.createdAt)}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Last Used:</span>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {formatDate(apiKey.lastRequest)}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Requests:</span>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {apiKey.requestCount || 0}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 dark:text-slate-400">Expires:</span>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {apiKey.expiresAt ? formatDate(apiKey.expiresAt) : 'Never'}
                        </div>
                      </div>
                    </div>

                    {/* Rate Limit Info */}
                    <div className="text-sm text-slate-500 dark:text-slate-400">
                      Rate Limit: {apiKey.rateLimitMax} requests per{' '}
                      {apiKey.rateLimitTimeWindow / 1000}s
                    </div>
                  </div>

                  {/* Actions */}
                  <button
                    onClick={() => setDeleteKey(apiKey)}
                    className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title={search || statusFilter !== 'all' ? 'No API Keys Found' : 'No API Keys'}
            description={
              search || statusFilter !== 'all'
                ? 'Try adjusting your filters to see more results'
                : 'Create your first API key to enable automated access'
            }
            action={
              !search && statusFilter === 'all' ? (
                <button
                  onClick={() => setCreateDialogOpen(true)}
                  className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all hover:bg-primary-500"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Create API Key
                </button>
              ) : undefined
            }
          />
        )}
      </div>

      {/* Create Dialog */}
      <CreateApiKeyDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      {/* Delete Confirmation Dialog */}
      {deleteKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={`bg-white dark:bg-slate-900 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl ${
            isAgentKey(deleteKey) ? 'border-2 border-red-500' : ''
          }`}>
            <h3 className="text-lg font-semibold mb-2 text-slate-900 dark:text-slate-100">
              {confirmAgentDelete ? '⚠️ Final Warning' : 'Revoke API Key'}
            </h3>
            
            {isAgentKey(deleteKey) && !confirmAgentDelete ? (
              <>
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 mb-4 dark:border-red-500/30 dark:bg-red-900/20">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300 mb-2">
                    ⚠️ This is an Agent API Key
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-400">
                    Revoking this key will <strong>immediately disconnect the agent</strong> and 
                    prevent it from communicating with Catalyst. The node will become unmanageable 
                    until a new API key is generated and configured.
                  </p>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                  Are you sure you want to revoke "{deleteKey.name}"?
                </p>
              </>
            ) : confirmAgentDelete ? (
              <>
                <div className="rounded-lg border border-red-300 bg-red-100 p-4 mb-4 dark:border-red-500/50 dark:bg-red-900/40">
                  <p className="text-sm font-bold text-red-900 dark:text-red-200">
                    This will render the node's agent USELESS!
                  </p>
                  <p className="text-sm text-red-800 dark:text-red-300 mt-2">
                    You will need physical or remote access to the node to reconfigure it with a new API key.
                  </p>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                  Type the node ID to confirm: <code className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-xs">{getNodeId(deleteKey)?.slice(0, 8)}...</code>
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
                Are you sure you want to revoke "{deleteKey.name}"? This action cannot be undone
                and any applications using this key will immediately lose access.
              </p>
            )}
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelDelete}
                className="px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded transition-colors"
              >
                {confirmAgentDelete ? 'Yes, Revoke Agent Key' : isAgentKey(deleteKey) ? 'Continue' : 'Revoke'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
