import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
  ChevronRight,
  CircleAlert,
  Puzzle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Loader2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchPlugins, fetchMarketplace, togglePlugin, reloadPlugin, updatePluginConfig, fetchPluginDetails, type SafetyConsentRequiredError } from '../../plugins/api';
import { toast } from 'sonner';
import { usePluginContext } from '../../plugins/usePluginContext';
import type { CapabilitySummary, PluginManifest } from '../../plugins/types';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';

import TabEmptyState from '../../components/servers/tabs/TabEmptyState';
import { PluginDetailsDialog } from './plugins/PluginDetailsDialog';
import { SafetyConsentDialog, PLUGIN_DISCLAIMER_VERSION } from './plugins/SafetyConsentDialog';
import { MarketplaceDialog } from './plugins/MarketplaceDialog';
import { permissionLabel } from './plugins/permissionMeta';

// ── Helpers ──────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'enabled' | 'disabled' | 'error';

interface PluginConfig {
  [key: string]: any;
}

function statusBadgeVariant(status: string, error?: string): 'destructive' | 'outline' | 'secondary' {
  if (error || status === 'error') return 'destructive';
  if (status === 'enabled') return 'outline';
  return 'secondary';
}

function statusText(status: string) {
  const map: Record<string, string> = {
    enabled: 'Enabled', disabled: 'Disabled', loaded: 'Loaded',
    loading: 'Loading', error: 'Error', unloaded: 'Unloaded',
  };
  return map[status] || status;
}

// ── Plugin Row ───────────────────────────────────────────────────────────────

function PluginRow({
  plugin,
  isProcessing,
  latestMarketplaceVersion,
  onToggle,
  onReload,
  onSettings,
  onDetails,
}: {
  plugin: PluginManifest;
  isProcessing: boolean;
  latestMarketplaceVersion?: string;
  onToggle: () => void;
  onReload: () => void;
  onSettings: () => void;
  onDetails: () => void;
}) {
  const revoked = plugin.revokedPermissions?.length ?? 0;
  const declaredCount = plugin.declaredPermissions?.length ?? 0;
  const caps = plugin.capabilityCounts;
  const updateAvailable = Boolean(latestMarketplaceVersion && latestMarketplaceVersion !== plugin.version);

  return (
    <div
      className="group flex cursor-pointer flex-wrap items-center gap-3 border-b border-border/40 py-3 last:border-0 hover:bg-surface-2/30"
      onClick={onDetails}
      data-testid={`plugin-row-${plugin.name}`}
    >
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
        plugin.enabled ? 'bg-success/10 text-success' : plugin.error ? 'bg-danger/10 text-danger' : 'bg-surface-2 text-muted-foreground'
      }`}>
        <Puzzle className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{plugin.displayName}</span>
          <Badge variant={statusBadgeVariant(plugin.status, plugin.error)} className="text-[10px]">
            {statusText(plugin.status)}
          </Badge>
          {updateAvailable && (
            <Badge variant="outline" className="gap-1 border-warning/40 text-warning text-[10px]">
              Update {plugin.version} → {latestMarketplaceVersion}
            </Badge>
          )}
          {plugin.legacyAcceptance && (
            <Badge variant="outline" className="gap-1 border-warning/40 text-warning text-[10px]">
              <CircleAlert className="h-3 w-3" />
              Review access
            </Badge>
          )}
          {!plugin.enabled && revoked > 0 && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title="Permissions currently granted after revocations">
              <ShieldCheck className="h-3 w-3" />
              {declaredCount - revoked}/{declaredCount} permissions
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {plugin.description}
          {' — '}
          <span className="font-mono">{plugin.name}@{plugin.version}</span>
          {caps && (caps.routes > 0 || caps.tasks > 0) && (
            <> · {[
              caps.routes > 0 && `${caps.routes} route${caps.routes === 1 ? '' : 's'}`,
              caps.tasks > 0 && `${caps.tasks} task${caps.tasks === 1 ? '' : 's'}`,
            ].filter(Boolean).join(', ')}</>
          )}
        </p>
        {plugin.error && (
          <p className="mt-0.5 truncate text-[11px] text-danger">{plugin.error}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant={plugin.enabled ? 'outline' : 'default'}
          size="sm"
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          disabled={isProcessing || plugin.status === 'error'}
        >
          {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : plugin.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); onReload(); }} disabled={isProcessing} aria-label="Reload">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={(e) => { e.stopPropagation(); onSettings(); }} aria-label="Settings">
          <Settings className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDetails} aria-label="Details">
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Button>
      </div>
    </div>
  );
}

// ── Plugin Settings Modal ────────────────────────────────────────────────────

function PluginSettingsModal({
  pluginName,
  open,
  onOpenChange,
}: {
  pluginName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [localConfig, setLocalConfig] = useState<PluginConfig | null>(null);

  const { data: pluginDetails, isLoading } = useQuery({
    queryKey: qk.adminPlugin(pluginName),
    queryFn: () => fetchPluginDetails(pluginName),
    enabled: open,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const manifestSchema = pluginDetails?.configSchema ?? {};
  const runtimeValues = pluginDetails?.config ?? {};
  const config = localConfig ?? (Object.keys(manifestSchema).length > 0 ? manifestSchema : runtimeValues);

  const handleConfigChange = (key: string, value: any) => {
    setLocalConfig((prev) => ({ ...(prev ?? config), [key]: value }));
  };

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setLocalConfig(null);
  }

  const updateMutation = useMutation({
    mutationFn: (newConfig: PluginConfig) => updatePluginConfig(pluginName, newConfig),
    onSuccess: () => {
      toast.success('Plugin configuration updated');
      onOpenChange(false);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminPlugins() });
      queryClient.invalidateQueries({ queryKey: qk.adminPlugin(pluginName) });
    },
    onError: (error: any) => toast.error(error.message || 'Failed to update configuration'),
  });

  type ConfigSchemaEntry = {
    type: string;
    default?: any;
    description?: string;
    label?: string;
    /** Plain strings ("medium") or objects ({ value, label }). */
    options?: Array<string | number | boolean | { value: any; label?: string }>;
  };
  function isConfigSchema(v: any): v is ConfigSchemaEntry {
    return v && typeof v === 'object' && typeof v.type === 'string';
  }

  /** Normalize plugin.json select options for <option> rendering. */
  function normalizeSelectOptions(
    options: ConfigSchemaEntry['options'] | undefined,
  ): Array<{ value: string; label: string; raw: any }> {
    if (!Array.isArray(options)) return [];
    return options.map((opt, index) => {
      if (opt !== null && typeof opt === 'object' && !Array.isArray(opt)) {
        const raw = (opt as any).value !== undefined ? (opt as any).value : (opt as any).id ?? index;
        const label =
          (opt as any).label ??
          (opt as any).name ??
          (opt as any).title ??
          String(raw);
        return { value: String(raw), label: String(label), raw };
      }
      // Plain string/number/boolean from plugin.json, e.g. "medium"
      return { value: String(opt), label: String(opt), raw: opt };
    });
  }

  const buildSaveConfig = (): PluginConfig => {
    const result: PluginConfig = {};
    for (const [key, value] of Object.entries(config)) {
      if (isConfigSchema(value)) {
        result[key] = value.default;
      } else {
        result[key] = value;
      }
    }
    return result;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader icon={<Settings className="h-4 w-4" />}>
          <DialogTitle>Plugin settings</DialogTitle>
          <DialogDescription>
            Configure {pluginDetails?.displayName || pluginName}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : Object.keys(config).length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/50 bg-surface-2/20 px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground">No configuration options available.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(config).map(([key, value]) => {
                const schema = isConfigSchema(value) ? value : null;
                const fieldType = schema ? schema.type : typeof value;
                const currentValue = schema ? schema.default : value;
                const description = schema ? (schema.description || '') : '';
                const label = schema ? (schema.label || key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())) : key;
                const selectOptions = normalizeSelectOptions(schema?.options);

                const runtimeOverride = runtimeValues[key];
                const isRuntimeObject = runtimeOverride !== undefined && !isConfigSchema(runtimeOverride);
                const effectiveValue = isRuntimeObject ? runtimeOverride : currentValue;

                return (
                  <div key={key} className="space-y-1.5">
                    <label className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">{label}</label>
                    {description && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
                    )}
                    {fieldType === 'boolean' ? (
                      <label className="flex cursor-pointer items-center gap-2 pt-1">
                        <input
                          type="checkbox"
                          checked={!!effectiveValue}
                          onChange={(e) =>
                            handleConfigChange(key, schema
                              ? { ...(value as Record<string, any>), default: e.target.checked }
                              : e.target.checked)
                          }
                          className="h-4 w-4 rounded border-border bg-card text-primary"
                        />
                        <span className="text-sm text-muted-foreground">
                          {effectiveValue ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    ) : fieldType === 'number' ? (
                      <Input
                        type="number"
                        value={effectiveValue ?? ''}
                        onChange={(e) =>
                          handleConfigChange(key, schema
                            ? { ...(value as Record<string, any>), default: parseFloat(e.target.value) || 0 }
                            : parseFloat(e.target.value) || 0)
                        }
                      />
                    ) : fieldType === 'select' && selectOptions.length > 0 ? (
                      <select
                        value={String(effectiveValue ?? '')}
                        onChange={(e) => {
                          const selected = selectOptions.find((o) => o.value === e.target.value);
                          // Prefer original raw value (keeps numbers/bools typed); fall back to string.
                          const newVal = selected ? selected.raw : e.target.value;
                          handleConfigChange(key, schema
                            ? { ...(value as Record<string, any>), default: newVal }
                            : newVal);
                        }}
                        className="flex h-9 w-full rounded-md border border-border bg-card px-3 py-1 text-sm text-foreground shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {/* Empty placeholder only if current value is not in the list */}
                        {!selectOptions.some((o) => o.value === String(effectiveValue ?? '')) && (
                          <option value={String(effectiveValue ?? '')} disabled>
                            {effectiveValue == null || effectiveValue === '' ? 'Select…' : String(effectiveValue)}
                          </option>
                        )}
                        {selectOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    ) : fieldType === 'password' ? (
                      <Input
                        type="password"
                        value={String(effectiveValue ?? '')}
                        onChange={(e) =>
                          handleConfigChange(key, schema
                            ? { ...(value as Record<string, any>), default: e.target.value }
                            : e.target.value)
                        }
                        placeholder="••••••••"
                      />
                    ) : fieldType === 'text' ? (
                      <textarea
                        value={String(effectiveValue ?? '')}
                        rows={3}
                        onChange={(e) =>
                          handleConfigChange(key, schema
                            ? { ...(value as Record<string, any>), default: e.target.value }
                            : e.target.value)
                        }
                        className="flex min-h-[80px] w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    ) : (
                      <Input
                        value={String(effectiveValue ?? '')}
                        onChange={(e) =>
                          handleConfigChange(key, schema
                            ? { ...(value as Record<string, any>), default: e.target.value }
                            : e.target.value)
                        }
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => updateMutation.mutate(buildSaveConfig())}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PluginsPage() {
  const { reloadPlugins } = usePluginContext();
  const [processingPlugin, setProcessingPlugin] = useState<string | null>(null);
  const [settingsPlugin, setSettingsPlugin] = useState<string | null>(null);
  const [detailsPlugin, setDetailsPlugin] = useState<string | null>(null);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);

  // Safety consent flow state
  const [consentRequest, setConsentRequest] = useState<{
    name: string;
    displayName: string;
    author?: string;
    version?: string;
    requestedCapabilities?: CapabilitySummary[];
  } | null>(null);
  const [consentBusy, setConsentBusy] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const { data: plugins, isLoading } = useQuery({
    queryKey: qk.adminPlugins(),
    queryFn: fetchPlugins,
    staleTime: 60_000,
  });

  const { data: marketplace } = useQuery({
    queryKey: ['plugins', 'marketplace'],
    queryFn: () => fetchMarketplace(false),
    staleTime: 60_000,
  });
  const marketplaceByName = useMemo(() => {
    const installed = new Map((plugins ?? []).map((p) => [p.name, p.version]));
    const map = new Map<string, { version?: string; updateAvailable?: boolean }>();
    for (const entry of marketplace?.entries ?? []) {
      const installedVersion = entry.installedVersion ?? installed.get(entry.name);
      const updateAvailable =
        Boolean(entry.updateAvailable) ||
        Boolean(installedVersion && entry.version && installedVersion !== entry.version &&
          entry.version.localeCompare(installedVersion, undefined, { numeric: true }) > 0);
      map.set(entry.name, { version: entry.version, updateAvailable });
    }
    return map;
  }, [marketplace?.entries, plugins]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.adminPlugins() });
    if (detailsPlugin) queryClient.invalidateQueries({ queryKey: qk.adminPlugin(detailsPlugin) });
  };

  /** Enable/disable through the backend gate; surfaces the disclaimer when required. */
  const requestToggle = async (plugin: PluginManifest) => {
    setProcessingPlugin(plugin.name);
    try {
      await togglePlugin(plugin.name, !plugin.enabled);
      reloadPlugins();
      toast.success(`Plugin ${plugin.enabled ? 'disabled' : 'enabled'} successfully`);
      invalidate();
    } catch (error: any) {
      if (error?.code === 'SAFETY_CONSENT_REQUIRED') {
        const err = error as SafetyConsentRequiredError;
        setConsentRequest({
          name: plugin.name,
          displayName: plugin.displayName,
          author: err.payload?.author,
          version: err.payload?.version,
          // Server-resolved reviewer copy (builtin + plugin-provided descriptions)
          requestedCapabilities: err.payload?.requestedCapabilities,
        });
      } else {
        toast.error(error?.message || 'Failed to toggle plugin');
      }
    } finally {
      setProcessingPlugin(null);
    }
  };

  /** Acceptance path from the consent dialog. */
  const confirmEnableWithConsent = async () => {
    if (!consentRequest) return;
    setConsentBusy(true);
    try {
      await togglePlugin(consentRequest.name, true, {
        acceptSafetyVersion: PLUGIN_DISCLAIMER_VERSION,
      });
      reloadPlugins();
      toast.success(`Plugin enabled successfully`);
      invalidate();
      setConsentRequest(null);
    } catch (error: any) {
      toast.error(error?.message || 'Failed to enable plugin');
    } finally {
      setConsentBusy(false);
    }
  };

  const reloadMutation = useMutation({
    mutationFn: (name: string) => reloadPlugin(name),
    onMutate: (name) => setProcessingPlugin(name),
    onSuccess: () => {
      reloadPlugins();
      toast.success('Plugin reloaded successfully');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminPlugins() });
      setProcessingPlugin(null);
    },
    onError: (error: any) => toast.error(error.message || 'Failed to reload plugin'),
  });

  const enabledCount = plugins?.filter((p) => p.enabled).length ?? 0;
  const totalCount = plugins?.length ?? 0;
  const errorCount = plugins?.filter((p) => p.error || p.status === 'error').length ?? 0;

  const filteredPlugins = useMemo(() => {
    if (!plugins) return [];
    const q = searchQuery.trim().toLowerCase();
    return plugins.filter((p) => {
      if (q && ![p.displayName, p.name, p.description ?? '', p.author].join(' ').toLowerCase().includes(q)) {
        return false;
      }
      switch (statusFilter) {
        case 'enabled': return p.enabled;
        case 'disabled': return !p.enabled;
        case 'error': return !!p.error || p.status === 'error';
        default: return true;
      }
    });
  }, [plugins, searchQuery, statusFilter]);

  const filterOptions: Array<{ key: StatusFilter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: totalCount },
    { key: 'enabled', label: 'Enabled', count: enabledCount },
    { key: 'disabled', label: 'Disabled', count: totalCount - enabledCount },
    { key: 'error', label: 'Errors', count: errorCount },
  ];

  // Consent-dialog inputs resolved from freshest list data
  const consentPlugin = plugins?.find((p) => p.name === consentRequest?.name);
  const consentCapabilities =
    consentRequest?.requestedCapabilities ?? consentPlugin?.permissionSummaries ?? undefined;
  const consentPermissionLabels = Object.fromEntries(
    (consentPlugin?.declaredPermissions ?? []).map((token) => [token, permissionLabel(token)]),
  );

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <TabHeader
        icon={Puzzle}
        title="Plugins"
        description="Manage, configure and audit installed plugins"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setMarketplaceOpen(true)}>
              <Store className="h-3.5 w-3.5" />
              Marketplace
            </Button>
            <Badge variant="outline" className="text-[11px]">
              {totalCount} installed
            </Badge>
            <Badge variant="secondary" className="text-[11px]">
              {enabledCount} enabled
            </Badge>
          </div>
        }
      />

      {/* ── Toolbar ── */}
      {plugins && plugins.length > 0 && (
        <ServerTabCard className="!py-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search plugins…"
                className="pl-8"
                aria-label="Search plugins"
              />
            </div>
            <div className="flex items-center gap-1" role="tablist" aria-label="Filter by status">
              {filterOptions.map(({ key, label, count }) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={statusFilter === key}
                  onClick={() => setStatusFilter(key)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    statusFilter === key
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground'
                  }`}
                >
                  {label}
                  <span className="ml-1.5 opacity-60">{count}</span>
                </button>
              ))}
            </div>
          </div>
        </ServerTabCard>
      )}

      {/* ── Plugin List ── */}
      {isLoading ? (
        <ServerTabCard>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2" />
            ))}
          </div>
        </ServerTabCard>
      ) : !plugins || plugins.length === 0 ? (
        <TabEmptyState
          title="No plugins installed"
          description="Add a plugin under catalyst-plugins/ with a plugin.json manifest, then restart the panel to discover it."
        />
      ) : filteredPlugins.length === 0 ? (
        <TabEmptyState
          title="No matches"
          description={`No plugins match "${searchQuery}" with the current filter.`}
        />
      ) : (
        <ServerTabCard>
          {filteredPlugins.map((plugin) => (
            <PluginRow
              key={plugin.name}
              plugin={plugin}
              isProcessing={processingPlugin === plugin.name}
              latestMarketplaceVersion={
                marketplaceByName.get(plugin.name)?.updateAvailable
                  ? marketplaceByName.get(plugin.name)?.version
                  : undefined
              }
              onToggle={() => requestToggle(plugin)}
              onReload={() => reloadMutation.mutate(plugin.name)}
              onSettings={() => setSettingsPlugin(plugin.name)}
              onDetails={() => setDetailsPlugin(plugin.name)}
            />
          ))}
        </ServerTabCard>
      )}

      {/* ── Settings Modal ── */}
      <PluginSettingsModal
        pluginName={settingsPlugin ?? ''}
        open={!!settingsPlugin}
        onOpenChange={(open) => !open && setSettingsPlugin(null)}
      />

      {/* ── Details Dialog ── */}
      <PluginDetailsDialog
        pluginName={detailsPlugin ?? ''}
        open={!!detailsPlugin}
        onOpenChange={(open) => !open && setDetailsPlugin(null)}
      />

      {/* ── Marketplace ── */}
      <MarketplaceDialog
        open={marketplaceOpen}
        onOpenChange={setMarketplaceOpen}
        installedVersions={Object.fromEntries((plugins ?? []).map((p) => [p.name, p.version]))}
        onInstalled={() => {
          reloadPlugins();
          queryClient.invalidateQueries({ queryKey: qk.adminPlugins() });
          queryClient.invalidateQueries({ queryKey: ['plugins', 'marketplace'] });
        }}
      />

      {/* ── Safety Consent Dialog ── */}
      <SafetyConsentDialog
        open={!!consentRequest}
        busy={consentBusy}
        pluginName={consentRequest?.name ?? ''}
        displayName={consentRequest?.displayName ?? ''}
        author={consentRequest?.author}
        version={consentRequest?.version}
        requestedCapabilities={consentCapabilities}
        requestedPermissions={consentPlugin?.declaredPermissions ?? []}
        permissionLabels={consentPermissionLabels}
        onAccept={confirmEnableWithConsent}
        onOpenChange={(open) => !open && setConsentRequest(null)}
      />
    </div>
  );
}
