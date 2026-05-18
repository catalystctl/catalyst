import { useEffect, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
 Puzzle,
 Power,
 PowerOff,
 RefreshCw,
 Settings,
 AlertCircle,
 Loader2,
 User,
 Code,
 Shield,
 Plus,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchPlugins, togglePlugin, reloadPlugin, fetchPluginDetails, updatePluginConfig } from '../../plugins/api';
import { toast } from 'sonner';
import { usePluginContext } from '../../plugins/PluginProvider';
import type { PluginManifest } from '../../plugins/types';
import { ModalPortal } from '@/components/ui/modal-portal';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';
import TabLoadingState from '../../components/servers/tabs/TabLoadingState';
import TabEmptyState from '../../components/servers/tabs/TabEmptyState';

// ── Helpers ──
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

// ── Plugin Card ──
function PluginCard({
 plugin,
 isProcessing,
 onToggle,
 onReload,
 onSettings,
}: {
 plugin: PluginManifest;
 isProcessing: boolean;
 onToggle: () => void;
 onReload: () => void;
 onSettings: () => void;
}) {
 return (
 <ServerTabCard>
 <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />
 {/* Header */}
 <div className="flex items-start justify-between gap-3">
 <div className="flex items-start gap-3 min-w-0 flex-1">
 <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
 plugin.enabled
 ? 'bg-success/10'
 : plugin.error
 ? 'bg-destructive/10'
 : 'bg-surface-3'
 }`}>
 <Puzzle className={`h-4 w-4 ${
 plugin.enabled
 ? 'text-success'
 : plugin.error
 ? 'text-destructive'
 : 'text-muted-foreground'
 }`} />
 </div>
 <div className="min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="font-semibold text-foreground text-sm">{plugin.displayName}</span>
 <Badge variant={statusBadgeVariant(plugin.status, plugin.error)} className="text-[10px]">
 {statusText(plugin.status)}
 </Badge>
 </div>
 <p className="mt-0.5 text-[11px] text-muted-foreground font-mono">{plugin.name}@v{plugin.version}</p>
 </div>
 </div>
 </div>

 {/* Description */}
 {plugin.description && (
 <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{plugin.description}</p>
 )}

 {/* Error */}
 {plugin.error && (
 <div className="mt-2 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2">
 <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
 <p className="text-[11px] text-destructive">{plugin.error}</p>
 </div>
 )}

 {/* Meta */}
 <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
 <span className="flex items-center gap-1">
 <User className="h-3 w-3" />
 {plugin.author}
 </span>
 <span className="flex items-center gap-1">
 <Code className="h-3 w-3" />
 {plugin.hasBackend ? 'Backend' : null}
 {plugin.hasBackend && plugin.hasFrontend ? ' + ' : null}
 {plugin.hasFrontend ? 'Frontend' : null}
 </span>
 {plugin.permissions.length > 0 && (
 <Badge variant="secondary" className="flex items-center gap-1 text-[9px]">
 <Shield className="h-2.5 w-2.5" />
 {plugin.permissions.length} perm{plugin.permissions.length === 1 ? '' : 's'}
 </Badge>
 )}
 </div>

 {/* Actions */}
 <div className="mt-4 flex items-center gap-2">
 <Button
 variant={plugin.enabled ? 'destructive' : 'default'}
 size="sm"
 className="flex-1 gap-1.5"
 onClick={onToggle}
 disabled={isProcessing || plugin.status === 'error'}
 >
 {isProcessing ? (
 <Loader2 className="h-3.5 w-3.5 animate-spin" />
 ) : plugin.enabled ? (
 <>
 <PowerOff className="h-3.5 w-3.5" />
 Disable
 </>
 ) : (
 <>
 <Power className="h-3.5 w-3.5" />
 Enable
 </>
 )}
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={onReload}
 disabled={isProcessing}
 title="Reload"
 >
 <RefreshCw className="h-3.5 w-3.5" />
 </Button>
 <Button
 variant="outline"
 size="sm"
 onClick={onSettings}
 title="Settings"
 >
 <Settings className="h-3.5 w-3.5" />
 </Button>
 </div>
 </ServerTabCard>
 );
}

// ── Plugin Settings Modal ──
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
 refetchInterval: 10000,
 });

 const manifestSchema = pluginDetails?.configSchema ?? {};
 const runtimeValues = pluginDetails?.config ?? {};
 const config = localConfig ?? (Object.keys(manifestSchema).length > 0 ? manifestSchema : runtimeValues);

 const handleConfigChange = (key: string, value: any) => {
 setLocalConfig((prev) => ({ ...(prev ?? config), [key]: value }));
 };

 useEffect(() => {
 if (open) {
 setLocalConfig(null);
 }
 }, [open]);

 const updateMutation = useMutation({
 mutationFn: (newConfig: PluginConfig) => updatePluginConfig(pluginName, newConfig),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminPlugins() });
 queryClient.invalidateQueries({ queryKey: qk.adminPlugin(pluginName) });
 toast.success('Plugin configuration updated');
 onOpenChange(false);
 },
 onError: (error: any) => toast.error(error.message || 'Failed to update configuration'),
 });

 type ConfigSchemaEntry = { type: string; default?: any; description?: string; label?: string; options?: any[] };
 function isConfigSchema(v: any): v is ConfigSchemaEntry {
 return v && typeof v === 'object' && typeof v.type === 'string';
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

 if (!open) return null;

 return (
 <ModalPortal>
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm px-4">
 <div className="mx-4 w-full max-w-lg rounded-xl border border-border bg-card shadow-xl">
 <div className="border-b border-border/50 px-6 py-4">
 <div className="flex items-center gap-2.5">
 <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
 <Settings className="h-4 w-4 text-primary" />
 </div>
 <div>
 <h2 className="text-sm font-semibold text-foreground">Plugin Settings</h2>
 <p className="text-[11px] text-muted-foreground">
 Configure <span className="font-medium text-foreground">{pluginDetails?.displayName}</span>
 </p>
 </div>
 </div>
 </div>

 <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
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
 const selectOptions = schema ? (schema.options || []) : [];

 const runtimeOverride = runtimeValues[key];
 const isRuntimeObject = runtimeOverride !== undefined && !isConfigSchema(runtimeOverride);
 const effectiveValue = isRuntimeObject ? runtimeOverride : currentValue;

 return (
 <div key={key} className="space-y-1.5">
 <label className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/50">{label}</label>
 {description && (
 <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
 )}
 {fieldType === 'boolean' ? (
 <label className="flex items-center gap-2 cursor-pointer pt-1">
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
 const selected = selectOptions.find((o: any) => String(o.value) === e.target.value);
 const newVal = selected ? selected.value : e.target.value;
 handleConfigChange(key, schema
 ? { ...(value as Record<string, any>), default: newVal }
 : newVal);
 }}
 className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
 >
 {selectOptions.map((opt: any) => (
 <option key={String(opt.value)} value={String(opt.value)}>
 {opt.label || opt.value}
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
 className="flex min-h-[80px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none"
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
 </div>

 <div className="flex items-center justify-end gap-2 border-t border-border/50 px-6 py-3">
 <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
 <Button
 size="sm"
 onClick={() => updateMutation.mutate(buildSaveConfig())}
 disabled={updateMutation.isPending}
 >
 {updateMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
 Save Changes
 </Button>
 </div>
 </div>
 </div>
 </ModalPortal>
 );
}

// ── Main Page ──
export default function PluginsPage() {
 const { reloadPlugins } = usePluginContext();
 const [processingPlugin, setProcessingPlugin] = useState<string | null>(null);
 const [settingsPlugin, setSettingsPlugin] = useState<string | null>(null);

 const { data: plugins, isLoading } = useQuery({
 queryKey: ['admin-plugins'],
 queryFn: fetchPlugins,
 refetchInterval: 15000,
 });

 const toggleMutation = useMutation({
 mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => togglePlugin(name, enabled),
 onMutate: ({ name }) => setProcessingPlugin(name),
 onSuccess: (_, { enabled }) => {
 queryClient.invalidateQueries({ queryKey: ['admin-plugins'] });
 reloadPlugins();
 toast.success(`Plugin ${enabled ? 'enabled' : 'disabled'} successfully`);
 },
 onError: (error: any) => toast.error(error.message || 'Failed to toggle plugin'),
 onSettled: () => setProcessingPlugin(null),
 });

 const reloadMutation = useMutation({
 mutationFn: (name: string) => reloadPlugin(name),
 onMutate: (name) => setProcessingPlugin(name),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['admin-plugins'] });
 reloadPlugins();
 toast.success('Plugin reloaded successfully');
 },
 onError: (error: any) => toast.error(error.message || 'Failed to reload plugin'),
 onSettled: () => setProcessingPlugin(null),
 });

 const enabledCount = plugins?.filter((p) => p.enabled).length ?? 0;
 const totalCount = plugins?.length ?? 0;

 return (
 <div className="space-y-5">
 {/* ── Header ── */}
 <TabHeader
 icon={Puzzle}
 title="Plugins"
 description="Manage and configure installed plugins"
 actions={
 <div className="flex items-center gap-2">
 <Badge variant="outline" className="text-[11px]">
 {totalCount} installed
 </Badge>
 <Badge variant="secondary" className="text-[11px]">
 {enabledCount} enabled
 </Badge>
 </div>
 }
 />

 {/* ── Plugin Grid ── */}
 {isLoading ? (
 <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
 {[1, 2, 3].map((i) => (
 <div key={i} className="rounded-xl border border-border bg-card p-5">
 <div className="flex items-start gap-3">
 <div className="h-10 w-10 animate-pulse rounded-lg bg-surface-3" />
 <div className="flex-1 space-y-2">
 <div className="h-4 w-28 animate-pulse rounded bg-surface-3" />
 <div className="h-3 w-40 animate-pulse rounded bg-surface-2 font-mono" />
 <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
 </div>
 </div>
 <div className="mt-4 flex gap-2">
 <div className="h-8 w-24 animate-pulse rounded-md bg-surface-2" />
 <div className="h-8 w-8 animate-pulse rounded-md bg-surface-2" />
 <div className="h-8 w-8 animate-pulse rounded-md bg-surface-2" />
 </div>
 </div>
 ))}
 </div>
 ) : !plugins || plugins.length === 0 ? (
 <TabEmptyState
 title="No Plugins Installed"
 description="Place plugins in the catalyst-plugins/ directory to get started."
 />
 ) : (
 <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
 {plugins.map((plugin) => (
 <PluginCard
 key={plugin.name}
 plugin={plugin}
 isProcessing={processingPlugin === plugin.name}
 onToggle={() => toggleMutation.mutate({ name: plugin.name, enabled: !plugin.enabled })}
 onReload={() => reloadMutation.mutate(plugin.name)}
 onSettings={() => setSettingsPlugin(plugin.name)}
 />
 ))}
 </div>
 )}

 {/* ── Settings Modal ── */}
 <PluginSettingsModal
 pluginName={settingsPlugin ?? ''}
 open={!!settingsPlugin}
 onOpenChange={(open) => !open && setSettingsPlugin(null)}
 />
 </div>
 );
}
