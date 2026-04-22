import { useState, useEffect, useCallback, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../../stores/authStore';
import { useThemeStore } from '../../stores/themeStore';
import { shallow } from 'zustand/shallow';
import apiClient from '../../services/api/client';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';
import { BrandFooter } from '../../components/shared/BrandFooter';
import { cn } from '../../lib/utils';
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
} from 'lucide-react';

// ── Color presets ──

const PRIMARY_COLORS = [
  { name: 'Teal', value: '#0d9488' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Indigo', value: '#6366f1' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Green', value: '#22c55e' },
] as const;

const ACCENT_COLORS = [
  { name: 'Teal', value: '#06b6d4' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Amber', value: '#f59e0b' },
  { name: 'Emerald', value: '#10b981' },
  { name: 'Blue', value: '#3b82f6' },
] as const;

// ── Animation variants ──

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
  }),
};

const stepLabels = ['Welcome', 'Admin Account', 'Appearance'];
const stepIcons = [Sparkles, User, Palette];

// ── Main component ──

function SetupPage() {
  const navigate = useNavigate();
  const init = useAuthStore((s) => s.init);
  const previewColors = useThemeStore((s) => s.previewColors);
  const cancelPreview = useThemeStore((s) => s.cancelPreview);
  const applyTheme = useThemeStore((s) => s.applyTheme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const theme = useThemeStore((s) => s.theme);

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
  const [primaryColor, setPrimaryColor] = useState('#0d9488');
  const [accentColor, setAccentColor] = useState('#06b6d4');
  const [customPrimaryHex, setCustomPrimaryHex] = useState('');
  const [customAccentHex, setCustomAccentHex] = useState('');
  const [showCustomPrimary, setShowCustomPrimary] = useState(false);
  const [showCustomAccent, setShowCustomAccent] = useState(false);
  const [defaultTheme, setDefaultTheme] = useState<'light' | 'dark'>('dark');

  // Check if setup is already done
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const data = await apiClient.get<{ setupRequired: boolean }>('/api/setup/status');
        if (!data.setupRequired) {
          setAlreadySetup(true);
          navigate('/login', { replace: true });
        }
      } catch {
        // Endpoint might not exist yet; allow the wizard to render
      }
    };
    checkStatus();
  }, [navigate]);

  // Live color preview
  useEffect(() => {
    previewColors({ primaryColor, accentColor });
    return () => {
      cancelPreview();
      applyTheme();
    };
  }, [primaryColor, accentColor, previewColors, cancelPreview, applyTheme]);

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
      await apiClient.post('/api/setup/complete', {
        panelName: panelName.trim() || 'Catalyst',
        logoUrl: logoDataUri || undefined,
        email: email.trim(),
        username: username.trim(),
        password,
        primaryColor,
        accentColor,
        defaultTheme,
      });

      // Cancel preview and re-apply theme with saved settings
      cancelPreview();

      // Re-initialize auth (backend sets session cookies)
      await init();

      navigate('/dashboard', { replace: true });
    } catch (err: any) {
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

  // ── Helpers ──

  const isValidHex = (hex: string) => /^#?[0-9a-fA-F]{6}$/.test(hex);
  const normalizeHex = (hex: string) => (hex.startsWith('#') ? hex : `#${hex}`);

  // ── Don't render if redirecting ──
  if (alreadySetup) return null;

  // ── Input class ──
  const inputClass =
    'w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30';

  const labelClass = 'block text-sm text-muted-foreground dark:text-zinc-300';

  return (
    <div className="app-shell relative flex min-h-screen items-center justify-center px-4 font-sans">
      {/* Background gradient */}
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-lg"
      >
        <div className="rounded-xl border border-border bg-white px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
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
                          ? 'border-primary bg-primary/10 text-primary dark:border-primary dark:bg-primary/20 dark:text-primary'
                          : isComplete
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-surface-3 text-muted-foreground dark:border-surface-2',
                      )}
                    >
                      {isComplete ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                    </div>
                    <span
                      className={cn(
                        'text-[11px] font-medium transition-colors',
                        isActive ? 'text-foreground dark:text-white' : 'text-muted-foreground',
                      )}
                    >
                      {label}
                    </span>
                  </div>
                  {i < 2 && (
                    <div
                      className={cn(
                        'mx-3 mb-5 h-0.5 w-10 transition-colors duration-300',
                        i < currentStep ? 'bg-primary' : 'bg-surface-3 dark:bg-surface-2',
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Error display ── */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="mb-4 rounded-lg border border-rose-200 bg-rose-100/60 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300"
              >
                {error}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Steps ── */}
          <AnimatePresence mode="wait" custom={direction}>
            {/* ─── STEP 1: Welcome & Identity ─── */}
            {currentStep === 0 && (
              <motion.div
                key="step-1"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="text-center">
                  <h1 className="font-display text-2xl font-bold text-foreground dark:text-white">
                    Welcome to Catalyst
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Let&apos;s configure your panel. This only takes a minute.
                  </p>
                </div>

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
                            className="h-16 w-16 rounded-lg border border-border object-contain p-1 dark:bg-surface-2"
                          />
                          <button
                            type="button"
                            onClick={clearLogo}
                            className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white shadow-sm transition-colors hover:bg-rose-600"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ) : (
                        <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-surface-3 transition-colors hover:border-primary/50 hover:bg-primary/5 dark:border-surface-2 dark:hover:border-primary/40">
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
                          <label className="mt-1.5 inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-primary-600 transition-colors hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300">
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
                    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/50 p-4 dark:bg-surface-2/30">
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
                        <p className="text-sm font-semibold text-foreground dark:text-white">
                          {panelName || 'Catalyst'} Panel
                        </p>
                        <p className="text-xs text-muted-foreground">Game Server Management</p>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* ─── STEP 2: Admin Account ─── */}
            {currentStep === 1 && (
              <motion.div
                key="step-2"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="text-center">
                  <h1 className="font-display text-2xl font-bold text-foreground dark:text-white">
                    Create Admin Account
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    This will be your primary administrator account.
                  </p>
                </div>

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
                      <p className="text-xs text-red-400">Passwords do not match</p>
                    )}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ─── STEP 3: Appearance ─── */}
            {currentStep === 2 && (
              <motion.div
                key="step-3"
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className="text-center">
                  <h1 className="font-display text-2xl font-bold text-foreground dark:text-white">
                    Appearance
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Choose colors and theme for your panel.
                  </p>
                </div>

                <div className="mt-6 space-y-6">
                  {/* Primary color */}
                  <div className="space-y-2.5">
                    <label className={labelClass}>Primary Color</label>
                    <div className="flex flex-wrap gap-2">
                      {PRIMARY_COLORS.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          title={c.name}
                          onClick={() => {
                            setPrimaryColor(c.value);
                            setCustomPrimaryHex('');
                            setShowCustomPrimary(false);
                          }}
                          className={cn(
                            'h-8 w-8 rounded-full border-2 transition-all duration-200 hover:scale-110',
                            primaryColor === c.value
                              ? 'border-foreground ring-2 ring-foreground/20'
                              : 'border-transparent',
                          )}
                          style={{ backgroundColor: c.value }}
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomPrimary(!showCustomPrimary);
                          setShowCustomAccent(false);
                        }}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-200',
                          showCustomPrimary
                            ? 'border-foreground ring-2 ring-foreground/20 text-foreground'
                            : 'border-surface-3 text-muted-foreground hover:border-foreground/30',
                        )}
                      >
                        +
                      </button>
                    </div>
                    {showCustomPrimary && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          className={cn(inputClass, 'w-28 font-mono text-xs')}
                          placeholder="#0d9488"
                          value={customPrimaryHex}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomPrimaryHex(val);
                            if (isValidHex(val)) {
                              setPrimaryColor(normalizeHex(val));
                            }
                          }}
                        />
                        <input
                          type="color"
                          value={primaryColor}
                          onChange={(e) => {
                            setPrimaryColor(e.target.value);
                            setCustomPrimaryHex(e.target.value);
                          }}
                          className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                        />
                      </motion.div>
                    )}
                  </div>

                  {/* Accent color */}
                  <div className="space-y-2.5">
                    <label className={labelClass}>Accent Color</label>
                    <div className="flex flex-wrap gap-2">
                      {ACCENT_COLORS.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          title={c.name}
                          onClick={() => {
                            setAccentColor(c.value);
                            setCustomAccentHex('');
                            setShowCustomAccent(false);
                          }}
                          className={cn(
                            'h-8 w-8 rounded-full border-2 transition-all duration-200 hover:scale-110',
                            accentColor === c.value
                              ? 'border-foreground ring-2 ring-foreground/20'
                              : 'border-transparent',
                          )}
                          style={{ backgroundColor: c.value }}
                        />
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomAccent(!showCustomAccent);
                          setShowCustomPrimary(false);
                        }}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-all duration-200',
                          showCustomAccent
                            ? 'border-foreground ring-2 ring-foreground/20 text-foreground'
                            : 'border-surface-3 text-muted-foreground hover:border-foreground/30',
                        )}
                      >
                        +
                      </button>
                    </div>
                    {showCustomAccent && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          className={cn(inputClass, 'w-28 font-mono text-xs')}
                          placeholder="#06b6d4"
                          value={customAccentHex}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomAccentHex(val);
                            if (isValidHex(val)) {
                              setAccentColor(normalizeHex(val));
                            }
                          }}
                        />
                        <input
                          type="color"
                          value={accentColor}
                          onChange={(e) => {
                            setAccentColor(e.target.value);
                            setCustomAccentHex(e.target.value);
                          }}
                          className="h-9 w-9 cursor-pointer rounded border border-border bg-transparent p-0.5"
                        />
                      </motion.div>
                    )}
                  </div>

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
                    <div className="overflow-hidden rounded-lg border border-border dark:bg-surface-2/50">
                      {/* Mock header */}
                      <div
                        className="flex items-center gap-2 px-4 py-2.5"
                        style={{ backgroundColor: primaryColor }}
                      >
                        <Monitor className="h-4 w-4 text-white/90" />
                        <span className="text-sm font-semibold text-white/90">
                          {panelName || 'Catalyst'}
                        </span>
                      </div>
                      {/* Mock content */}
                      <div className="space-y-3 p-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2.5 w-24 rounded-full bg-surface-3 dark:bg-surface-3" />
                          <div
                            className="h-2.5 w-16 rounded-full"
                            style={{ backgroundColor: accentColor, opacity: 0.4 }}
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-md border border-border p-2.5">
                            <div className="h-2 w-14 rounded bg-surface-3 dark:bg-surface-3" />
                            <div className="mt-1.5 h-1.5 w-10 rounded bg-surface-3/60 dark:bg-surface-3/60" />
                          </div>
                          <div className="rounded-md border border-border p-2.5">
                            <div className="h-2 w-12 rounded bg-surface-3 dark:bg-surface-3" />
                            <div className="mt-1.5 h-1.5 w-8 rounded bg-surface-3/60 dark:bg-surface-3/60" />
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <div
                            className="h-7 flex-1 rounded-md text-center text-[10px] font-medium leading-7 text-white"
                            style={{ backgroundColor: primaryColor }}
                          >
                            Primary Button
                          </div>
                          <div
                            className="h-7 flex-1 rounded-md text-center text-[10px] font-medium leading-7 text-white"
                            style={{ backgroundColor: accentColor }}
                          >
                            Accent Button
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Navigation buttons ── */}
          <div className="mt-8 flex items-center justify-between">
            {currentStep > 0 ? (
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground dark:hover:bg-surface-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            ) : (
              <div />
            )}

            {currentStep < 2 ? (
              <button
                type="button"
                onClick={goNext}
                className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
              >
                Next
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-70"
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

          {/* Step counter */}
          <p className="mt-4 text-center text-xs text-muted-foreground/60">
            Step {currentStep + 1} of 3
          </p>
        </div>
      </motion.div>

      <BrandFooter />
    </div>
  );
}

export default SetupPage;
