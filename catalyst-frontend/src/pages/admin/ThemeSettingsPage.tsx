import { useState, useEffect, useMemo, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { toast } from 'sonner';
import { useThemeSettings, useOidcConfig } from '../../hooks/useAdmin';
import { generatePalette, hexToHSL, type HarmonyMode } from '../../utils/generatePalette';
import { adminApi } from '../../services/api/admin';
import { useThemeStore, defaultThemeColors } from '../../stores/themeStore';
import type { ThemeColors } from '../../services/api/theme';
import {
  Sun,
  Moon,
  Layers,
  Layout,
  Code2,
  RotateCcw,
  Check,
  Save,
  Shield,
  AlertTriangle,
  Info,
  Wand2,
  Shuffle,
  Eye,
  Globe,
  Palette,
} from 'lucide-react';

// ─── Defaults ───

const DEFAULTS = {
  primaryColor: '#0d9488',
  secondaryColor: '#8b5cf6',
  accentColor: '#06b6d4',
  themeColors: { ...defaultThemeColors } satisfies ThemeColors,
} as const;

type TabId = 'brand' | 'palette' | 'colors' | 'surfaces' | 'layout' | 'advanced';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const TABS: Tab[] = [
  { id: 'brand', label: 'Brand', icon: Globe },
  { id: 'palette', label: 'Palette', icon: Wand2 },
  { id: 'colors', label: 'Colors', icon: Palette },
  { id: 'surfaces', label: 'Surfaces', icon: Layers },
  { id: 'layout', label: 'Layout', icon: Layout },
  { id: 'advanced', label: 'Advanced', icon: Code2 },
];

// ─── Color Picker ───

function ColorPicker({
  label,
  description,
  value,
  onChange,
  icon: Icon,
  compact = false,
}: {
  label: string;
  description?: string;
  value: string;
  onChange: (v: string) => void;
  icon?: React.ComponentType<{ className?: string }>;
  compact?: boolean;
}) {
  const isValid = /^#[0-9A-Fa-f]{6}$/.test(value);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <div className="relative flex-shrink-0">
          <div
            className="h-8 w-8 cursor-pointer rounded-md ring-1 ring-black/10 dark:ring-white/10"
            style={{ backgroundColor: isValid ? value : '#71717a' }}
          />
          <input
            type="color"
            value={isValid ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer rounded-md opacity-0"
          />
        </div>
        <div className="min-w-0 flex-1">
          {Icon && <Icon className="mb-0.5 h-3 w-3 text-muted-foreground" />}
          <p className="truncate text-[11px] font-medium text-foreground">{label}</p>
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000"
          className={`w-[72px] rounded-md border bg-transparent px-2 py-1 font-mono text-[11px] transition-colors focus:outline-none focus:ring-1 ${
            isValid
              ? 'border-border text-foreground focus:border-primary focus:ring-primary/20'
              : 'border-danger/40 text-danger focus:border-danger focus:ring-danger/20'
          }`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
        <label className="text-xs font-medium text-foreground">{label}</label>
      </div>
      {description && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
      )}
      <div className="flex items-center gap-2">
        <div className="relative flex-shrink-0">
          <div
            className="h-10 w-10 cursor-pointer rounded-lg ring-1 ring-black/10 transition-transform hover:scale-105 dark:ring-white/10"
            style={{ backgroundColor: isValid ? value : '#71717a' }}
          />
          <input
            type="color"
            value={isValid ? value : '#000000'}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer rounded-lg opacity-0"
          />
        </div>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className={`flex-1 rounded-lg border bg-card px-3 py-2 font-mono text-xs transition-colors focus:outline-none focus:ring-2 ${
            isValid
              ? 'border-border text-foreground focus:border-primary focus:ring-primary/20'
              : 'border-danger/40 text-danger focus:border-danger focus:ring-danger/20'
          }`}
        />
      </div>
    </div>
  );
}

// ─── Swatch (tiny color preview chip) ───

function Swatch({ color, label, mono }: { color: string; label?: string; mono?: boolean }) {
  return (
    <div className="group/swatch flex flex-col items-center gap-1">
      <div
        className="h-10 w-full rounded-md ring-1 ring-black/5 transition-transform hover:scale-105 dark:ring-white/5"
        style={{ backgroundColor: color }}
      />
      {label && (
        <span
          className={`text-[10px] font-medium ${mono ? 'font-mono text-[9px]' : ''} text-muted-foreground`}
        >
          {label}
        </span>
      )}
    </div>
  );
}

// ─── OIDC Provider Section ───

function OidcProviderSection() {
  const { data: serverConfigs = {}, isLoading } = useOidcConfig();
  const [configs, setConfigs] = useState<
    Record<string, { clientId: string; clientSecret: string; discoveryUrl: string; source: string }>
  >({});

  useEffect(() => {
    if (Object.keys(serverConfigs).length > 0) {
      setConfigs(serverConfigs);
    }
  }, [serverConfigs]);

  const updateField = (provider: string, field: string, value: string) => {
    setConfigs((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], [field]: value },
    }));
  };

  const oidcMutation = useMutation({
    mutationFn: (localConfigs: typeof configs) => adminApi.updateOidcConfig(localConfigs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.adminThemeSettings() });
      queryClient.invalidateQueries({ queryKey: qk.adminOidcConfig() });
      toast.success('OAuth configuration saved. A server restart may be required.');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.error || 'Failed to save OAuth configuration');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-transparent" />
        Loading OAuth configuration…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {(['paymenter', 'whmcs'] as const).map((provider) => {
        const cfg = configs[provider] || {
          clientId: '',
          clientSecret: '',
          discoveryUrl: '',
          source: 'none',
        };
        const isConfigured = cfg.source !== 'none';

        return (
          <div key={provider} className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                {provider.charAt(0).toUpperCase() + provider.slice(1)}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  isConfigured
                    ? 'bg-success/10 text-success'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {isConfigured ? `Configured (${cfg.source})` : 'Not configured'}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <InputField
                label="Client ID"
                value={cfg.clientId}
                onChange={(v) => updateField(provider, 'clientId', v)}
                placeholder={`${provider.toUpperCase()}_OIDC_CLIENT_ID`}
              />
              <div>
                <InputField
                  label="Client Secret"
                  type="password"
                  value={cfg.clientSecret}
                  onChange={(v) => updateField(provider, 'clientSecret', v)}
                  placeholder={
                    cfg.clientSecret
                      ? 'Leave unchanged to keep current secret'
                      : `${provider.toUpperCase()}_OIDC_CLIENT_SECRET`
                  }
                />
                {cfg.source === 'database' && cfg.clientSecret && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Secret is masked. Enter a new value to update.
                  </p>
                )}
              </div>
              <InputField
                label="Discovery URL"
                type="url"
                value={cfg.discoveryUrl}
                onChange={(v) => updateField(provider, 'discoveryUrl', v)}
                placeholder="https://example.com/.well-known/openid-configuration"
              />
            </div>
          </div>
        );
      })}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => oidcMutation.mutate(configs)}
          disabled={oidcMutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {oidcMutation.isPending ? (
            <>
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Saving…
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              Save OAuth Config
            </>
          )}
        </button>
        <p className="text-[11px] text-muted-foreground">
          Values stored in the database override environment variables. May require server restart.
        </p>
      </div>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}

// ─── Section header ───

function SectionHeader({
  title,
  description,
  onReset,
}: {
  title: string;
  description: string;
  onReset?: () => void;
}) {
  return (
    <div className="mb-5 flex items-start justify-between">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      {onReset && (
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:bg-surface-2"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      )}
    </div>
  );
}

// ─── Surface Elevation Preview ───

function ElevationPreview({
  bg,
  s1,
  s2,
  s3,
  isDark,
}: {
  bg: string;
  s1: string;
  s2: string;
  s3: string;
  isDark: boolean;
}) {
  const levels = [
    { color: bg, label: 'BG' },
    { color: s1, label: 'S1' },
    { color: s2, label: 'S2' },
    { color: s3, label: 'S3' },
  ];

  return (
    <div className="flex gap-1.5">
      {levels.map(({ color, label }) => (
        <div key={label} className="flex-1 text-center">
          <div
            className={`mx-auto h-12 rounded-lg ring-1 transition-transform hover:scale-105 ${
              isDark ? 'ring-white/5' : 'ring-black/5'
            }`}
            style={{ backgroundColor: color }}
          />
          <span className="mt-1 block text-[9px] font-medium text-muted-foreground">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───

function ThemeSettingsPage() {
  const { data: settings, isLoading } = useThemeSettings();
  const applyThemeSettings = useThemeStore((s) => s.setThemeSettings);
  const applyTheme = useThemeStore((s) => s.applyTheme);
  const previewColors = useThemeStore((s) => s.previewColors);
  const cancelPreview = useThemeStore((s) => s.cancelPreview);
  const injectCustomCss = useThemeStore((s) => s.injectCustomCss);
  const currentTheme = useThemeStore((s) => s.theme);

  // ── Tab state ──
  const [activeTab, setActiveTab] = useState<TabId>('brand');

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

  // ── Palette Generator ──
  const [seedColor, setSeedColor] = useState(DEFAULTS.primaryColor);
  const [harmonyMode, setHarmonyMode] = useState<HarmonyMode>('auto');

  // ── Helper: push preview to DOM ──
  const pushPreview = useCallback(
    (overrides: { primaryColor?: string; secondaryColor?: string; accentColor?: string; themeColors?: ThemeColors } = {}) => {
      previewColors({
        primaryColor: overrides.primaryColor ?? primaryColor,
        secondaryColor: overrides.secondaryColor ?? secondaryColor,
        accentColor: overrides.accentColor ?? accentColor,
        themeColors: overrides.themeColors ?? themeColors,
      });
    },
    [previewColors, primaryColor, secondaryColor, accentColor, themeColors],
  );

  // ── Palette Generator (computed) ──
  const isSeedValid = /^#[0-9A-Fa-f]{6}$/.test(seedColor);
  const generatedPalette = useMemo(
    () => (isSeedValid ? generatePalette(seedColor, harmonyMode) : null),
    [seedColor, harmonyMode, isSeedValid],
  );

  const handleApplyPalette = () => {
    if (!generatedPalette) return;
    const { primaryColor: p, secondaryColor: sec, accentColor: acc, themeColors: tc } =
      generatedPalette;
    setPrimaryColor(p);
    setSecondaryColor(sec);
    setAccentColor(acc);
    setThemeColors(tc);
    pushPreview({ primaryColor: p, accentColor: acc, themeColors: tc });
    toast.success('Palette applied — review and save when ready');
  };

  // ── Initialize form from server ──
  useEffect(() => {
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
    setSeedColor(settings.primaryColor || DEFAULTS.primaryColor);
    setCustomCss(settings.customCss || '');
    setThemeColors(
      savedColors ? { ...DEFAULTS.themeColors, ...savedColors } : { ...DEFAULTS.themeColors },
    );
  }, [settings]);

  // ── Update a ThemeColor key + live preview ──
  const updateThemeColor = (key: keyof ThemeColors, value: string) => {
    const updated = { ...themeColors, [key]: value };
    setThemeColors(updated);
    pushPreview({ themeColors: updated });
  };

  // ── Brand color handlers ──
  const handlePrimaryColorChange = (v: string) => {
    setPrimaryColor(v);
    pushPreview({ primaryColor: v });
  };
  const handleSecondaryColorChange = (v: string) => {
    setSecondaryColor(v);
    pushPreview({ secondaryColor: v });
  };
  const handleAccentColorChange = (v: string) => {
    setAccentColor(v);
    pushPreview({ accentColor: v });
  };

  // ── Theme toggle ──
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
      queryClient.invalidateQueries({ queryKey: qk.adminThemeSettings() });
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
      toast.success('Theme settings updated');
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
      metadata: { themeColors: hasCustomColors ? themeColors : undefined },
    });
  };

  // ── Reset ──
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
    setSeedColor(settings.primaryColor || DEFAULTS.primaryColor);
    setCustomCss(settings.customCss || '');
    setThemeColors(
      savedColors ? { ...DEFAULTS.themeColors, ...savedColors } : { ...DEFAULTS.themeColors },
    );
    cancelPreview();
    applyTheme();
  };

  const handleResetSection = (section: 'brand' | 'semantic' | 'dark' | 'light' | 'layout') => {
    switch (section) {
      case 'brand':
        setPrimaryColor(DEFAULTS.primaryColor);
        setSecondaryColor(DEFAULTS.secondaryColor);
        setAccentColor(DEFAULTS.accentColor);
        setSeedColor(DEFAULTS.primaryColor);
        pushPreview({ primaryColor: DEFAULTS.primaryColor, secondaryColor: DEFAULTS.secondaryColor, accentColor: DEFAULTS.accentColor });
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
        const updated = { ...themeColors, borderRadius: DEFAULTS.themeColors.borderRadius };
        setThemeColors(updated);
        pushPreview({ themeColors: updated });
        break;
      }
    }
  };

  // ── Custom CSS handlers ──
  const handlePreviewCustomCss = () => {
    injectCustomCss(customCss.trim() || null);
  };
  const handleResetCustomCss = () => {
    const saved = settings?.customCss || '';
    setCustomCss(saved);
    injectCustomCss(saved || null);
  };

  // ── Surface definitions ──
  const darkSurfaces: { key: keyof ThemeColors; label: string; desc: string }[] = [
    { key: 'darkBackground', label: 'Background', desc: 'Main page background' },
    { key: 'darkCard', label: 'Card', desc: 'Card & panel backgrounds' },
    { key: 'darkSurface1', label: 'Surface 1', desc: 'Elevated base layer' },
    { key: 'darkSurface2', label: 'Surface 2', desc: 'Secondary elevation' },
    { key: 'darkSurface3', label: 'Surface 3', desc: 'Tertiary elevation' },
    { key: 'darkBorder', label: 'Border', desc: 'Borders & dividers' },
    { key: 'darkForeground', label: 'Foreground', desc: 'Primary text' },
    { key: 'darkMuted', label: 'Muted', desc: 'Secondary text & bg' },
  ];

  const lightSurfaces: { key: keyof ThemeColors; label: string; desc: string }[] = [
    { key: 'lightBackground', label: 'Background', desc: 'Main page background' },
    { key: 'lightCard', label: 'Card', desc: 'Card & panel backgrounds' },
    { key: 'lightSurface1', label: 'Surface 1', desc: 'Elevated base layer' },
    { key: 'lightSurface2', label: 'Surface 2', desc: 'Secondary elevation' },
    { key: 'lightSurface3', label: 'Surface 3', desc: 'Tertiary elevation' },
    { key: 'lightBorder', label: 'Border', desc: 'Borders & dividers' },
    { key: 'lightForeground', label: 'Foreground', desc: 'Primary text' },
    { key: 'lightMuted', label: 'Muted', desc: 'Secondary text & bg' },
  ];

  // ── Loading state ──
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading theme settings…
        </div>
      </div>
    );
  }

  // ── Branding panel ──
  const BrandPanel = () => (
    <div className="space-y-6">
      <SectionHeader
        title="Panel Identity"
        description="Customize your panel name and branding assets"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Panel Name</label>
          <input
            type="text"
            value={panelName}
            onChange={(e) => setPanelName(e.target.value)}
            placeholder="Catalyst"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Logo URL</label>
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://example.com/logo.png"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Leave empty for default. Recommended: 24×24px, SVG or PNG.
          </p>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Favicon URL</label>
          <input
            type="text"
            value={faviconUrl}
            onChange={(e) => setFaviconUrl(e.target.value)}
            placeholder="https://example.com/favicon.ico"
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Leave empty for default favicon.
          </p>
        </div>
      </div>

      <hr className="border-border" />

      <SectionHeader title="Theme Mode" description="Default theme and which modes are available" />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">Default Theme</label>
          <select
            value={defaultTheme}
            onChange={(e) => setDefaultTheme(e.target.value)}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="system">System</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-foreground">
            Available Themes
          </label>
          <div className="flex gap-2">
            {[
              { id: 'light', icon: Sun, color: 'text-amber-500' },
              { id: 'dark', icon: Moon, color: 'text-blue-400' },
            ].map(({ id, icon: Icon, color }) => (
              <label
                key={id}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
                  enabledThemes.includes(id)
                    ? 'border-primary bg-primary/5 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/30'
                }`}
              >
                <input
                  type="checkbox"
                  checked={enabledThemes.includes(id)}
                  onChange={() => toggleTheme(id)}
                  className="sr-only"
                />
                <Icon className={`h-4 w-4 ${color}`} />
                {id.charAt(0).toUpperCase() + id.slice(1)}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Palette panel ──
  const PalettePanel = () => {
    const hsl = isSeedValid ? hexToHSL(seedColor) : null;
    return (
      <div className="space-y-6">
        <SectionHeader
          title="Palette Studio"
          description="Pick one color and we'll generate a complete theme"
        />

        {/* Seed color */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          <div className="group relative flex-shrink-0">
            <div
              className="h-24 w-24 cursor-pointer rounded-2xl ring-1 ring-black/5 transition-all duration-300 group-hover:scale-105 dark:ring-white/10"
              style={{
                backgroundColor: isSeedValid ? seedColor : '#71717a',
                boxShadow: isSeedValid
                  ? `0 12px 32px ${seedColor}30, 0 4px 12px ${seedColor}15`
                  : '0 4px 12px rgba(0,0,0,0.15)',
              }}
            />
            <input
              type="color"
              value={isSeedValid ? seedColor : '#71717a'}
              onChange={(e) => setSeedColor(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer rounded-2xl opacity-0"
            />
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-foreground">Seed Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={seedColor}
                  onChange={(e) => setSeedColor(e.target.value)}
                  placeholder="#0d9488"
                  className={`w-36 rounded-lg border bg-card px-3 py-2 font-mono text-sm transition-colors focus:outline-none focus:ring-2 ${
                    isSeedValid
                      ? 'border-border text-foreground focus:border-primary focus:ring-primary/20'
                      : 'border-danger/40 text-danger focus:border-danger focus:ring-danger/20'
                  }`}
                />
                <button
                  type="button"
                  onClick={() =>
                    setSeedColor(
                      '#' +
                        Math.floor(Math.random() * 16777215)
                          .toString(16)
                          .padStart(6, '0'),
                    )
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                  title="Random color"
                >
                  <Shuffle className="h-4 w-4" />
                </button>
                {hsl && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    HSL({hsl.h}°, {hsl.s}%, {hsl.l}%)
                  </span>
                )}
              </div>
            </div>

            {/* Harmony modes */}
            <div>
              <label className="mb-2 block text-xs font-medium text-foreground">
                Color Harmony
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'auto' as const, label: 'Auto' },
                    { id: 'monochromatic' as const, label: 'Mono' },
                    { id: 'analogous' as const, label: 'Analogous' },
                    { id: 'complementary' as const, label: 'Complementary' },
                    { id: 'split-complementary' as const, label: 'Split Comp.' },
                    { id: 'triadic' as const, label: 'Triadic' },
                    { id: 'tetradic' as const, label: 'Tetradic' },
                    { id: 'tetradic-rectangle' as const, label: 'Rectangle' },
                    { id: 'diadic' as const, label: 'Diadic' },
                    { id: 'neutral' as const, label: 'Neutral' },
                  ] as const
                ).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setHarmonyMode(m.id)}
                    className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-all ${
                      harmonyMode === m.id
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'bg-surface-2 text-muted-foreground hover:bg-surface-3 hover:text-foreground'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Generated palette preview */}
        {generatedPalette && (
          <div className="space-y-5 rounded-xl border border-border bg-surface-1/50 p-5">
            {/* Brand */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Brand
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Primary', color: generatedPalette.primaryColor },
                  { label: 'Secondary', color: generatedPalette.secondaryColor },
                  { label: 'Accent', color: generatedPalette.accentColor },
                ].map(({ label, color }) => (
                  <div key={label}>
                    <Swatch color={color} />
                    <p className="mt-1.5 text-center text-[10px] font-medium text-muted-foreground">
                      {label}
                    </p>
                    <p className="text-center font-mono text-[9px] text-muted-foreground/70">
                      {color}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Semantic */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Semantic
              </p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { label: 'Success', key: 'successColor' as const },
                    { label: 'Warning', key: 'warningColor' as const },
                    { label: 'Danger', key: 'dangerColor' as const },
                    { label: 'Info', key: 'infoColor' as const },
                  ] as const
                ).map(({ label, key }) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium"
                    style={{
                      backgroundColor: `${generatedPalette.themeColors[key]}18`,
                      color: generatedPalette.themeColors[key],
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: generatedPalette.themeColors[key] }}
                    />
                    {label}
                  </span>
                ))}
              </div>
            </div>

            {/* Dark surfaces */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Dark Surfaces
              </p>
              <div className="rounded-lg bg-surface-0 p-3">
                <div className="flex gap-1">
                  {[
                    { label: 'BG', key: 'darkBackground' as const },
                    { label: 'Card', key: 'darkCard' as const },
                    { label: 'S1', key: 'darkSurface1' as const },
                    { label: 'S2', key: 'darkSurface2' as const },
                    { label: 'S3', key: 'darkSurface3' as const },
                    { label: 'Bdr', key: 'darkBorder' as const },
                    { label: 'FG', key: 'darkForeground' as const },
                    { label: 'Mt', key: 'darkMuted' as const },
                  ].map(({ label, key }) => (
                    <div key={key} className="flex-1">
                      <Swatch color={generatedPalette.themeColors[key]!} label={label} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Light surfaces */}
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Light Surfaces
              </p>
              <div className="rounded-lg border border-border p-3">
                <div className="flex gap-1">
                  {[
                    { label: 'BG', key: 'lightBackground' as const },
                    { label: 'Card', key: 'lightCard' as const },
                    { label: 'S1', key: 'lightSurface1' as const },
                    { label: 'S2', key: 'lightSurface2' as const },
                    { label: 'S3', key: 'lightSurface3' as const },
                    { label: 'Bdr', key: 'lightBorder' as const },
                    { label: 'FG', key: 'lightForeground' as const },
                    { label: 'Mt', key: 'lightMuted' as const },
                  ].map(({ label, key }) => (
                    <div key={key} className="flex-1">
                      <Swatch color={generatedPalette.themeColors[key]!} label={label} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleApplyPalette}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
            >
              <Wand2 className="h-4 w-4" />
              Apply Palette to Theme
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Colors panel ──
  const ColorsPanel = () => (
    <div className="space-y-8">
      <div>
        <SectionHeader
          title="Brand Colors"
          description="Primary, secondary, and accent palette"
          onReset={() => handleResetSection('brand')}
        />
        <div className="grid gap-5 sm:grid-cols-3">
          <ColorPicker
            label="Primary Color"
            description="Main brand — buttons, links, active states"
            value={primaryColor}
            onChange={handlePrimaryColorChange}
          />
          <ColorPicker
            label="Secondary Color"
            description="Supporting brand color — maps to bg-secondary"
            value={secondaryColor}
            onChange={handleSecondaryColorChange}
          />
          <ColorPicker
            label="Accent Color"
            description="Highlight for focus rings & accents"
            value={accentColor}
            onChange={handleAccentColorChange}
          />
        </div>
        <div className="mt-4 flex gap-2 rounded-lg border border-border p-3">
          {[primaryColor, secondaryColor, accentColor].map((color, i) => (
            <div
              key={i}
              className="h-10 flex-1 rounded-md ring-1 ring-black/5 dark:ring-white/5"
              style={{ backgroundColor: color }}
              title={['Primary', 'Secondary', 'Accent'][i]}
            />
          ))}
        </div>
      </div>

      <hr className="border-border" />

      <div>
        <SectionHeader
          title="Semantic Colors"
          description="Status indicators, alerts, and feedback"
          onReset={() => handleResetSection('semantic')}
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="mt-4 flex flex-wrap gap-2 rounded-lg border border-border p-3">
          {[
            { color: themeColors.successColor, label: 'Success' },
            { color: themeColors.warningColor, label: 'Warning' },
            { color: themeColors.dangerColor, label: 'Danger' },
            { color: themeColors.infoColor, label: 'Info' },
          ].map(({ color, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium"
              style={{ backgroundColor: color ? `${color}18` : undefined, color: color || undefined }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color || undefined }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Surfaces panel ──
  const SurfacesPanel = () => (
    <div className="space-y-8">
      <div>
        <SectionHeader
          title="Dark Mode Surfaces"
          description="Background, elevation, and text colors for dark theme"
          onReset={() => handleResetSection('dark')}
        />
        <div className="mb-5">
          <ElevationPreview
            bg={themeColors.darkBackground || ''}
            s1={themeColors.darkSurface1 || ''}
            s2={themeColors.darkSurface2 || ''}
            s3={themeColors.darkSurface3 || ''}
            isDark
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {darkSurfaces.map(({ key, label, desc }) => (
            <ColorPicker
              key={key}
              label={label}
              description={desc}
              value={(themeColors as any)[key] || ''}
              onChange={(v) => updateThemeColor(key, v)}
              compact
            />
          ))}
        </div>
      </div>

      <hr className="border-border" />

      <div>
        <SectionHeader
          title="Light Mode Surfaces"
          description="Background, elevation, and text colors for light theme"
          onReset={() => handleResetSection('light')}
        />
        <div className="mb-5">
          <ElevationPreview
            bg={themeColors.lightBackground || ''}
            s1={themeColors.lightSurface1 || ''}
            s2={themeColors.lightSurface2 || ''}
            s3={themeColors.lightSurface3 || ''}
            isDark={false}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {lightSurfaces.map(({ key, label, desc }) => (
            <ColorPicker
              key={key}
              label={label}
              description={desc}
              value={(themeColors as any)[key] || ''}
              onChange={(v) => updateThemeColor(key, v)}
              compact
            />
          ))}
        </div>
      </div>
    </div>
  );

  // ── Layout panel ──
  const LayoutPanel = () => (
    <div className="space-y-6">
      <SectionHeader
        title="Border Radius"
        description="Control the roundness of cards, buttons, and inputs"
        onReset={() => handleResetSection('layout')}
      />
      <div className="max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="1.5"
            step="0.0625"
            value={parseFloat(themeColors.borderRadius || '0.5')}
            onChange={(e) => updateThemeColor('borderRadius', `${e.target.value}rem`)}
            className="flex-1 accent-primary"
          />
          <span className="w-[72px] rounded-lg border border-border bg-card px-2 py-1.5 text-center font-mono text-xs text-foreground">
            {themeColors.borderRadius || '0.5rem'}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          0 = sharp corners, 1.5rem = pill shape.
        </p>
        <div className="flex items-end gap-3 pt-2">
          <div
            className="flex h-14 w-14 items-center justify-center bg-primary text-sm font-semibold text-primary-foreground"
            style={{ borderRadius: themeColors.borderRadius || '0.5rem' }}
          >
            Aa
          </div>
          <div
            className="flex h-10 w-24 items-center justify-center bg-primary text-xs font-semibold text-primary-foreground"
            style={{ borderRadius: themeColors.borderRadius || '0.5rem' }}
          >
            Button
          </div>
          <div
            className="flex h-14 flex-1 items-center bg-primary/10 px-4 text-sm font-medium text-primary"
            style={{ borderRadius: themeColors.borderRadius || '0.5rem' }}
          >
            Card preview
          </div>
        </div>
      </div>
    </div>
  );

  // ── Advanced panel ──
  const AdvancedPanel = () => (
    <div className="space-y-8">
      <div>
        <SectionHeader
          title="Custom CSS"
          description="Advanced styling injected into every page (max 100 KB)"
        />
        <div className="space-y-3">
          <textarea
            value={customCss}
            onChange={(e) => setCustomCss(e.target.value)}
            placeholder="/* Your custom CSS here */&#10;.my-custom-class {&#10;  color: red;&#10;}"
            rows={14}
            spellCheck={false}
            className="w-full rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreviewCustomCss}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <Eye className="h-3.5 w-3.5" />
              Preview
            </button>
            <button
              type="button"
              onClick={handleResetCustomCss}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset to Saved
            </button>
          </div>
        </div>
      </div>

      <hr className="border-border" />

      <div>
        <SectionHeader
          title="OAuth Providers"
          description="Configure OIDC/SSO login for WHMCS and Paymenter"
        />
        <OidcProviderSection />
      </div>
    </div>
  );

  // ── Live Preview Strip ──
  const LivePreviewStrip = () => (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Live Preview
        </span>
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: primaryColor }}
          />
          {currentTheme === 'dark' ? 'Dark' : 'Light'} mode
        </span>
      </div>
      <div className="flex gap-1.5">
        <div className="flex-1 space-y-1">
          <div className="flex h-5 items-center gap-1">
            <span className="text-[9px] font-medium text-muted-foreground">Brand</span>
          </div>
          <div className="flex gap-1">
            {[primaryColor, secondaryColor, accentColor].map((c, i) => (
              <div
                key={i}
                className="h-5 flex-1 rounded-sm"
                style={{ backgroundColor: c }}
                title={['Primary', 'Secondary', 'Accent'][i]}
              />
            ))}
          </div>
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex h-5 items-center gap-1">
            <span className="text-[9px] font-medium text-muted-foreground">Semantic</span>
          </div>
          <div className="flex gap-1">
            {[
              themeColors.successColor,
              themeColors.warningColor,
              themeColors.dangerColor,
              themeColors.infoColor,
            ].map((c, i) => (
              <div
                key={i}
                className="h-5 flex-1 rounded-sm"
                style={{ backgroundColor: c || '#888' }}
              />
            ))}
          </div>
        </div>
        <div className="flex-[2] space-y-1">
          <div className="flex h-5 items-center gap-1">
            <span className="text-[9px] font-medium text-muted-foreground">Surface Elevation</span>
          </div>
          <div className="flex gap-[2px]">
            {(currentTheme === 'dark'
              ? [
                  themeColors.darkBackground,
                  themeColors.darkSurface1,
                  themeColors.darkSurface2,
                  themeColors.darkSurface3,
                ]
              : [
                  themeColors.lightBackground,
                  themeColors.lightSurface1,
                  themeColors.lightSurface2,
                  themeColors.lightSurface3,
                ]
            ).map((c, i) => (
              <div
                key={i}
                className="h-5 flex-1 rounded-sm ring-1 ring-black/10 dark:ring-white/5"
                style={{ backgroundColor: c || '#888' }}
                title={`Surface ${i}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // ─── Render ───
  const activeTabContent = {
    brand: <BrandPanel />,
    palette: <PalettePanel />,
    colors: <ColorsPanel />,
    surfaces: <SurfacesPanel />,
    layout: <LayoutPanel />,
    advanced: <AdvancedPanel />,
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* ── Page Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Theme Settings
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Customize the look and feel of your panel
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleResetAll}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset All
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
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

      {/* ── Live Preview Strip ── */}
      <LivePreviewStrip />

      {/* ── Tab Navigation ── */}
      <div className="flex gap-1 rounded-xl border border-border bg-surface-1 p-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-medium transition-all ${
                isActive
                  ? 'bg-card text-foreground shadow-sm ring-1 ring-black/5 dark:ring-white/5'
                  : 'text-muted-foreground hover:text-foreground hover:bg-surface-2/50'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Active Tab Content ── */}
      <div className="rounded-xl border border-border bg-card p-6">
        {activeTabContent[activeTab]}
      </div>
    </div>
  );
}

export default ThemeSettingsPage;
