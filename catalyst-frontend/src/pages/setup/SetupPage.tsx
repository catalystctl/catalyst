import { useState, useEffect, useMemo, useCallback, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore, defaultThemeColors } from '../../stores/themeStore';
import { useSetupStatus } from '../../hooks/useSetupStatus';
import apiClient from '../../services/api/client';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';
import { reportSystemError } from '../../services/api/systemErrors';
import { BrandFooter } from '../../components/shared/BrandFooter';
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
import TabHeader from '../../components/servers/tabs/TabHeader';
import ServerTabCard from '../../components/servers/tabs/ServerTabCard';
import SectionHeader from '../../components/servers/tabs/SectionHeader';

const stepLabels = ['Welcome', 'Admin Account', 'Appearance'];
const stepIcons = [Sparkles, User, Palette];

// ── Swatch (tiny color preview chip) ──

function Swatch({ color, label }: { color: string; label?: string }) {
  return (
    <div className="group/swatch flex flex-col items-center gap-1">
      <div
        className="h-10 w-full rounded-md ring-1 ring-black/5 transition-transform hover:scale-105"
        style={{ backgroundColor: color }}
      />
      {label && (
        <span className="text-[11px] font-medium text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  );
}

// ── Main component ──

function SetupPage() {
  const navigate = useNavigate();
  const init = useAuthStore((s) => s.init);
  const previewColors = useThemeStore((s) => s.previewColors);
  const cancelPreview = useThemeStore((s) => s.cancelPreview);
  const applyTheme = useThemeStore((s) => s.applyTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const { recheck } = useSetupStatus();

  const [currentStep, setCurrentStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadySetup, setAlreadySetup] = useState(false);

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
  const [seedColor, setSeedColor] = useState('#0d9488');
  const [harmonyMode, setHarmonyMode] = useState<HarmonyMode>('auto');
  const [primaryColor, setPrimaryColor] = useState('#0d9488');
  const [secondaryColor, setSecondaryColor] = useState('#8b5cf6');
  const [accentColor, setAccentColor] = useState('#06b6d4');
  const [themeColors, setThemeColors] = useState<ThemeColors>({ ...defaultThemeColors });
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
        if (!data.setupRequired) {
          setAlreadySetup(true);
          navigate('/login', { replace: true });
        }
      } catch (err) {
        reportSystemError({
          level: 'error',
          component: 'SetupPage',
          message: err instanceof Error ? err.message : String(err),
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

  // When palette is generated, apply it to local state + preview
  const handleApplyPalette = useCallback(() => {
    if (!generatedPalette) return;
    const { primaryColor: p, secondaryColor: sec, accentColor: acc, themeColors: tc } = generatedPalette;
    setPrimaryColor(p);
    setSecondaryColor(sec);
    setAccentColor(acc);
    setThemeColors(tc);
  }, [generatedPalette]);

  // Auto-apply palette when seed or harmony mode changes
  useEffect(() => {
    if (generatedPalette) {
      handleApplyPalette();
    }
  }, [generatedPalette, handleApplyPalette]);

  // ── Validation ──

  const validateStep2 = useCallback((): boolean => {
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Invalid email address');
      return false;
    }
    if (!username.trim()) {
      setError('Username is required');
      return false;
    }
    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters');
      return false;
    }
    if (!password) {
      setError('Password is required');
      return false;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    setError(null);
    return true;
  }, [email, username, password, confirmPassword]);

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
      setError('Logo must be smaller than 512KB');
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
      const response = await apiClient.post<{
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
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'handleSubmit' },
      });
      const message =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        'Setup failed. Please try again.';
      setError(typeof message === 'string' ? message : 'Setup failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Don't render if redirecting ──
  if (alreadySetup) return null;

  // ── Input class ──
  const inputClass =
    'w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary';

  const labelClass = 'block text-sm text-muted-foreground';

  return (
    <div className="app-shell relative flex min-h-screen items-center justify-center px-4 font-sans">
      <div className="relative z-10 w-full max-w-lg space-y-4">
        <ServerTabCard>
          {/* ── Step indicator ── */}
          <div className="mb-8 flex items-center justify-center gap-2">
            {stepLabels.map((label, i) => {
              const Icon = stepIcons[i];
              const isActive = i === currentStep;
              const isComplete = i < currentStep;
              return (
                <div key={label} className="flex items-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-300',
                        isActive
                          ? 'border-primary bg-primary/10 text-primary'
                          : isComplete
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-surface-3 text-muted-foreground',
                      )}
                    >
                      {isComplete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </div>
                    <span
                      className={cn(
                        'text-[11px] font-medium transition-colors',
                        isActive ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {label}
                    </span>
                  </div>
                  {i < 2 && (
                    <div
                      className={cn(
                        'mx-3 mb-5 h-0.5 w-10 transition-colors duration-300',
                        i < currentStep ? 'bg-primary' : 'bg-surface-3',
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Error display ── */}
          {error && (
            <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* ── Form wrapper enables Enter key navigation ── */}
          <form onSubmit={handleFormSubmit}>
            {/* ── Steps ── */}
            {/* ─── STEP 1: Welcome & Identity ─── */}
            {currentStep === 0 && (
              <div key="step-1">
                <TabHeader
                  icon={Sparkles}
                  title="Welcome to Catalyst"
                  description="Let's configure your panel. This only takes a minute."
                />

                <div className="mt-6 space-y-5">
                  {/* Panel name */}
                  <div className="space-y-2">
                    <label className={labelClass} htmlFor="panelName">
                      Panel Name
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
                    <label className={labelClass}>Panel Logo (optional)</label>
                    <div className="flex items-start gap-3">
                      {logoDataUri ? (
                        <div className="relative">
                          <img
                            src={logoDataUri}
                            alt="Logo preview"
                            className="h-16 w-16 rounded-lg border border-border object-contain p-1"
                          />
                          <button
                            type="button"
                            onClick={clearLogo}
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive/50 text-destructive-foreground shadow-sm transition-colors hover:bg-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-surface-3 transition-colors hover:border-primary/50 hover:bg-primary/5">
                          <Upload className="h-5 w-5 text-muted-foreground" />
                          <span className="text-[9px] text-muted-foreground">Upload</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleLogoUpload}
                          />
                        </label>
                      )}
                      <div className="flex-1 pt-1">
                        <p className="text-xs text-muted-foreground">
                          Recommended: square image, at least 128x128px. Max 512KB.
                        </p>
                        {!logoDataUri && (
                          <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary-600 transition-colors hover:text-primary">
                            Choose file
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
                    <label className={labelClass}>Preview</label>
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/50 p-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        {logoDataUri ? (
                          <img
                            src={logoDataUri}
                            alt="Logo"
                            className="h-7 w-7 rounded object-contain"
                          />
                        ) : (
                          <Sparkles className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {panelName || 'Catalyst'} Panel
                        </p>
                        <p className="text-xs text-muted-foreground">Game Server Management</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ─── STEP 2: Admin Account ─── */}
            {currentStep === 1 && (
              <div key="step-2">
                <TabHeader
                  icon={User}
                  title="Create Admin Account"
                  description="This will be your primary administrator account."
                />

                <div className="mt-6 space-y-4">
                  {/* Email */}
                  <div className="space-y-2">
                    <label className={labelClass} htmlFor="adminEmail">
                      Email
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
                      placeholder="admin@example.com"
                      autoComplete="email"
                    />
                  </div>

                  {/* Username */}
                  <div className="space-y-2">
                    <label className={labelClass} htmlFor="adminUsername">
                      Username
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
                      placeholder="admin"
                      autoComplete="username"
                    />
                  </div>

                  {/* Password */}
                  <div className="space-y-2">
                    <label className={labelClass} htmlFor="adminPassword">
                      Password
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
                      Confirm Password
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
                      <p className="text-xs text-destructive">Passwords do not match</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ─── STEP 3: Appearance (Palette Studio) ─── */}
            {currentStep === 2 && (
              <div key="step-3">
                <TabHeader
                  icon={Palette}
                  title="Appearance"
                  description="Pick one color and we'll generate a complete theme."
                />

                <div className="mt-6 space-y-6">
                  {/* Seed color picker */}
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                    <div className="group relative flex-shrink-0">
                      <div
                        className="h-20 w-20 cursor-pointer rounded-2xl ring-1 ring-black/5 transition-all duration-300 group-hover:scale-105"
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
                            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                            title="Random color"
                          >
                            <Shuffle className="h-4 w-4" />
                          </button>
                          {isSeedValid && (() => {
                            const hsl = hexToHSL(seedColor);
                            return (
                              <span className="text-xs tabular-nums text-muted-foreground">
                                HSL({hsl.h}°, {hsl.s}%, {hsl.l}%)
                              </span>
                            );
                          })()}
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
                              { id: 'complementary' as const, label: 'Complement' },
                              { id: 'split-complementary' as const, label: 'Split Comp.' },
                              { id: 'triadic' as const, label: 'Triadic' },
                              { id: 'tetradic' as const, label: 'Tetradic' },
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
                    <div className="space-y-4 rounded-xl border border-border bg-surface-1/50 p-4">
                      {/* Brand colors */}
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
                    </div>
                  )}

                  {/* Theme toggle */}
                  <div className="space-y-2.5">
                    <label className={labelClass}>Default Theme</label>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setDefaultTheme('dark');
                          setTheme('dark');
                        }}
                        className={cn(
                          'flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 transition-all duration-200',
                          defaultTheme === 'dark'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-surface-3 text-muted-foreground hover:border-foreground/20',
                        )}
                      >
                        <Moon className="h-4 w-4" />
                        <span className="text-sm font-medium">Dark</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDefaultTheme('light');
                          setTheme('light');
                        }}
                        className={cn(
                          'flex flex-1 items-center justify-center gap-2 rounded-lg border-2 px-4 py-3 transition-all duration-200',
                          defaultTheme === 'light'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-surface-3 text-muted-foreground hover:border-foreground/20',
                        )}
                      >
                        <Sun className="h-4 w-4" />
                        <span className="text-sm font-medium">Light</span>
                      </button>
                    </div>
                  </div>

                  {/* Live preview */}
                  <div className="space-y-2">
                    <label className={labelClass}>Live Preview</label>
                    <div className="overflow-hidden rounded-lg border border-border">
                      {/* Mock header */}
                      <div
                        className="flex items-center gap-2 px-4 py-2.5"
                        style={{ backgroundColor: primaryColor }}
                      >
                        <Monitor className="h-4 w-4 text-primary-foreground" />
                        <span className="text-sm font-semibold text-primary-foreground">
                          {panelName || 'Catalyst'}
                        </span>
                      </div>
                      {/* Mock content */}
                      <div className="space-y-3 p-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-24 rounded-full bg-surface-3" />
                          <div
                            className="h-2.5 w-16 rounded-full"
                            style={{ backgroundColor: accentColor, opacity: 0.4 }}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-md border border-border p-2.5">
                            <div className="h-2 w-14 rounded bg-surface-3" />
                            <div className="mt-1.5 h-1.5 w-10 rounded bg-surface-3/60" />
                          </div>
                          <div className="rounded-md border border-border p-2.5">
                            <div className="h-2 w-12 rounded bg-surface-3" />
                            <div className="mt-1.5 h-1.5 w-8 rounded bg-surface-3/60" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <div
                            className="h-7 flex-1 rounded-md text-center text-[10px] font-medium leading-7 text-primary-foreground"
                            style={{ backgroundColor: primaryColor }}
                          >
                            Primary Button
                          </div>
                          <div
                            className="h-7 flex-1 rounded-md text-center text-[10px] font-medium leading-7 text-primary-foreground"
                            style={{ backgroundColor: accentColor }}
                          >
                            Accent Button
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
                  className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </button>
              ) : (
                <div />
              )}

              {currentStep < 2 ? (
                <button
                  type="submit"
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-70"
                >
                  {isSubmitting ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      Complete Setup
                      <Check className="h-4 w-4" />
                    </>
                  )}
                </button>
              )}
            </div>
          </form>

          {/* Step counter */}
          <p className="mt-4 text-center text-xs text-muted-foreground/60">
            Step {currentStep + 1} of 3
          </p>
        </ServerTabCard>
      </div>

      <BrandFooter />
    </div>
  );
}

export default SetupPage;
