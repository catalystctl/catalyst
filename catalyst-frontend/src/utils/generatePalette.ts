import type { ThemeColors } from '../services/api/theme';

// ─── Types ───

export type HarmonyMode =
  | 'auto'
  | 'complementary'
  | 'analogous'
  | 'triadic'
  | 'split-complementary'
  | 'monochromatic'
  | 'tetradic'
  | 'tetradic-rectangle'
  | 'diadic'
  | 'neutral';

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
    if ((h >= 0 && h < 45) || h >= 330) {
      // Red, magenta, pink → split-complementary (rich contrast)
      effectiveMode = 'split-complementary';
    } else if (h >= 45 && h < 90) {
      // Yellow-orange → triadic (vibrant energy)
      effectiveMode = 'triadic';
    } else if (h >= 90 && h < 180) {
      // Green, teal, cyan → analogous (natural flow)
      effectiveMode = 'analogous';
    } else if (h >= 180 && h < 240) {
      // Cyan-blue → tetradic (balanced four-color)
      effectiveMode = 'tetradic';
    } else if (h >= 240 && h < 300) {
      // Blue-purple → diadic (crisp two-tone)
      effectiveMode = 'diadic';
    } else {
      // Purple-magenta → complementary (bold contrast)
      effectiveMode = 'complementary';
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
    case 'tetradic':
      // Square: four hues at 90° intervals
      secondaryHue = rotateHue(h, 90);
      accentHue = rotateHue(h, 270);
      break;
    case 'tetradic-rectangle':
      // Rectangle: two complementary pairs 60° apart
      secondaryHue = rotateHue(h, 60);
      accentHue = rotateHue(h, 240);
      break;
    case 'diadic':
      // Two hues 60° apart; accent is a softer variant of secondary
      secondaryHue = rotateHue(h, 60);
      accentHue = rotateHue(h, 90);
      break;
    case 'neutral':
      // Micro-shifts — nearly monochromatic with whisper of hue variation
      secondaryHue = rotateHue(h, 8);
      accentHue = rotateHue(h, -8);
      break;
    case 'monochromatic':
    default:
      secondaryHue = h;
      accentHue = h;
      break;
  }

  // ── Brand colors ──
  const isMono = effectiveMode === 'monochromatic';
  const isNeutral = effectiveMode === 'neutral';

  const primaryColor = seed;
  const secondaryColor = hslToHex(
    secondaryHue,
    isMono
      ? clamp(s - 15, 20, 80)
      : isNeutral
        ? clamp(s - 10, 30, 80)
        : clamp(s, 45, 75),
    isMono
      ? clamp(l + 15, 30, 70)
      : isNeutral
        ? clamp(l + 10, 35, 65)
        : clamp(l, 40, 60),
  );
  const accentColor = hslToHex(
    accentHue,
    isMono
      ? clamp(s - 25, 15, 70)
      : isNeutral
        ? clamp(s - 20, 20, 75)
        : clamp(s, 45, 75),
    isMono
      ? clamp(l + 25, 30, 75)
      : isNeutral
        ? clamp(l + 20, 35, 70)
        : clamp(l, 45, 65),
  );

  // ── Semantic colors — standard hues, saturation influenced by seed ──
  const satFactor = clamp(s / 100, 0.3, 1);
  const semanticSat = Math.round(55 + satFactor * 25);

  const successColor = hslToHex(152, semanticSat, 42);
  const warningColor = hslToHex(38, Math.min(semanticSat + 15, 95), 48);
  const dangerColor = hslToHex(0, semanticSat, 55);
  const infoColor = hslToHex(217, semanticSat, 55);

  // ── Surface hues — influenced by the harmony mode ──
  // Each mode shifts surface colors toward a complementary or related hue,
  // creating depth and cohesion between brand colors and the background.
  const surfaceHueShift = ((): number => {
    switch (effectiveMode) {
      case 'monochromatic':
        return 0; // No shift — surfaces mirror the brand hue
      case 'neutral':
        return 3; // Whisper of shift
      case 'analogous':
        return 15; // Gentle lean toward the analogous direction
      case 'complementary':
        return 22; // Subtle pull toward the complement — creates depth
      case 'split-complementary':
        return 18; // Balanced between complement and analogous
      case 'triadic':
        return 30; // Richer shift — surfaces feel dynamic
      case 'tetradic':
        return 35; // Multi-hue influence — bold surface character
      case 'tetradic-rectangle':
        return 28;
      case 'diadic':
        return 25; // Lean into the secondary relationship
      default:
        return 12;
    }
  })();

  // Blend factor: how much the surface hue shift applies per elevation level.
  // Background (level 0) stays closer to primary; higher elevations shift more.
  const hueBlend = (level: number): number => {
    // level 0 = background, 1 = card/s1, 2 = s2, 3 = s3/border
    // Background gets ~15% of the shift, surface3 gets ~70%
    return 0.12 + level * 0.19;
  };

  const surfaceHue = (level: number): number => {
    // Blend between primary hue and the shifted hue based on elevation level
    const targetHue = rotateHue(h, surfaceHueShift);
    const blend = hueBlend(level);
    // Use shortest-path interpolation in hue space
    let diff = targetHue - h;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    return Math.round(h + diff * blend);
  };

  // ── Dark surfaces — harmony-aware, elevated from pure black for readability ──
  const hueInfluence = 0.35;
  const darkBaseSat = Math.round(6 + (s / 100) * 14 * hueInfluence);

  const darkBackground = hslToHex(surfaceHue(0), darkBaseSat + 2, 8);
  const darkForeground = hslToHex(surfaceHue(1), 4, 95);
  const darkCard = hslToHex(surfaceHue(0), darkBaseSat + 3, 10);
  const darkSurface1 = hslToHex(surfaceHue(1), darkBaseSat + 3, 13);
  const darkSurface2 = hslToHex(surfaceHue(2), darkBaseSat + 3, 19);
  const darkSurface3 = hslToHex(surfaceHue(3), darkBaseSat + 2, 28);
  const darkBorder = hslToHex(surfaceHue(3), darkBaseSat + 2, 21);
  const darkMuted = hslToHex(surfaceHue(2), 4, 60);

  // ── Light surfaces — warm and readable, never pure white ──
  // Seed color character influences light surface luminance:
  // darker seeds → warmer, slightly dimmer light surfaces
  // brighter seeds → can stay brighter
  const seedLuminanceFactor = clamp((l - 30) / 50, -0.04, 0.02);
  const lightBaseSat = Math.round(8 + (s / 100) * 18 * hueInfluence);
  const lightBaseL = 94 + Math.round(seedLuminanceFactor * 100);

  const lightBackground = hslToHex(surfaceHue(0), lightBaseSat, lightBaseL);
  const lightForeground = hslToHex(surfaceHue(1), 12, 8);
  const lightCard = hslToHex(surfaceHue(0), lightBaseSat + 1, lightBaseL + 2);
  const lightSurface1 = hslToHex(surfaceHue(1), lightBaseSat + 1, lightBaseL + 3);
  const lightSurface2 = hslToHex(surfaceHue(2), lightBaseSat - 2, lightBaseL - 3);
  const lightSurface3 = hslToHex(surfaceHue(3), lightBaseSat - 4, lightBaseL - 8);
  const lightBorder = hslToHex(surfaceHue(3), lightBaseSat - 4, lightBaseL - 8);
  const lightMuted = hslToHex(surfaceHue(2), 6, 48);

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
