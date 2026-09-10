import { useState, useMemo, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
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
import i18n from '@/i18n';
import { formatDateTime } from '@/i18n/format';
import { CreateApiKeyDialog } from '../components/apikeys/CreateApiKeyDialog';
import { EditApiKeyDialog } from '../components/apikeys/EditApiKeyDialog';
import { Input } from '../components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
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
 if (!dateString) return i18n.t('never', { ns: 'profile' });
 return formatDateTime(dateString);
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
 const { t } = useTranslation('profile');
 if (apiKey.allPermissions) {
 return (
 <div className="flex items-center gap-1.5">
 <ShieldCheck className="h-3.5 w-3.5 text-success" />
 <span className="text-xs font-medium text-success">
 {t('apiKeys.permissions.allCreator')}
 </span>
 </div>
 );
 }

 const perms = apiKey.permissions || [];
 if (perms.length === 0) {
 return <span className="text-xs text-muted-foreground italic">{t('apiKeys.permissions.none')}</span>;
 }

 const grouped = new Map<string, { cat: PermissionCategory; perms: string[] }>();
 for (const perm of perms) {
 const cat = catalog.find((c) => c.permissions.some((p) => p.value === perm));
 const catId = cat?.id || 'other';
 if (!grouped.has(catId)) grouped.set(catId, { cat: cat || { id: 'other', label: t('apiKeys.permissions.other'), description: '', permissions: [] }, perms: [] });
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
 {t('apiKeys.permissions.more', { count: grouped.size - maxShow })}
 </button>
 )}
 </div>

 {!collapsed && (
 <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 pl-1">
 {entries.map(([, { perms: catPerms }]) =>
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
 const { t } = useTranslation('profile');
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
 {apiKey.name || t('unnamedKey')}
 </span>
 {agent && (
 <Badge variant="outline" className="border-warning/30 text-warning text-[10px]">
 <Server className="mr-1 h-2.5 w-2.5" /> {t('apiKeys.row.agent')}
 </Badge>
 )}
 {apiKey.enabled && !expired ? (
 <Badge variant="outline" className="border-success/30 text-success text-[10px]">
 {t('apiKeys.active')}
 </Badge>
 ) : !apiKey.enabled ? (
 <Badge variant="secondary" className="text-[10px]">{t('common:actions.disabled')}</Badge>
 ) : null}
 {expired && (
 <Badge variant="destructive" className="text-[10px]">{t('apiKeys.expired')}</Badge>
 )}
 </div>
 {agent && nodeId && (() => {
 const nodeName = getNodeName(nodeId);
 return (
 <div className="mt-1 text-xs text-warning">
 {t('apiKeys.row.node')}{' '}
 {nodeName ? (
 <span className="font-medium">{nodeName}</span>
 ) : null}
 {' '}
 <code className="rounded bg-warning-muted px-1.5 py-0.5 font-mono text-[11px]">{nodeId.slice(0, 12)}{nodeId.length > 12 ? '...' : ''}</code>
 {!nodeName && (
 <span className="ml-1 text-[11px] opacity-60">{t('apiKeys.row.unknownNode')}</span>
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
 <span>{t('apiKeys.row.created')} <span className="font-medium text-foreground">{formatDate(apiKey.createdAt)}</span></span>
 </div>
 <div className="flex items-center gap-1.5 text-muted-foreground">
 <Clock className="h-3 w-3 shrink-0" />
 <span>{t('apiKeys.row.lastUsed')} <span className="font-medium text-foreground">{formatDate(apiKey.lastRequest)}</span></span>
 </div>
 <div className="flex items-center gap-1.5 text-muted-foreground">
 <Zap className="h-3 w-3 shrink-0" />
 <span>{t('apiKeys.row.requests')} <span className="font-medium text-foreground">{apiKey.requestCount || 0}</span></span>
 </div>
 <div className="flex items-center gap-1.5 text-muted-foreground">
 <Clock className="h-3 w-3 shrink-0" />
 <span>{t('apiKeys.row.expires')} <span className="font-medium text-foreground">{apiKey.expiresAt ? formatDate(apiKey.expiresAt) : t('never')}</span></span>
 </div>
 </div>

 <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
 <span>{t('apiKeys.row.rateLimit', { max: apiKey.rateLimitMax, window: apiKey.rateLimitTimeWindow / 1000 })}</span>
 {apiKey.user && (
 <span>
 {t('apiKeys.row.by')} <span className="font-medium text-foreground">{apiKey.user.username || apiKey.user.email}</span>
 </span>
 )}
 </div>
 </div>

 <div className="flex shrink-0 items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
 <button
 onClick={onEdit}
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
 title={t('apiKeys.row.edit')}
 >
 <Pencil className="h-3.5 w-3.5" />
 </button>
 <button
 onClick={onDelete}
 className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-danger-muted hover:text-danger"
 title={t('apiKeys.row.revoke')}
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
 const { t } = useTranslation('profile');
 const { data: apiKeys, isLoading, isError, refetch } = useApiKeys();
 const { data: catalog = [] } = usePermissionsCatalog();
 const { data: nodes = [] } = useNodes();
 const deleteApiKey = useDeleteApiKey();
 const [createDialogOpen, setCreateDialogOpen] = useState(false);
 const [editKey, setEditKey] = useState<ApiKey | null>(null);
 const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null);
 const [confirmAgentDelete, setConfirmAgentDelete] = useState(false);
 const skipCancelRef = useRef(false);
 const [search, setSearch] = useState('');
 const [showAgentKeys, setShowAgentKeys] = useState(false);
 const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'expired'>('all');

 const handleDelete = () => {
 if (deleteKey) {
 if (isAgentKey(deleteKey) && !confirmAgentDelete) {
 skipCancelRef.current = true;
 setConfirmAgentDelete(true);
 return;
 }
 deleteApiKey.mutate(deleteKey.id);
 setDeleteKey(null);
 setConfirmAgentDelete(false);
 }
 };

 const handleCancelDelete = () => {
 if (skipCancelRef.current) {
 skipCancelRef.current = false;
 return;
 }
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
 title={t('apiKeys.title')}
 description={t('apiKeys.description')}
 actions={
 <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1.5">
 <Plus className="h-3.5 w-3.5" />
 {t('apiKeys.create')}
 </Button>
 }
 />

 <ServerTabCard>
 <SectionHeader icon={Activity} title={t('apiKeys.overview')} />
 <StatGrid
 columns={4}
 items={[
 { label: t('apiKeys.total'), value: stats.total },
 { label: t('apiKeys.active'), value: stats.active },
 { label: t('apiKeys.agentKeys'), value: stats.agent },
 { label: t('apiKeys.totalRequests'), value: stats.totalRequests },
 ]}
 />
 {stats.expired > 0 && (
 <div className="mt-2">
 <StatGrid
 columns={4}
 items={[{ label: t('apiKeys.expired'), value: stats.expired }]}
 />
 </div>
 )}
 </ServerTabCard>

 <ServerTabCard>
 <SectionHeader icon={Filter} title={t('apiKeys.filters.title')} />
 <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
 <div className="relative">
 <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 placeholder={t('apiKeys.filters.searchPlaceholder')}
 className="pl-9 border-border/40"
 />
 </div>

 <div>
 <select
 value={statusFilter}
 onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'disabled' | 'expired')}
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
 >
 <option value="all">{t('apiKeys.filters.allStatuses')}</option>
 <option value="active">{t('apiKeys.filters.active')}</option>
 <option value="disabled">{t('apiKeys.filters.disabled')}</option>
 <option value="expired">{t('apiKeys.filters.expired')}</option>
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
 {t('apiKeys.filters.showAgentKeys', { count: stats.agent })}
 </span>
 </label>
 </div>

 {(search || !showAgentKeys || statusFilter !== 'all') && (
 <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/30 pt-3">
 <span className="text-[11px] text-muted-foreground">{t('apiKeys.filters.activeFilters')}</span>
 {!showAgentKeys && (
 <Badge variant="outline" className="border-warning/30 text-warning text-[10px]">
 {t('apiKeys.filters.hidingAgentKeys', { count: stats.agent })}
 </Badge>
 )}
 {statusFilter !== 'all' && (
 <Badge variant="outline" className="text-[10px]">
 {t('apiKeys.filters.status', { status: statusFilter })}
 </Badge>
 )}
 {search && (
 <Badge variant="outline" className="text-[10px]">
 {t('apiKeys.filters.search', { query: search })}
 </Badge>
 )}
 <button
 onClick={() => { setSearch(''); setStatusFilter('all'); }}
 className="ml-auto text-[11px] text-muted-foreground transition-colors hover:text-primary-600"
 >
 {t('apiKeys.filters.clear')}
 </button>
 </div>
 )}
 </ServerTabCard>

 {isLoading ? (
 <TabLoadingState rows={4} />
 ) : isError ? (
 <TabErrorState message={t('apiKeys.loadFailed')} onRetry={() => refetch?.()} />
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
 title={search || statusFilter !== 'all' ? t('apiKeys.filteredEmptyTitle') : t('apiKeys.emptyTitle')}
 description={
 search || statusFilter !== 'all'
 ? t('apiKeys.filteredEmptyDescription')
 : t('apiKeys.emptyDescription')
 }
 action={
 !search && statusFilter === 'all' ? (
 <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="gap-1.5">
 <Plus className="h-3.5 w-3.5" />
 {t('apiKeys.create')}
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

      <ConfirmDialog
        open={!!deleteKey}
        title={confirmAgentDelete ? t('apiKeys.confirm.finalWarningTitle') : t('apiKeys.confirm.title')}
        message={
          deleteKey && isAgentKey(deleteKey) && !confirmAgentDelete ? (
            <>
              <div className="rounded-lg border border-danger/30 bg-danger-muted p-4">
                <p className="text-sm font-semibold text-danger">{t('apiKeys.confirm.agentKeyHeading')}</p>
                <p className="mt-1 text-sm text-danger/80">
                  <Trans i18nKey="apiKeys.confirm.agentKeyWarning" ns="profile" components={{ strong: <strong /> }} />
                </p>
              </div>
              <p className="mt-3">
                {t('apiKeys.confirm.revokeNamed', { name: deleteKey.name })}
              </p>
            </>
          ) : deleteKey && confirmAgentDelete ? (
            <>
              <div className="rounded-lg border border-danger/50 bg-danger-muted p-4">
                <p className="text-sm font-bold text-danger">
                  {t('apiKeys.confirm.uselessWarning')}
                </p>
                <p className="mt-1 text-sm text-danger/80">
                  {t('apiKeys.confirm.reconfigureWarning')}
                </p>
              </div>
              <p className="mt-3">
                {t('apiKeys.confirm.typeNodeId')}{' '}
                <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">
                  {getNodeId(deleteKey)?.slice(0, 8)}…
                </code>
              </p>
            </>
          ) : (
            <>
              {t('apiKeys.confirm.revokeDescription', { name: deleteKey?.name })}
            </>
          )
        }
        confirmText={
          confirmAgentDelete
            ? t('apiKeys.confirm.confirmAgent')
            : deleteKey && isAgentKey(deleteKey)
              ? t('apiKeys.confirm.continue')
              : t('apiKeys.confirm.revoke')
        }
        variant="danger"
        loading={deleteApiKey.isPending}
        onConfirm={handleDelete}
        onCancel={handleCancelDelete}
      />
 </div>
 );
}
