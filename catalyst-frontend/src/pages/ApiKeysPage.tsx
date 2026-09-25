import { useState, useMemo, useRef } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import {
  Search,
  Plus,
  Trash2,
  Pencil,
  Copy,
  Server,
  Activity,
  Clock,
  Zap,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { useApiKeys, useDeleteApiKey, usePermissionsCatalog } from '../hooks/useApiKeys';
import { useNodes } from '../hooks/useNodes';
import { useAuthStore } from '../stores/authStore';
import { ApiKey, PermissionCategory, getPermissionLabel } from '../services/apiKeys';
import i18n from '@/i18n';
import { formatDateTime } from '@/i18n/format';
import { CreateApiKeyDialog } from '../components/apikeys/CreateApiKeyDialog';
import { EditApiKeyDialog } from '../components/apikeys/EditApiKeyDialog';
import { Button } from '@/components/ui/button';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import TabLoadingState from '../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../components/servers/tabs/TabEmptyState';
import TabErrorState from '../components/servers/tabs/TabErrorState';
import { BracketLabel, Segmented, StatusLed } from '../components/deck/primitives';
import { cn } from '@/lib/utils';

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

/**
 * One grid template shared by the column header and every row.
 *   base : identity · actions
 *   md   : identity · usage · actions
 */
const APIKEY_GRID =
  'grid grid-cols-1 items-start gap-x-3 gap-y-1 ' +
  'md:grid-cols-[minmax(0,1fr)_11rem_5rem]';

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
        <ShieldCheck className="h-3 w-3 shrink-0 text-success" />
        <span className="text-mini font-medium text-success">
          {t('apiKeys.permissions.allCreator')}
        </span>
      </div>
    );
  }

  const perms = apiKey.permissions || [];
  if (perms.length === 0) {
    return <span className="text-mini italic text-muted-foreground">{t('apiKeys.permissions.none')}</span>;
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
      <div className="flex flex-wrap items-center gap-1.5">
        {entries.map(([catId, { cat, perms: catPerms }]) => (
          <span
            key={catId}
            className="flex items-center gap-1 rounded-sm border border-border/50 px-1.5 py-0.5 font-mono text-micro tabular-nums text-muted-foreground"
          >
            <Shield className="h-2.5 w-2.5 shrink-0" />
            {cat.label}
            <span className="opacity-60">{catPerms.length}</span>
          </span>
        ))}
        {grouped.size > maxShow && (
          <button
            onClick={onToggle}
            className="text-micro text-primary transition-colors hover:underline"
          >
            {t('apiKeys.permissions.more', { count: grouped.size - maxShow })}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
          {entries.map(([, { perms: catPerms }]) =>
            catPerms.map((perm) => (
              <div key={perm} className="flex items-center gap-1.5 text-micro text-muted-foreground">
                <span className="text-muted-foreground/50" aria-hidden>·</span>
                <span className="truncate">{getPermissionLabel(perm, catalog)}</span>
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
  canManage,
}: {
  apiKey: ApiKey;
  onDelete: () => void;
  onEdit: () => void;
  catalog: PermissionCategory[];
  getNodeName: (nodeId: string) => string | undefined;
  canManage: boolean;
}) {
  const { t } = useTranslation('profile');
  const agent = isAgentKey(apiKey);
  const expired = isExpired(apiKey.expiresAt);
  const nodeId = getNodeId(apiKey);
  const [permsExpanded, setPermsExpanded] = useState(false);
  const nodeName = nodeId ? getNodeName(nodeId) : undefined;

  return (
    <div
      role="row"
      className={cn(APIKEY_GRID, 'px-3 py-2 transition-colors hover:bg-surface-1/40')}
    >
      {/* identity */}
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <StatusLed
            tone={agent ? 'hazard' : expired ? 'alarm' : apiKey.enabled ? 'go' : 'idle'}
            pulse={apiKey.enabled && !expired && !agent}
          />
          <span className="truncate font-display text-data font-semibold tracking-tight text-foreground">
            {apiKey.name || t('unnamedKey')}
          </span>
          {agent && (
            <span className="type-overline shrink-0 text-warning">{t('apiKeys.row.agent')}</span>
          )}
          {apiKey.enabled && !expired ? (
            <span className="type-overline shrink-0 text-success">{t('apiKeys.active')}</span>
          ) : !apiKey.enabled ? (
            <span className="type-overline shrink-0">{t('common:actions.disabled')}</span>
          ) : null}
          {expired && (
            <span className="type-overline shrink-0 text-danger">{t('apiKeys.expired')}</span>
          )}
        </div>

        {agent && nodeId && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-micro text-warning">
            <Server className="h-3 w-3 shrink-0" />
            <span>{t('apiKeys.row.node')}</span>
            {nodeName ? <span className="truncate">{nodeName}</span> : null}
            <code className="font-mono tabular-nums">
              {nodeId.slice(0, 12)}{nodeId.length > 12 ? '...' : ''}
            </code>
            {!nodeName && (
              <span className="opacity-60">{t('apiKeys.row.unknownNode')}</span>
            )}
          </div>
        )}

        {apiKey.prefix && apiKey.start && (
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            <code className="min-w-0 truncate font-mono text-micro tabular-nums text-muted-foreground">
              {apiKey.start}{'*'.repeat(16)}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(apiKey.start || '')}
              title={t('common:actions.copy')}
              aria-label={t('common:actions.copy')}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Copy className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="mt-1">
          <PermissionsDisplay
            apiKey={apiKey}
            catalog={catalog}
            collapsed={!permsExpanded}
            onToggle={() => setPermsExpanded(!permsExpanded)}
          />
        </div>
      </div>

      {/* usage meta */}
      <div className="hidden flex-col gap-0.5 text-micro text-muted-foreground md:flex">
        <span className="flex items-center gap-1.5">
          <Activity className="h-3 w-3 shrink-0" />
          {t('apiKeys.row.created')}{' '}
          <span className="font-mono tabular-nums text-foreground">{formatDate(apiKey.createdAt)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0" />
          {t('apiKeys.row.lastUsed')}{' '}
          <span className="font-mono tabular-nums text-foreground">{formatDate(apiKey.lastRequest)}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Zap className="h-3 w-3 shrink-0" />
          {t('apiKeys.row.requests')}{' '}
          <span className="font-mono tabular-nums text-foreground">{apiKey.requestCount || 0}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0" />
          {t('apiKeys.row.expires')}{' '}
          <span className="font-mono tabular-nums text-foreground">
            {apiKey.expiresAt ? formatDate(apiKey.expiresAt) : t('never')}
          </span>
        </span>
        <span className="truncate font-mono tabular-nums">
          {t('apiKeys.row.rateLimit', { max: apiKey.rateLimitMax, window: apiKey.rateLimitTimeWindow / 1000 })}
        </span>
        {apiKey.user && (
          <span className="truncate">
            {t('apiKeys.row.by')}{' '}
            <span className="text-foreground">{apiKey.user.username || apiKey.user.email}</span>
          </span>
        )}
      </div>

      {/* actions */}
      <div className="flex shrink-0 items-center justify-end gap-1">
        {canManage && (
          <>
            <button
              onClick={onEdit}
              title={t('apiKeys.row.edit')}
              aria-label={t('apiKeys.row.edit')}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onDelete}
              title={t('apiKeys.row.revoke')}
              aria-label={t('apiKeys.row.revoke')}
              className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-danger/5 hover:text-danger"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function LegendCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5">
      <Segmented muted className="text-micro">{value}</Segmented>
      <span className="type-overline">{label}</span>
    </span>
  );
}

// ── Main Page ──
export function ApiKeysPage() {
  const { t } = useTranslation('profile');
  const { data: apiKeys, isLoading, isError, refetch } = useApiKeys();
  const { data: catalog = [] } = usePermissionsCatalog();
  const { data: nodes = [] } = useNodes();
  // Mutating API keys requires apikey.manage; read-only admins (admin.read)
  // get a working list view with the mutation UI hidden.
  const userPerms = useAuthStore((s) => s.user?.permissions) ?? [];
  const canManage = userPerms.includes('*') || userPerms.includes('apikey.manage');
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

  const hasActiveFilters = Boolean(search) || !showAgentKeys || statusFilter !== 'all';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* ── Deck header ── */}
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <BracketLabel>{t('apiKeys.overview')}</BracketLabel>
          <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
            {t('apiKeys.title')}
          </h1>
          <p className="type-meta">{t('apiKeys.description')}</p>
        </div>
        {canManage && (
          <Button
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            className="h-8 gap-1.5 px-3 text-mini"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('apiKeys.create')}
          </Button>
        )}
      </header>

      {/* ── The deck: controls, rows and legend in one frame ── */}
      <div className="deck-panel flex min-h-0 flex-col overflow-hidden">
        {/* Control strip */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-surface-1/40 px-3 py-1.5">
          <label className="relative flex min-w-[12rem] flex-1 items-center">
            <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('apiKeys.filters.searchPlaceholder')}
              className="h-7 w-full rounded-sm border border-border/60 bg-background/40 pl-7 pr-2 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </label>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'disabled' | 'expired')}
            aria-label={t('apiKeys.filters.allStatuses')}
            className="h-7 rounded-sm border border-border/60 bg-background/40 pl-2 pr-7 text-mini text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/40"
          >
            <option value="all">{t('apiKeys.filters.allStatuses')}</option>
            <option value="active">{t('apiKeys.filters.active')}</option>
            <option value="disabled">{t('apiKeys.filters.disabled')}</option>
            <option value="expired">{t('apiKeys.filters.expired')}</option>
          </select>

          <label className="flex h-7 cursor-pointer select-none items-center gap-2 px-1 text-mini text-muted-foreground">
            <input
              type="checkbox"
              checked={showAgentKeys}
              onChange={(e) => setShowAgentKeys(e.target.checked)}
              className="h-3.5 w-3.5 rounded-sm border-border/60 bg-background/40 text-primary focus:ring-primary"
            />
            <span>{t('apiKeys.filters.showAgentKeys', { count: stats.agent })}</span>
          </label>
        </div>

        {/* Active filters strip */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-1.5">
            <span className="type-overline">{t('apiKeys.filters.activeFilters')}</span>
            {!showAgentKeys && (
              <span className="type-overline text-warning">
                {t('apiKeys.filters.hidingAgentKeys', { count: stats.agent })}
              </span>
            )}
            {statusFilter !== 'all' && (
              <span className="type-overline">
                {t('apiKeys.filters.status', { status: statusFilter })}
              </span>
            )}
            {search && (
              <span className="type-overline">
                {t('apiKeys.filters.search', { query: search })}
              </span>
            )}
            <button
              onClick={() => { setSearch(''); setStatusFilter('all'); }}
              className="ml-auto text-micro text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('apiKeys.filters.clear')}
            </button>
          </div>
        )}

        {/* Column header */}
        <div
          className={cn(
            APIKEY_GRID,
            'hidden border-b border-border/50 bg-surface-1 py-1.5 pl-3 pr-3 text-muted-foreground/70 md:grid',
          )}
        >
          <span className="type-overline">{t('apiKeys.form.name')}</span>
          <span className="type-overline hidden md:inline-flex">{t('apiKeys.overview')}</span>
          <span className="type-overline justify-self-end">{t('apiKeys.row.edit')}</span>
        </div>

        {/* Rows */}
        <div className="bg-background/25">
          {isLoading ? (
            <div className="p-3">
              <TabLoadingState rows={4} />
            </div>
          ) : isError ? (
            <div className="p-3">
              <TabErrorState message={t('apiKeys.loadFailed')} onRetry={() => refetch?.()} />
            </div>
          ) : filteredApiKeys.length > 0 ? (
            <div className="divide-y divide-border/40">
              {filteredApiKeys.map((apiKey) => (
                <ApiKeyRow
                  key={apiKey.id}
                  apiKey={apiKey}
                  catalog={catalog}
                  canManage={canManage}
                  onDelete={() => { setDeleteKey(apiKey); setConfirmAgentDelete(false); }}
                  onEdit={() => setEditKey(apiKey)}
                  getNodeName={getNodeName}
                />
              ))}
            </div>
          ) : (
            <div className="py-2">
              <TabEmptyState
                title={search || statusFilter !== 'all' ? t('apiKeys.filteredEmptyTitle') : t('apiKeys.emptyTitle')}
                description={
                  search || statusFilter !== 'all'
                    ? t('apiKeys.filteredEmptyDescription')
                    : t('apiKeys.emptyDescription')
                }
                action={
                  !search && statusFilter === 'all' && canManage ? (
                    <Button size="sm" onClick={() => setCreateDialogOpen(true)} className="h-8 gap-1.5 px-3 text-mini">
                      <Plus className="h-3.5 w-3.5" />
                      {t('apiKeys.create')}
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
        </div>

        {/* Footer strip — legend */}
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border/50 bg-surface-1/40 px-3 py-1.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <LegendCount label={t('apiKeys.total')} value={stats.total} />
            <LegendCount label={t('apiKeys.active')} value={stats.active} />
            <LegendCount label={t('apiKeys.agentKeys')} value={stats.agent} />
            {stats.expired > 0 && <LegendCount label={t('apiKeys.expired')} value={stats.expired} />}
          </div>
          <span className="font-mono text-micro tabular-nums text-muted-foreground/60">
            {t('apiKeys.totalRequests')}: {stats.totalRequests}
          </span>
        </div>
      </div>

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
              <div className="rounded-sm border border-danger/30 px-3 py-2">
                <p className="text-mini font-semibold text-danger">{t('apiKeys.confirm.agentKeyHeading')}</p>
                <p className="mt-1 text-mini text-danger/80">
                  <Trans i18nKey="apiKeys.confirm.agentKeyWarning" ns="profile" components={{ strong: <strong /> }} />
                </p>
              </div>
              <p className="mt-3">
                {t('apiKeys.confirm.revokeNamed', { name: deleteKey.name })}
              </p>
            </>
          ) : deleteKey && confirmAgentDelete ? (
            <>
              <div className="rounded-sm border border-danger/50 px-3 py-2">
                <p className="text-mini font-bold text-danger">
                  {t('apiKeys.confirm.uselessWarning')}
                </p>
                <p className="mt-1 text-mini text-danger/80">
                  {t('apiKeys.confirm.reconfigureWarning')}
                </p>
              </div>
              <p className="mt-3">
                {t('apiKeys.confirm.typeNodeId')}{' '}
                <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-micro tabular-nums">
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
