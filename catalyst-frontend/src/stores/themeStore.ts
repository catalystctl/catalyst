import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PublicThemeSettings, ThemeColors } from '../services/api/theme';
import { debugLog } from '../lib/debug-log';

type Theme = 'light' | 'dark';

interface ThemeState {
  theme: Theme;
  sidebarCollapsed: boolean;
 serverViewMode: 'card' | 'list';
 themeSettings: PublicThemeSettings | null;
  customCssElement: HTMLStyleElement | null;

  setTheme: (theme: Theme) => void;
  setServerViewMode: (mode: 'card' | 'list') => void;
  toggleSidebar: () => void;
  setThemeSettings: (settings: PublicThemeSettings, customCss?: string | null) => void;
  applyTheme: () => void;
  previewColors: (overrides: {
    primaryColor?: string;
    secondaryColor?: string;
    accentColor?: string;
    themeColors?: ThemeColors;
  }) => void;
  cancelPreview: () => void;
  injectCustomCss: (css: string | null) => void;
}

const defaultThemeSettings: PublicThemeSettings = {
  panelName: 'Catalyst',
  logoUrl: null,
  faviconUrl: null,
  defaultTheme: 'dark',
  enabledThemes: ['light', 'dark'],
  primaryColor: '#0d9488',
  secondaryColor: '#8b5cf6',
  accentColor: '#06b6d4',
};

export const defaultThemeColors: ThemeColors = {
  successColor: '#10b981',
  warningColor: '#f59e0b',
  dangerColor: '#ef4444',
  infoColor: '#3b82f6',
  darkBackground: '#0c0c14',
  darkForeground: '#f4f4f7',
  darkCard: '#12121c',
  darkSurface1: '#161622',
  darkSurface2: '#222230',
  darkSurface3: '#303042',
  darkBorder: '#2a2a3a',
  darkMuted: '#9494a3',
  lightBackground: '#f5f4f2',
  lightForeground: '#15141c',
  lightCard: '#fbfaf9',
  lightSurface1: '#fcfbfa',
  lightSurface2: '#efeeec',
  lightSurface3: '#e2e0dc',
  lightBorder: '#e1dfdb',
  lightMuted: '#6f6f7a',
  borderRadius: '0.625rem',
};

export const THEME_CACHE_KEY = 'catalyst-theme-cache-v1';
export const CUSTOM_CSS_ELEMENT_ID = 'catalyst-custom-css';
const MAX_CUSTOM_CSS_CHARS = 100_000;

interface CachedTheme {
  theme: Theme;
  settings: PublicThemeSettings;
  customCss: string | null;
  cssVars: Record<string, string>;
  savedAt: number;
}

function sanitizeCustomCss(css: string | null | undefined): string | null {
  if (!css || !css.trim()) return null;
  let safe = css.trim().slice(0, MAX_CUSTOM_CSS_CHARS);
  safe = safe
    .replace(/expression\s*\(/gi, '/*blocked*/(')
    .replace(/behavior\s*:/gi, '/*blocked*/:')
    .replace(/-moz-binding\s*:/gi, '/*blocked*/:')
    .replace(/javascript\s*:/gi, '/*blocked*/:')
    .replace(/@import\b/gi, '/*blocked-import*/');
  return safe || null;
}

function resolveThemeName(
  explicitChoice: string | null | undefined,
  defaultTheme: string | null | undefined,
): Theme {
  if (explicitChoice === 'light' || explicitChoice === 'dark') return explicitChoice;
  if (defaultTheme === 'light' || defaultTheme === 'dark') return defaultTheme;
  if (defaultTheme === 'system' && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

function readPersistedThemeChoice(): Theme | null {
  try {
    const raw = localStorage.getItem('catalyst-theme');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } };
    return parsed?.state?.theme === 'light' || parsed?.state?.theme === 'dark'
      ? parsed.state.theme
      : null;
  } catch {
    return null;
  }
}

export function readThemeCache(): CachedTheme | null {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedTheme>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.theme !== 'light' && parsed.theme !== 'dark') return null;
    if (!parsed.settings || typeof parsed.settings !== 'object') return null;
    if (!parsed.cssVars || typeof parsed.cssVars !== 'object') return null;
    return {
      theme: parsed.theme,
      settings: parsed.settings as PublicThemeSettings,
      customCss: typeof parsed.customCss === 'string' ? parsed.customCss : null,
      cssVars: parsed.cssVars as Record<string, string>,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

function writeThemeCache(entry: Omit<CachedTheme, 'savedAt'>): void {
  try {
    const payload: CachedTheme = { ...entry, savedAt: Date.now() };
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or unavailable — theme still applies for this session.
  }
}

// Synchronous pre-paint apply for startup (main.tsx + index.html boot).
// Reads only localStorage + DOM, never the store, so it runs before React.
export function preApplyCachedTheme(): boolean {
  try {
    const cached = readThemeCache();
    if (!cached) return false;
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(cached.theme);
    for (const [name, value] of Object.entries(cached.cssVars)) {
      root.style.setProperty(name, value);
    }
    const existing = document.getElementById(CUSTOM_CSS_ELEMENT_ID);
    if (existing?.parentNode) existing.parentNode.removeChild(existing);
    if (cached.customCss) {
      const style = document.createElement('style');
      style.id = CUSTOM_CSS_ELEMENT_ID;
      style.textContent = cached.customCss;
      document.head.appendChild(style);
    }
    return true;
  } catch {
    return false;
  }
}

// ─── Pure color utilities ───

function hexToHSL(hex: string): string {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  h = Math.round(h * 360);
  s = Math.round(s * 100);
  const lPercent = Math.round(l * 100);
  return `${h} ${s}% ${lPercent}%`;
}

function mutedVariant(hsl: string): string {
  return `${hsl} / 0.15`;
}

function generateColorScale(baseHSL: string): Record<string, string> {
  const [h, s, l] = baseHSL.split(' ');
  const hue = parseInt(h);
  const sat = parseInt(s);
  const baseLightness = parseInt(l);
  return {
    '50': `${hue} ${Math.min(sat + 10, 100)}% 95%`,
    '100': `${hue} ${Math.min(sat + 10, 100)}% 90%`,
    '200': `${hue} ${Math.min(sat + 5, 100)}% 80%`,
    '300': `${hue} ${sat}% 70%`,
    '400': `${hue} ${sat}% 60%`,
    '500': baseHSL,
    '600': `${hue} ${sat}% ${Math.max(baseLightness - 10, 20)}%`,
    '700': `${hue} ${Math.min(sat + 5, 100)}% ${Math.max(baseLightness - 20, 15)}%`,
    '800': `${hue} ${Math.min(sat + 10, 100)}% ${Math.max(baseLightness - 30, 10)}%`,
    '900': `${hue} ${Math.min(sat + 15, 100)}% ${Math.max(baseLightness - 40, 5)}%`,
  };
}

function luminance(hsl: string): number {
  return parseInt(hsl.split(' ')[2]) / 100;
}

// ─── Pure DOM application (no store dependency) ───
// Build the variable map first so startup can cache + replay it pre-paint.

function buildThemeCssVars(
  theme: Theme,
  primaryColor: string,
  secondaryColor: string,
  accentColor: string,
  colors: ThemeColors,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const set = (name: string, value: string) => {
    vars[name] = value;
  };

  const primaryHSL = hexToHSL(primaryColor);
  const primaryScale = generateColorScale(primaryHSL);
  set('--primary', primaryHSL);
  for (const [shade, value] of Object.entries(primaryScale)) {
    set(`--primary-${shade}`, value);
  }
  const isLightPrimary = luminance(primaryHSL) > 0.55;
  set('--primary-foreground', isLightPrimary ? '0 0% 9%' : '0 0% 100%');

  const secondaryHSL = hexToHSL(secondaryColor);
  set('--secondary', secondaryHSL);
  const isLightSecondary = luminance(secondaryHSL) > 0.55;
  set('--secondary-foreground', isLightSecondary ? '0 0% 9%' : '0 0% 100%');

  const accentHSL = hexToHSL(accentColor);
  set('--accent', accentHSL);
  set('--ring', primaryHSL);

  const semanticKeys: (keyof ThemeColors)[] = ['successColor', 'warningColor', 'dangerColor', 'infoColor'];
  const cssVarMap: Record<string, string> = {
    successColor: 'success',
    warningColor: 'warning',
    dangerColor: 'danger',
    infoColor: 'info',
  };
  for (const key of semanticKeys) {
    const hex = colors[key];
    if (!hex) continue;
    const hsl = hexToHSL(hex);
    const varName = cssVarMap[key];
    set(`--${varName}`, hsl);
    set(`--${varName}-muted`, mutedVariant(hsl));
    if (key === 'dangerColor') {
      set('--destructive', hsl);
    }
  }

  const isDark = theme === 'dark';
  const bgKey = isDark ? 'darkBackground' : 'lightBackground';
  const fgKey = isDark ? 'darkForeground' : 'lightForeground';
  const cardKey = isDark ? 'darkCard' : 'lightCard';
  const borderKey = isDark ? 'darkBorder' : 'lightBorder';
  const mutedKey = isDark ? 'darkMuted' : 'lightMuted';
  const s1Key = isDark ? 'darkSurface1' : 'lightSurface1';
  const s2Key = isDark ? 'darkSurface2' : 'lightSurface2';
  const s3Key = isDark ? 'darkSurface3' : 'lightSurface3';

  if (colors[bgKey]) {
    set('--background', hexToHSL(colors[bgKey]));
    set('--surface-0', hexToHSL(colors[bgKey]));
  }
  if (colors[fgKey]) set('--foreground', hexToHSL(colors[fgKey]));
  if (colors[cardKey]) {
    set('--card', hexToHSL(colors[cardKey]));
    set('--card-foreground', hexToHSL(colors[fgKey] || (isDark ? '#fafafa' : '#09090b')));
  }
  if (colors[borderKey]) {
    set('--border', hexToHSL(colors[borderKey]));
    set('--input', hexToHSL(colors[borderKey]));
  }
  if (colors[s1Key]) set('--surface-1', hexToHSL(colors[s1Key]));
  if (colors[s2Key]) {
    set('--surface-2', hexToHSL(colors[s2Key]));
    // Keep muted as a surface tone so badges/inputs stay readable under customization.
    set('--muted', hexToHSL(colors[s2Key]));
  }
  if (colors[s3Key]) set('--surface-3', hexToHSL(colors[s3Key]));
  if (colors[mutedKey]) {
    set('--muted-foreground', hexToHSL(colors[mutedKey]));
  }

  const fallbackBg = isDark ? '#09090b' : '#ffffff';
  const fallbackFg = isDark ? '#fafafa' : '#09090b';
  set('--popover', hexToHSL(colors[cardKey] || colors[bgKey] || fallbackBg));
  set('--popover-foreground', hexToHSL(colors[fgKey] || fallbackFg));
  set('--accent-foreground', hexToHSL(colors[bgKey] || fallbackBg));
  set('--destructive-foreground', '0 0% 100%');

  if (colors.borderRadius) {
    set('--radius', colors.borderRadius);
  }

  set('--accent-teal', primaryHSL);
  set('--accent-teal-light', accentHSL);
  set('--accent-teal-muted', mutedVariant(primaryHSL));

  const sonnerBg = colors[cardKey] || colors[s1Key] || fallbackBg;
  set('--sonner-background', `hsl(${hexToHSL(sonnerBg)})`);
  return vars;
}

function applyThemeToDOM(
  theme: Theme,
  primaryColor: string,
  secondaryColor: string,
  accentColor: string,
  colors: ThemeColors,
): Record<string, string> {
  const vars = buildThemeCssVars(theme, primaryColor, secondaryColor, accentColor, colors);
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  for (const [name, value] of Object.entries(vars)) {
    root.style.setProperty(name, value);
  }
  return vars;
}

// ─── RAF-batched preview ───
// When the user drags a colour picker, onChange fires ~60 times/sec.
// Without batching each call runs ~35 style.setProperty() writes
// synchronously, which forces layout thrashing and jank.
// Instead we stash the latest values and flush once per animation frame.

let previewRafId: number | null = null;
let pendingPreview: Partial<{
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  themeColors: ThemeColors;
}> | null = null;

function schedulePreview(getState: () => ThemeState) {
  const { themeSettings } = getState();
  const base = themeSettings || defaultThemeSettings;

  pendingPreview = {
    primaryColor: pendingPreview?.primaryColor ?? base.primaryColor,
    secondaryColor: pendingPreview?.secondaryColor ?? base.secondaryColor,
    accentColor: pendingPreview?.accentColor ?? base.accentColor,
    themeColors: pendingPreview?.themeColors ?? (base.themeColors || defaultThemeColors),
  };

  if (previewRafId !== null) return; // already scheduled

  previewRafId = requestAnimationFrame(() => {
    previewRafId = null;
    const data = pendingPreview;
    pendingPreview = null;
    if (!data) return;
    const currentTheme = getState().theme;
    const {
      primaryColor = base.primaryColor,
      secondaryColor = base.secondaryColor,
      accentColor = base.accentColor,
      themeColors = base.themeColors || defaultThemeColors,
    } = data;
    applyThemeToDOM(currentTheme, primaryColor, secondaryColor, accentColor, themeColors);
  });
}

/** Call when the user is *done* editing (save / reset) to flush immediately. */
function flushPreview() {
  if (previewRafId !== null) {
    cancelAnimationFrame(previewRafId);
    previewRafId = null;
  }
  pendingPreview = null;
}

function initialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const persisted = readPersistedThemeChoice();
  if (persisted) return persisted;
  const cached = readThemeCache();
  if (cached) return resolveThemeName(null, cached.settings.defaultTheme);
  return 'dark';
}

function initialThemeSettings(): PublicThemeSettings | null {
  if (typeof window === 'undefined') return null;
  return readThemeCache()?.settings ?? null;
}

// ─── Store ───

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: initialTheme(),
      sidebarCollapsed: false,
      serverViewMode: 'card' as const,
      themeSettings: initialThemeSettings(),
      customCssElement: null,

      setTheme: (theme) => {
        set({ theme });
        get().applyTheme();
      },

      setServerViewMode: (mode) => set({ serverViewMode: mode }),

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setThemeSettings: (settings, customCss) => {
        flushPreview();
        debugLog('[themeStore] setThemeSettings called, customCss length:', customCss?.length ?? 0);
        const hadCache = readThemeCache() !== null;
        const hadChoice = readPersistedThemeChoice() !== null;
        if (!hadCache && !hadChoice) {
          const resolved = resolveThemeName(null, settings.defaultTheme);
          if (resolved !== get().theme) set({ theme: resolved });
        }
        set({ themeSettings: settings });
        get().applyTheme();
        if (customCss !== undefined) {
          get().injectCustomCss(customCss);
        }
      },

      injectCustomCss: (css) => {
        const { customCssElement } = get();
        debugLog('[themeStore] injectCustomCss called, css length:', css?.length ?? 0);

        if (customCssElement && customCssElement.parentNode) {
          customCssElement.parentNode.removeChild(customCssElement);
        }
        const orphaned = document.getElementById(CUSTOM_CSS_ELEMENT_ID);
        if (orphaned && orphaned.parentNode) {
          orphaned.parentNode.removeChild(orphaned);
        }
        const safeCss = sanitizeCustomCss(css);
        if (safeCss) {
          const style = document.createElement('style');
          style.id = CUSTOM_CSS_ELEMENT_ID;
          style.textContent = safeCss;
          document.head.appendChild(style);
          set({ customCssElement: style });
        } else {
          set({ customCssElement: null });
        }
        const existing = readThemeCache();
        if (existing) {
          writeThemeCache({ ...existing, customCss: safeCss });
        }
      },

      applyTheme: () => {
        flushPreview();
        const { theme, themeSettings } = get();
        const settings = themeSettings || defaultThemeSettings;
        const colors = settings.themeColors || defaultThemeColors;

        const cssVars = applyThemeToDOM(theme, settings.primaryColor, settings.secondaryColor, settings.accentColor, colors);
        const cached = readThemeCache();
        writeThemeCache({
          theme,
          settings,
          customCss: cached?.customCss ?? sanitizeCustomCss(settings.customCss) ?? null,
          cssVars,
        });

        document.title = settings.panelName;
        if (settings.faviconUrl) {
          let favicon = document.querySelector("link[rel~='icon']") as HTMLLinkElement;
          if (!favicon) {
            favicon = document.createElement('link');
            favicon.rel = 'icon';
            document.head.appendChild(favicon);
          }
          favicon.href = settings.faviconUrl;
        }
      },

      /**
       * Schedule a live-preview DOM update, batched via requestAnimationFrame.
       * Rapid calls (e.g. dragging a colour picker) coalesce into a single
       * paint-frame write, eliminating jank.
       */
      previewColors: (overrides) => {
        if (overrides.primaryColor !== undefined) {
          if (!pendingPreview) pendingPreview = null as any;
          pendingPreview = { ...pendingPreview, primaryColor: overrides.primaryColor };
        }
        if (overrides.secondaryColor !== undefined) {
          if (!pendingPreview) pendingPreview = null as any;
          pendingPreview = { ...pendingPreview, secondaryColor: overrides.secondaryColor };
        }
        if (overrides.accentColor !== undefined) {
          if (!pendingPreview) pendingPreview = null as any;
          pendingPreview = { ...pendingPreview, accentColor: overrides.accentColor };
        }
        if (overrides.themeColors) {
          if (!pendingPreview) pendingPreview = null as any;
          pendingPreview = { ...pendingPreview, themeColors: overrides.themeColors };
        }
        schedulePreview(get);
      },

      /** Cancel any pending preview frame (used before applyTheme / save). */
      cancelPreview: () => {
        flushPreview();
      },
    }),
    {
      name: 'catalyst-theme',
      partialize: (state) => ({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed, serverViewMode: state.serverViewMode }),
    }
  )
);
