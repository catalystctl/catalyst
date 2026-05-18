import { useState, useMemo } from 'react';
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
} from 'lucide-react';
import { useApiKeys, useDeleteApiKey, usePermissionsCatalog } from '../hooks/useApiKeys';
import { useNodes } from '../hooks/useNodes';
import { ApiKey, PermissionCategory, getPermissionLabel } from '../services/apiKeys';
import { CreateApiKeyDialog } from '../components/apikeys/CreateApiKeyDialog';
import { EditApiKeyDialog } from '../components/apikeys/EditApiKeyDialog';
import { Input } from '../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ModalPortal } from '@/components/ui/modal-portal';
import TabHeader from '../components/servers/tabs/TabHeader';
import ServerTabCard from '../components/servers/tabs/ServerTabCard';
import SectionHeader from '../components/servers/tabs/SectionHeader';
import StatGrid from '../components/servers/tabs/StatGrid';
import TabLoadingState from '../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../components/servers/tabs/TabEmptyState';
import TabErrorState from '../components/servers/tabs/TabErrorState';

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
 <Badge variant="outline" className="text-[10px] border-primary-300/40 text-primary-700">
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

 {!collapsed && (
 <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 pl-1">
 {entries.map(([{ perms: catPerms }]) =>
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

// ── API Key Row ──
function ApiKeyRow({
 apiKey,
 onDelete,
 onEdit,
 catalog,
 getNodeName,
}: {
 apiKey: ApiKey;
 onDelete: () => void;
 onEdit: () => void;
 catalog: PermissionCategory[];
 getNodeName: (nodeId: string) => string | undefined;
}) {
 const agent = isAgentKey(apiKey);
 const expired = isExpired(apiKey.expiresAt);
 const nodeId = getNodeId(apiKey);
 const [permsExpanded, setPermsExpanded] = useState(false);

 return (
 <div
 className={`group relative overflow-hidden rounded-xl border p-5 transition-all duration-200 ${
 agent
 ? 'border-warning/20 bg-warning-muted'
 : expired
 ? 'border-danger/15 bg-danger-muted'
 : 'border-border/30 bg-card'
 }`}
 >
 <div className="flex items-start gap-4">
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

 {apiKey.prefix && apiKey.start && (
 <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/30 bg-card px-3 py-2 font-mono text-sm">
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

 <div className="mt-3">
 <PermissionsDisplay
 apiKey={apiKey}
 catalog={catalog}
 collapsed={!permsExpanded}
 onToggle={() => setPermsExpanded(!permsExpanded)}
 />
 </div>

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

 <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
 <span>Rate limit: {apiKey.rateLimitMax} req/{apiKey.rateLimitTimeWindow / 1000}s</span>
 {apiKey.user && (
 <span>
 by <span className="font-medium text-foreground">{apiKey.user.username || apiKey.user.email}</span>
 </span>
 )}
 </div>
 </div>

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
 </div>
 );
}

// ── Main Page ──
export function ApiKeysPage() {
 const { data: apiKeys, isLoading, isError, refetch } = useApiKeys();
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
 if (!apiKeys) return { total: 0, active: 0, agent: 0, expired: 0, totalRequests: 0 };
 return {
 total: apiKeys.length,
 active: apiKeys.filter((k) => k.enabled).length,
 agent: apiKeys.filter(isAgentKey).length,
 expired: apiKeys.filter((k) => isExpired(k.expiresAt)).length,
 totalRequests: apiKeys.reduce((sum, k) => sum + (k.requestCount || 0), 0),
 };
 }, [apiKeys]);

 return (
 <div className="space-y-4">
 <TabHeader
 icon={Key}
 title="API Keys"
 description="Manage API keys for automated access to Catalyst."
 actions={
 <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1.5">
 <Plus className="h-3.5 w-3.5" />
 Create API Key
 </Button>
 }
 />

 <ServerTabCard>
 <SectionHeader icon={Activity} title="Overview" />
 <StatGrid
 columns={4}
 items={[
 { label: 'Total', value: stats.total },
 { label: 'Active', value: stats.active },
 { label: 'Agent keys', value: stats.agent },
 { label: 'Total requests', value: stats.totalRequests },
 ]}
 />
 {stats.expired > 0 && (
 <div className="mt-2">
 <StatGrid
 columns={4}
 items={[{ label: 'Expired', value: stats.expired }]}
 />
 </div>
 )}
 </ServerTabCard>

 <ServerTabCard>
 <SectionHeader icon={Filter} title="Filters" />
 <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
 <div className="relative">
 <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder="Name, node ID, or key…"
 className="pl-9 border-border/40"
 />
 </div>

 <div>
 <select
 value={statusFilter}
 onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'disabled' | 'expired')}
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
 >
 <option value="all">All statuses</option>
 <option value="active">Active</option>
 <option value="disabled">Disabled</option>
 <option value="expired">Expired</option>
 </select>
 </div>

 <label className="flex items-center gap-2 rounded-lg border border-border/40 bg-card px-3 py-2 cursor-pointer transition-colors hover:border-primary/50">
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

 {(search || !showAgentKeys || statusFilter !== 'all') && (
 <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/30 pt-3">
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
 </ServerTabCard>

 {isLoading ? (
 <TabLoadingState rows={4} />
 ) : isError ? (
 <TabErrorState message="Failed to load API keys." onRetry={() => refetch?.()} />
 ) : filteredApiKeys.length > 0 ? (
 <div className="space-y-2.5">
 {filteredApiKeys.map((apiKey) => (
 <ApiKeyRow
 key={apiKey.id}
 apiKey={apiKey}
 catalog={catalog}
 onDelete={() => { setDeleteKey(apiKey); setConfirmAgentDelete(false); }}
 onEdit={() => setEditKey(apiKey)}
 getNodeName={getNodeName}
 />
 ))}
 </div>
 ) : (
 <TabEmptyState
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
 )}

 <CreateApiKeyDialog open={createDialogOpen} onOpenChange={setCreateDialogOpen} />

 {editKey && (
 <EditApiKeyDialog
 apiKey={editKey}
 open={!!editKey}
 onClose={() => setEditKey(null)}
 />
 )}

 {deleteKey && (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
 <div
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
 </div>
 </div>
 </ModalPortal>
 )}
 </div>
 );
}
