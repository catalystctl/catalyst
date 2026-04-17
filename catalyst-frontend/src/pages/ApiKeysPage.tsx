import { useState, useMemo } from 'react';
import { motion, type Variants } from 'framer-motion';
import {
  Key,
  Search,
  Plus,
  Trash2,
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
import { ApiKey, PermissionCategory, getPermissionLabel } from '../services/apiKeys';
import { CreateApiKeyDialog } from '../components/apikeys/CreateApiKeyDialog';
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
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
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
            <Badge variant="outline" className="text-[10px] border-primary-300/40 text-primary-700 dark:border-primary-500/30 dark:text-primary-400">
              <Shield className="mr-1 h-2.5 w-2.5" />
              {cat.label}
              <span className="ml-1 text-[9px] opacity-60">{catPerms.length}</span>
            </Badge>
          </div>
        ))}
        {grouped.size > maxShow && (
          <button
            onClick={onToggle}
            className="text-[10px] text-primary-600 hover:underline dark:text-primary-400 flex items-center gap-0.5"
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
                <span className="h-1 w-1 rounded-full bg-primary-400/60" />
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
    active: 'border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-900/10',
    agent: 'border-amber-500/20 bg-amber-50/50 dark:bg-amber-900/10',
    expired: 'border-rose-500/20 bg-rose-50/50 dark:bg-rose-900/10',
  };
  const iconColorMap = {
    default: 'text-muted-foreground',
    active: 'text-emerald-600 dark:text-emerald-400',
    agent: 'text-amber-600 dark:text-amber-400',
    expired: 'text-rose-600 dark:text-rose-400',
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
  index,
  catalog,
}: {
  apiKey: ApiKey;
  onDelete: () => void;
  index: number;
  catalog: PermissionCategory[];
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
      className={`group relative overflow-hidden rounded-xl border p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg ${
        agent
          ? 'border-amber-500/20 bg-amber-50/30 dark:bg-amber-900/5'
          : expired
          ? 'border-rose-500/15 bg-rose-50/20 dark:bg-rose-900/5'
          : 'border-border bg-card/80'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Icon + Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              agent ? 'bg-amber-100 dark:bg-amber-900/30' : expired ? 'bg-rose-100 dark:bg-rose-900/30' : 'bg-primary-100 dark:bg-primary-900/30'
            }`}>
              {agent ? (
                <Server className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              ) : expired ? (
                <Clock className="h-4 w-4 text-rose-600 dark:text-rose-400" />
              ) : (
                <Key className="h-4 w-4 text-primary-600 dark:text-primary-400" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground dark:text-zinc-100 truncate">
                  {apiKey.name || 'Unnamed Key'}
                </span>
                {agent && (
                  <Badge variant="outline" className="border-amber-400/40 text-amber-700 dark:border-amber-500/30 dark:text-amber-400 text-[10px]">
                    <Server className="mr-1 h-2.5 w-2.5" /> Agent
                  </Badge>
                )}
                {apiKey.enabled && !expired ? (
                  <Badge variant="outline" className="border-emerald-400/40 text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400 text-[10px]">
                    Active
                  </Badge>
                ) : !apiKey.enabled ? (
                  <Badge variant="secondary" className="text-[10px]">Disabled</Badge>
                ) : null}
                {expired && (
                  <Badge variant="destructive" className="text-[10px]">Expired</Badge>
                )}
              </div>
              {agent && nodeId && (
                <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  Node: <code className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[11px] dark:bg-amber-900/30">{nodeId}</code>
                </div>
              )}
            </div>
          </div>

          {/* Key Preview */}
          {apiKey.prefix && apiKey.start && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/50 bg-white px-3 py-2 font-mono text-sm dark:bg-surface-1">
              <code className="flex-1 truncate text-foreground dark:text-zinc-300">
                {apiKey.start}{'*'.repeat(40)}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(apiKey.start || '')}
                className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
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
              <span>Created: <span className="font-medium text-foreground dark:text-zinc-300">{formatDate(apiKey.createdAt)}</span></span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span>Last used: <span className="font-medium text-foreground dark:text-zinc-300">{formatDate(apiKey.lastRequest)}</span></span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Zap className="h-3 w-3 shrink-0" />
              <span>Requests: <span className="font-medium text-foreground dark:text-zinc-300">{apiKey.requestCount || 0}</span></span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-3 w-3 shrink-0" />
              <span>Expires: <span className="font-medium text-foreground dark:text-zinc-300">{apiKey.expiresAt ? formatDate(apiKey.expiresAt) : 'Never'}</span></span>
            </div>
          </div>

          {/* Rate limit + Created by */}
          <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>Rate limit: {apiKey.rateLimitMax} req/{apiKey.rateLimitTimeWindow / 1000}s</span>
            {apiKey.user && (
              <span>
                by <span className="font-medium text-foreground dark:text-zinc-300">{apiKey.user.username || apiKey.user.email}</span>
              </span>
            )}
          </div>
        </div>

        {/* Delete action */}
        <button
          onClick={onDelete}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-100 transition-colors hover:bg-rose-50 hover:text-rose-600 sm:opacity-0 sm:group-hover:opacity-100"
          title="Revoke key"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </motion.div>
  );
}

// ── Main Page ──
export function ApiKeysPage() {
  const { data: apiKeys, isLoading } = useApiKeys();
  const { data: catalog = [] } = usePermissionsCatalog();
  const deleteApiKey = useDeleteApiKey();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
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
      className="relative min-h-screen overflow-hidden"
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
                <Key className="relative h-7 w-7 text-rose-600 dark:text-rose-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
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
        <motion.div variants={itemVariants} className="rounded-xl border border-border/50 bg-card/60 p-4 backdrop-blur-sm">
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
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground transition-colors focus:border-primary-500 focus:outline-none dark:border-border dark:bg-surface-1 dark:text-zinc-200"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="expired">Expired</option>
              </select>
            </div>

            {/* Agent keys toggle */}
            <label className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 cursor-pointer transition-colors hover:border-primary/50 dark:border-border dark:bg-surface-1">
              <input
                type="checkbox"
                checked={showAgentKeys}
                onChange={(e) => setShowAgentKeys(e.target.checked)}
                className="rounded border-border text-primary-600 focus:ring-primary-500 dark:border-zinc-600"
              />
              <span className="text-sm text-foreground dark:text-zinc-200">
                Show agent keys ({stats.agent})
              </span>
            </label>
          </div>

          {/* Active filter chips */}
          {(search || !showAgentKeys || statusFilter !== 'all') && (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
              <span className="text-[11px] text-muted-foreground">Active filters:</span>
              {!showAgentKeys && (
                <Badge variant="outline" className="border-amber-400/40 text-amber-700 dark:border-amber-500/30 dark:text-amber-400 text-[10px]">
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
              <div key={i} className="rounded-xl border border-border bg-card/80 p-5">
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

      {/* ── Delete Confirmation ── */}
      {deleteKey && (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className={`mx-4 w-full max-w-md rounded-xl border bg-card p-6 shadow-xl ${
              isAgentKey(deleteKey) ? 'border-rose-500/50' : 'border-border'
            }`}
          >
            <h3 className="text-lg font-semibold text-foreground dark:text-zinc-100">
              {confirmAgentDelete ? '⚠️ Final Warning' : 'Revoke API Key'}
            </h3>

            {isAgentKey(deleteKey) && !confirmAgentDelete ? (
              <>
                <div className="mt-3 rounded-lg border border-rose-300/50 bg-rose-50 p-4 dark:border-rose-500/30 dark:bg-rose-900/20">
                  <p className="text-sm font-semibold text-rose-800 dark:text-rose-300">
                    ⚠️ This is an Agent API Key
                  </p>
                  <p className="mt-1 text-sm text-rose-700 dark:text-rose-400">
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
                <div className="mt-3 rounded-lg border border-rose-400/50 bg-rose-100 p-4 dark:border-rose-500/50 dark:bg-rose-900/40">
                  <p className="text-sm font-bold text-rose-900 dark:text-rose-200">
                    This will render the node&apos;s agent USELESS!
                  </p>
                  <p className="mt-1 text-sm text-rose-800 dark:text-rose-300">
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
