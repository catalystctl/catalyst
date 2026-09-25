import { useTranslation } from 'react-i18next';
import { StatusLed } from '../deck/primitives';
import { cn } from '@/lib/utils';

const MOD_PROVIDERS = ['curseforge', 'modrinth'] as const;
const PLUGIN_PROVIDERS = ['spigot', 'paper', 'modrinth'] as const;

export type ProviderId = string;

/** Extract an array of plain provider IDs from a template's provider list.
 * Template providers can be simple strings or detailed objects with an `id` field. */
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
  const { t } = useTranslation('templates');

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

  const toggleBase =
    'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-mini font-medium transition-colors select-none';

  return (
    <div className="space-y-3 rounded-sm border border-border/50 p-3">
      <div className="type-overline">
        {t('provider.title')}
      </div>

      {/* ── Mod Manager ── */}
      <div className="space-y-2 border-t border-border/50 pt-3">
        <button
          type="button"
          onClick={() => onModManagerEnabledChange(!modManagerEnabled)}
          className={cn(
            toggleBase,
            modManagerEnabled
              ? 'border-primary/60 bg-primary/10 text-foreground'
              : 'border-border/60 text-muted-foreground hover:text-foreground',
          )}
        >
          <StatusLed tone={modManagerEnabled ? 'go' : 'idle'} />
          {t('provider.modManager')}
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
                  className={cn(
                    toggleBase,
                    'font-mono tabular-nums',
                    active
                      ? 'border-primary/60 bg-primary/10 text-foreground'
                      : 'border-border/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {id}
                </button>
              );
            })}
            {modProviders.length === 0 && (
              <span className="type-overline">
                {t('provider.selectOne')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Plugin Manager ── */}
      <div className="space-y-2 border-t border-border/50 pt-3">
        <button
          type="button"
          onClick={() => onPluginManagerEnabledChange(!pluginManagerEnabled)}
          className={cn(
            toggleBase,
            pluginManagerEnabled
              ? 'border-primary/60 bg-primary/10 text-foreground'
              : 'border-border/60 text-muted-foreground hover:text-foreground',
          )}
        >
          <StatusLed tone={pluginManagerEnabled ? 'go' : 'idle'} />
          {t('provider.pluginManager')}
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
                  className={cn(
                    toggleBase,
                    'font-mono tabular-nums',
                    active
                      ? 'border-primary/60 bg-primary/10 text-foreground'
                      : 'border-border/60 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {id}
                </button>
              );
            })}
            {pluginProviders.length === 0 && (
              <span className="type-overline">
                {t('provider.selectOne')}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TemplateProviderEditor;
