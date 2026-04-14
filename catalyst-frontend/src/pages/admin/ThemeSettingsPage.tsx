import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useThemeSettings } from '../../hooks/useAdmin';
import { adminApi } from '../../services/api/admin';
import { useThemeStore, defaultThemeColors } from '../../stores/themeStore';
import type { ThemeColors } from '../../services/api/theme';
import {
  Palette,
  Type,
  Sun,
  Moon,
  Layers,
  Layout,
  Code2,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronRight,
  Save,
  SwatchBook,
  Shield,
  AlertTriangle,
  Info,
} from 'lucide-react';

// ─── Default color values matching the Obsidian design system ───

const DEFAULTS = {
  primaryColor: '#0d9488',
  secondaryColor: '#8b5cf6',
  accentColor: '#06b6d4',
  themeColors: { ...defaultThemeColors } satisfies ThemeColors,
};

// ─── Shared UI Components ───

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-surface-light dark:border-zinc-800 dark:bg-surface-1 dark:shadow-surface-dark">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-surface-2"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
          </div>
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-zinc-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-zinc-400" />
        )}
      </button>
      {open && <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800">{children}</div>}
    </div>
  );
}

function ColorPicker({
  label,
  description,
  value,
  onChange,
  icon: Icon,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const isValid = /^#[0-9A-Fa-f]{6}$/.test(value);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-zinc-400" />}
        <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</label>
      </div>
      {description && <p className="text-[11px] text-zinc-400 dark:text-zinc-500">{description}</p>}
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            type="color"
            value={isValid ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-lg border border-zinc-200 bg-transparent p-0.5 transition-colors hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
          />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className={`flex-1 rounded-lg border bg-white px-3 py-1.5 font-mono text-xs transition-colors focus:outline-none focus:ring-2 dark:bg-surface-2 ${
            isValid
              ? 'border-zinc-200 text-zinc-800 focus:border-primary focus:ring-primary/20 dark:border-zinc-700 dark:text-zinc-200'
              : 'border-red-300 text-red-600 focus:border-red-400 focus:ring-red-400/20 dark:border-red-800 dark:text-red-400'
          }`}
        />
        <div
          className="h-9 w-9 flex-shrink-0 rounded-lg border border-zinc-200 shadow-inner dark:border-zinc-700"
          style={{ backgroundColor: isValid ? value : 'transparent' }}
        />
      </div>
    </div>
  );
}

// ─── Main Page ───

function ThemeSettingsPage() {
  const { data: settings, isLoading } = useThemeSettings();
  const queryClient = useQueryClient();
  const { setThemeSettings: applyThemeSettings, applyTheme, previewColors, cancelPreview } = useThemeStore();

  // ── Branding ──
  const [panelName, setPanelName] = useState('Catalyst');
  const [logoUrl, setLogoUrl] = useState('');
  const [faviconUrl, setFaviconUrl] = useState('');

  // ── Theme Mode ──
  const [defaultTheme, setDefaultTheme] = useState('dark');
  const [enabledThemes, setEnabledThemes] = useState<string[]>(['light', 'dark']);

  // ── Brand Colors ──
  const [primaryColor, setPrimaryColor] = useState(DEFAULTS.primaryColor);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULTS.secondaryColor);
  const [accentColor, setAccentColor] = useState(DEFAULTS.accentColor);

  // ── Extended Theme Colors ──
  const [themeColors, setThemeColors] = useState<ThemeColors>({ ...DEFAULTS.themeColors });

  // ── Custom CSS ──
  const [customCss, setCustomCss] = useState('');

  // ── Helper: push current form state to the live DOM preview ──
  // Uses explicit values (not closures) so it's always in sync.
  const pushPreview = (
    overrides: {
      primaryColor?: string;
      accentColor?: string;
      themeColors?: ThemeColors;
    } = {},
  ) => {
    previewColors({
      primaryColor: overrides.primaryColor ?? primaryColor,
      accentColor: overrides.accentColor ?? accentColor,
      themeColors: overrides.themeColors ?? themeColors,
    });
  };

  // ── Initialize form from server response ──
  useEffect(() => {
    if (!settings) return;

    // Admin API returns the raw Prisma record — theme colors live inside metadata.
    const savedColors = (settings.metadata as any)?.themeColors as ThemeColors | undefined;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- initializing form from async data
    setPanelName(settings.panelName || 'Catalyst');
    setLogoUrl(settings.logoUrl || '');
    setFaviconUrl(settings.faviconUrl || '');
    setDefaultTheme(settings.defaultTheme || 'dark');
    setEnabledThemes(settings.enabledThemes || ['light', 'dark']);
    setPrimaryColor(settings.primaryColor || DEFAULTS.primaryColor);
    setSecondaryColor(settings.secondaryColor || DEFAULTS.secondaryColor);
    setAccentColor(settings.accentColor || DEFAULTS.accentColor);
    setCustomCss(settings.customCss || '');
    setThemeColors(savedColors ? { ...DEFAULTS.themeColors, ...savedColors } : { ...DEFAULTS.themeColors });
  }, [settings]);

  // ── Update a single ThemeColor key + live-preview ──
  const updateThemeColor = (key: keyof ThemeColors, value: string) => {
    const updated = { ...themeColors, [key]: value };
    setThemeColors(updated);
    pushPreview({ themeColors: updated });
  };

  // ── Brand color handlers with live preview ──
  const handlePrimaryColorChange = (v: string) => {
    setPrimaryColor(v);
    pushPreview({ primaryColor: v });
  };

  const handleSecondaryColorChange = (v: string) => {
    setSecondaryColor(v);
    pushPreview();
  };

  const handleAccentColorChange = (v: string) => {
    setAccentColor(v);
    pushPreview({ accentColor: v });
  };

  const toggleTheme = (theme: string) => {
    if (enabledThemes.includes(theme)) {
      if (enabledThemes.length > 1) {
        setEnabledThemes(enabledThemes.filter((t) => t !== theme));
      } else {
        toast.error('At least one theme must be enabled');
      }
    } else {
      setEnabledThemes([...enabledThemes, theme]);
    }
  };

  // ── Save ──
  const updateMutation = useMutation({
    mutationFn: (payload: any) => adminApi.updateThemeSettings(payload),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-theme-settings'] });

      // Admin PATCH returns the raw Prisma record — themeColors are in metadata.
      const savedColors = (data.metadata as any)?.themeColors as ThemeColors | undefined;

      applyThemeSettings(
        {
          panelName: data.panelName,
          logoUrl: data.logoUrl,
          faviconUrl: data.faviconUrl,
          defaultTheme: data.defaultTheme,
          enabledThemes: data.enabledThemes,
          primaryColor: data.primaryColor,
          secondaryColor: data.secondaryColor,
          accentColor: data.accentColor,
          themeColors: savedColors || null,
        },
        data.customCss,
      );
      toast.success('Theme settings updated successfully');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.error || 'Failed to update theme settings');
    },
  });

  const handleSave = () => {
    const hasCustomColors = Object.entries(themeColors).some(
      ([key, val]) => val !== DEFAULTS.themeColors[key as keyof ThemeColors],
    );

    updateMutation.mutate({
      panelName: panelName.trim() || undefined,
      logoUrl: logoUrl.trim() || null,
      faviconUrl: faviconUrl.trim() || null,
      defaultTheme,
      enabledThemes,
      primaryColor,
      secondaryColor,
      accentColor,
      customCss: customCss.trim() || null,
      metadata: {
        themeColors: hasCustomColors ? themeColors : undefined,
      },
    });
  };

  // ── Reset helpers ──
  const handleResetAll = () => {
    if (!settings) return;

    const savedColors = (settings.metadata as any)?.themeColors as ThemeColors | undefined;

    setPanelName(settings.panelName || 'Catalyst');
    setLogoUrl(settings.logoUrl || '');
    setFaviconUrl(settings.faviconUrl || '');
    setDefaultTheme(settings.defaultTheme || 'dark');
    setEnabledThemes(settings.enabledThemes || ['light', 'dark']);
    setPrimaryColor(settings.primaryColor || DEFAULTS.primaryColor);
    setSecondaryColor(settings.secondaryColor || DEFAULTS.secondaryColor);
    setAccentColor(settings.accentColor || DEFAULTS.accentColor);
    setCustomCss(settings.customCss || '');
    setThemeColors(savedColors ? { ...DEFAULTS.themeColors, ...savedColors } : { ...DEFAULTS.themeColors });

    // Revert live preview to whatever is persisted on the server
    cancelPreview();
    applyTheme();
  };

  const handleResetSection = (section: 'brand' | 'semantic' | 'dark' | 'light' | 'layout') => {
    switch (section) {
      case 'brand':
        setPrimaryColor(DEFAULTS.primaryColor);
        setSecondaryColor(DEFAULTS.secondaryColor);
        setAccentColor(DEFAULTS.accentColor);
        pushPreview({
          primaryColor: DEFAULTS.primaryColor,
          accentColor: DEFAULTS.accentColor,
        });
        break;
      case 'semantic': {
        const updated = {
          ...themeColors,
          successColor: DEFAULTS.themeColors.successColor,
          warningColor: DEFAULTS.themeColors.warningColor,
          dangerColor: DEFAULTS.themeColors.dangerColor,
          infoColor: DEFAULTS.themeColors.infoColor,
        };
        setThemeColors(updated);
        pushPreview({ themeColors: updated });
        break;
      }
      case 'dark': {
        const updated = {
          ...themeColors,
          darkBackground: DEFAULTS.themeColors.darkBackground,
          darkForeground: DEFAULTS.themeColors.darkForeground,
          darkCard: DEFAULTS.themeColors.darkCard,
          darkSurface1: DEFAULTS.themeColors.darkSurface1,
          darkSurface2: DEFAULTS.themeColors.darkSurface2,
          darkSurface3: DEFAULTS.themeColors.darkSurface3,
          darkBorder: DEFAULTS.themeColors.darkBorder,
          darkMuted: DEFAULTS.themeColors.darkMuted,
        };
        setThemeColors(updated);
        pushPreview({ themeColors: updated });
        break;
      }
      case 'light': {
        const updated = {
          ...themeColors,
          lightBackground: DEFAULTS.themeColors.lightBackground,
          lightForeground: DEFAULTS.themeColors.lightForeground,
          lightCard: DEFAULTS.themeColors.lightCard,
          lightSurface1: DEFAULTS.themeColors.lightSurface1,
          lightSurface2: DEFAULTS.themeColors.lightSurface2,
          lightSurface3: DEFAULTS.themeColors.lightSurface3,
          lightBorder: DEFAULTS.themeColors.lightBorder,
          lightMuted: DEFAULTS.themeColors.lightMuted,
        };
        setThemeColors(updated);
        pushPreview({ themeColors: updated });
        break;
      }
      case 'layout': {
        const updated = {
          ...themeColors,
          borderRadius: DEFAULTS.themeColors.borderRadius,
        };
        setThemeColors(updated);
        pushPreview({ themeColors: updated });
        break;
      }
    }
  };

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-surface-light dark:border-zinc-800 dark:bg-surface-1 dark:shadow-surface-dark">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading theme settings...</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Surface color definitions ──
  const darkSurfaces: { key: keyof ThemeColors; label: string; desc: string }[] = [
    { key: 'darkBackground', label: 'Background', desc: 'Main page background' },
    { key: 'darkCard', label: 'Card', desc: 'Card and panel backgrounds' },
    { key: 'darkSurface1', label: 'Surface 1', desc: 'Elevated base layer' },
    { key: 'darkSurface2', label: 'Surface 2', desc: 'Secondary elevation' },
    { key: 'darkSurface3', label: 'Surface 3', desc: 'Tertiary elevation' },
    { key: 'darkBorder', label: 'Border', desc: 'Borders and dividers' },
    { key: 'darkForeground', label: 'Foreground', desc: 'Primary text color' },
    { key: 'darkMuted', label: 'Muted', desc: 'Secondary text and backgrounds' },
  ];

  const lightSurfaces: { key: keyof ThemeColors; label: string; desc: string }[] = [
    { key: 'lightBackground', label: 'Background', desc: 'Main page background' },
    { key: 'lightCard', label: 'Card', desc: 'Card and panel backgrounds' },
    { key: 'lightSurface1', label: 'Surface 1', desc: 'Elevated base layer' },
    { key: 'lightSurface2', label: 'Surface 2', desc: 'Secondary elevation' },
    { key: 'lightSurface3', label: 'Surface 3', desc: 'Tertiary elevation' },
    { key: 'lightBorder', label: 'Border', desc: 'Borders and dividers' },
    { key: 'lightForeground', label: 'Foreground', desc: 'Primary text color' },
    { key: 'lightMuted', label: 'Muted', desc: 'Secondary text and backgrounds' },
  ];

  return (
    <div className="space-y-5">
      {/* ── Branding ── */}
      <SectionCard
        title="Branding"
        description="Panel name, logo, and favicon"
        icon={Type}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Panel Name
            </label>
            <input
              type="text"
              value={panelName}
              onChange={(e) => setPanelName(e.target.value)}
              placeholder="Catalyst"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-surface-2 dark:text-zinc-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Logo URL
            </label>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-surface-2 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              Leave empty to use default logo. Recommended: 24×24px, SVG or PNG.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Favicon URL
            </label>
            <input
              type="text"
              value={faviconUrl}
              onChange={(e) => setFaviconUrl(e.target.value)}
              placeholder="https://example.com/favicon.ico"
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-surface-2 dark:text-zinc-100 dark:placeholder:text-zinc-500"
            />
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              Leave empty to use default favicon.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* ── Theme Mode ── */}
      <SectionCard
        title="Theme Mode"
        description="Default theme and available modes"
        icon={Layers}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Default Theme
            </label>
            <select
              value={defaultTheme}
              onChange={(e) => setDefaultTheme(e.target.value)}
              className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-surface-2 dark:text-zinc-100"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Available Themes
            </label>
            <div className="flex gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 dark:border-zinc-700 dark:has-[:checked]:bg-primary/10">
                <input
                  type="checkbox"
                  checked={enabledThemes.includes('light')}
                  onChange={() => toggleTheme('light')}
                  className="h-4 w-4 rounded border-zinc-300 text-primary focus:ring-primary/20 dark:border-zinc-600"
                />
                <Sun className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">Light</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 dark:border-zinc-700 dark:has-[:checked]:bg-primary/10">
                <input
                  type="checkbox"
                  checked={enabledThemes.includes('dark')}
                  onChange={() => toggleTheme('dark')}
                  className="h-4 w-4 rounded border-zinc-300 text-primary focus:ring-primary/20 dark:border-zinc-600"
                />
                <Moon className="h-4 w-4 text-blue-500" />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">Dark</span>
              </label>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ── Brand Colors ── */}
      <SectionCard
        title="Brand Colors"
        description="Primary, secondary, and accent palette"
        icon={SwatchBook}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <ColorPicker
              label="Primary Color"
              description="Main brand color — buttons, links, active states"
              value={primaryColor}
              onChange={handlePrimaryColorChange}
            />
            <ColorPicker
              label="Secondary Color"
              description="Supporting brand color for secondary elements"
              value={secondaryColor}
              onChange={handleSecondaryColorChange}
            />
            <ColorPicker
              label="Accent Color"
              description="Highlight color for focus rings and accents"
              value={accentColor}
              onChange={handleAccentColorChange}
            />
          </div>
          {/* Live preview strip */}
          <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Preview
            </p>
            <div className="flex gap-2">
              <div
                className="h-8 flex-1 rounded-lg shadow-sm"
                style={{ backgroundColor: primaryColor }}
                title="Primary"
              />
              <div
                className="h-8 flex-1 rounded-lg shadow-sm"
                style={{ backgroundColor: secondaryColor }}
                title="Secondary"
              />
              <div
                className="h-8 flex-1 rounded-lg shadow-sm"
                style={{ backgroundColor: accentColor }}
                title="Accent"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleResetSection('brand')}
            className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <RotateCcw className="h-3 w-3" />
            Reset brand colors
          </button>
        </div>
      </SectionCard>

      {/* ── Semantic Colors ── */}
      <SectionCard
        title="Semantic Colors"
        description="Status indicators, alerts, and feedback colors"
        icon={Palette}
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <ColorPicker
              label="Success"
              description="Positive states, confirmations"
              value={themeColors.successColor || ''}
              onChange={(v) => updateThemeColor('successColor', v)}
              icon={Check}
            />
            <ColorPicker
              label="Warning"
              description="Caution states, attention needed"
              value={themeColors.warningColor || ''}
              onChange={(v) => updateThemeColor('warningColor', v)}
              icon={AlertTriangle}
            />
            <ColorPicker
              label="Danger"
              description="Errors, destructive actions"
              value={themeColors.dangerColor || ''}
              onChange={(v) => updateThemeColor('dangerColor', v)}
              icon={Shield}
            />
            <ColorPicker
              label="Info"
              description="Informational messages, tips"
              value={themeColors.infoColor || ''}
              onChange={(v) => updateThemeColor('infoColor', v)}
              icon={Info}
            />
          </div>
          {/* Live preview */}
          <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Preview
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { color: themeColors.successColor, label: 'Success' },
                { color: themeColors.warningColor, label: 'Warning' },
                { color: themeColors.dangerColor, label: 'Danger' },
                { color: themeColors.infoColor, label: 'Info' },
              ].map(({ color, label }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: color ? `${color}18` : undefined,
                    color: color,
                  }}
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleResetSection('semantic')}
            className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <RotateCcw className="h-3 w-3" />
            Reset semantic colors
          </button>
        </div>
      </SectionCard>

      {/* ── Dark Mode Surfaces ── */}
      <SectionCard
        title="Dark Mode Surfaces"
        description="Background, card, border, and elevation colors for dark theme"
        icon={Moon}
        defaultOpen={false}
      >
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {darkSurfaces.map(({ key, label, desc }) => (
              <ColorPicker
                key={key}
                label={label}
                description={desc}
                value={(themeColors as any)[key] || ''}
                onChange={(v) => updateThemeColor(key, v)}
              />
            ))}
          </div>
          {/* Surface elevation preview */}
          <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Elevation Preview
            </p>
            <div className="flex gap-2">
              <div
                className="flex h-10 flex-1 items-center justify-center rounded-lg text-[10px] font-medium text-white"
                style={{ backgroundColor: themeColors.darkBackground }}
              >
                BG
              </div>
              <div
                className="flex h-10 flex-1 items-center justify-center rounded-lg text-[10px] font-medium text-white"
                style={{ backgroundColor: themeColors.darkSurface1 }}
              >
                S1
              </div>
              <div
                className="flex h-10 flex-1 items-center justify-center rounded-lg text-[10px] font-medium text-white"
                style={{ backgroundColor: themeColors.darkSurface2 }}
              >
                S2
              </div>
              <div
                className="flex h-10 flex-1 items-center justify-center rounded-lg text-[10px] font-medium"
                style={{ backgroundColor: themeColors.darkSurface3 }}
              >
                S3
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleResetSection('dark')}
            className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <RotateCcw className="h-3 w-3" />
            Reset dark surfaces
          </button>
        </div>
      </SectionCard>

      {/* ── Light Mode Surfaces ── */}
      <SectionCard
        title="Light Mode Surfaces"
        description="Background, card, border, and elevation colors for light theme"
        icon={Sun}
        defaultOpen={false}
      >
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {lightSurfaces.map(({ key, label, desc }) => (
              <ColorPicker
                key={key}
                label={label}
                description={desc}
                value={(themeColors as any)[key] || ''}
                onChange={(v) => updateThemeColor(key, v)}
              />
            ))}
          </div>
          {/* Surface elevation preview */}
          <div className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Elevation Preview
            </p>
            <div className="flex gap-2">
              <div
                className="flex h-10 flex-1 items-center justify-center rounded-lg border border-zinc-200 text-[10px] font-medium text-zinc-800"
                style={{ backgroundColor: themeColors.lightBackground }}
              >
                BG
              </div>
              <div
                className="flex h-10 flex-1 items-center justify-center rounded-lg border border-zinc-200 text-[10px] font-medium text-zinc-800"
                style={{ backgroundColor: themeColors.lightSurface1 }}
              >
                S1
              </div>
              <div
                className="flex h-10 flex-1 items-center justify-center rounded-lg border border-zinc-200 text-[10px] font-medium text-zinc-800"
                style={{ backgroundColor: themeColors.lightSurface2 }}
              >
                S2
              </div>
              <div
                className="flex h-10 flex-1 items-center justify-center rounded-lg border border-zinc-200 text-[10px] font-medium text-zinc-800"
                style={{ backgroundColor: themeColors.lightSurface3 }}
              >
                S3
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleResetSection('light')}
            className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <RotateCcw className="h-3 w-3" />
            Reset light surfaces
          </button>
        </div>
      </SectionCard>

      {/* ── Layout ── */}
      <SectionCard
        title="Layout"
        description="Border radius and spacing adjustments"
        icon={Layout}
        defaultOpen={false}
      >
        <div className="space-y-4">
          <div className="max-w-xs">
            <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Border Radius
            </label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0"
                max="1.5"
                step="0.0625"
                value={parseFloat(themeColors.borderRadius || '0.5')}
                onChange={(e) => updateThemeColor('borderRadius', `${e.target.value}rem`)}
                className="flex-1 accent-primary"
              />
              <span className="w-16 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-center font-mono text-xs text-zinc-600 dark:border-zinc-700 dark:bg-surface-2 dark:text-zinc-300">
                {themeColors.borderRadius || '0.5rem'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-400 dark:text-zinc-500">
              Controls the roundness of cards, buttons, and inputs (0 = sharp, 1.5rem = pill).
            </p>
          </div>
          {/* Radius preview */}
          <div className="flex items-end gap-3">
            <div
              className="flex h-12 w-12 items-center justify-center bg-primary text-xs font-medium text-primary-foreground"
              style={{ borderRadius: themeColors.borderRadius || '0.5rem' }}
            >
              Aa
            </div>
            <div
              className="flex h-12 w-20 items-center bg-primary text-xs font-medium text-primary-foreground"
              style={{ borderRadius: themeColors.borderRadius || '0.5rem' }}
            >
              Button
            </div>
            <div
              className="flex h-12 flex-1 items-center bg-primary/10 px-3 text-xs font-medium text-primary"
              style={{ borderRadius: themeColors.borderRadius || '0.5rem' }}
            >
              Card preview
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleResetSection('layout')}
            className="flex items-center gap-1.5 text-xs text-zinc-400 transition-colors hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            <RotateCcw className="h-3 w-3" />
            Reset layout
          </button>
        </div>
      </SectionCard>

      {/* ── Custom CSS ── */}
      <SectionCard
        title="Custom CSS"
        description="Advanced styling injected into every page"
        icon={Code2}
        defaultOpen={false}
      >
        <div className="space-y-2">
          <textarea
            value={customCss}
            onChange={(e) => setCustomCss(e.target.value)}
            placeholder="/* Your custom CSS here */&#10;.my-custom-class {&#10;  color: red;&#10;}"
            rows={12}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-xs text-zinc-800 placeholder:text-zinc-400 transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-zinc-700 dark:bg-surface-2 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Maximum 100 KB. Custom CSS overrides all defaults — use with caution as it can break the UI.
          </p>
        </div>
      </SectionCard>

      {/* ── Action Buttons ── */}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleResetAll}
          className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs font-semibold text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-800 dark:border-zinc-700 dark:bg-surface-2 dark:text-zinc-400 dark:hover:bg-surface-3 dark:hover:text-zinc-200"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset All
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {updateMutation.isPending ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Save Changes
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export default ThemeSettingsPage;
