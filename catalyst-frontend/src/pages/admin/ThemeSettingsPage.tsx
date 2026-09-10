import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useMutation } from '@/csync';
import { qk } from '@/lib/queryKeys';
import { queryClient } from '@/lib/queryClient';
import { toast } from 'sonner';
import { useThemeSettings, useOidcConfig } from '../../hooks/useAdmin';
import { generatePalette, hexToHSL, type HarmonyMode } from '../../utils/generatePalette';
import { THEME_PRESETS } from '../../utils/themePresets';
import { buildSharedTheme, parseSharedTheme, contrastRatio } from '../../utils/themeSharing';
import { adminApi } from '../../services/api/admin';
import { notifyError } from '../../utils/notify';
import { formatNumber } from '../../i18n/format';
import { useThemeStore, defaultThemeColors } from '../../stores/themeStore';
import type { ThemeColors } from '../../services/api/theme';
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
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
 Download,
 Upload,
 Copy,
 Sparkles,
} from 'lucide-react';

// ─── Defaults ───

const DEFAULTS = {
 primaryColor: '#0d9488',
 secondaryColor: '#8b5cf6',
 accentColor: '#06b6d4',
 themeColors: { ...defaultThemeColors } satisfies ThemeColors,
} as const;

type TabId = 'presets' | 'brand' | 'palette' | 'colors' | 'surfaces' | 'layout' | 'manage' | 'advanced';

interface Tab {
 id: TabId;
 icon: React.ComponentType<{ className?: string }>;
}

const TABS: Tab[] = [
 { id: 'presets', icon: Sparkles },
 { id: 'brand', icon: Globe },
 { id: 'palette', icon: Wand2 },
 { id: 'colors', icon: Palette },
 { id: 'surfaces', icon: Layers },
 { id: 'layout', icon: Layout },
 { id: 'manage', icon: Copy },
 { id: 'advanced', icon: Code2 },
];

/** Tab label for a settings section. */
function tabLabel(t: TFunction<'admin-system'>, id: TabId): string {
 switch (id) {
 case 'presets': return t('theme.presets');
 case 'brand': return t('theme.brand');
 case 'palette': return t('theme.palette');
 case 'colors': return t('theme.colors');
 case 'surfaces': return t('theme.surfaces');
 case 'layout': return t('theme.layout');
 case 'manage': return t('theme.manage');
 case 'advanced': return t('theme.advanced');
 }
}

/** Preset display name, keyed by preset id. */
function presetName(t: TFunction<'admin-system'>, id: string): string {
 switch (id) {
 case 'catalyst-teal': return t('theme.presetName.catalystTeal');
 case 'ocean': return t('theme.presetName.ocean');
 case 'sunset': return t('theme.presetName.sunset');
 case 'forest': return t('theme.presetName.forest');
 case 'royal': return t('theme.presetName.royal');
 case 'crimson': return t('theme.presetName.crimson');
 case 'slate-mono': return t('theme.presetName.slateMono');
 case 'neon-nights': return t('theme.presetName.neonNights');
 case 'brutalist': return t('theme.presetName.brutalist');
 default: return id;
 }
}

/** Preset description, keyed by preset id. */
function presetDescription(t: TFunction<'admin-system'>, id: string): string {
 switch (id) {
 case 'catalyst-teal': return t('theme.presetDescription.catalystTeal');
 case 'ocean': return t('theme.presetDescription.ocean');
 case 'sunset': return t('theme.presetDescription.sunset');
 case 'forest': return t('theme.presetDescription.forest');
 case 'royal': return t('theme.presetDescription.royal');
 case 'crimson': return t('theme.presetDescription.crimson');
 case 'slate-mono': return t('theme.presetDescription.slateMono');
 case 'neon-nights': return t('theme.presetDescription.neonNights');
 case 'brutalist': return t('theme.presetDescription.brutalist');
 default: return id;
 }
}

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
 className="h-8 w-8 cursor-pointer rounded-md ring-1 ring-black/10"
 style={{ backgroundColor: isValid ? value : 'hsl(var(--muted-foreground))' }}
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
 className={`w-[72px] rounded-md border px-2 py-1 font-mono text-[11px] transition-colors focus:outline-none focus:ring-1 ${
 isValid
 ? 'border-border/40 text-foreground focus:border-primary focus:ring-primary/20'
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
 className="h-10 w-10 cursor-pointer rounded-lg ring-1 ring-black/10 transition-transform hover:scale-105"
 style={{ backgroundColor: isValid ? value : 'hsl(var(--muted-foreground))' }}
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
 ? 'border-border/40 text-foreground focus:border-primary focus:ring-primary/20'
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
 className="h-10 w-full rounded-md ring-1 ring-black/5 transition-transform hover:scale-105"
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

// Stable empty default — inline `= {}` creates a new object every render and
// trips the React 19 "adjust state when props change" sync into an infinite loop.
const EMPTY_OIDC_CONFIGS: Record<
 string,
 { clientId: string; clientSecret: string; discoveryUrl: string; source: string }
> = {};
function OidcProviderSection() {
 const { t } = useTranslation('admin-system');
 const { data: serverConfigs = EMPTY_OIDC_CONFIGS, isLoading } = useOidcConfig();
 const [configs, setConfigs] = useState<
 Record<string, { clientId: string; clientSecret: string; discoveryUrl: string; source: string }>
 >({});

 // Same remount rule as the main form below: start the tracker as undefined
 // so a cached-but-unchanged `serverConfigs` reference still syncs on mount.
 const [prevServerConfigs, setPrevServerConfigs] = useState<typeof serverConfigs | undefined>(undefined);
 if (serverConfigs !== prevServerConfigs) {
 setPrevServerConfigs(serverConfigs);
 if (Object.keys(serverConfigs).length > 0) {
 setConfigs(serverConfigs);
 }
 }

 const updateField = (provider: string, field: string, value: string) => {
 setConfigs((prev) => ({
 ...prev,
 [provider]: { ...prev[provider], [field]: value },
 }));
 };

 const oidcMutation = useMutation({
 mutationFn: (localConfigs: typeof configs) => adminApi.updateOidcConfig(localConfigs),
 onSuccess: () => {
 toast.success(t('theme.toastOauthSaved'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminThemeSettings() });
 queryClient.invalidateQueries({ queryKey: qk.adminOidcConfig() });
 },
 onError: (err: any) => {
 notifyError(err);
 },
 });

 if (isLoading) {
 return (
 <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
 <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-transparent" />
 {t('theme.oauthLoading')}
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
 className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
 isConfigured
 ? 'border-success/30 bg-success/10 text-success'
 : 'border-border/60 bg-surface-2 text-foreground/80'
 }`}
 >
 {isConfigured ? t('theme.configured', { source: cfg.source }) : t('theme.notConfigured')}
 </span>
 </div>

 <div className="grid gap-3 sm:grid-cols-3">
 <InputField
 label={t('theme.clientId')}
 value={cfg.clientId}
 onChange={(v) => updateField(provider, 'clientId', v)}
 placeholder={`${provider.toUpperCase()}_OIDC_CLIENT_ID`}
 />
 <div>
 <InputField
 label={t('theme.clientSecret')}
 type="password"
 value={cfg.clientSecret}
 onChange={(v) => updateField(provider, 'clientSecret', v)}
 placeholder={
 cfg.clientSecret
 ? t('theme.clientSecretPlaceholder')
 : `${provider.toUpperCase()}_OIDC_CLIENT_SECRET`
 }
 />
 {cfg.source === 'database' && cfg.clientSecret && (
 <p className="mt-1 text-[10px] text-muted-foreground">
 {t('theme.clientSecretMasked')}
 </p>
 )}
 </div>
 <InputField
 label={t('theme.discoveryUrl')}
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
 {t('saving')}
 </>
 ) : (
 <>
 <Save className="h-3.5 w-3.5" />
 {t('theme.saveOAuthConfig')}
 </>
 )}
 </button>
 <p className="text-[11px] text-muted-foreground">
 {t('theme.oauthEnvOverride')}
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
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
 />
 </div>
 );
}

// ─── Panel Section header ───

function PanelSectionHeader({
 title,
 description,
 onReset,
}: {
 title: string;
 description: string;
 onReset?: () => void;
}) {
 const { t } = useTranslation('admin-system');
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
 className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 >
 <RotateCcw className="h-3 w-3" />
 {t('common:actions.reset')}
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
}: {
 bg: string;
 s1: string;
 s2: string;
 s3: string;
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
 className="mx-auto h-12 rounded-lg ring-1 ring-black/5 transition-transform hover:scale-105"
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
 const { t } = useTranslation('admin-system');
 const { data: settings, isLoading } = useThemeSettings();
 const applyThemeSettings = useThemeStore((s) => s.setThemeSettings);
 const applyTheme = useThemeStore((s) => s.applyTheme);
 const previewColors = useThemeStore((s) => s.previewColors);
 const cancelPreview = useThemeStore((s) => s.cancelPreview);
 const injectCustomCss = useThemeStore((s) => s.injectCustomCss);
 const currentTheme = useThemeStore((s) => s.theme);
 const setTheme = useThemeStore((s) => s.setTheme);
 const personalColors = useThemeStore((s) => s.personalColors);
 const themePreference = useThemeStore((s) => s.themePreference);
 const clearPersonalTheme = useThemeStore((s) => s.clearPersonalTheme);

 // ── Tab state ──
 const [activeTab, setActiveTab] = useState<TabId>('presets');

 // ── Branding ──
 const [panelName, setPanelName] = useState('Catalyst');
 const [logoUrl, setLogoUrl] = useState('');
 const [faviconUrl, setFaviconUrl] = useState('');

 // ── Theme Mode ──
 const [defaultTheme, setDefaultTheme] = useState('dark');
 const [enabledThemes, setEnabledThemes] = useState<string[]>(['light', 'dark']);

 // ── Brand Colors ──
 const [primaryColor, setPrimaryColor] = useState<string>(DEFAULTS.primaryColor);
 const [secondaryColor, setSecondaryColor] = useState<string>(DEFAULTS.secondaryColor);
 const [accentColor, setAccentColor] = useState<string>(DEFAULTS.accentColor);

 // ── Extended Theme Colors ──
 const [themeColors, setThemeColors] = useState<ThemeColors>({ ...DEFAULTS.themeColors });

 // ── Custom CSS ──
 const [customCss, setCustomCss] = useState('');

 // ── Share (import/export) ──
 const [importText, setImportText] = useState('');
 const [importError, setImportError] = useState<string | null>(null);

 // ── Palette Generator ──
 const [seedColor, setSeedColor] = useState<string>(DEFAULTS.primaryColor);
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
 toast.success(t('theme.toastPaletteApplied'));
 };

 const handleApplyPreset = (presetId: string) => {
 const preset = THEME_PRESETS.find((p) => p.id === presetId);
 if (!preset) return;
 setPrimaryColor(preset.primaryColor);
 setSecondaryColor(preset.secondaryColor);
 setAccentColor(preset.accentColor);
 setSeedColor(preset.primaryColor);
 const merged = { ...DEFAULTS.themeColors, ...preset.themeColors };
 setThemeColors(merged);
 if (preset.customCss !== undefined) {
 setCustomCss(preset.customCss || '');
 injectCustomCss(preset.customCss || null);
 }
 pushPreview({
 primaryColor: preset.primaryColor,
 secondaryColor: preset.secondaryColor,
 accentColor: preset.accentColor,
 themeColors: merged,
 });
 toast.success(t('theme.toastPresetApplied', { name: presetName(t, preset.id) }));
 };

 const handleExportCopy = async () => {
 const payload = buildSharedTheme({ primaryColor, secondaryColor, accentColor, themeColors, customCss });
 try {
 await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
 toast.success(t('theme.toastThemeJsonCopied'));
 } catch {
 toast.error(t('theme.toastCopyFailed'));
 }
 };

 const handleExportDownload = () => {
 const payload = buildSharedTheme({ primaryColor, secondaryColor, accentColor, themeColors, customCss });
 const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
 const url = URL.createObjectURL(blob);
 const a = document.createElement('a');
 a.href = url;
 a.download = 'catalyst-theme.json';
 a.click();
 URL.revokeObjectURL(url);
 };

 const handleImportApply = () => {
 setImportError(null);
 let parsed: unknown;
 try {
 parsed = JSON.parse(importText);
 } catch {
 setImportError(t('theme.invalidJson'));
 return;
 }
 const result = parseSharedTheme(parsed);
 if (!result.ok) {
 setImportError(result.error);
 return;
 }
 const data = result.data;
 setPrimaryColor(data.primaryColor);
 setSecondaryColor(data.secondaryColor);
 setAccentColor(data.accentColor);
 setSeedColor(data.primaryColor);
 const merged = { ...DEFAULTS.themeColors, ...data.themeColors };
 setThemeColors(merged);
 setCustomCss(data.customCss || '');
 injectCustomCss(data.customCss || null);
 pushPreview({
 primaryColor: data.primaryColor,
 secondaryColor: data.secondaryColor,
 accentColor: data.accentColor,
 themeColors: merged,
 });
 toast.success(data.name ? t('theme.toastThemeImportedNamed', { name: data.name }) : t('theme.toastThemeImported'));
 };

 // Contrast helpers for the accessibility strip (dark + light text on background).
 const contrastInfo = useMemo(() => {
 const darkBg = themeColors.darkBackground;
 const darkFg = themeColors.darkForeground;
 const lightBg = themeColors.lightBackground;
 const lightFg = themeColors.lightForeground;
 return {
 dark: darkBg && darkFg ? contrastRatio(darkBg, darkFg) : null,
 light: lightBg && lightFg ? contrastRatio(lightBg, lightFg) : null,
 };
 }, [themeColors.darkBackground, themeColors.darkForeground, themeColors.lightBackground, themeColors.lightForeground]);

 const hasPersonalOverride = Boolean(personalColors) || (themePreference && themePreference !== 'panel');

 // ── Initialize form from server ──
 // prev must start as undefined — NOT as `settings`. When the query cache
 // already holds data (e.g. navigating Themes → Plugins → Themes within
 // staleTime), remounting hands back the same cached object reference, so
 // `useState(settings)` would make `settings !== prevSettings` false on the
 // first render and the form would silently stay on its useState defaults.
 const [prevSettings, setPrevSettings] = useState<typeof settings | undefined>(undefined);
 if (settings !== prevSettings) {
 setPrevSettings(settings);
 if (settings) {
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
 }
 }

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
 toast.error(t('theme.toastAtLeastOneTheme'));
 }
 } else {
 setEnabledThemes([...enabledThemes, theme]);
 }
 };

 // ── Save ──
 const updateMutation = useMutation({
 mutationFn: (payload: any) => adminApi.updateThemeSettings(payload),
 onSuccess: (data) => {
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
 toast.success(t('theme.toastThemeUpdated'));
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.adminThemeSettings() });
 },
 onError: (error: any) => {
 notifyError(error);
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
 customCss: (customCss.trim().slice(0, 100_000) || null),
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

 const handleResetSection = (section: 'brand' | 'semantic' | 'dark' | 'light' | 'layout' | 'focus') => {
 switch (section) {
 case 'brand': {
 const updated = { ...themeColors, ringColor: DEFAULTS.themeColors.ringColor };
 setPrimaryColor(DEFAULTS.primaryColor);
 setSecondaryColor(DEFAULTS.secondaryColor);
 setAccentColor(DEFAULTS.accentColor);
 setSeedColor(DEFAULTS.primaryColor);
 setThemeColors(updated);
 pushPreview({ primaryColor: DEFAULTS.primaryColor, secondaryColor: DEFAULTS.secondaryColor, accentColor: DEFAULTS.accentColor, themeColors: updated });
 break;
 }
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
 darkMutedBackground: DEFAULTS.themeColors.darkMutedBackground,
 darkPopover: DEFAULTS.themeColors.darkPopover,
 darkInput: DEFAULTS.themeColors.darkInput,
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
 lightMutedBackground: DEFAULTS.themeColors.lightMutedBackground,
 lightPopover: DEFAULTS.themeColors.lightPopover,
 lightInput: DEFAULTS.themeColors.lightInput,
 };
 setThemeColors(updated);
 pushPreview({ themeColors: updated });
 break;
 }
 case 'focus': {
 const updated = { ...themeColors, ringColor: DEFAULTS.themeColors.ringColor };
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
 { key: 'darkBackground', label: t('theme.background'), desc: t('theme.backgroundDescription') },
 { key: 'darkCard', label: t('theme.card'), desc: t('theme.cardDescription') },
 { key: 'darkSurface1', label: t('theme.surface1'), desc: t('theme.surface1Description') },
 { key: 'darkSurface2', label: t('theme.surface2'), desc: t('theme.surface2Description') },
 { key: 'darkSurface3', label: t('theme.surface3'), desc: t('theme.surface3Description') },
 { key: 'darkBorder', label: t('theme.border'), desc: t('theme.borderDescription') },
 { key: 'darkInput', label: t('theme.input'), desc: t('theme.inputDescription') },
 { key: 'darkPopover', label: t('theme.popover'), desc: t('theme.popoverDescription') },
 { key: 'darkMutedBackground', label: t('theme.mutedBg'), desc: t('theme.mutedBgDescription') },
 { key: 'darkForeground', label: t('theme.foreground'), desc: t('theme.foregroundDescription') },
 { key: 'darkMuted', label: t('theme.mutedText'), desc: t('theme.mutedTextDescription') },
 ];

 const lightSurfaces: { key: keyof ThemeColors; label: string; desc: string }[] = [
 { key: 'lightBackground', label: t('theme.background'), desc: t('theme.backgroundDescription') },
 { key: 'lightCard', label: t('theme.card'), desc: t('theme.cardDescription') },
 { key: 'lightSurface1', label: t('theme.surface1'), desc: t('theme.surface1Description') },
 { key: 'lightSurface2', label: t('theme.surface2'), desc: t('theme.surface2Description') },
 { key: 'lightSurface3', label: t('theme.surface3'), desc: t('theme.surface3Description') },
 { key: 'lightBorder', label: t('theme.border'), desc: t('theme.borderDescription') },
 { key: 'lightInput', label: t('theme.input'), desc: t('theme.inputDescription') },
 { key: 'lightPopover', label: t('theme.popover'), desc: t('theme.popoverDescription') },
 { key: 'lightMutedBackground', label: t('theme.mutedBg'), desc: t('theme.mutedBgDescription') },
 { key: 'lightForeground', label: t('theme.foreground'), desc: t('theme.foregroundDescription') },
 { key: 'lightMuted', label: t('theme.mutedText'), desc: t('theme.mutedTextDescription') },
 ];

 // ── Loading state ──
 if (isLoading) {
 return (
 <div className="flex h-64 items-center justify-center">
 <div className="flex items-center gap-3 text-sm text-muted-foreground">
 <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
 {t('theme.loading')}
 </div>
 </div>
 );
 }

 // ── Branding panel ──
 const renderBrandPanel = () => (
 <div className="space-y-6">
 <PanelSectionHeader
 title={t('theme.panelIdentity')}
 description={t('theme.panelIdentityDescription')}
 />
 <div className="grid gap-4 sm:grid-cols-2">
 <div>
 <label className="mb-1.5 block text-xs font-medium text-foreground">{t('theme.panelName')}</label>
 <input
 type="text"
 value={panelName}
 onChange={(e) => setPanelName(e.target.value)}
 placeholder="Catalyst"
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
 />
 </div>
 <div />
 <div>
 <label className="mb-1.5 block text-xs font-medium text-foreground">{t('theme.logoUrl')}</label>
 <input
 type="text"
 value={logoUrl}
 onChange={(e) => setLogoUrl(e.target.value)}
 placeholder="https://example.com/logo.png"
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
 />
 <p className="mt-1 text-[10px] text-muted-foreground">
 {t('theme.logoHint')}
 </p>
 </div>
 <div>
 <label className="mb-1.5 block text-xs font-medium text-foreground">{t('theme.faviconUrl')}</label>
 <input
 type="text"
 value={faviconUrl}
 onChange={(e) => setFaviconUrl(e.target.value)}
 placeholder="https://example.com/favicon.ico"
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
 />
 <p className="mt-1 text-[10px] text-muted-foreground">
 {t('theme.faviconHint')}
 </p>
 </div>
 </div>

 <hr className="border-border/30" />

 <PanelSectionHeader title={t('theme.themeMode')} description={t('theme.themeModeDescription')} />
 <div className="grid gap-4 sm:grid-cols-2">
 <div>
 <label className="mb-1.5 block text-xs font-medium text-foreground">{t('theme.defaultTheme')}</label>
 <select
 value={defaultTheme}
 onChange={(e) => setDefaultTheme(e.target.value)}
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
 >
 <option value="light">{t('theme.light')}</option>
 <option value="dark">{t('theme.dark')}</option>
 <option value="system">{t('theme.system')}</option>
 </select>
 </div>
 <div>
 <label className="mb-1.5 block text-xs font-medium text-foreground">
 {t('theme.availableThemes')}
 </label>
 <div className="flex gap-2">
 {[
 { id: 'light', icon: Sun, color: 'text-warning' },
 { id: 'dark', icon: Moon, color: 'text-info' },

 ].map(({ id, icon: Icon, color }) => (
 <label
 key={id}
 className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-all ${
 enabledThemes.includes(id)
 ? 'border-primary bg-primary/5 text-foreground'
 : 'border-border/30 text-muted-foreground hover:border-primary/30'
 }`}
 >
 <input
 type="checkbox"
 checked={enabledThemes.includes(id)}
 onChange={() => toggleTheme(id)}
 className="sr-only"
 />
 <Icon className={`h-4 w-4 ${color}`} />
 {id === 'dark' ? t('theme.dark') : t('theme.light')}
 </label>
 ))}
 </div>
 </div>
 </div>
 </div>
 );

 // ── Palette panel ──
 const renderPalettePanel = () => {
 const hsl = isSeedValid ? hexToHSL(seedColor) : null;
 return (
 <div className="space-y-6">
 <PanelSectionHeader
 title={t('theme.paletteTitle')}
 description={t('theme.paletteDescription')}
 />

 {/* Seed color */}
 <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
 <div className="group relative flex-shrink-0">
 <div
 className="h-24 w-24 cursor-pointer rounded-lg ring-1 ring-black/5 transition-all duration-300 group-hover:scale-105"
 style={{
 backgroundColor: isSeedValid ? seedColor : 'hsl(var(--muted-foreground))',
 boxShadow: isSeedValid
 ? `0 12px 32px ${seedColor}30, 0 4px 12px ${seedColor}15`
 : '0 4px 12px rgba(0,0,0,0.15)',
 }}
 />
 <input
 type="color"
 value={isSeedValid ? seedColor : DEFAULTS.primaryColor}
 onChange={(e) => setSeedColor(e.target.value)}
 className="absolute inset-0 h-full w-full cursor-pointer rounded-lg opacity-0"
 />
 </div>
 <div className="flex-1 space-y-3">
 <div>
 <label className="mb-1 block text-xs font-medium text-foreground">{t('theme.seedColor')}</label>
 <div className="flex items-center gap-2">
 <input
 type="text"
 value={seedColor}
 onChange={(e) => setSeedColor(e.target.value)}
 placeholder="#0d9488"
 className={`w-36 rounded-lg border bg-card px-3 py-2 font-mono text-sm transition-colors focus:outline-none focus:ring-2 ${
 isSeedValid
 ? 'border-border/40 text-foreground focus:border-primary focus:ring-primary/20'
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
 className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/30 bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
 title={t('theme.randomColor')}
 >
 <Shuffle className="h-4 w-4" />
 </button>
 {hsl && (
 <span className="text-xs tabular-nums text-muted-foreground">
 {t('theme.hslLabel', { h: hsl.h, s: hsl.s, l: hsl.l })}
 </span>
 )}
 </div>
 </div>

 {/* Harmony modes */}
 <div>
 <label className="mb-2 block text-xs font-medium text-foreground">
 {t('theme.colorHarmony')}
 </label>
 <div className="flex flex-wrap gap-1.5">
 {(
 [
 { id: 'auto' as const, label: t('theme.harmonyAuto') },
 { id: 'monochromatic' as const, label: t('theme.harmonyMono') },
 { id: 'analogous' as const, label: t('theme.harmonyAnalogous') },
 { id: 'complementary' as const, label: t('theme.harmonyComplementary') },
 { id: 'split-complementary' as const, label: t('theme.harmonySplitComplementary') },
 { id: 'triadic' as const, label: t('theme.harmonyTriadic') },
 { id: 'tetradic' as const, label: t('theme.harmonyTetradic') },
 { id: 'tetradic-rectangle' as const, label: t('theme.harmonyRectangle') },
 { id: 'diadic' as const, label: t('theme.harmonyDiadic') },
 { id: 'neutral' as const, label: t('theme.harmonyNeutral') },
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
 <div className="space-y-5 rounded-xl border border-border/30 bg-surface-1/50 p-5">
 {/* Brand */}
 <div>
 <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
 {t('theme.brand')}
 </p>
 <div className="grid grid-cols-3 gap-3">
 {[
 { label: t('theme.primary'), color: generatedPalette.primaryColor },
 { label: t('theme.secondary'), color: generatedPalette.secondaryColor },
 { label: t('theme.accent'), color: generatedPalette.accentColor },
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
 {t('theme.semantic')}
 </p>
 <div className="flex flex-wrap gap-2">
 {(
 [
 { label: t('theme.success'), key: 'successColor' as const },
 { label: t('theme.warning'), key: 'warningColor' as const },
 { label: t('theme.danger'), key: 'dangerColor' as const },
 { label: t('theme.info'), key: 'infoColor' as const },
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
 {t('theme.darkSurfaces')}
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
 {t('theme.lightSurfaces')}
 </p>
 <div className="rounded-lg border border-border/30 p-3">
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
 className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
 >
 <Wand2 className="h-4 w-4" />
 {t('theme.applyPalette')}
 </button>
 </div>
 )}
 </div>
 );
 };

 // ── Presets panel ──
 const renderPresetsPanel = () => (
 <div className="space-y-6">
 <PanelSectionHeader
 title={t('theme.presetsTitle')}
 description={t('theme.presetsDescription')}
 />
 <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
 {THEME_PRESETS.map((preset) => (
 <div key={preset.id} className="flex flex-col rounded-xl border border-border/30 bg-card p-4">
 <div className="mb-1 flex items-center justify-between">
 <p className="text-sm font-semibold text-foreground">{presetName(t, preset.id)}</p>
 {preset.customCss ? (
 <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{t('theme.plusCss')}</span>
 ) : null}
 </div>
 <p className="mb-3 min-h-8 text-[11px] leading-relaxed text-muted-foreground">{presetDescription(t, preset.id)}</p>
 <div className="mb-3 flex gap-1.5">
 {[preset.primaryColor, preset.secondaryColor, preset.accentColor].map((c, i) => (
 <div key={i} className="h-8 flex-1 rounded-md ring-1 ring-black/10" style={{ backgroundColor: c }} />
 ))}
 </div>
 <div className="mb-4 flex gap-1">
 {[preset.themeColors.darkBackground, preset.themeColors.darkSurface2, preset.themeColors.lightBackground, preset.themeColors.lightSurface2].map((c, i) => (
 <div key={i} className="h-5 flex-1 rounded-sm ring-1 ring-black/10" style={{ backgroundColor: c }} />
 ))}
 </div>
 <button
 type="button"
 onClick={() => handleApplyPreset(preset.id)}
 className="mt-auto inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/30 bg-surface-1 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-surface-2"
 >
 <Wand2 className="h-3.5 w-3.5" />
 {t('theme.applyPreset', { name: presetName(t, preset.id) })}
 </button>
 </div>
 ))}
 </div>
 <div className="rounded-xl border border-border/30 bg-surface-1/50 p-4 text-[11px] leading-relaxed text-muted-foreground">
 <p className="mb-1 font-semibold text-foreground">{t('theme.howPresetsWork')}</p>
 {t('theme.howPresetsWorkDescription')}
 </div>
 </div>
 );

 // ── Share (import/export) panel ──
 const renderManagePanel = () => {
 const exportPreview = JSON.stringify(
 buildSharedTheme({ primaryColor, secondaryColor, accentColor, themeColors, customCss }),
 null,
 2,
 );
 return (
 <div className="space-y-8">
 <div>
 <PanelSectionHeader title={t('theme.exportTheme')} description={t('theme.exportThemeDescription')} />
 <div className="flex flex-wrap gap-2">
 <button
 type="button"
 onClick={handleExportCopy}
 className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
 >
 <Copy className="h-3.5 w-3.5" />
 {t('theme.copyJson')}
 </button>
 <button
 type="button"
 onClick={handleExportDownload}
 className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
 >
 <Download className="h-3.5 w-3.5" />
 {t('theme.downloadJson')}
 </button>
 </div>
 <pre className="mt-3 max-h-64 overflow-auto rounded-lg border border-border/30 bg-surface-0 p-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
 {exportPreview}
 </pre>
 </div>

 <hr className="border-border/30" />

 <div>
 <PanelSectionHeader title={t('theme.importTheme')} description={t('theme.importThemeDescription')} />
 <div className="space-y-3">
 <textarea
 value={importText}
 onChange={(e) => { setImportText(e.target.value); setImportError(null); }}
 placeholder='{"version": 1, "primaryColor": "#0d9488", ...}'
 rows={8}
 spellCheck={false}
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
 />
 {importError && (
 <p className="flex items-center gap-1.5 text-xs text-danger">
 <AlertTriangle className="h-3.5 w-3.5" />
 {importError}
 </p>
 )}
 <div className="flex flex-wrap items-center gap-2">
 <button
 type="button"
 onClick={handleImportApply}
 disabled={!importText.trim()}
 className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
 >
 <Upload className="h-3.5 w-3.5" />
 {t('theme.previewImport')}
 </button>
 <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/30 bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-2">
 <Upload className="h-3.5 w-3.5" />
 {t('theme.chooseJsonFile')}
 <input
 type="file"
 accept="application/json,.json"
 className="hidden"
 onChange={(e) => {
 const f = e.target.files?.[0];
 if (!f) return;
 const reader = new FileReader();
 reader.onload = () => { setImportText(String(reader.result || '')); setImportError(null); };
 reader.readAsText(f);
 e.target.value = '';
 }}
 />
 </label>
 </div>
 <p className="text-[11px] text-muted-foreground">{t('theme.importHint')}</p>
 </div>
 </div>
 </div>
 );
 };

 // ── Colors panel ──
 const renderColorsPanel = () => (
 <div className="space-y-8">
 <div>
 <PanelSectionHeader
 title={t('theme.brandColors')}
 description={t('theme.brandColorsDescription')}
 onReset={() => handleResetSection('brand')}
 />
 <div className="grid gap-5 sm:grid-cols-3">
 <ColorPicker
 label={t('theme.primaryColor')}
 description={t('theme.primaryColorDescription')}
 value={primaryColor}
 onChange={handlePrimaryColorChange}
 />
 <ColorPicker
 label={t('theme.secondaryColor')}
 description={t('theme.secondaryColorDescription')}
 value={secondaryColor}
 onChange={handleSecondaryColorChange}
 />
 <ColorPicker
 label={t('theme.accentColor')}
 description={t('theme.accentColorDescription')}
 value={accentColor}
 onChange={handleAccentColorChange}
 />
 </div>
 <div className="mt-4 flex gap-2 rounded-lg border border-border/30 p-3">
 {[primaryColor, secondaryColor, accentColor].map((color, i) => (
 <div
 key={i}
 className="h-10 flex-1 rounded-md ring-1 ring-black/5"
 style={{ backgroundColor: color }}
 title={[t('theme.primaryTooltip'), t('theme.secondaryTooltip'), t('theme.accentTooltip')][i]}
 />
 ))}
 </div>
 </div>

 <hr className="border-border/30" />

 <div>
 <PanelSectionHeader
 title={t('theme.semanticColors')}
 description={t('theme.semanticColorsDescription')}
 onReset={() => handleResetSection('semantic')}
 />
 <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
 <ColorPicker
 label={t('theme.success')}
 description={t('theme.successDescription')}
 value={themeColors.successColor || ''}
 onChange={(v) => updateThemeColor('successColor', v)}
 icon={Check}
 />
 <ColorPicker
 label={t('theme.warning')}
 description={t('theme.warningDescription')}
 value={themeColors.warningColor || ''}
 onChange={(v) => updateThemeColor('warningColor', v)}
 icon={AlertTriangle}
 />
 <ColorPicker
 label={t('theme.danger')}
 description={t('theme.dangerDescription')}
 value={themeColors.dangerColor || ''}
 onChange={(v) => updateThemeColor('dangerColor', v)}
 icon={Shield}
 />
 <ColorPicker
 label={t('theme.info')}
 description={t('theme.infoDescription')}
 value={themeColors.infoColor || ''}
 onChange={(v) => updateThemeColor('infoColor', v)}
 icon={Info}
 />
 </div>
 <div className="mt-4 flex flex-wrap gap-2 rounded-lg border border-border/30 p-3">
 {[
 { color: themeColors.successColor, label: t('theme.success') },
 { color: themeColors.warningColor, label: t('theme.warning') },
 { color: themeColors.dangerColor, label: t('theme.danger') },
 { color: themeColors.infoColor, label: t('theme.info') },
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

 <hr className="border-border/30" />

 <div>
 <PanelSectionHeader
 title={t('theme.focusRing')}
 description={t('theme.focusRingDescription')}
 onReset={() => handleResetSection('focus')}
 />
 <div className="max-w-sm">
 <ColorPicker
 label={t('theme.ringColor')}
 description={t('theme.ringColorDescription')}
 value={themeColors.ringColor || ''}
 onChange={(v) => updateThemeColor('ringColor', v)}
 />
 </div>
 </div>
 </div>
 );

 // ── Surfaces panel ──
 const renderSurfacesPanel = () => (
 <div className="space-y-8">
 <div>
 <PanelSectionHeader
 title={t('theme.darkModeSurfaces')}
 description={t('theme.darkModeSurfacesDescription')}
 onReset={() => handleResetSection('dark')}
 />
 <div className="mb-5">
 <ElevationPreview
 bg={themeColors.darkBackground || ''}
 s1={themeColors.darkSurface1 || ''}
 s2={themeColors.darkSurface2 || ''}
 s3={themeColors.darkSurface3 || ''}
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

 <hr className="border-border/30" />

 <div>
 <PanelSectionHeader
 title={t('theme.lightModeSurfaces')}
 description={t('theme.lightModeSurfacesDescription')}
 onReset={() => handleResetSection('light')}
 />
 <div className="mb-5">
 <ElevationPreview
 bg={themeColors.lightBackground || ''}
 s1={themeColors.lightSurface1 || ''}
 s2={themeColors.lightSurface2 || ''}
 s3={themeColors.lightSurface3 || ''}
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
 const renderLayoutPanel = () => (
 <div className="space-y-6">
 <PanelSectionHeader
 title={t('theme.borderRadius')}
 description={t('theme.borderRadiusDescription')}
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
 <span className="w-[72px] rounded-lg border border-border/30 bg-card px-2 py-1.5 text-center font-mono text-xs text-foreground">
 {themeColors.borderRadius || '0.5rem'}
 </span>
 </div>
 <p className="text-[11px] text-muted-foreground">
 {t('theme.borderRadiusHint')}
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
 {t('theme.buttonPreview')}
 </div>
 <div
 className="flex h-14 flex-1 items-center bg-primary/10 px-4 text-sm font-medium text-primary"
 style={{ borderRadius: themeColors.borderRadius || '0.5rem' }}
 >
 {t('theme.cardPreview')}
 </div>
 </div>
 </div>
 </div>
 );

 // ── Advanced panel ──
 const renderAdvancedPanel = () => (
 <div className="space-y-8">
 <div>
 <PanelSectionHeader
 title={t('theme.customCss')}
 description={t('theme.customCssDescription')}
 />
 <div className="space-y-3">
 <textarea
 value={customCss}
 onChange={(e) => setCustomCss(e.target.value.slice(0, 100_000))}
 placeholder="/* Your custom CSS here */&#10;.my-custom-class {&#10; color: red;&#10;}"
 rows={14}
 spellCheck={false}
 className="w-full rounded-lg border border-border/40 bg-card px-3 py-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
 />
 <p className="text-[11px] text-muted-foreground">{t('theme.customCssCounter', { used: formatNumber(customCss.length) })}</p>
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={handlePreviewCustomCss}
 className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
 >
 <Eye className="h-3.5 w-3.5" />
 {t('theme.preview')}
 </button>
 <button
 type="button"
 onClick={handleResetCustomCss}
 className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
 >
 <RotateCcw className="h-3.5 w-3.5" />
 {t('theme.resetToSaved')}
 </button>
 </div>
 </div>
 </div>

 <hr className="border-border/30" />

 <div>
 <PanelSectionHeader
 title={t('theme.oauthProviders')}
 description={t('theme.oauthProvidersDescription')}
 />
 <OidcProviderSection />
 </div>
 </div>
 );

 // ── Live Preview Strip ──
 const renderLivePreviewStrip = () => (
 <div className="rounded-xl border border-border/30 bg-card p-4">
 <div className="mb-3 flex items-center justify-between">
 <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
 {t('theme.livePreview')}
 </span>
 <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
 <span
 className="h-2 w-2 rounded-full"
 style={{ backgroundColor: primaryColor }}
 />
 {t('theme.themeModeStatus', { mode: currentTheme === 'dark' ? t('theme.dark') : t('theme.light') })}
 </span>
 </div>
 <div className="flex gap-1.5">
 <div className="flex-1 space-y-1">
 <div className="flex h-5 items-center gap-1">
 <span className="text-[9px] font-medium text-muted-foreground">{t('theme.brand')}</span>
 </div>
 <div className="flex gap-1">
 {[primaryColor, secondaryColor, accentColor].map((c, i) => (
 <div
 key={i}
 className="h-5 flex-1 rounded-sm"
 style={{ backgroundColor: c }}
 title={[t('theme.primaryTooltip'), t('theme.secondaryTooltip'), t('theme.accentTooltip')][i]}
 />
 ))}
 </div>
 </div>
 <div className="flex-1 space-y-1">
 <div className="flex h-5 items-center gap-1">
 <span className="text-[9px] font-medium text-muted-foreground">{t('theme.semantic')}</span>
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
 style={{ backgroundColor: c || 'hsl(var(--muted-foreground))' }}
 />
 ))}
 </div>
 </div>
 <div className="flex-[2] space-y-1">
 <div className="flex h-5 items-center gap-1">
 <span className="text-[9px] font-medium text-muted-foreground">{t('theme.surfacesTitle')}</span>
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
 className="h-5 flex-1 rounded-sm ring-1 ring-black/10"
 style={{ backgroundColor: c || 'hsl(var(--muted-foreground))' }}
 title={t('theme.elevationLevel', { level: i })}
 />
 ))}
 </div>
 </div>
 </div>
 </div>
 );

 // ─── Render ───
 const activeTabContent = {
 presets: renderPresetsPanel(),
 brand: renderBrandPanel(),
 palette: renderPalettePanel(),
 colors: renderColorsPanel(),
 surfaces: renderSurfacesPanel(),
 layout: renderLayoutPanel(),
 manage: renderManagePanel(),
 advanced: renderAdvancedPanel(),
 };

 return (
 <div className="mx-auto max-w-5xl space-y-5">
 {hasPersonalOverride && (
 <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/30 bg-warning/5 p-4">
 <div className="flex items-start gap-2.5">
 <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
 <div>
 <p className="text-xs font-semibold text-foreground">{t('theme.personalOverrideTitle')}</p>
 <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
 {t('theme.personalOverrideDescription')}
 </p>
 </div>
 </div>
 <button
 type="button"
 onClick={() => { clearPersonalTheme(); toast.success(t('theme.toastPersonalThemeCleared')); }}
 className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
 >
 <RotateCcw className="h-3.5 w-3.5" />
 {t('theme.showPanelDefault')}
 </button>
 </div>
 )}

 {/* ── Page Header ── */}
 <TabHeader
 icon={Palette}
 title={t('theme.title')}
 description={t('theme.description')}
 actions={
 <div className="flex items-center gap-2">
 <button
 type="button"
 onClick={handleResetAll}
 className="inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-card px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-2"
 >
 <RotateCcw className="h-3.5 w-3.5" />
 {t('theme.resetAll')}
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
 {t('saving')}
 </>
 ) : (
 <>
 <Save className="h-3.5 w-3.5" />
 {t('theme.saveChanges')}
 </>
 )}
 </button>
 </div>
 }
 variant="default"
 />

 {/* ── Live Preview Strip ── */}
 {renderLivePreviewStrip()}

 <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/30 bg-card px-4 py-3">
 <div className="flex items-center gap-2 text-xs text-muted-foreground">
 <Eye className="h-3.5 w-3.5" />
 {t('theme.previewingMode', { mode: currentTheme === 'dark' ? t('theme.dark').toLowerCase() : t('theme.light').toLowerCase() })}
 </div>
 <div className="flex items-center gap-2">
 <div className="flex gap-1 rounded-lg bg-surface-1 p-1">
 {(currentTheme === 'dark' ? ['dark', 'light'] : ['light', 'dark']).map((m) => (
 <button
 key={m}
 type="button"
 onClick={() => setTheme(m as 'light' | 'dark')}
 className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
 (currentTheme === m)
 ? 'bg-card text-foreground shadow-sm ring-1 ring-black/5'
 : 'text-muted-foreground hover:text-foreground'
 }`}
 >
 {m === 'dark' ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
 {m === 'dark' ? t('theme.dark') : t('theme.light')}
 </button>
 ))}
 </div>
 {(contrastInfo.dark !== null || contrastInfo.light !== null) && (
 <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
 {contrastInfo.dark !== null && (
 <span title={t('theme.darkContrastTitle')}>{t('theme.contrastValue', { mode: t('theme.dark'), ratio: contrastInfo.dark.toFixed(1) })}</span>
 )}
 {contrastInfo.light !== null && (
 <span title={t('theme.lightContrastTitle')}>{t('theme.contrastValue', { mode: t('theme.light'), ratio: contrastInfo.light.toFixed(1) })}</span>
 )}
 </div>
 )}
 </div>
 </div>

 {/* ── Tab Navigation ── */}
 <div className="flex gap-1 overflow-x-auto rounded-xl border border-border/30 bg-surface-1 p-1">
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
 ? 'bg-card text-foreground shadow-sm ring-1 ring-black/5'
 : 'text-muted-foreground hover:bg-surface-2/50 hover:text-foreground'
 }`}
 >
 <Icon className="h-3.5 w-3.5" />
 <span className="hidden sm:inline">{tabLabel(t, tab.id)}</span>
 </button>
 );
 })}
 </div>

 {/* ── Active Tab Content ── */}
 <ServerTabCard>
 {activeTabContent[activeTab]}
 </ServerTabCard>
 </div>
 );
}

export default ThemeSettingsPage;
