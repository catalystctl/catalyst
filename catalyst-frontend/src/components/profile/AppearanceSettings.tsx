import { Moon, Palette, RotateCcw, Sun, Monitor, LayoutTemplate } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import ServerTabCard from '../servers/tabs/ServerTabCard';
import SectionHeader from '../servers/tabs/SectionHeader';
import LanguageSwitcher from '../shared/LanguageSwitcher';
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
      <label className="type-overline">{label}</label>
      <div className="flex items-center gap-2">
        <div className="relative flex-shrink-0">
          <div
            className="h-8 w-8 cursor-pointer rounded-sm ring-1 ring-border/60"
            style={{ backgroundColor: isValid ? value : fallback }}
          />
          <input
            type="color"
            value={isValid ? value : fallback}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer rounded-sm opacity-0"
          />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallback}
          className="h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 font-mono text-mini tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40"
        />
      </div>
    </div>
  );
}

export default function AppearanceSettings() {
  const { t } = useTranslation('profile');
  const themePreference = useThemeStore((s) => s.themePreference);
  const setThemePreference = useThemeStore((s) => s.setThemePreference);
  const personalColors = useThemeStore((s) => s.personalColors);
  const setPersonalColors = useThemeStore((s) => s.setPersonalColors);
  const clearPersonalTheme = useThemeStore((s) => s.clearPersonalTheme);
  const themeSettings = useThemeStore((s) => s.themeSettings);

  const panelPrimary = themeSettings?.primaryColor || '#c48d5a';
  const panelSecondary = themeSettings?.secondaryColor || '#8b5cf6';
  const panelAccent = themeSettings?.accentColor || '#06b6d4';
  const panelDefault = themeSettings?.defaultTheme || 'dark';

  const primary = personalColors?.primaryColor || panelPrimary;
  const secondary = personalColors?.secondaryColor || panelSecondary;
  const accent = personalColors?.accentColor || panelAccent;
  const hasCustom = Boolean(personalColors);

  const modes: { id: ThemePreference; label: string; icon: typeof Sun; hint: string }[] = [
    { id: 'panel', label: t('appearance.panelDefault'), icon: LayoutTemplate, hint: t('appearance.panelDefaultHint', { panelDefault }) },
    { id: 'light', label: t('appearance.light'), icon: Sun, hint: t('appearance.lightHint') },
    { id: 'dark', label: t('appearance.dark'), icon: Moon, hint: t('appearance.darkHint') },
    { id: 'system', label: t('appearance.system'), icon: Monitor, hint: t('appearance.systemHint') },
  ];

  return (
    <ServerTabCard>
      <SectionHeader icon={Palette} title={t('appearance.title')} description={t('appearance.description')} />
      <div className="space-y-5">
        <div>
          <p className="type-overline mb-2">{t('appearance.themeMode')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {modes.map(({ id, label, icon: Icon, hint }) => {
              const active = (themePreference || 'panel') === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setThemePreference(id)}
                  title={hint}
                  className={`flex flex-col items-center gap-1 rounded-sm border px-2 py-2 text-mini transition-colors ${
                    active
                      ? 'border-primary/60 bg-primary/5 text-foreground'
                      : 'border-border/60 text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="font-medium">{label}</span>
                  <span className="text-micro opacity-70">{hint}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="type-overline">{t('appearance.accentColors')}</p>
            {hasCustom && (
              <button
                type="button"
                onClick={clearPersonalTheme}
                className="flex h-7 items-center gap-1 rounded-sm px-2 text-mini text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                {t('appearance.panelDefaults')}
              </button>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <PersonalColorField
              label={t('appearance.primary')}
              value={primary}
              fallback={panelPrimary}
              onChange={(v) => setPersonalColors({ ...personalColors, primaryColor: v })}
            />
            <PersonalColorField
              label={t('appearance.secondary')}
              value={secondary}
              fallback={panelSecondary}
              onChange={(v) => setPersonalColors({ ...personalColors, secondaryColor: v })}
            />
            <PersonalColorField
              label={t('appearance.accent')}
              value={accent}
              fallback={panelAccent}
              onChange={(v) => setPersonalColors({ ...personalColors, accentColor: v })}
            />
          </div>
          <div className="mt-3 flex gap-1.5">
            {[primary, secondary, accent].map((c, i) => (
              <div key={i} className="h-5 flex-1 rounded-sm ring-1 ring-border/60" style={{ backgroundColor: c }} />
            ))}
          </div>
          <p className="type-meta mt-2">
            {hasCustom ? t('appearance.usingCustom') : t('appearance.usingDefaults')} {t('appearance.changesApplyInstantly')}
          </p>
        </div>

        <div>
          <p className="type-overline mb-2">{t('common:language.label')}</p>
          <div className="max-w-xs">
            <LanguageSwitcher />
          </div>
          <p className="type-meta mt-2">{t('common:language.description')}</p>
        </div>
      </div>
    </ServerTabCard>
  );
}
