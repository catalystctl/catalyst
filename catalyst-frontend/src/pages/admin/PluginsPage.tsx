import { useState } from 'react';
import { useQuery, useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import {
  Puzzle,
  RefreshCw,
  Settings,
  Loader2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchPlugins, togglePlugin, reloadPlugin, fetchPluginDetails, updatePluginConfig } from '../../plugins/api';
import { toast } from 'sonner';
import { usePluginContext } from '../../plugins/usePluginContext';
import type { PluginManifest } from '../../plugins/types';
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
    <div className="flex flex-wrap items-center gap-3 border-b border-border/40 py-3 last:border-0">
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
          <span className="type-meta font-mono">{plugin.name}@{plugin.version}</span>
        </div>
        {plugin.error && <p className="mt-0.5 text-[11px] text-danger">{plugin.error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          variant={plugin.enabled ? 'outline' : 'default'}
          size="sm"
          onClick={onToggle}
          disabled={isProcessing || plugin.status === 'error'}
        >
          {isProcessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : plugin.enabled ? 'Disable' : 'Enable'}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onReload} disabled={isProcessing} aria-label="Reload">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onSettings} aria-label="Settings">
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
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

// ── Main Page ──
export default function PluginsPage() {
 const { reloadPlugins } = usePluginContext();
 const [processingPlugin, setProcessingPlugin] = useState<string | null>(null);
 const [settingsPlugin, setSettingsPlugin] = useState<string | null>(null);

 const { data: plugins, isLoading } = useQuery({
 queryKey: qk.adminPlugins(),
 queryFn: fetchPlugins,
 staleTime: 60_000,
 });

 const toggleMutation = useMutation({
 mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => togglePlugin(name, enabled),
 onMutate: ({ name }) => setProcessingPlugin(name),
 onSuccess: (_, { enabled }) => {
 reloadPlugins();
 toast.success(`Plugin ${enabled ? 'enabled' : 'disabled'} successfully`);
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminPlugins() });
 setProcessingPlugin(null);
 },
 onError: (error: any) => toast.error(error.message || 'Failed to toggle plugin'),
 });

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
          <ServerTabCard>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-md bg-surface-2" />
              ))}
            </div>
          </ServerTabCard>
        ) : !plugins || plugins.length === 0 ? (
          <TabEmptyState
            title="No plugins"
            description="Place plugins in catalyst-plugins/."
          />
        ) : (
          <ServerTabCard>
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
          </ServerTabCard>
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
