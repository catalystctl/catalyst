/**
 * Resolve Catalyst CSS tokens into concrete colors for xterm.
 *
 * Tokens are HSL *channels* (`240 12% 9%`), not full colors. xterm needs a
 * real `#rrggbb` / `rgb()` value. A naive `getComputedStyle(probe).color`
 * probe is unsafe: the probe lives on <html>, which in `.dark` has
 * `color-scheme: dark`, so a failed `hsl(var(--token))` inherits canvastext
 * (~white). xterm 6 then paints that onto `.xterm-scrollable-element` and
 * the log becomes white-on-white.
 */

import type { ITheme } from '@xterm/xterm';

const CHANNELS = /^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%(?:\s*\/\s*([\d.]+%?))?$/;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Convert HSL channels (H 0–360, S/L 0–100) to `#rrggbb`. */
export function hslChannelsToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + hh / 30) % 12;
    const c = ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Turn a raw CSS custom-property value into a concrete color.
 * Accepts channel tokens, already-wrapped hsl()/rgb()/#hex, or empty.
 * Translucent channel tokens (`H S% L% / alpha`) are rejected — xterm needs
 * opaque colors, and silently dropping the alpha would paint a wrong solid.
 */
export function tokenValueToColor(raw: string, fallback: string): string {
  const value = raw.trim();
  if (!value) return fallback;

  if (value.startsWith('#') || /^(rgb|hsl|oklch|hwb|lab|lch|color)\(/i.test(value)) {
    return value;
  }

  const match = value.match(CHANNELS);
  if (match) {
    const alphaRaw = match[4];
    if (alphaRaw !== undefined) {
      const alpha = alphaRaw.endsWith('%') ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
      if (!Number.isFinite(alpha) || alpha < 1) return fallback;
    }
    return hslChannelsToHex(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  return fallback;
}

const VAR_REF = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/;

export function readCssVar(token: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  try {
    const styles = getComputedStyle(document.documentElement);
    let value = styles.getPropertyValue(token).trim();
    // Follow var() hops (`--primary: var(--signal)`) up to 3 deep, then stop
    // so a cyclic alias cannot hang the theme read.
    for (let depth = 0; depth < 3; depth++) {
      const ref = value.match(VAR_REF);
      if (!ref) break;
      const next = styles.getPropertyValue(ref[1]).trim();
      if (next) {
        value = next;
      } else {
        value = (ref[2] ?? '').trim();
        break;
      }
    }
    return value;
  } catch {
    return '';
  }
}

export function resolveThemeColor(token: string, fallback: string): string {
  return tokenValueToColor(readCssVar(token), fallback);
}

function parseRgb(color: string): [number, number, number] | null {
  const hex = color.match(/^#([\da-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  }
  const rgb = color.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    return document.documentElement.classList.contains('dark');
  } catch {
    return true;
  }
}

/** Mix `amount` of `fg` over `bg` into `#rrggbb` (xterm cannot parse color-mix()). */
function mixHex(fg: string, bg: string, amount: number): string {
  const fgRgb = parseRgb(fg);
  const bgRgb = parseRgb(bg);
  if (!fgRgb || !bgRgb) return fg;
  const mix = (a: number, b: number) =>
    Math.round(a * amount + b * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(fgRgb[0], bgRgb[0])}${mix(fgRgb[1], bgRgb[1])}${mix(fgRgb[2], bgRgb[2])}`;
}

/** Selection wash: primary mixed over the terminal bg (0.28 dark / 0.22 light). */
function resolveSelection(primary: string, bg: string): string {
  return mixHex(primary, bg, isDarkTheme() ? 0.28 : 0.22);
}

export function readXtermTheme(): ITheme {
  const bg = resolveThemeColor('--card', '#161a21');
  const fg = resolveThemeColor('--foreground', '#e6edf3');
  const primary = resolveThemeColor('--primary', '#ff3d7f');
  const danger = resolveThemeColor('--danger', '#f87171');
  const success = resolveThemeColor('--success', '#4ade80');
  const warning = resolveThemeColor('--warning', '#fbbf24');
  const info = resolveThemeColor('--info', '#60a5fa');
  const muted = resolveThemeColor('--muted-foreground', '#939dac');
  const surface = resolveThemeColor('--surface-2', '#232a35');

  return {
    background: bg,
    foreground: fg,
    cursor: primary,
    cursorAccent: bg,
    selectionBackground: resolveSelection(primary, bg),
    // Blurred-window selection: surface at 25% over the terminal bg,
    // pre-blended because xterm cannot parse color-mix().
    selectionInactiveBackground: mixHex(surface, bg, 0.25),
    selectionForeground: fg,
    black: resolveThemeColor('--background', '#09090b'),
    red: danger,
    green: success,
    yellow: warning,
    blue: info,
    magenta: primary,
    cyan: info,
    white: fg,
    brightBlack: muted,
    brightRed: danger,
    brightGreen: success,
    brightYellow: warning,
    brightBlue: info,
    brightMagenta: primary,
    brightCyan: info,
    brightWhite: resolveThemeColor('--card-foreground', fg),
  };
}

/** xterm 6 paints theme.background onto these nodes as an inline style. */
const XTERM_BG_SELECTORS = ['.xterm', '.xterm-viewport', '.xterm-scrollable-element'];

export function paintXtermBackground(host: HTMLElement, bg: string): void {
  host.style.backgroundColor = bg;
  for (const selector of XTERM_BG_SELECTORS) {
    const el = host.querySelector(selector) as HTMLElement | null;
    if (el) el.style.backgroundColor = bg;
  }
}
