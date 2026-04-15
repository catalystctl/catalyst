import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, type Variants } from 'framer-motion';
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
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchPlugins, togglePlugin, reloadPlugin, fetchPluginDetails, updatePluginConfig } from '../../plugins/api';
import { toast } from 'sonner';
import { usePluginContext } from '../../plugins/PluginProvider';
import type { PluginManifest } from '../../plugins/types';
import EmptyState from '../../components/shared/EmptyState';

// ── Animation Variants ──
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 24 } },
};

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
  index,
}: {
  plugin: PluginManifest;
  isProcessing: boolean;
  onToggle: () => void;
  onReload: () => void;
  onSettings: () => void;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 24, delay: index * 0.04 }}
      className="group relative overflow-hidden rounded-xl border border-border bg-card/80 p-5 backdrop-blur-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
            plugin.enabled
              ? 'bg-emerald-100 dark:bg-emerald-900/30'
              : plugin.error
              ? 'bg-rose-100 dark:bg-rose-900/30'
              : 'bg-surface-3 dark:bg-surface-2'
          }`}>
            <Puzzle className={`h-5 w-5 ${
              plugin.enabled
                ? 'text-emerald-600 dark:text-emerald-400'
                : plugin.error
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-muted-foreground'
            }`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-foreground dark:text-zinc-100">{plugin.displayName}</span>
              <Badge variant={statusBadgeVariant(plugin.status, plugin.error)} className="text-[10px]">
                {statusText(plugin.status)}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground font-mono">{plugin.name}@v{plugin.version}</p>
          </div>
        </div>
      </div>

      {/* Description */}
      {plugin.description && (
        <p className="mt-3 text-sm text-muted-foreground line-clamp-2">{plugin.description}</p>
      )}

      {/* Error */}
      {plugin.error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-300/40 bg-rose-50 p-2.5 dark:border-rose-500/20 dark:bg-rose-900/15">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
          <p className="text-xs text-rose-700 dark:text-rose-400">{plugin.error}</p>
        </div>
      )}

      {/* Meta */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
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
          <Badge variant="secondary" className="flex items-center gap-1 text-[10px]">
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
    </motion.div>
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
  const queryClient = useQueryClient();
  const [localConfig, setLocalConfig] = useState<PluginConfig | null>(null);

  const { data: pluginDetails, isLoading } = useQuery({
    queryKey: ['plugin', pluginName],
    queryFn: () => fetchPluginDetails(pluginName),
    enabled: open,
  });

  // Use pluginDetails config as base, but allow local edits to override
  const config = localConfig ?? pluginDetails?.config ?? {};

  const handleConfigChange = (key: string, value: any) => {
    setLocalConfig((prev) => ({ ...(prev ?? config), [key]: value }));
  };

  // Reset local edits when modal reopens
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting form on modal open
      setLocalConfig(null);
    }
  }, [open]);

  const updateMutation = useMutation({
    mutationFn: (newConfig: PluginConfig) => updatePluginConfig(pluginName, newConfig),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      queryClient.invalidateQueries({ queryKey: ['plugin', pluginName] });
      toast.success('Plugin configuration updated');
      onOpenChange(false);
    },
    onError: (error: any) => toast.error(error.message || 'Failed to update configuration'),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        className="mx-4 w-full max-w-lg rounded-xl border border-border bg-card shadow-xl"
      >
        <div className="border-b border-border/50 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/30">
              <Settings className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground dark:text-white">Plugin Settings</h2>
              <p className="text-xs text-muted-foreground">
                Configure <span className="font-medium text-foreground dark:text-zinc-100">{pluginDetails?.displayName}</span>
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
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
                const isSchema = value && typeof value === 'object' && 'type' in value;
                const fieldType = isSchema ? value.type : typeof value;
                const currentValue = isSchema ? value.default : value;
                const description = isSchema ? value.description : '';
                const displayKey = isSchema
                  ? key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
                  : key;

                return (
                  <label key={key} className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">{displayKey}</span>
                    {description && (
                      <p className="text-[11px] text-muted-foreground">{description}</p>
                    )}
                    {fieldType === 'boolean' ? (
                      <label className="flex items-center gap-2 cursor-pointer pt-1">
                        <input
                          type="checkbox"
                          checked={!!currentValue}
                          onChange={(e) =>
                            handleConfigChange(key, isSchema
                              ? { ...value, default: e.target.checked }
                              : e.target.checked)
                          }
                          className="h-4 w-4 rounded border-border bg-white text-primary-600 dark:border-zinc-600 dark:bg-surface-1 dark:text-primary-400"
                        />
                        <span className="text-sm text-muted-foreground">
                          {currentValue ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    ) : fieldType === 'number' ? (
                      <Input
                        type="number"
                        value={currentValue ?? ''}
                        onChange={(e) =>
                          handleConfigChange(key, isSchema
                            ? { ...value, default: parseFloat(e.target.value) || 0 }
                            : parseFloat(e.target.value) || 0)
                        }
                      />
                    ) : (
                      <Input
                        value={String(currentValue ?? '')}
                        onChange={(e) =>
                          handleConfigChange(key, isSchema
                            ? { ...value, default: e.target.value }
                            : e.target.value)
                        }
                      />
                    )}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-6 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => updateMutation.mutate(config)}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Main Page ──
export default function PluginsPage() {
  const queryClient = useQueryClient();
  const { reloadPlugins } = usePluginContext();
  const [processingPlugin, setProcessingPlugin] = useState<string | null>(null);
  const [settingsPlugin, setSettingsPlugin] = useState<string | null>(null);

  const { data: plugins, isLoading } = useQuery({
    queryKey: ['plugins'],
    queryFn: fetchPlugins,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) => togglePlugin(name, enabled),
    onMutate: ({ name }) => setProcessingPlugin(name),
    onSuccess: (_, { enabled }) => {
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
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
      queryClient.invalidateQueries({ queryKey: ['plugins'] });
      reloadPlugins();
      toast.success('Plugin reloaded successfully');
    },
    onError: (error: any) => toast.error(error.message || 'Failed to reload plugin'),
    onSettled: () => setProcessingPlugin(null),
  });

  return (
    <motion.div
      variants={containerVariants}
      initial={false}
      animate="visible"
      className="relative min-h-screen overflow-hidden"
    >
      {/* Ambient background */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-gradient-to-br from-violet-500/8 to-purple-500/8 blur-3xl dark:from-violet-500/15 dark:to-purple-500/15" />
        <div className="absolute bottom-0 -left-32 h-80 w-80 rounded-full bg-gradient-to-tr from-cyan-500/8 to-teal-500/8 blur-3xl dark:from-cyan-500/15 dark:to-teal-500/15" />
      </div>

      <div className="relative z-10 space-y-5">
        {/* ── Header ── */}
        <motion.div variants={itemVariants} className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-1 rounded-lg bg-gradient-to-r from-violet-500 to-purple-500 opacity-20 blur-sm" />
                <Puzzle className="relative h-7 w-7 text-violet-600 dark:text-violet-400" />
              </div>
              <h1 className="font-display text-3xl font-bold tracking-tight text-foreground dark:text-white">
                Plugins
              </h1>
            </div>
            <p className="ml-10 text-sm text-muted-foreground">
              Manage and configure installed plugins.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {plugins?.length ?? 0} installed
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {plugins?.filter((p) => p.enabled).length ?? 0} enabled
            </Badge>
          </div>
        </motion.div>

        {/* ── Plugin Grid ── */}
        {isLoading ? (
          <motion.div variants={itemVariants} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card/80 p-5">
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
          </motion.div>
        ) : !plugins || plugins.length === 0 ? (
          <motion.div variants={itemVariants}>
            <EmptyState
              title="No Plugins Installed"
              description="Place plugins in the catalyst-plugins/ directory to get started."
            />
          </motion.div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {plugins.map((plugin, i) => (
              <PluginCard
                key={plugin.name}
                plugin={plugin}
                index={i}
                isProcessing={processingPlugin === plugin.name}
                onToggle={() => toggleMutation.mutate({ name: plugin.name, enabled: !plugin.enabled })}
                onReload={() => reloadMutation.mutate(plugin.name)}
                onSettings={() => setSettingsPlugin(plugin.name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Settings Modal ── */}
      <PluginSettingsModal
        pluginName={settingsPlugin ?? ''}
        open={!!settingsPlugin}
        onOpenChange={(open) => !open && setSettingsPlugin(null)}
      />
    </motion.div>
  );
}
