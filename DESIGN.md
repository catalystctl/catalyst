---
name: Catalyst
description: A game-server control panel built as a server browser, not an admin dashboard.
colors:
  # Chassis — cool graphite, tinted, never pure black or white
  ink: "#0E1116"
  panel: "#161A21"
  panel-2: "#1D222B"
  edge: "#2B323D"
  chalk: "#E9EDF2"
  dust: "#939DAC"
  # Signal — interactive only
  signal: "#FF3D7F"
  signal-deep: "#C81E5C"
  # Status — state only
  success: "#3FCF8E"
  warning: "#FFB020"
  danger: "#FF5A5A"
  info: "#6FA8FF"
  # Game identity — glyph chips only, never surfaces
  game-minecraft: "#4FAE5A"
  game-cs: "#E8A33D"
  game-rust: "#C4553B"
  game-ark: "#3FA9A0"
  game-valheim: "#7C9CC4"
  game-generic: "#8A93A0"
  # Brutalist theme preset only (documented exception: hard offset shadows)
  brutalist-shadow: "rgb(0 0 0 / 0.9)"
  brutalist-shadow-soft: "rgb(0 0 0 / 0.85)"
typography:
  display:
    fontFamily: '"Oxanium Variable", system-ui, sans-serif'
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
  body:
    fontFamily: '"DM Sans Variable", system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: '"DM Sans Variable", system-ui, sans-serif'
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "0.08em"
  data:
    fontFamily: '"JetBrains Mono Variable", "Fira Code", monospace'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  micro:
    fontFamily: '"DM Sans Variable", system-ui, sans-serif'
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "normal"
  mini:
    fontFamily: '"DM Sans Variable", system-ui, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  dataSmall:
    fontFamily: '"JetBrains Mono Variable", "Fira Code", monospace'
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  sm: "4px"       # controls — pinned so a theme preset cannot reshape the deck
  md: "6px"
  lg: "4px"       # panels use --deck-radius (4px); lg stays theme-driven for floating surfaces
  xl: "8px"
  "2xl": "12px"
  hairline: "2px" # text-highlight chips only
  scroll: "3px"   # native scrollbar track/thumb chrome
  pill: "999px"   # status LED + avatar circles only — never a surface
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  button-secondary:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  input-default:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  panel-default:
    backgroundColor: "{colors.panel}"
    borderColor: "{colors.edge}"
    rounded: "{rounded.lg}"
    padding: "12px"
  row-default:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  badge-default:
    backgroundColor: "{colors.panel-2}"
    textColor: "{colors.dust}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
---

# Design System: Catalyst — the Server Browser deck

The full contract, the anti-default audit and the structural rules live in
[`docs/design/deck-identity.md`](docs/design/deck-identity.md). This file is the
machine-readable summary that tooling reads.

## 1. Subject and lane

Catalyst runs **game servers**, and its users know one interface better than any
dashboard: the in-game **server browser** — rows of servers with ping bars,
player counts, maps and tick rates. The panel is a deck: a rack cabinet with a
browser bolted to the front. Identity comes from *game* colour, not from one
brand hue; status colours stay semantic.

**Refused** (documented AI-design defaults, and our own earlier misses): warm
cream + serif + terracotta; near-black + acid green; broadsheet hairlines;
purple gradients; cyan-on-dark; thick single-side accent borders ("side tabs");
rounded-lg card stacks; icon-in-a-rounded-tile headings; pure `#000`/`#fff`;
bounce or elastic easing.

## 2. Colour

All values are HSL channel tokens so Theme Settings can re-hue at runtime —
identity must survive a re-hue because it lives in structure, type and the
activity cluster, not in hue.

- **Chassis**: `ink` #0E1116, `panel` #161A21, `panel-2` #1D222B, `edge` #2B323D,
  `chalk` #E9EDF2, `dust` #939DAC.
- **Signal**: `signal` #FF3D7F (interactive only), `signal-deep` #C81E5C.
- **Status**: `success` #3FCF8E, `warning` #FFB020, `danger` #FF5A5A, `info` #6FA8FF —
  state only, never decoration.
- **Game identity**: per-game hues above, glyph chips only, never surfaces.

The **Signal Rule.** Magenta appears only where the user can act: active
navigation, primary buttons, focus rings, filter underlines. If it is
everywhere it points at nothing.

The **Semantic Isolation Rule.** Green/amber/red/blue mean state. A green
button is a confirmation, never a brand colour.

The **Neutral Rule.** Never `#000` or `#fff`; every neutral is a tinted
graphite step (`surface-0` → `surface-3`) or a chassis token.

## 3. Typography

- **Display — Oxanium Variable**: wordmark, page titles, actions, small caps
  labels. Angular and gaming-native; it must not be swapped for a geometric
  sans.
- **Prose — DM Sans Variable**: paragraphs and helper text.
- **Data — JetBrains Mono Variable**: ids, addresses, ports, sizes, counts,
  timestamps — anything a user compares column-to-column.

Documented ramp — ad-hoc literals (`text-[10px]`, `text-[11px]`, `text-[9px]`)
are off-ramp and flagged by tooling:

| step | size | class |
|---|---|---|
| micro | 11px | `.text-micro` |
| mini | 12px | `.text-mini` |
| data | 13px | `.text-data` |
| body | 14px | `text-sm` |
| prose | 16px | `text-base` |
| title | 18px | `text-lg` |

## 4. Shape, motion, structure

- **Radius.** Panels and rows use a fixed `--deck-radius` (4px) via
  `.deck-panel`/`.deck-rows`, and the control step (`rounded-sm` = 4px) is
  pinned in the Tailwind scale rather than derived from `--radius`, so an admin
  theme — including a gallery preset — cannot reshape the deck's controls.
  `lg` and above stay theme-driven for floating surfaces. Oversized radii on
  data surfaces are refused.
- **Motion**: 120ms/200ms on `--ease-standard`. The status LED pulses opacity
  only (`.deck-led-pulse`, 2.4s) — never scale, never bounce.
- **Structure**: a 56px cabinet rail, a marquee header, and one framed
  `.deck-panel` per surface holding a control strip, a sticky column header of
  `type-overline` labels, dense rows (`px-3`, 1px `border-border/40`
  separators, hover `bg-surface-1/40`) and a footer strip. Labels are
  `BracketLabel` (filled square + letterspaced display label) — never an
  overline closed by a long hairline.
- **Sizing roles**: page primary action h-8, toolbar and row controls h-7, icon
  buttons `icon-sm`, rail h-9. One height per role.

## 5. The signature

**The activity cluster**: `ActivityBars` (a small bar cluster) plus `Meter`
(with a visible track) plus mono values, with severity carried by the *value*
(amber ≥75%, red ≥90%) rather than by decoration. It appears on fleet rows, in
the marquee heartbeat and on metric surfaces — that cluster, not a colour, is
what makes the panel recognisable.

## 6. Non-negotiables

- Every colour flows through the HSL tokens; never hardcode a palette literal.
- All user-visible copy goes through `t()`; no literal strings.
- Plugin-facing primitives keep their props, variants and exports.
- Tables share one grid template between header and rows, with fixed or `1fr`
  tracks only — a content-sized track makes headers and values drift apart.
