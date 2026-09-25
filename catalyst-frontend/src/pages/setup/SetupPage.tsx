import { useState, useEffect, useMemo, useCallback, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore, defaultThemeColors } from '../../stores/themeStore';
import { useSetupStatus } from '../../hooks/useSetupStatus';
import apiClient from '../../services/api/client';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';
import { reportSystemError } from '../../services/api/systemErrors';
import { getLocalizedErrorMessage } from '../../i18n/api-errors';
import { describeError } from '../../utils/errors';
import { BrandFooter } from '../../components/shared/BrandFooter';
import LanguageSwitcher from '../../components/shared/LanguageSwitcher';
import { BracketLabel } from '../../components/deck/primitives';
import { generatePalette, hexToHSL, type HarmonyMode } from '../../utils/generatePalette';
import { cn } from '../../lib/utils';
import type { ThemeColors } from '../../services/api/theme';
import {
 Upload,
 Eye,
 EyeOff,
 ArrowRight,
 ArrowLeft,
 Check,
 Palette,
 Sparkles,
 User,
 Monitor,
 Moon,
 Sun,
 X,
 Shuffle,
} from 'lucide-react';

const stepIcons = [Sparkles, User, Palette];

// ── Swatch (tiny color preview chip) ──

function Swatch({ color, label }: { color: string; label?: string }) {
 return (
 <div className="group/swatch flex flex-col items-center gap-1">
 <div
 className="h-9 w-full rounded-sm ring-1 ring-border/70 transition-transform group-hover/swatch:-translate-y-0.5"
 style={{ backgroundColor: color }}
 />
 {label && (
 <span className="font-mono text-micro text-muted-foreground">
 {label}
 </span>
 )}
 </div>
 );
}

// ── Main component ──

function SetupPage() {
 const { t } = useTranslation('setup');
 const navigate = useNavigate();
 const init = useAuthStore((s) => s.init);
 const previewColors = useThemeStore((s) => s.previewColors);
 const cancelPreview = useThemeStore((s) => s.cancelPreview);
 const applyTheme = useThemeStore((s) => s.applyTheme);
 const setTheme = useThemeStore((s) => s.setTheme);
 const { recheck } = useSetupStatus();

 const [currentStep, setCurrentStep] = useState(0);
 const [_, setDirection] = useState(1);
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [alreadySetup, setAlreadySetup] = useState(false);

 const stepLabels = [t('steps.welcome'), t('steps.adminAccount'), t('steps.appearance')];

 // ── Step 1 state ──
 const [panelName, setPanelName] = useState('Catalyst');
 const [logoDataUri, setLogoDataUri] = useState<string | null>(null);

 // ── Step 2 state ──
 const [email, setEmail] = useState('');
 const [username, setUsername] = useState('');
 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [showPassword, setShowPassword] = useState(false);
 const [showConfirm, setShowConfirm] = useState(false);

 // ── Step 3 state ──
 const [seedColor, setSeedColor] = useState('#c48d5a');
 const [harmonyMode, setHarmonyMode] = useState<HarmonyMode>('auto');
 const [primaryColor] = useState('#c48d5a');
 const [secondaryColor] = useState('#5ac4c2');
 const [accentColor] = useState('#5a5cc4');
 const [themeColors] = useState<ThemeColors>({ ...defaultThemeColors });
 const [defaultTheme, setDefaultTheme] = useState<'light' | 'dark'>('dark');

 // ── Palette generation ──
 const isSeedValid = /^#[0-9A-Fa-f]{6}$/.test(seedColor);
 const generatedPalette = useMemo(
 () => (isSeedValid ? generatePalette(seedColor, harmonyMode) : null),
 [seedColor, harmonyMode, isSeedValid],
 );

 // Check if setup is already done
 useEffect(() => {
 const checkStatus = async () => {
 try {
 const data = await apiClient.get<{ setupRequired: boolean }>('/api/setup/status');
 // Dev preview: `?preview=1` renders the wizard on an already-set-up panel
 // so its states can be reviewed. Submitting is unchanged.
 const previewWizard =
   import.meta.env.DEV &&
   typeof window !== 'undefined' &&
   new URLSearchParams(window.location.search).has('preview');
 if (!data.setupRequired && !previewWizard) {
   setAlreadySetup(true);
   navigate('/login', { replace: true });
 }
 } catch (err) {
 reportSystemError({
 level: 'error',
 component: 'SetupPage',
 message: describeError(err),
 stack: err instanceof Error ? err.stack : undefined,
 metadata: { context: 'checkSetupStatus' },
 });
 // Endpoint might not exist yet; allow the wizard to render
 }
 };
 checkStatus();
 }, [navigate]);

 // Live color preview — applies generated palette to DOM in real time
 useEffect(() => {
 previewColors({ primaryColor, secondaryColor, accentColor, themeColors });
 return () => {
 cancelPreview();
 applyTheme();
 };
 }, [primaryColor, secondaryColor, accentColor, themeColors, previewColors, cancelPreview, applyTheme]);

 // ── Validation ──

 const validateStep2 = useCallback((): boolean => {
 if (!email.trim()) {
 setError(t('errors.emailRequired'));
 return false;
 }
 if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
 setError(t('errors.emailInvalid'));
 return false;
 }
 if (!username.trim()) {
 setError(t('errors.usernameRequired'));
 return false;
 }
 if (username.trim().length < 3) {
 setError(t('errors.usernameTooShort', { min: 3 }));
 return false;
 }
 if (!password) {
 setError(t('errors.passwordRequired'));
 return false;
 }
 if (password.length < 8) {
 setError(t('errors.passwordTooShort', { min: 8 }));
 return false;
 }
 if (password !== confirmPassword) {
 setError(t('admin.passwordMismatch'));
 return false;
 }
 setError(null);
 return true;
 }, [email, username, password, confirmPassword, t]);

 // ── Navigation ──

 const goNext = () => {
 if (currentStep === 1 && !validateStep2()) return;
 setDirection(1);
 setError(null);
 setCurrentStep((s) => Math.min(s + 1, 2));
 };

 const goBack = () => {
 setDirection(-1);
 setError(null);
 setCurrentStep((s) => Math.max(s - 1, 0));
 };

 // Form submit handler — enables Enter key navigation
 const handleFormSubmit = (e: React.FormEvent) => {
 e.preventDefault();
 if (currentStep < 2) {
 goNext();
 } else {
 handleSubmit();
 }
 };

 // ── Logo upload ──

 const handleLogoUpload = (e: ChangeEvent<HTMLInputElement>) => {
 const file = e.target.files?.[0];
 if (!file) return;
 if (!file.type.startsWith('image/')) return;
 if (file.size > 512 * 1024) {
 setError(t('errors.logoTooLarge'));
 return;
 }
 const reader = new FileReader();
 reader.onload = () => setLogoDataUri(reader.result as string);
 reader.readAsDataURL(file);
 };

 const clearLogo = () => {
 setLogoDataUri(null);
 };

 // ── Submit ──

 const handleSubmit = async () => {
 if (isSubmitting) return;
 setIsSubmitting(true);
 setError(null);

 try {
 await apiClient.post<{
 success: boolean;
 data: {
 id: string;
 email: string;
 username: string;
 name?: string | null;
 firstName?: string | null;
 lastName?: string | null;
 image?: string | null;
 role?: string;
 permissions?: string[];
 panelName?: string;
 };
 }>('/api/setup/complete', {
 panelName: panelName.trim() || 'Catalyst',
 logoUrl: logoDataUri || undefined,
 email: email.trim(),
 username: username.trim(),
 password,
 primaryColor,
 secondaryColor,
 accentColor,
 defaultTheme,
 metadata: { themeColors },
 });

 // Cancel preview and re-apply theme with saved settings
 cancelPreview();

 // Notify App.tsx that setup is complete so it re-fetches status
 window.dispatchEvent(new CustomEvent('catalyst:setup-complete'));
 recheck();

 // Re-initialize auth (backend sets session cookies).
 // Retry a few times with delays — browsers need time to process
 // Set-Cookie before the cookie jar is ready for the next request.
 let loggedIn = false;
 for (let attempt = 0; attempt < 4; attempt++) {
 if (attempt > 0) {
 await new Promise((resolve) => setTimeout(resolve, 400));
 }
 try {
 await init();
 loggedIn = true;
 break;
 } catch {
 // Cookie not ready yet — retry
 }
 }

 if (loggedIn) {
 navigate('/dashboard', { replace: true });
 } else {
 // Cookie-based auto-login failed (common in fresh Docker installs
 // behind reverse proxies). Redirect to /login so the user can sign
 // in manually. App.tsx now includes /login in the setup-only router,
 // so this cannot loop.
 navigate('/login', { replace: true, state: { fromSetup: true } });
 }
 } catch (err: any) {
 reportSystemError({
 level: 'error',
 component: 'SetupPage',
 message: describeError(err),
 stack: err instanceof Error ? err.stack : undefined,
 metadata: { context: 'handleSubmit' },
 });
 setError(getLocalizedErrorMessage(err));
 } finally {
 setIsSubmitting(false);
 }
 };

 // ── Don't render if redirecting ──
 if (alreadySetup) return null;

 // ── Input class ──
 const inputClass =
 'h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';

 const labelClass = 'block text-mini text-muted-foreground';

 return (
 <div className="app-shell relative flex min-h-screen items-center justify-center px-4 font-sans">
 <div className="absolute right-4 top-4 z-20">
 <LanguageSwitcher variant="compact" />
 </div>
 <div className="relative z-10 w-full max-w-lg space-y-4">
 <div className="deck-panel px-3 py-3 sm:px-4 sm:py-4">
 {/* ── Step indicator ── */}
 <div className="mb-6 flex items-center gap-2 overflow-x-auto">
 {stepLabels.map((label, i) => {
 const Icon = stepIcons[i];
 const isActive = i === currentStep;
 const isComplete = i < currentStep;
 return (
 <div key={label} className="flex flex-1 items-center gap-2">
 <div
 className={cn(
 'flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 font-display text-micro font-semibold transition-colors sm:px-2.5',
 isActive
 ? 'border-primary/50 bg-primary/10 text-primary'
 : isComplete
 ? 'border-success/40 text-success'
 : 'border-border/60 text-muted-foreground',
 )}
 >
 {isComplete ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
 <span>{label}</span>
 </div>
 {i < 2 && (
 <span
 className={cn(
 'hidden h-px flex-1 transition-colors sm:block',
 i < currentStep ? 'bg-primary/60' : 'bg-border/50',
 )}
 />
 )}
 </div>
 );
 })}
 </div>

 {/* ── Error display ── */}
 {error && (
 <div className="mb-4 rounded-sm border border-danger/25 bg-danger/5 px-3 py-2.5 text-mini text-danger">
 {error}
 </div>
 )}

 {/* ── Form wrapper enables Enter key navigation ── */}
 <form onSubmit={handleFormSubmit}>
 {/* ── Steps ── */}
 {/* ─── STEP 1: Welcome & Identity ─── */}
 {currentStep === 0 && (
 <div key="step-1">
 <div>
 <BracketLabel>{t('welcome.title')}</BracketLabel>
 <p className="type-meta mt-1">{t('welcome.description')}</p>
 </div>

 <div className="mt-6 space-y-5">
 {/* Panel name */}
 <div className="space-y-2">
 <label className={labelClass} htmlFor="panelName">
 {t('welcome.panelName')}
 </label>
 <input
 id="panelName"
 type="text"
 className={inputClass}
 value={panelName}
 onChange={(e) => setPanelName(e.target.value)}
 placeholder="Catalyst"
 />
 </div>

 {/* Logo upload */}
 <div className="space-y-2">
 <label className={labelClass}>{t('welcome.panelLogo')}</label>
 <div className="flex items-start gap-3">
 {logoDataUri ? (
 <div className="relative">
 <img
 src={logoDataUri}
 alt={t('welcome.logoPreviewAlt')}
 className="h-16 w-16 rounded-sm border border-border object-contain p-1"
 />
 <button
 type="button"
 onClick={clearLogo}
 className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-sm bg-danger/70 text-primary-foreground transition-colors hover:bg-danger"
 >
 <X className="h-3 w-3" />
 </button>
 </div>
 ) : (
 <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-border/60 transition-colors hover:border-primary/50 hover:bg-primary/5">
 <Upload className="h-5 w-5 text-muted-foreground" />
 <span className="text-micro text-muted-foreground">{t('common:actions.upload')}</span>
 <input
 type="file"
 accept="image/*"
 className="hidden"
 onChange={handleLogoUpload}
 />
 </label>
 )}
 <div className="flex-1 pt-1">
 <p className="text-mini text-muted-foreground">
 {t('welcome.logoHint')}
 </p>
 {!logoDataUri && (
 <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-mini font-medium text-primary transition-colors hover:text-primary/80">
 {t('welcome.chooseFile')}
 <input
 type="file"
 accept="image/*"
 className="hidden"
 onChange={handleLogoUpload}
 />
 </label>
 )}
 </div>
 </div>
 </div>

 {/* Preview card */}
 <div className="space-y-2">
 <label className={labelClass}>{t('welcome.preview')}</label>
 <div className="flex items-center gap-3 rounded-sm border border-border/60 bg-surface-1/40 p-3">
 <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-primary/10">
 {logoDataUri ? (
 <img
 src={logoDataUri}
 alt={t('welcome.logoAlt')}
 className="h-7 w-7 rounded-sm object-contain"
 />
 ) : (
 <Sparkles className="h-5 w-5 text-primary" />
 )}
 </div>
 <div>
 <p className="font-display text-mini font-semibold text-foreground">
 {t('welcome.panelPreview', { panelName: panelName || 'Catalyst' })}
 </p>
 <p className="text-mini text-muted-foreground">{t('welcome.productTagline')}</p>
 </div>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* ─── STEP 2: Admin Account ─── */}
 {currentStep === 1 && (
 <div key="step-2">
 <div>
 <BracketLabel>{t('admin.title')}</BracketLabel>
 <p className="type-meta mt-1">{t('admin.description')}</p>
 </div>

 <div className="mt-6 space-y-4">
 {/* Email */}
 <div className="space-y-2">
 <label className={labelClass} htmlFor="adminEmail">
 {t('admin.email')}
 </label>
 <input
 id="adminEmail"
 type="email"
 className={inputClass}
 value={email}
 onChange={(e) => {
 setEmail(e.target.value);
 setError(null);
 }}
 placeholder={t('admin.emailPlaceholder')}
 autoComplete="email"
 />
 </div>

 {/* Username */}
 <div className="space-y-2">
 <label className={labelClass} htmlFor="adminUsername">
 {t('admin.username')}
 </label>
 <input
 id="adminUsername"
 type="text"
 className={inputClass}
 value={username}
 onChange={(e) => {
 setUsername(e.target.value);
 setError(null);
 }}
 placeholder={t('admin.usernamePlaceholder')}
 autoComplete="username"
 />
 </div>

 {/* Password */}
 <div className="space-y-2">
 <label className={labelClass} htmlFor="adminPassword">
 {t('admin.password')}
 </label>
 <div className="relative">
 <input
 id="adminPassword"
 type={showPassword ? 'text' : 'password'}
 className={cn(inputClass, 'pr-10')}
 value={password}
 onChange={(e) => {
 setPassword(e.target.value);
 setError(null);
 }}
 placeholder="••••••••"
 autoComplete="new-password"
 />
 <button
 type="button"
 onClick={() => setShowPassword(!showPassword)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
 tabIndex={-1}
 >
 {showPassword ? (
 <EyeOff className="h-4 w-4" />
 ) : (
 <Eye className="h-4 w-4" />
 )}
 </button>
 </div>
 <PasswordStrengthMeter password={password} />
 </div>

 {/* Confirm password */}
 <div className="space-y-2">
 <label className={labelClass} htmlFor="adminConfirmPassword">
 {t('admin.confirmPassword')}
 </label>
 <div className="relative">
 <input
 id="adminConfirmPassword"
 type={showConfirm ? 'text' : 'password'}
 className={cn(inputClass, 'pr-10')}
 value={confirmPassword}
 onChange={(e) => {
 setConfirmPassword(e.target.value);
 setError(null);
 }}
 placeholder="••••••••"
 autoComplete="new-password"
 />
 <button
 type="button"
 onClick={() => setShowConfirm(!showConfirm)}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
 tabIndex={-1}
 >
 {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
 </button>
 </div>
 {confirmPassword && password !== confirmPassword && (
 <p className="text-mini text-danger">{t('admin.passwordMismatch')}</p>
 )}
 </div>
 </div>
 </div>
 )}

 {/* ─── STEP 3: Appearance (Palette Studio) ─── */}
 {currentStep === 2 && (
 <div key="step-3">
 <div>
 <BracketLabel>{t('appearance.title')}</BracketLabel>
 <p className="type-meta mt-1">{t('appearance.description')}</p>
 </div>

 <div className="mt-6 space-y-6">
 {/* Seed color picker */}
 <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
 <div className="group relative flex-shrink-0">
 <div
 className="h-20 w-20 cursor-pointer rounded-sm ring-1 ring-border/70 transition-transform group-hover:-translate-y-0.5"
 style={{ backgroundColor: isSeedValid ? seedColor : 'hsl(var(--muted))' }}
 />
 <input
 type="color"
 value={isSeedValid ? seedColor : '#c48d5a'}
 onChange={(e) => setSeedColor(e.target.value)}
 className="absolute inset-0 h-full w-full cursor-pointer rounded-sm opacity-0"
 />
 </div>
 <div className="flex-1 space-y-3">
 <div>
 <label className="mb-1 block text-mini font-medium text-foreground">{t('appearance.seedColor')}</label>
 <div className="flex items-center gap-2">
 <input
 type="text"
 value={seedColor}
 onChange={(e) => setSeedColor(e.target.value)}
 placeholder="#c48d5a"
 className={`h-8 w-36 rounded-sm border bg-background/40 px-2.5 font-mono text-mini outline-none transition-colors focus:ring-1 ${
 isSeedValid
 ? 'border-border/60 text-foreground focus:border-primary focus:ring-primary/40'
 : 'border-danger/40 text-danger focus:border-danger focus:ring-danger/40'
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
 className="flex h-8 w-8 items-center justify-center rounded-sm border border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
 title={t('appearance.randomColor')}
 >
 <Shuffle className="h-4 w-4" />
 </button>
 {isSeedValid && (() => {
 const hsl = hexToHSL(seedColor);
 return (
 <span className="font-mono text-mini tabular-nums text-muted-foreground">
 HSL({hsl.h}°, {hsl.s}%, {hsl.l}%)
 </span>
 );
 })()}
 </div>
 </div>

 {/* Harmony modes */}
 <div>
 <label className="mb-1.5 block text-mini font-medium text-foreground">
 {t('appearance.colorHarmony')}
 </label>
 <div className="flex flex-wrap gap-1">
 {(
 [
 { id: 'auto' as const, label: t('harmony.auto') },
 { id: 'monochromatic' as const, label: t('harmony.mono') },
 { id: 'analogous' as const, label: t('harmony.analogous') },
 { id: 'complementary' as const, label: t('harmony.complement') },
 { id: 'split-complementary' as const, label: t('harmony.splitComplement') },
 { id: 'triadic' as const, label: t('harmony.triadic') },
 { id: 'tetradic' as const, label: t('harmony.tetradic') },
 { id: 'diadic' as const, label: t('harmony.diadic') },
 { id: 'neutral' as const, label: t('harmony.neutral') },
 ] as const
 ).map((m) => (
 <button
 key={m.id}
 type="button"
 onClick={() => setHarmonyMode(m.id)}
 className={`rounded-sm px-2.5 py-1 text-micro font-medium transition-colors ${
 harmonyMode === m.id
 ? 'bg-primary text-primary-foreground'
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
 <div className="space-y-4 rounded-sm border border-border/50 bg-surface-1/40 p-3">
 {/* Brand colors */}
 <div>
 <p className="type-overline mb-2">
 {t('palette.brand')}
 </p>
 <div className="grid grid-cols-3 gap-3">
 {[
 { label: t('palette.primary'), color: generatedPalette.primaryColor },
 { label: t('palette.secondary'), color: generatedPalette.secondaryColor },
 { label: t('palette.accent'), color: generatedPalette.accentColor },
 ].map(({ label, color }) => (
 <div key={label}>
 <Swatch color={color} />
 <p className="mt-1.5 text-center text-micro font-medium text-muted-foreground">
 {label}
 </p>
 <p className="text-center font-mono text-micro text-muted-foreground/70">
 {color}
 </p>
 </div>
 ))}
 </div>
 </div>

 {/* Semantic */}
 <div>
 <p className="type-overline mb-2">
 {t('palette.semantic')}
 </p>
 <div className="flex flex-wrap gap-2">
 {(
 [
 { label: t('palette.success'), key: 'successColor' as const },
 { label: t('palette.warning'), key: 'warningColor' as const },
 { label: t('palette.danger'), key: 'dangerColor' as const },
 { label: t('palette.info'), key: 'infoColor' as const },
 ] as const
 ).map(({ label, key }) => (
 <span
 key={label}
 className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-micro font-medium"
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
 <p className="type-overline mb-2">
 {t('appearance.darkSurfaces')}
 </p>
 <div className="rounded-sm bg-surface-0 p-3">
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
 <p className="type-overline mb-2">
 {t('appearance.lightSurfaces')}
 </p>
 <div className="rounded-sm border border-border/50 p-3">
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
 </div>
 )}

 {/* Theme toggle */}
 <div className="space-y-2.5">
 <label className={labelClass}>{t('appearance.defaultTheme')}</label>
 <div className="flex gap-3">
 <button
 type="button"
 onClick={() => {
 setDefaultTheme('dark');
 setTheme('dark');
 }}
 className={cn(
 'flex flex-1 items-center justify-center gap-2 rounded-sm border px-4 py-2 text-mini font-medium transition-colors',
 defaultTheme === 'dark'
 ? 'border-primary/50 bg-primary/10 text-primary'
 : 'border-border/60 text-muted-foreground hover:border-foreground/20',
 )}
 >
 <Moon className="h-4 w-4" />
 <span>{t('appearance.dark')}</span>
 </button>
 <button
 type="button"
 onClick={() => {
 setDefaultTheme('light');
 setTheme('light');
 }}
 className={cn(
 'flex flex-1 items-center justify-center gap-2 rounded-sm border px-4 py-2 text-mini font-medium transition-colors',
 defaultTheme === 'light'
 ? 'border-primary/50 bg-primary/10 text-primary'
 : 'border-border/60 text-muted-foreground hover:border-foreground/20',
 )}
 >
 <Sun className="h-4 w-4" />
 <span>{t('appearance.light')}</span>
 </button>
 </div>
 </div>

 {/* Live preview */}
 <div className="space-y-2">
 <label className={labelClass}>{t('appearance.livePreview')}</label>
 <div className="overflow-hidden rounded-sm border border-border/60">
 {/* Mock header */}
 <div
 className="flex items-center gap-2 px-3 py-2"
 style={{ backgroundColor: primaryColor }}
 >
 <Monitor className="h-4 w-4 text-primary-foreground" />
 <span className="font-display text-mini font-semibold text-primary-foreground">
 {panelName || 'Catalyst'}
 </span>
 </div>
 {/* Mock content */}
 <div className="space-y-3 p-3">
 <div className="flex items-center gap-2">
 <div className="h-2 w-24 bg-surface-3" />
 <div
 className="h-2 w-16"
 style={{ backgroundColor: accentColor, opacity: 0.4 }}
 />
 </div>
 <div className="grid grid-cols-2 gap-2">
 <div className="rounded-sm border border-border/60 p-2.5">
 <div className="h-2 w-14 bg-surface-3" />
 <div className="mt-1.5 h-1.5 w-10 bg-surface-3/60" />
 </div>
 <div className="rounded-sm border border-border/60 p-2.5">
 <div className="h-2 w-12 bg-surface-3" />
 <div className="mt-1.5 h-1.5 w-8 bg-surface-3/60" />
 </div>
 </div>
 <div className="flex gap-2">
 <div
 className="flex h-7 flex-1 items-center justify-center rounded-sm text-micro font-medium text-primary-foreground"
 style={{ backgroundColor: primaryColor }}
 >
 {t('appearance.primaryButton')}
 </div>
 <div
 className="flex h-7 flex-1 items-center justify-center rounded-sm text-micro font-medium text-primary-foreground"
 style={{ backgroundColor: accentColor }}
 >
 {t('appearance.accentButton')}
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* ── Navigation buttons ── */}
 <div className="mt-8 flex items-center justify-between">
 {currentStep > 0 ? (
 <button
 type="button"
 onClick={goBack}
 className="pressable flex h-8 items-center gap-1.5 rounded-sm px-3 font-display text-mini font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
 >
 <ArrowLeft className="h-4 w-4" />
 {t('common:actions.back')}
 </button>
 ) : (
 <div />
 )}

 {currentStep < 2 ? (
 <button
 type="submit"
 className="pressable flex h-8 items-center gap-1.5 rounded-sm bg-primary px-4 font-display text-mini font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
 >
 {t('common:actions.next')}
 <ArrowRight className="h-4 w-4" />
 </button>
 ) : (
 <button
 type="submit"
 disabled={isSubmitting}
 className="pressable flex h-8 items-center gap-1.5 rounded-sm bg-primary px-4 font-display text-mini font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70"
 >
 {isSubmitting ? (
 <>
 <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
 {t('submit.completing')}
 </>
 ) : (
 <>
 {t('submit.complete')}
 <Check className="h-4 w-4" />
 </>
 )}
 </button>
 )}
 </div>
 </form>

 {/* Step counter */}
 <p className="mt-4 text-center text-mini text-muted-foreground/60">
 {t('steps.progress', { current: currentStep + 1, total: 3 })}
 </p>
 </div>
 </div>

 <BrandFooter />
 </div>
 );
}

export default SetupPage;
