const MOD_PROVIDERS = ['curseforge', 'modrinth'] as const;
const PLUGIN_PROVIDERS = ['spigot', 'paper', 'modrinth'] as const;

export type ProviderId = string;

/** Extract an array of plain provider IDs from a template's provider list.
 *  Template providers can be simple strings or detailed objects with an `id` field. */
export function extractProviderIds(providers?: unknown[]): string[] {
  if (!Array.isArray(providers)) return [];
  return providers
    .map((p) => (typeof p === 'string' ? p : (p as Record<string, unknown>)?.id))
    .filter((id): id is string => typeof id === 'string');
}

export interface TemplateProviderEditorProps {
  modManagerEnabled: boolean;
  onModManagerEnabledChange: (v: boolean) => void;
  modProviders: string[];
  onModProvidersChange: (v: string[]) => void;
  pluginManagerEnabled: boolean;
  onPluginManagerEnabledChange: (v: boolean) => void;
  pluginProviders: string[];
  onPluginProvidersChange: (v: string[]) => void;
}

function TemplateProviderEditor({
  modManagerEnabled,
  onModManagerEnabledChange,
  modProviders,
  onModProvidersChange,
  pluginManagerEnabled,
  onPluginManagerEnabledChange,
  pluginProviders,
  onPluginProvidersChange,
}: TemplateProviderEditorProps) {
  const toggleModProvider = (id: string) => {
    if (modProviders.includes(id)) {
      onModProvidersChange(modProviders.filter((p) => p !== id));
    } else {
      onModProvidersChange([...modProviders, id]);
    }
  };

  const togglePluginProvider = (id: string) => {
    if (pluginProviders.includes(id)) {
      onPluginProvidersChange(pluginProviders.filter((p) => p !== id));
    } else {
      onPluginProvidersChange([...pluginProviders, id]);
    }
  };

  const pillBase =
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-200 select-none';

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-surface-2 p-4 transition-all duration-300 dark:border-border dark:bg-surface-1/40">
      <div className="text-sm font-semibold text-foreground dark:text-zinc-200">
        Mod &amp; Plugin Providers
      </div>

      {/* ── Mod Manager ── */}
      <div className="space-y-2 rounded-lg border border-border bg-white p-3 transition-all duration-300 dark:border-border dark:bg-zinc-950/40">
        <button
          type="button"
          onClick={() => onModManagerEnabledChange(!modManagerEnabled)}
          className={`${pillBase} ${
            modManagerEnabled
              ? 'border-primary-500 bg-primary-600 text-white shadow-sm shadow-primary-500/25'
              : 'border-border bg-white text-muted-foreground hover:border-primary-500 hover:text-foreground dark:border-border dark:bg-surface-1 dark:text-zinc-300'
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              modManagerEnabled ? 'bg-white' : 'bg-muted-foreground dark:bg-zinc-500'
            }`}
          />
          Mod Manager
        </button>

        {modManagerEnabled && (
          <div className="flex flex-wrap gap-2 pt-1">
            {MOD_PROVIDERS.map((id) => {
              const active = modProviders.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleModProvider(id)}
                  className={`${pillBase} ${
                    active
                      ? 'border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300'
                      : 'border-border bg-white text-muted-foreground hover:border-primary-500 hover:text-foreground dark:border-border dark:bg-surface-1 dark:text-zinc-400'
                  }`}
                >
                  {id}
                </button>
              );
            })}
            {modProviders.length === 0 && (
              <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                Select at least one provider.
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Plugin Manager ── */}
      <div className="space-y-2 rounded-lg border border-border bg-white p-3 transition-all duration-300 dark:border-border dark:bg-zinc-950/40">
        <button
          type="button"
          onClick={() => onPluginManagerEnabledChange(!pluginManagerEnabled)}
          className={`${pillBase} ${
            pluginManagerEnabled
              ? 'border-primary-500 bg-primary-600 text-white shadow-sm shadow-primary-500/25'
              : 'border-border bg-white text-muted-foreground hover:border-primary-500 hover:text-foreground dark:border-border dark:bg-surface-1 dark:text-zinc-300'
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              pluginManagerEnabled ? 'bg-white' : 'bg-muted-foreground dark:bg-zinc-500'
            }`}
          />
          Plugin Manager
        </button>

        {pluginManagerEnabled && (
          <div className="flex flex-wrap gap-2 pt-1">
            {PLUGIN_PROVIDERS.map((id) => {
              const active = pluginProviders.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => togglePluginProvider(id)}
                  className={`${pillBase} ${
                    active
                      ? 'border-primary-400 bg-primary-50 text-primary-700 dark:border-primary-500/40 dark:bg-primary-500/10 dark:text-primary-300'
                      : 'border-border bg-white text-muted-foreground hover:border-primary-500 hover:text-foreground dark:border-border dark:bg-surface-1 dark:text-zinc-400'
                  }`}
                >
                  {id}
                </button>
              );
            })}
            {pluginProviders.length === 0 && (
              <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                Select at least one provider.
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TemplateProviderEditor;
