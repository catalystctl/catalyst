import type { ThemeColors } from '../services/api/theme';

export interface SharedTheme {
  version: 1;
  name?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  themeColors: ThemeColors;
  customCss?: string | null;
}

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const MAX_CSS = 100_000;

const THEME_COLOR_KEYS: (keyof ThemeColors)[] = [
  'successColor',
  'warningColor',
  'dangerColor',
  'infoColor',
  'darkBackground',
  'darkForeground',
  'darkCard',
  'darkSurface1',
  'darkSurface2',
  'darkSurface3',
  'darkBorder',
  'darkMuted',
  'darkMutedBackground',
  'darkPopover',
  'darkInput',
  'lightBackground',
  'lightForeground',
  'lightCard',
  'lightSurface1',
  'lightSurface2',
  'lightSurface3',
  'lightBorder',
  'lightMuted',
  'lightMutedBackground',
  'lightPopover',
  'lightInput',
  'ringColor',
  'borderRadius',
];

export function buildSharedTheme(input: {
  name?: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  themeColors: ThemeColors;
  customCss?: string | null;
}): SharedTheme {
  const themeColors: ThemeColors = {};
  for (const key of THEME_COLOR_KEYS) {
    const v = input.themeColors[key];
    if (typeof v === 'string' && v.length > 0) {
      (themeColors as Record<string, string>)[key] = v;
    }
  }
  return {
    version: 1,
    ...(input.name ? { name: input.name } : {}),
    primaryColor: input.primaryColor,
    secondaryColor: input.secondaryColor,
    accentColor: input.accentColor,
    themeColors,
    customCss: input.customCss?.trim() ? input.customCss.trim().slice(0, MAX_CSS) : null,
  };
}

export function parseSharedTheme(raw: unknown): { ok: true; data: SharedTheme } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Theme JSON must be an object.' };
  const obj = raw as Record<string, unknown>;
  for (const key of ['primaryColor', 'secondaryColor', 'accentColor'] as const) {
    if (typeof obj[key] !== 'string' || !HEX_RE.test(obj[key] as string)) {
      return { ok: false, error: `Invalid ${key} — expected a #rrggbb hex color.` };
    }
  }
  const tc = obj.themeColors;
  if (!tc || typeof tc !== 'object') return { ok: false, error: 'Missing themeColors object.' };
  const themeColors: ThemeColors = {};
  for (const key of THEME_COLOR_KEYS) {
    const v = (tc as Record<string, unknown>)[key];
    if (v === undefined) continue;
    if (key === 'borderRadius') {
      if (typeof v !== 'string' || !/^\d+(\.\d+)?rem$/.test(v)) {
        return { ok: false, error: 'Invalid borderRadius — expected like "0.625rem".' };
      }
      themeColors.borderRadius = v;
      continue;
    }
    if (typeof v !== 'string' || !HEX_RE.test(v)) {
      return { ok: false, error: `Invalid themeColors.${key} — expected a #rrggbb hex color.` };
    }
    (themeColors as Record<string, string>)[key] = v;
  }
  let customCss: string | null = null;
  if (obj.customCss !== undefined && obj.customCss !== null) {
    if (typeof obj.customCss !== 'string') return { ok: false, error: 'Invalid customCss — expected a string.' };
    if (obj.customCss.length > MAX_CSS) return { ok: false, error: 'Custom CSS exceeds 100 KB.' };
    customCss = obj.customCss.trim() ? obj.customCss.trim() : null;
  }
  return {
    ok: true,
    data: {
      version: 1,
      ...(typeof obj.name === 'string' && obj.name.trim() ? { name: obj.name.trim().slice(0, 80) } : {}),
      primaryColor: obj.primaryColor as string,
      secondaryColor: obj.secondaryColor as string,
      accentColor: obj.accentColor as string,
      themeColors,
      customCss,
    },
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG contrast ratio between two hex colors (1–21).
export function contrastRatio(a: string, b: string): number | null {
  if (!HEX_RE.test(a) || !HEX_RE.test(b)) return null;
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
