import type { ThemeColors } from '../services/api/theme';

// ─── Types ───

export type HarmonyMode =
  | 'auto'
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'split-complementary'
  | 'monochromatic';

export interface GeneratedPalette {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  themeColors: ThemeColors;
}

// ─── Color utilities ───

export function hexToHSL(hex: string): { h: number; s: number; l: number } {
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

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * Math.max(0, Math.min(1, color)))
      .toString(16)
      .padStart(2, '0');
  };

  return `#${f(0)}${f(8)}${f(4)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function rotateHue(h: number, degrees: number): number {
  return ((h + degrees) % 360 + 360) % 360;
}

// ─── Palette generation ───

/**
 * Given a single seed hex color and a harmony mode, generates a complete
 * theme palette including brand colors, semantic colors, and dark/light
 * surface elevations.
 */
export function generatePalette(
  seed: string,
  mode: HarmonyMode = 'auto',
): GeneratedPalette {
  const { h, s, l } = hexToHSL(seed);

  // ── Resolve auto mode based on hue ──
  let effectiveMode = mode;
  if (mode === 'auto') {
    if ((h >= 0 && h < 60) || h >= 300) {
      // Warm tones (red, orange, yellow, magenta) → split-complementary
      effectiveMode = 'split-complementary';
    } else if (h >= 60 && h < 180) {
      // Warm-cool transition (yellow, green, cyan) → analogous
      effectiveMode = 'analogous';
    } else {
      // Cool tones (blue, purple) → triadic
      effectiveMode = 'triadic';
    }
  }

  // ── Compute secondary & accent hues ──
  let secondaryHue: number;
  let accentHue: number;

  switch (effectiveMode) {
    case 'complementary':
      secondaryHue = rotateHue(h, 180);
      accentHue = rotateHue(h, 30);
      break;
    case 'analogous':
      secondaryHue = rotateHue(h, 30);
      accentHue = rotateHue(h, -30);
      break;
    case 'triadic':
      secondaryHue = rotateHue(h, 120);
      accentHue = rotateHue(h, 240);
      break;
    case 'split-complementary':
      secondaryHue = rotateHue(h, 150);
      accentHue = rotateHue(h, 210);
      break;
    case 'monochromatic':
    default:
      secondaryHue = h;
      accentHue = h;
      break;
  }

  // ── Brand colors ──
  const isMono = effectiveMode === 'monochromatic';

  const primaryColor = seed;
  const secondaryColor = hslToHex(
    secondaryHue,
    isMono ? clamp(s - 15, 20, 80) : clamp(s, 45, 75),
    isMono ? clamp(l + 15, 30, 70) : clamp(l, 40, 60),
  );
  const accentColor = hslToHex(
    accentHue,
    isMono ? clamp(s - 25, 15, 70) : clamp(s, 45, 75),
    isMono ? clamp(l + 25, 30, 75) : clamp(l, 45, 65),
  );

  // ── Semantic colors — standard hues, saturation influenced by seed ──
  const satFactor = clamp(s / 100, 0.3, 1);
  const semanticSat = Math.round(55 + satFactor * 25);

  const successColor = hslToHex(152, semanticSat, 42);
  const warningColor = hslToHex(38, Math.min(semanticSat + 15, 95), 48);
  const dangerColor = hslToHex(0, semanticSat, 55);
  const infoColor = hslToHex(217, semanticSat, 55);

  // ── Dark surfaces — subtle tint of the seed hue ──
  const hueInfluence = 0.35;
  const darkBaseSat = Math.round(6 + (s / 100) * 14 * hueInfluence);

  const darkBackground = hslToHex(h, darkBaseSat, 4);
  const darkForeground = hslToHex(h, 5, 97);
  const darkCard = hslToHex(h, darkBaseSat + 1, 5);
  const darkSurface1 = hslToHex(h, darkBaseSat + 2, 7);
  const darkSurface2 = hslToHex(h, darkBaseSat + 3, 16);
  const darkSurface3 = hslToHex(h, darkBaseSat + 2, 25);
  const darkBorder = hslToHex(h, darkBaseSat + 2, 17);
  const darkMuted = hslToHex(h, 5, 62);

  // ── Light surfaces — subtle tint of the seed hue ──
  const lightBaseSat = Math.round(10 + (s / 100) * 20 * hueInfluence);

  const lightBackground = hslToHex(h, lightBaseSat, 98);
  const lightForeground = hslToHex(h, 10, 5);
  const lightCard = hslToHex(h, lightBaseSat, 99);
  const lightSurface1 = hslToHex(h, lightBaseSat, 99.5);
  const lightSurface2 = hslToHex(h, lightBaseSat - 3, 96);
  const lightSurface3 = hslToHex(h, lightBaseSat - 5, 90);
  const lightBorder = hslToHex(h, lightBaseSat - 5, 90);
  const lightMuted = hslToHex(h, 5, 45);

  return {
    primaryColor,
    secondaryColor,
    accentColor,
    themeColors: {
      successColor,
      warningColor,
      dangerColor,
      infoColor,
      darkBackground,
      darkForeground,
      darkCard,
      darkSurface1,
      darkSurface2,
      darkSurface3,
      darkBorder,
      darkMuted,
      lightBackground,
      lightForeground,
      lightCard,
      lightSurface1,
      lightSurface2,
      lightSurface3,
      lightBorder,
      lightMuted,
      borderRadius: '0.5rem',
    },
  };
}
