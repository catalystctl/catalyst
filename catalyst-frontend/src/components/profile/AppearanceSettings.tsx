import { Moon, Palette, RotateCcw, Sun, Monitor, LayoutTemplate } from 'lucide-react';
import ServerTabCard from '../servers/tabs/ServerTabCard';
import SectionHeader from '../servers/tabs/SectionHeader';
import { useThemeStore, type ThemePreference } from '../../stores/themeStore';

function PersonalColorField({
  label,
  value,
  fallback,
  onChange,
}: {
  label: string;
  value: string;
  fallback: string;
  onChange: (v: string) => void;
}) {
  const isValid = /^#[0-9A-Fa-f]{6}$/.test(value);
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <div className="relative flex-shrink-0">
          <div
            className="h-9 w-9 cursor-pointer rounded-lg ring-1 ring-black/10"
            style={{ backgroundColor: isValid ? value : fallback }}
          />
          <input
            type="color"
            value={isValid ? value : fallback}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer rounded-lg opacity-0"
          />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          className="w-full rounded-lg border border-border/40 bg-card px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
      </div>
    </div>
  );
}

export default function AppearanceSettings() {
  const themePreference = useThemeStore((s) => s.themePreference);
  const setThemePreference = useThemeStore((s) => s.setThemePreference);
  const personalColors = useThemeStore((s) => s.personalColors);
  const setPersonalColors = useThemeStore((s) => s.setPersonalColors);
  const clearPersonalTheme = useThemeStore((s) => s.clearPersonalTheme);
  const themeSettings = useThemeStore((s) => s.themeSettings);

  const panelPrimary = themeSettings?.primaryColor || '#0d9488';
  const panelSecondary = themeSettings?.secondaryColor || '#8b5cf6';
  const panelAccent = themeSettings?.accentColor || '#06b6d4';
  const panelDefault = themeSettings?.defaultTheme || 'dark';

  const primary = personalColors?.primaryColor || panelPrimary;
  const secondary = personalColors?.secondaryColor || panelSecondary;
  const accent = personalColors?.accentColor || panelAccent;
  const hasCustom = Boolean(personalColors);

  const modes: { id: ThemePreference; label: string; icon: typeof Sun; hint: string }[] = [
    { id: 'panel', label: 'Panel default', icon: LayoutTemplate, hint: `Follows admin (${panelDefault})` },
    { id: 'light', label: 'Light', icon: Sun, hint: 'Always light' },
    { id: 'dark', label: 'Dark', icon: Moon, hint: 'Always dark' },
    { id: 'system', label: 'System', icon: Monitor, hint: 'Follows OS' },
  ];

  return (
    <ServerTabCard>
      <SectionHeader icon={Palette} title="Appearance" description="Your personal theme for this browser — never affects other users" />
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-medium text-foreground">Theme mode</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {modes.map(({ id, label, icon: Icon, hint }) => {
              const active = (themePreference || 'panel') === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setThemePreference(id)}
                  title={hint}
                  className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs transition-all ${
                    active
                      ? 'border-primary bg-primary/5 text-foreground'
                      : 'border-border/30 text-muted-foreground hover:border-primary/30 hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{label}</span>
                  <span className="text-[10px] opacity-70">{hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium text-foreground">Accent colors</p>
            {hasCustom && (
              <button
                type="button"
                onClick={clearPersonalTheme}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                Panel defaults
              </button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <PersonalColorField
              label="Primary"
              value={primary}
              fallback={panelPrimary}
              onChange={(v) => setPersonalColors({ ...personalColors, primaryColor: v })}
            />
            <PersonalColorField
              label="Secondary"
              value={secondary}
              fallback={panelSecondary}
              onChange={(v) => setPersonalColors({ ...personalColors, secondaryColor: v })}
            />
            <PersonalColorField
              label="Accent"
              value={accent}
              fallback={panelAccent}
              onChange={(v) => setPersonalColors({ ...personalColors, accentColor: v })}
            />
          </div>
          <div className="mt-3 flex gap-1.5">
            {[primary, secondary, accent].map((c, i) => (
              <div key={i} className="h-6 flex-1 rounded-md ring-1 ring-black/10" style={{ backgroundColor: c }} />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {hasCustom ? 'Using your colors in this browser.' : 'Currently using the panel defaults.'} Changes apply instantly.
          </p>
        </div>
      </div>
    </ServerTabCard>
  );
}
