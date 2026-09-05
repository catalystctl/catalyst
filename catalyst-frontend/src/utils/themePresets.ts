import type { ThemeColors } from '../services/api/theme';
import { generatePalette, type HarmonyMode } from './generatePalette';
import { defaultThemeColors } from '../stores/themeStore';

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  themeColors: ThemeColors;
  customCss?: string | null;
}

function makeGeneratedPreset(
  id: string,
  name: string,
  description: string,
  seed: string,
  mode: HarmonyMode,
  borderRadius = '0.625rem',
): ThemePreset {
  const generated = generatePalette(seed, mode);
  return {
    id,
    name,
    description,
    primaryColor: generated.primaryColor,
    secondaryColor: generated.secondaryColor,
    accentColor: generated.accentColor,
    themeColors: { ...generated.themeColors, borderRadius },
  };
}

const NEON_CSS = `/* Neon Nights — compact glow pack (full version in public/themes/showcase-cyberpunk.css) */
.dark .bg-primary { box-shadow: 0 0 12px hsl(var(--primary) / 0.35), 0 0 40px hsl(var(--primary) / 0.1); }
.dark [class*="rounded-xl"][class*="border"] { border-color: hsl(var(--primary) / 0.18) !important; }
.dark input:focus, .dark textarea:focus, .dark select:focus { box-shadow: 0 0 0 2px hsl(var(--primary) / 0.12), 0 0 18px hsl(var(--primary) / 0.1) !important; }
.dark [role="progressbar"] > div { background: linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent))) !important; }
`;

const BRUTALIST_CSS = `/* Brutalist — compact pack (full version in public/themes/showcase-brutalist.css) */
.dark *, .light * { border-radius: 0 !important; }
.dark .bg-primary, .light .bg-primary { box-shadow: 4px 4px 0 rgb(0 0 0 / 0.9) !important; font-weight: 700 !important; }
.dark [class*="rounded-xl"][class*="border"], .light [class*="rounded-xl"][class*="border"] { border-width: 2px !important; box-shadow: 4px 4px 0 rgb(0 0 0 / 0.85) !important; }
`;

const neonPreset: ThemePreset = {
  id: 'neon-nights',
  name: 'Neon Nights',
  description: 'Hot pink on deep void with cyan accents',
  primaryColor: '#ff2d95',
  secondaryColor: '#22d3ee',
  accentColor: '#a78bfa',
  themeColors: {
    successColor: '#00e676',
    warningColor: '#ffd600',
    dangerColor: '#ff5252',
    infoColor: '#40c4ff',
    darkBackground: '#0a0a14',
    darkForeground: '#f5f0fa',
    darkCard: '#0f0f1c',
    darkSurface1: '#141424',
    darkSurface2: '#1e1e30',
    darkSurface3: '#2a2a40',
    darkBorder: '#2e1a3a',
    darkMuted: '#8e8ea3',
    lightBackground: '#faf5fb',
    lightForeground: '#140a1a',
    lightCard: '#ffffff',
    lightSurface1: '#fdf2f8',
    lightSurface2: '#f5e6f2',
    lightSurface3: '#ecd9ea',
    lightBorder: '#e8c4e0',
    lightMuted: '#7a6a7e',
    borderRadius: '0.375rem',
  },
  customCss: NEON_CSS,
};

const brutalistPreset: ThemePreset = {
  id: 'brutalist',
  name: 'Brutalist',
  description: 'Sharp corners, hard shadows, stark yellow',
  primaryColor: '#facc15',
  secondaryColor: '#111111',
  accentColor: '#ef4444',
  themeColors: {
    successColor: '#16a34a',
    warningColor: '#facc15',
    dangerColor: '#dc2626',
    infoColor: '#0284c7',
    darkBackground: '#0a0a0a',
    darkForeground: '#fafafa',
    darkCard: '#111111',
    darkSurface1: '#1a1a1a',
    darkSurface2: '#262626',
    darkSurface3: '#333333',
    darkBorder: '#333333',
    darkMuted: '#a3a3a3',
    lightBackground: '#fafafa',
    lightForeground: '#0a0a0a',
    lightCard: '#ffffff',
    lightSurface1: '#f5f5f5',
    lightSurface2: '#e5e5e5',
    lightSurface3: '#d4d4d4',
    lightBorder: '#0a0a0a',
    lightMuted: '#525252',
    borderRadius: '0rem',
  },
  customCss: BRUTALIST_CSS,
};

const catalystDefault: ThemePreset = {
  id: 'catalyst-teal',
  name: 'Catalyst Teal',
  description: 'The default panel look — balanced teal',
  primaryColor: '#0d9488',
  secondaryColor: '#8b5cf6',
  accentColor: '#06b6d4',
  themeColors: { ...defaultThemeColors },
};

export const THEME_PRESETS: ThemePreset[] = [
  catalystDefault,
  makeGeneratedPreset('ocean', 'Ocean', 'Deep blue with calm flow', '#2563eb', 'analogous'),
  makeGeneratedPreset('sunset', 'Sunset Ember', 'Warm orange with rich contrast', '#ea580c', 'split-complementary'),
  makeGeneratedPreset('forest', 'Forest', 'Natural greens that breathe', '#16a34a', 'analogous'),
  makeGeneratedPreset('royal', 'Royal', 'Bold purple with crisp depth', '#7c3aed', 'diadic'),
  makeGeneratedPreset('crimson', 'Crimson', 'Strong red with bold contrast', '#dc2626', 'complementary'),
  makeGeneratedPreset('slate-mono', 'Slate Mono', 'Quiet neutral, almost monochrome', '#64748b', 'neutral'),
  neonPreset,
  brutalistPreset,
];

export function getPresetById(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id);
}
