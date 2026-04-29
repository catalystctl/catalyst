import { useState, useMemo } from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  Key,
  Search,
  Plus,
  Trash2,
  Pencil,
  Copy,
  Server,
  Filter,
  Activity,
  Clock,
  Zap,
  Shield,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useApiKeys, useDeleteApiKey, usePermissionsCatalog } from '../hooks/useApiKeys';
import { useNodes } from '../hooks/useNodes';
import { ApiKey, PermissionCategory, getPermissionLabel } from '../services/apiKeys';
import { CreateApiKeyDialog } from '../components/apikeys/CreateApiKeyDialog';
import { EditApiKeyDialog } from '../components/apikeys/EditApiKeyDialog';
import EmptyState from '../components/shared/EmptyState';
import { Input } from '../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ModalPortal } from '@/components/ui/modal-portal';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

// ── Helpers ──
const parseMetadata = (metadata: Record<string, any> | string | null): Record<string, any> | null => {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try { return JSON.parse(metadata); } catch { return null; }
  }
  return metadata;
};

const isAgentKey = (apiKey: ApiKey) => parseMetadata(apiKey.metadata)?.purpose === 'agent';
const getNodeId = (apiKey: ApiKey): string | null => parseMetadata(apiKey.metadata)?.nodeId || null;
const isExpired = (expiresAt: string | null) => expiresAt ? new Date(expiresAt) < new Date() : false;
const formatDate = (dateString: string | null) => {
  if (!dateString) return 'Never';
  return new Date(dateString).toLocaleString();
};

// ── Permissions Display ──
function PermissionsDisplay({
  apiKey,
  catalog,
  collapsed,
  onToggle,
}: {
  apiKey: ApiKey;
  catalog: PermissionCategory[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (apiKey.allPermissions) {
    return (
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-success" />
        <span className="text-xs font-medium text-success">
          All creator permissions
        </span>
      </div>
    );
  }

  const perms = apiKey.permissions || [];
  if (perms.length === 0) {
    return <span className="text-xs text-muted-foreground italic">No permissions</span>;
  }

  // Group permissions by category
  const grouped = new Map<string, { cat: PermissionCategory; perms: string[] }>();
  for (const perm of perms) {
    const cat = catalog.find((c) => c.permissions.some((p) => p.value === perm));
    const catId = cat?.id || 'other';
    if (!grouped.has(catId)) grouped.set(catId, { cat: cat || { id: 'other', label: 'Other', description: '', permissions: [] }, perms: [] });
    grouped.get(catId)!.perms.push(perm);
  }

  const maxShow = collapsed ? 3 : grouped.size;
  const entries = [...grouped.entries()].slice(0, maxShow);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {entries.map(([catId, { cat, perms: catPerms }]) => (
          <div key={catId} className="flex items-center gap-1">
            <Badge variant="outline" className="text-[10px] border-primary-300/40 text-primary-700 dark:border-primary/30 dark:text-primary-400">
              <Shield className="mr-1 h-2.5 w-2.5" />
              {cat.label}
              <span className="ml-1 text-[9px] opacity-60">{catPerms.length}</span>
            </Badge>
          </div>
        ))}
        {grouped.size > maxShow && (
          <button
            onClick={onToggle}
            className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
          >
            +{grouped.size - maxShow} more
          </button>
        )}
      </div>

      {/* Expanded permission list */}
      {!collapsed && (
        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 pl-1">
          {entries.map(([catId, { perms: catPerms }]) =>
            catPerms.map((perm) => (
              <div key={perm} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-1 w-1 rounded-full bg-primary/40" />
                <span>{getPermissionLabel(perm, catalog)}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Stat Card ──
function StatCard({ label, value, variant = 'default' }: { label: string; value: number; variant?: 'default' | 'active' | 'agent' | 'expired' }) {
  const colorMap = {
    default: 'border-border bg-card',
    active: 'border-success/20 bg-success-muted',
    agent: 'border-warning/20 bg-warning-muted',
    expired: 'border-danger/20 bg-danger-muted',
  };
  const iconColorMap = {
    default: 'text-muted-foreground',
    active: 'text-success',
    agent: 'text-warning',
    expired: 'text-danger',
  };
  return (
    <div className={`flex items-center gap-3 rounded-lg border px-3.5 py-2.5 ${colorMap[variant]}`}>
      <span className={`text-lg font-bold tabular-nums ${iconColorMap[variant]}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

// ── API Key Row ──
function ApiKeyRow({
  apiKey,
  onDelete,
  onEdit,
  index,
  catalog,
  getNodeName,
}: {
  apiKey: ApiKey;
  onDelete: () => void;
  onEdit: () => void;
  index: number;
  catalog: PermissionCategory[];
  getNodeName: (nodeId: string) => string | undefined;
}) {
  const agent = isAgentKey(apiKey);
  const expired = isExpired(apiKey.expiresAt);
  const nodeId = getNodeId(apiKey);
  const [permsExpanded, setPermsExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24, delay: index * 0.03 }}
      className={`group relative overflow-hidden rounded-xl border p-5 transition-all duration-200 hover:shadow-md ${
        agent
          ? 'border-warning/20 bg-warning-muted'
          : expired
          ? 'border-danger/15 bg-danger-muted'
          : 'border-border bg-card'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Icon + Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              agent ? 'bg-warning-muted' : expired ? 'bg-danger-muted' : 'bg-primary/10'
            }`}>
              {agent ? (
                <Server className="h-4 w-4 text-warning" />
              ) : expired ? (
                <Clock className="h-4 w-4 text-danger" />
              ) : (
                <Key className="h-4 w-4 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground truncate">
                  {apiKey.name || 'Unnamed Key'}
                </span>
                {agent && (
                  <Badge variant="outline" className="border-warning/30 text-warning text-[10px]">
                    <Server className="mr-1 h-2.5 w-2.5" /> Agent
                  </Badge>
                )}
                {apiKey.enabled && !expired ? (
                  <Badge variant="outline" className="border-success/30 text-success text-[10px]">
                    Active
                  </Badge>
                ) : !apiKey.enabled ? (
                  <Badge variant="secondary" className="text-[10px]">Disabled</Badge>
                ) : null}
                {expired && (
                  <Badge variant="destructive" className="text-[10px]">Expired</Badge>
                )}
              </div>
              {agent && nodeId && (() => {
                const nodeName = getNodeName(nodeId);
                return (
                  <div className="mt-1 text-xs text-warning">
                    Node:{' '}
                    {nodeName ? (
                      <span className="font-medium">{nodeName}</span>
                    ) : null}
                    {' '}
                    <code className="rounded bg-warning-muted px-1.5 py-0.5 font-mono text-[11px]">{nodeId.slice(0, 12)}{nodeId.length > 12 ? '...' : ''}</code>
                    {!nodeName && (
                      <span className="ml-1 text-[11px] opacity-60">(unknown)</span>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Key Preview */}
          {apiKey.prefix && apiKey.start && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 font-mono text-sm">
              <code className="flex-1 truncate text-foreground">
                {apiKey.start}{'*'.repeat(40)}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(apiKey.start || '')}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Permissions */}
          <div className="mt-3">
            <PermissionsDisplay
              apiKey={apiKey}
              catalog={catalog}
              collapsed={!permsExpanded}
              onToggle={() => setPermsExpanded(!permsExpanded)}
            />
          </div>

          {/* Metadata grid */}
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Activity className="h-3 w-3 shrink-0" />
              <span>Created: <span className="font-medium text-foreground">{formatDate(apiKey.createdAt)}</span></span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span>Last used: <span className="font-medium text-foreground">{formatDate(apiKey.lastRequest)}</span></span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Zap className="h-3 w-3 shrink-0" />
              <span>Requests: <span className="font-medium text-foreground">{apiKey.requestCount || 0}</span></span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span>Expires: <span className="font-medium text-foreground">{apiKey.expiresAt ? formatDate(apiKey.expiresAt) : 'Never'}</span></span>
            </div>
          </div>

          {/* Rate limit + Created by */}
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>Rate limit: {apiKey.rateLimitMax} req/{apiKey.rateLimitTimeWindow / 1000}s</span>
            {apiKey.user && (
              <span>
                by <span className="font-medium text-foreground">{apiKey.user.username || apiKey.user.email}</span>
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          <button
            onClick={onEdit}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Edit key"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger-muted hover:text-danger"
            title="Revoke key"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Main Page ──
export function ApiKeysPage() {
  const { data: apiKeys, isLoading } = useApiKeys();
  const { data: catalog = [] } = usePermissionsCatalog();
  const { data: nodes = [] } = useNodes();
  const deleteApiKey = useDeleteApiKey();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editKey, setEditKey] = useState<ApiKey | null>(null);
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);
  const [confirmAgentDelete, setConfirmAgentDelete] = useState(false);
  const [search, setSearch] = useState('');
  const [showAgentKeys, setShowAgentKeys] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'expired'>('all');

  const handleDelete = () => {
    if (deleteKey) {
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

  const getNodeName = (nodeId: string): string | undefined => {
    const node = nodes.find((n) => n.id === nodeId);
    return node?.name;
  };

  const filteredApiKeys = useMemo(() => {
    if (!apiKeys) return [];
    return apiKeys.filter((apiKey) => {
      if (!showAgentKeys && isAgentKey(apiKey)) return false;
      if (search.trim()) {
        const s = search.toLowerCase();
        const name = (apiKey.name || '').toLowerCase();
        const nodeId = getNodeId(apiKey)?.toLowerCase() || '';
        const keyStart = (apiKey.start || '').toLowerCase();
        if (!name.includes(s) && !nodeId.includes(s) && !keyStart.includes(s)) return false;
      }
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
      active: apiKeys.filter((k) => k.enabled).length,
      agent: apiKeys.filter(isAgentKey).length,
      expired: apiKeys.filter((k) => isExpired(k.expiresAt)).length,
    };
  }, [apiKeys]);

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-rose-500/8 to-orange-500/8 blur-3xl dark:from-rose-500/15 dark:to-orange-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-cyan-500/8 to-emerald-500/8 blur-3xl dark:from-cyan-500/15 dark:to-emerald-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-rose-500 to-orange-500 opacity-20 blur-sm" />
                <Key className="relative h-7 w-7 text-destructive dark:text-destructive" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-foreground">
                API Keys
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Manage API keys for automated access to Catalyst.
            </p>
          </div>
          <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Create API Key
          </Button>
        </motion.div>

        {/* ── Stats ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap gap-2">
          <StatCard label="Total" value={stats.total} />
          <StatCard label="Active" value={stats.active} variant="active" />
          <StatCard label="Agent keys" value={stats.agent} variant="agent" />
          {stats.expired > 0 && <StatCard label="Expired" value={stats.expired} variant="expired" />}
        </motion.div>

        {/* ── Filters ── */}
        <motion.div variants={itemVariants} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            <Filter className="h-3.5 w-3.5" />
            Filters
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* Search */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name, node ID, or key…"
                className="pl-9"
              />
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'disabled' | 'expired')}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="expired">Expired</option>
              </select>
            </div>

            {/* Agent keys toggle */}
            <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 cursor-pointer transition-colors hover:border-primary/50">
              <input
                type="checkbox"
                checked={showAgentKeys}
                onChange={(e) => setShowAgentKeys(e.target.checked)}
                className="rounded border-border text-primary focus:ring-ring"
              />
              <span className="text-sm text-foreground">
                Show agent keys ({stats.agent})
              </span>
            </label>
          </div>

          {/* Active filter chips */}
          {(search || !showAgentKeys || statusFilter !== 'all') && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="text-[11px] text-muted-foreground">Active filters:</span>
              {!showAgentKeys && (
                <Badge variant="outline" className="border-warning/30 text-warning text-[10px]">
                  Hiding {stats.agent} agent keys
                </Badge>
              )}
              {statusFilter !== 'all' && (
                <Badge variant="outline" className="text-[10px]">
                  Status: {statusFilter}
                </Badge>
              )}
              {search && (
                <Badge variant="outline" className="text-[10px]">
                  Search: {search}
                </Badge>
              )}
              <button
                onClick={() => { setSearch(''); setStatusFilter('all'); }}
                className="ml-auto text-[11px] text-muted-foreground transition-colors hover:text-primary-600"
              >
                Clear filters
              </button>
            </div>
          )}
        </motion.div>

        {/* ── Key List ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-start gap-3">
                  <div className="h-9 w-9 animate-pulse rounded-lg bg-surface-3" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-32 animate-pulse rounded bg-surface-3" />
                    <div className="h-8 w-full animate-pulse rounded bg-surface-2" />
                    <div className="grid grid-cols-2 gap-2">
                      <div className="h-3 w-24 animate-pulse rounded bg-surface-2" />
                      <div className="h-3 w-28 animate-pulse rounded bg-surface-2" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </motion.div>
        ) : filteredApiKeys.length > 0 ? (
          <div className="space-y-3">
            {filteredApiKeys.map((apiKey, i) => (
              <ApiKeyRow
                key={apiKey.id}
                apiKey={apiKey}
                index={i}
                catalog={catalog}
                onDelete={() => { setDeleteKey(apiKey); setConfirmAgentDelete(false); }}
                onEdit={() => setEditKey(apiKey)}
                getNodeName={getNodeName}
              />
            ))}
          </div>
        ) : (
          <motion.div variants={itemVariants}>
            <EmptyState
              title={search || statusFilter !== 'all' ? 'No API Keys Found' : 'No API Keys'}
              description={
                search || statusFilter !== 'all'
                  ? 'Try adjusting your filters to see more results.'
                  : 'Create your first API key to enable automated access.'
              }
              action={
                !search && statusFilter === 'all' ? (
                  <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1.5">
                    <Plus className="h-3.5 w-3.5" />
                    Create API Key
                  </Button>
                ) : undefined
              }
            />
          </motion.div>
        )}
      </div>

      {/* ── Create Dialog ── */}
      <CreateApiKeyDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

      {/* ── Edit Dialog ── */}
      {editKey && (
        <EditApiKeyDialog
          apiKey={editKey}
          open={!!editKey}
          onClose={() => setEditKey(null)}
        />
      )}

      {/* ── Delete Confirmation ── */}
      {deleteKey && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl ${
              isAgentKey(deleteKey) ? 'border-danger/50' : 'border-border'
            }`}
          >
            <h3 className="text-lg font-semibold text-foreground">
              {confirmAgentDelete ? '⚠️ Final Warning' : 'Revoke API Key'}
            </h3>

            {isAgentKey(deleteKey) && !confirmAgentDelete ? (
              <>
                <div className="mt-3 rounded-lg border border-danger/30 bg-danger-muted p-4">
                  <p className="text-sm font-semibold text-danger">
                    ⚠️ This is an Agent API Key
                  </p>
                  <p className="mt-1 text-sm text-danger/80">
                    Revoking this key will <strong>immediately disconnect the agent</strong> and
                    prevent it from communicating with Catalyst. The node will become unmanageable
                    until a new API key is generated and configured.
                  </p>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Are you sure you want to revoke &quot;{deleteKey.name}&quot;?
                </p>
              </>
            ) : confirmAgentDelete ? (
              <>
                <div className="mt-3 rounded-lg border border-danger/50 bg-danger-muted p-4">
                  <p className="text-sm font-bold text-danger">
                    This will render the node&apos;s agent USELESS!
                  </p>
                  <p className="mt-1 text-sm text-danger/80">
                    You will need physical or remote access to the node to reconfigure it with a new API key.
                  </p>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  Type the node ID to confirm: <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{getNodeId(deleteKey)?.slice(0, 8)}…</code>
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Are you sure you want to revoke &quot;{deleteKey.name}&quot;? This action cannot be undone
                and any applications using this key will immediately lose access.
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleCancelDelete}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete}>
                {confirmAgentDelete ? 'Yes, Revoke Agent Key' : isAgentKey(deleteKey) ? 'Continue' : 'Revoke'}
              </Button>
            </div>
          </motion.div>
        </div>
        </ModalPortal>
      )}
    </motion.div>
  );
}
