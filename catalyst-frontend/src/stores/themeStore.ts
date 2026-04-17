import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PublicThemeSettings, ThemeColors } from '../services/api/theme';

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
  darkBackground: '#09090b',
  darkForeground: '#fafafa',
  darkCard: '#09090b',
  darkSurface1: '#0f0f14',
  darkSurface2: '#27272a',
  darkSurface3: '#3f3f46',
  darkBorder: '#27272a',
  darkMuted: '#a1a1aa',
  lightBackground: '#ffffff',
  lightForeground: '#09090b',
  lightCard: '#ffffff',
  lightSurface1: '#ffffff',
  lightSurface2: '#f4f4f5',
  lightSurface3: '#e4e4e7',
  lightBorder: '#e4e4e7',
  lightMuted: '#71717a',
  borderRadius: '0.5rem',
};

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
// This is the single source of truth for writing CSS variables to <html>.

function applyThemeToDOM(
  theme: Theme,
  primaryColor: string,
  accentColor: string,
  colors: ThemeColors,
) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);

  // ── Primary color + full scale ──
  const primaryHSL = hexToHSL(primaryColor);
  const primaryScale = generateColorScale(primaryHSL);
  root.style.setProperty('--primary', primaryHSL);
  for (const [shade, value] of Object.entries(primaryScale)) {
    root.style.setProperty(`--primary-${shade}`, value);
  }
  const isLightPrimary = luminance(primaryHSL) > 0.55;
  root.style.setProperty('--primary-foreground', isLightPrimary ? '0 0% 9%' : '0 0% 100%');

  // ── Accent + ring ──
  const accentHSL = hexToHSL(accentColor);
  root.style.setProperty('--accent', accentHSL);
  root.style.setProperty('--ring', primaryHSL);

  // ── Semantic colors ──
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
    root.style.setProperty(`--${varName}`, hsl);
    root.style.setProperty(`--${varName}-muted`, mutedVariant(hsl));
    if (key === 'dangerColor') {
      root.style.setProperty('--destructive', hsl);
    }
  }

  // ── Surfaces (dark / light) ──
  const isDark = theme === 'dark';
  const bgKey = isDark ? 'darkBackground' : 'lightBackground';
  const fgKey = isDark ? 'darkForeground' : 'lightForeground';
  const cardKey = isDark ? 'darkCard' : 'lightCard';
  const borderKey = isDark ? 'darkBorder' : 'lightBorder';
  const mutedKey = isDark ? 'darkMuted' : 'lightMuted';
  const s1Key = isDark ? 'darkSurface1' : 'lightSurface1';
  const s2Key = isDark ? 'darkSurface2' : 'lightSurface2';
  const s3Key = isDark ? 'darkSurface3' : 'lightSurface3';
  const otherS1 = isDark ? 'lightSurface1' : 'darkSurface1';

  if (colors[bgKey]) {
    root.style.setProperty('--background', hexToHSL(colors[bgKey]));
    root.style.setProperty('--surface-0', hexToHSL(colors[bgKey]));
  }
  if (colors[fgKey]) root.style.setProperty('--foreground', hexToHSL(colors[fgKey]));
  if (colors[cardKey]) {
    root.style.setProperty('--card', hexToHSL(colors[cardKey]));
    root.style.setProperty('--card-foreground', hexToHSL(colors[fgKey] || (isDark ? '#fafafa' : '#09090b')));
  }
  if (colors[borderKey]) {
    root.style.setProperty('--border', hexToHSL(colors[borderKey]));
    root.style.setProperty('--input', hexToHSL(colors[borderKey]));
  }
  if (colors[s1Key]) root.style.setProperty('--surface-1', hexToHSL(colors[s1Key]));
  if (colors[s2Key]) root.style.setProperty('--surface-2', hexToHSL(colors[s2Key]));
  if (colors[s3Key]) root.style.setProperty('--surface-3', hexToHSL(colors[s3Key]));
  if (colors[mutedKey]) {
    root.style.setProperty('--muted', hexToHSL(colors[mutedKey]));
    root.style.setProperty('--muted-foreground', hexToHSL(colors[mutedKey]));
  }

  const fallbackBg = isDark ? '#09090b' : '#ffffff';
  const fallbackFg = isDark ? '#fafafa' : '#09090b';
  root.style.setProperty('--popover', hexToHSL(colors[cardKey] || colors[bgKey] || fallbackBg));
  root.style.setProperty('--popover-foreground', hexToHSL(colors[fgKey] || fallbackFg));
  root.style.setProperty('--secondary', hexToHSL(colors[s2Key] || fallbackBg));
  root.style.setProperty('--secondary-foreground', hexToHSL(colors[fgKey] || fallbackFg));
  root.style.setProperty('--accent-foreground', hexToHSL(colors[bgKey] || fallbackBg));
  root.style.setProperty('--destructive-foreground', '0 0% 100%');

  // ── Border radius ──
  if (colors.borderRadius) {
    root.style.setProperty('--radius', colors.borderRadius);
  }

  // ── Accent-teal backward compat ──
  root.style.setProperty('--accent-teal', primaryHSL);
  root.style.setProperty('--accent-teal-light', accentHSL);
  root.style.setProperty('--accent-teal-muted', mutedVariant(primaryHSL));

  // ── Sonner ──
  const sonnerBg = colors[cardKey] || colors[s1Key] || fallbackBg;
  root.style.setProperty('--sonner-background', `hsl(${hexToHSL(sonnerBg)})`);
}

// ─── RAF-batched preview ───
// When the user drags a colour picker, onChange fires ~60 times/sec.
// Without batching each call runs ~35 style.setProperty() writes
// synchronously, which forces layout thrashing and jank.
// Instead we stash the latest values and flush once per animation frame.

let previewRafId: number | null = null;
let pendingPreview: {
  primaryColor: string;
  accentColor: string;
  themeColors: ThemeColors;
} | null = null;

function schedulePreview(getState: () => ThemeState) {
  const { theme, themeSettings } = getState();
  const base = themeSettings || defaultThemeSettings;

  pendingPreview = {
    primaryColor: pendingPreview?.primaryColor ?? base.primaryColor,
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
    applyThemeToDOM(currentTheme, data.primaryColor, data.accentColor, data.themeColors);
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

// ─── Store ───

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      serverViewMode: 'card' as const,
      themeSettings: null,
      customCssElement: null,

      setTheme: (theme) => {
        set({ theme });
        get().applyTheme();
      },

      setServerViewMode: (mode) => set({ serverViewMode: mode }),

      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      setThemeSettings: (settings, customCss) => {
        flushPreview();
        set({ themeSettings: settings });
        get().applyTheme();
        if (customCss !== undefined) {
          get().injectCustomCss(customCss);
        }
      },

      injectCustomCss: (css) => {
        const { customCssElement } = get();
        if (customCssElement && customCssElement.parentNode) {
          customCssElement.parentNode.removeChild(customCssElement);
        }
        if (css && css.trim()) {
          const style = document.createElement('style');
          style.id = 'catalyst-custom-css';
          style.textContent = css;
          document.head.appendChild(style);
          set({ customCssElement: style });
        } else {
          set({ customCssElement: null });
        }
      },

      applyTheme: () => {
        flushPreview();
        const { theme, themeSettings } = get();
        const settings = themeSettings || defaultThemeSettings;
        const colors = settings.themeColors || defaultThemeColors;

        applyThemeToDOM(theme, settings.primaryColor, settings.accentColor, colors);

        // ── Title & favicon (only from saved settings) ──
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
