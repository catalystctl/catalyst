---
name: Catalyst
description: A clean, fast, modern game server management panel.
colors:
  primary: "#17D3C0"
  primary-light: "#3AE3D2"
  primary-muted: "#17D3C026"
  success: "#10B981"
  warning: "#F59E0B"
  danger: "#EF4444"
  info: "#3B82F6"
  neutral-bg: "#F6F5F4"
  neutral-fg: "#151226"
  neutral-muted: "#EFEEEC"
  neutral-card: "#FBFAF9"
  neutral-border: "#E1DFDB"
  dark-bg: "#07071D"
  dark-fg: "#F4F4F6"
  dark-muted: "#272734"
  dark-card: "#0C0C21"
  dark-border: "#2D2D39"
typography:
  display:
    fontFamily: '"Outfit Variable", system-ui, sans-serif'
    fontSize: "clamp(1.5rem, 4vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: '"DM Sans Variable", system-ui, sans-serif'
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: '"DM Sans Variable", system-ui, sans-serif'
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.05em"
  mono:
    fontFamily: '"JetBrains Mono Variable", "Fira Code", monospace'
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  "2xl": "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-light}"
  button-secondary:
    backgroundColor: "{colors.neutral-muted}"
    textColor: "{colors.neutral-fg}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-fg}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  input-default:
    backgroundColor: "{colors.neutral-bg}"
    textColor: "{colors.neutral-fg}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  card-default:
    backgroundColor: "{colors.neutral-card}"
    textColor: "{colors.neutral-fg}"
    rounded: "{rounded.xl}"
    padding: "24px"
  badge-default:
    backgroundColor: "{colors.primary-muted}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "2px 8px"
---

# Design System: Catalyst

## 1. Overview: Precision Console

**Creative North Star: "Precision Console"**

Catalyst is a dense product UI for game-server operations. The visual system is a refined workshop bench: warm zinc neutrals form the work surface, a single primary accent (customizable) marks active tools, and tonal layering replaces heavy chrome. Layout stays stable and scannable. Motion stays functional. Density favors operators who live in the panel all day.

**Taste dials (panel UI):** DESIGN_VARIANCE 3 · MOTION_INTENSITY 3 · VISUAL_DENSITY 7

**Stack lock:** shadcn/ui + CSS variables. Theme Settings rewrites `--primary`, surfaces, radius, and semantics at runtime. Never hardcode brand hex in components; always use theme tokens (`bg-primary`, `bg-card`, `bg-surface-*`, `text-muted-foreground`, etc.).

The system is built on tonal layering rather than shadow elevation. Depth is communicated through background color steps (`surface-0` through `surface-3`), not lifted cards. This keeps the interface grounded and avoids the visual noise of competing drop shadows. Dark mode inverts the warmth to a cool zinc — same systematic logic, different ambient temperature.

This system explicitly rejects the generic visual language of AI-generated dashboards: no gradient text, no glassmorphism, no decorative side-stripes, no identical icon-heading-text card grids, and no modal-as-default interaction patterns. It also rejects "gamer aesthetic" neon accents and Bootstrap-era dense chrome. Catalyst is infrastructure software that happens to be well-designed, not a design portfolio piece.

**Key Characteristics:**
- Warm zinc ground in light mode, cool zinc in dark mode — never pure white or pure black
- One accent color (warm aqua teal) used sparingly; semantic colors (green, amber, red, blue) for status only
- Tonal layering for depth; minimal shadow use
- 200ms default transitions; no bounce or elastic easing
- HSL color space in source; hex approximations exported for tooling compliance
- Responsive from mobile (320px) to ultrawide (4K)

## 2. Colors: The Warm Aqua Palette

The palette is intentionally restrained: tinted neutrals carry 90%+ of every screen, warm aqua marks interactive and active states, and semantic colors are reserved for status indicators. The "Warm Aqua Rule" governs the accent: it appears on active navigation items, primary buttons, focus rings, and selected states — never as decorative fills or gradient backgrounds.

### Primary
- **Warm Aqua** (`#17D3C0` / `hsl(174 80% 46%)`): The sole accent. Used for primary buttons, active navigation, focus rings, selected states, and links. Its warmth comes from the zinc ground; against cool backgrounds it reads as slightly greener. In dark mode it gains luminosity against the deep cool ground.
- **Warm Aqua Light** (`#3AE3D2` / `hsl(174 72% 56%)`): Hover state for primary buttons and interactive elements. Slightly lighter and less saturated to avoid vibration on hover.
- **Warm Aqua Muted** (`#17D3C026` / `hsl(174 80% 46% / 0.15)`): Badge backgrounds, subtle active indicators, and tinted containers. At 15% opacity it provides recognizability without dominance.

### Semantic
- **Signal Green** (`#10B981` / `hsl(160 84% 39%)`): Success states, healthy server indicators, confirmation actions.
- **Signal Amber** (`#F59E0B` / `hsl(38 92% 50%)`): Warnings, pending states, attention-required indicators.
- **Signal Red** (`#EF4444` / `hsl(0 84% 60%)`): Errors, destructive actions, critical alerts.
- **Signal Blue** (`#3B82F6` / `hsl(217 91% 60%)`): Informational states, links in dense text, neutral highlights.

### Neutral (Light Mode)
- **Warm Zinc Ground** (`#F6F5F4` / `hsl(40 10% 96%)`: The app background. Tinted subtly warm (40° hue) to avoid the sterile flatness of pure gray. Every neutral in light mode carries this same warm undertone.
- **Warm Zinc Surface** (`#FBFAF9` / `hsl(40 15% 98%)`): Card and popover backgrounds. Slightly lighter than the ground to create subtle separation without borders.
- **Warm Zinc Muted** (`#EFEEEC` / `hsl(40 8% 93%)`): Secondary surfaces, hover states, disabled backgrounds, table striping.
- **Warm Zinc Border** (`#E1DFDB` / `hsl(40 8% 87%)`: Dividers, input borders, card outlines. The lightest value that still registers as a boundary.
- **Warm Zinc Text** (`#151226` / `hsl(250 10% 11%)`: Primary text. Tinted slightly cool (250° hue) for crispness against the warm ground.
- **Warm Zinc Text Muted** (`#727273` / `hsl(250 5% 45%)`: Secondary text, placeholders, inactive labels.

### Neutral (Dark Mode)
- **Cool Zinc Ground** (`#07071D` / `hsl(240 10% 7%)`): The dark app background. Cool blue-gray undertone (240° hue) for reduced eye strain in low-light environments.
- **Cool Zinc Surface** (`#0C0C21` / `hsl(240 10% 9%)`): Card and popover backgrounds in dark mode.
- **Cool Zinc Muted** (`#272734` / `hsl(240 8% 18%)`: Secondary surfaces, hover states, input backgrounds.
- **Cool Zinc Border** (`#2D2D39` / `hsl(240 8% 20%)`: Dividers and outlines in dark mode.
- **Cool Zinc Text** (`#F4F4F6` / `hsl(240 10% 96%)`: Primary text in dark mode. High contrast without pure white harshness.
- **Cool Zinc Text Muted** (`#94949E` / `hsl(240 5% 60%)`: Secondary text in dark mode.

### Named Rules
**The Warm Aqua Rule.** The primary accent appears on ≤10% of any given screen. Its rarity is the point. If warm aqua is everywhere, it marks nothing. Reserve it for active states, primary actions, and focus rings only.

**The Tinted Neutral Rule.** Never use `#000` or `#fff`. Every neutral is tinted toward the mode's temperature: warm (40°) in light, cool (240°) in dark. Chroma stays at 0.005–0.01 — just enough to feel intentional, not enough to read as color.

**The Semantic Isolation Rule.** Green, amber, red, and blue are status indicators only. They do not appear in marketing elements, decorative accents, or brand expression. A green button is a confirmation; it is never a "brand color."

## 3. Typography

**Display Font:** Outfit Variable (system-ui fallback) — geometric, confident, slightly technical. Used for page titles, card headers, and any moment that needs structural presence.

**Body Font:** DM Sans Variable (system-ui fallback) — humanist sans with generous apertures. Optimized for extended reading of server logs, configuration values, and dense tabular data.

**Mono Font:** JetBrains Mono Variable (Fira Code fallback) — purpose-built for code. Used for file paths, console output, configuration keys, and any monospace context.

**Character:** The pairing is warm-meets-technical. DM Sans provides approachable readability; Outfit provides architectural hierarchy. Together they feel like a well-organized workshop: everything has a place, and the labels are legible at a glance.

### Hierarchy
- **Display** (700, clamp(1.5rem, 4vw, 2.25rem), line-height 1.1): Page titles, empty state headlines, major section headers. Tight tracking (-0.02em) for presence. Never used for body text.
- **Headline** (600, 1.25rem, line-height 1.25): Card titles, dialog headers, sub-section headings. Outfit at reduced weight from Display.
- **Title** (500, 1rem, line-height 1.375): Form section labels, table column headers, list group titles. DM Sans semi-bold.
- **Body** (400, 0.875rem/14px, line-height 1.5): All readable content. Max line length 75ch in wide containers. The workhorse of the system.
- **Label** (500, 0.75rem/12px, letter-spacing 0.05em, uppercase): Navigation section headers, stat card subtitles, badge text, metadata. Uppercase with wide tracking for scannability.
- **Mono** (400, 0.8125rem/13px, line-height 1.5): Code, file paths, UUIDs, timestamps, console output. Slightly smaller than body to compensate for monospace's larger perceived size.

### Named Rules
**The One Weight Jump Rule.** Adjacent type sizes must differ by at least 1.25× in scale or 200 in font weight. Avoid flat hierarchies where 14px medium and 14px regular sit next to each other with only color to distinguish them.

**The 75ch Rule.** Body text in wide containers (server descriptions, log output panels, documentation) must not exceed 75 characters per line. Break into columns or truncate with ellipsis.

## 4. Elevation

Catalyst is a tonal-layering system. Surfaces are flat at rest; depth is conveyed through background color steps, not shadow geometry. This produces a cleaner, less visually noisy interface that stays legible in both light and dark modes without managing shadow color shifts.

Shadows exist but are minimal and functional: a 1px diffuse shadow (`surface-light`) gives cards subtle separation from the ground, and a 4px elevated shadow (`elevated`) appears only on hover or for modal overlays. There are no persistent medium shadows on static elements.

### Shadow Vocabulary
- **Surface** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)` in light / `0 1px 2px 0 rgb(0 0 0 / 0.3)` in dark): Default card shadow. Barely perceptible — just enough to register as a discrete surface.
- **Elevated** (`box-shadow: 0 4px 12px -2px rgb(0 0 0 / 0.1)` in light / `0 4px 12px -2px rgb(0 0 0 / 0.5)` in dark): Hover elevation on cards, dropdown menus, and modal content. Appears as a response to state, not at rest.

### Tonal Layering
- **surface-0** (`#F6F5F4` / `#07071D`): The app ground. Everything sits on this.
- **surface-1** (`#FBFAF9` / `#0C0C21`): Cards, popovers, modals, elevated panels. One step above the ground.
- **surface-2** (`#EFEEEC` / `#272734`): Hover states, secondary panels, input backgrounds, tab lists. Two steps above.
- **surface-3** (`#E1DFDB` / `#2D2D39`): Active pressed states, dragged items, strong boundaries. Three steps above; used sparingly.

### Named Rules
**The Flat-By-Default Rule.** Every surface is flat at rest. Shadows appear only as a response to state: hover (elevated), focus (ring), drag (surface-3), modal (overlay + elevated). If an element has a persistent shadow, question whether it needs to be a separate surface.

**The No-Backdrop-Blur Rule.** Backdrop-filter blur is used only for modal overlays (`bg-black/60 backdrop-blur-sm`) and mobile header bars. It is never used for card backgrounds, frosted panels, or decorative glass effects.

## 5. Components

Component character across the system: direct and expert. Buttons feel firm, inputs feel precise, cards feel like organized trays. Every component assumes the user is competent and in a hurry.

### Buttons
- **Shape:** Gently curved (6px radius). Not pill-shaped, not sharp-cornered. The radius says "friendly tool," not "marketing CTA."
- **Primary:** Warm Aqua background (`#17D3C0`), white text, 8px 16px padding, 1px surface shadow. Hover shifts to Warm Aqua Light (`#3AE3D2`). Active darkens to 80% opacity. Focus: 2px ring at 40% primary opacity with 2px background offset.
- **Secondary:** Warm Zinc Muted background (`#EFEEEC`), dark text. For non-destructive secondary actions. Hover to surface-3.
- **Ghost:** Transparent background, dark text. Hover to Warm Zinc Muted. For toolbars, icon buttons, and low-priority actions.
- **Destructive:** Signal Red background, white text. For delete, remove, and irreversible actions. Hover darkens 10%.
- **Sizes:** Default (36px height), Small (32px), Large (40px), Icon (36px × 36px square). All sizes share the same 6px radius.

### Badges
- **Style:** Filled subtle by default. Warm Aqua Muted background (`#17D3C026`), Warm Aqua text, 6px radius, 2px 8px padding. No border.
- **Variants:** Secondary (surface-2 background), Outline (transparent with border), Success/Warning/Danger/Info (semantic muted background with matching text). All variants share the same subtle, non-blocking presence.

### Cards / Containers
- **Corner Style:** 12px radius (`rounded-xl`). More generous than buttons to read as containers, not controls.
- **Background:** Warm Zinc Surface in light, Cool Zinc Surface in dark.
- **Border:** 1px Warm Zinc Border in light, Cool Zinc Border in dark. Always present for definition.
- **Shadow:** Surface shadow at rest. Elevated shadow on hover (if interactive).
- **Internal Padding:** 24px (`p-6`) for header and content areas. Header and content are separated by consistent whitespace, not divider lines.

### Inputs / Fields
- **Style:** 36px height, 6px radius, 1px border in Warm Zinc Border, background in Warm Zinc Ground. Text in body style.
- **Focus:** Border shifts to Warm Aqua, 2px ring at 40% primary opacity. No glow, no animated border.
- **Placeholder:** Warm Zinc Text Muted.
- **Disabled:** Cursor not-allowed, opacity 0.5. No grayed-out background change — the opacity reduction is sufficient.
- **File inputs:** Same styling with transparent file button styling.

### Navigation
- **Style:** Vertical sidebar, 224px wide expanded / 64px collapsed. Background: surface-0. Border-right: 1px border.
- **Items:** 8px 12px padding, 6px radius, DM Sans 14px medium. Icon (16px) + label with 12px gap.
- **Default:** Warm Zinc Text Muted.
- **Hover:** Warm Zinc Muted background, dark text.
- **Active:** Warm Aqua background, white text, 1px surface shadow. This is the primary accent's most visible application.
- **Section headers:** 11px uppercase, wide tracking (0.05em), Warm Zinc Text Muted. Expandable with chevron.
- **Mobile:** Fixed overlay sidebar with backdrop blur. Bottom sheet for selection on smallest viewports.

### Tables
- **Header:** 44px height, Warm Zinc Text Muted, 500 weight, left-aligned. Bottom border only.
- **Rows:** 48px implied height (py-3 + content), border-b between rows. Hover: surface-2/50 background.
- **Selection:** surface-2 background for selected rows. Checkbox in first column if bulk actions available.
- **Cells:** 16px horizontal padding. No vertical borders. Clean horizontal rhythm.

### Tabs
- **List:** 40px height, 6px radius, surface-2 background, 4px internal padding.
- **Trigger:** 6px radius, 12px horizontal padding. Default: Warm Zinc Text Muted. Active: background background, dark text, 1px surface shadow. Transition 200ms.
- **Content:** 12px top margin (`mt-3`). No vertical borders or heavy separators.

### Dialogs
- **Overlay:** Black at 60% opacity with 4px backdrop blur.
- **Content:** Max 512px width, centered. 12px radius, surface-1 background, 1px border, elevated shadow.
- **Header:** Title in Outfit 18px semi-bold. Close button top-right, ghost style.
- **Padding:** 24px all around.
- **Animation:** 200ms fade + zoom (95%→100%). No bounce.

### Empty States
- **Style:** 12px radius, dashed border, surface-1 background, surface shadow.
- **Content:** Centered. Title in Outfit 18px semi-bold. Optional description in body muted. Optional action button below with 16px top margin.

## 6. Do's and Don'ts

### Do:
- **Do** use Warm Aqua exclusively for active states, primary actions, and focus rings. Its scarcity is its power.
- **Do** rely on tonal layering (`surface-0` → `surface-3`) before reaching for shadows.
- **Do** cap body text at 75 characters per line in wide layouts.
- **Do** use 200ms `cubic-bezier(0.4, 0, 0.2, 1)` for all state transitions. No bounce, no elastic.
- **Do** tint every neutral: warm (40°) in light mode, cool (240°) in dark mode. Never `#000` or `#fff`.
- **Do** pair color with icon or text for status indicators. Color alone fails accessibility.
- **Do** use Outfit for display text and DM Sans for everything else. No mixing at the same hierarchy level.
- **Do** respect `prefers-reduced-motion` by collapsing transitions to 0.01ms.
- **Do** use skeleton loaders (`animate-pulse` on muted backgrounds) instead of spinners for content loading.

### Don't:
- **Don't** use gradient text (`background-clip: text`). Decorative, never meaningful. Use a single solid color; emphasis via weight or size.
- **Don't** use glassmorphism or frosted panels as a default treatment. Blur is reserved for modal overlays and mobile headers only.
- **Don't** use side-stripe borders (`border-left` or `border-right` > 1px as a colored accent on cards, list items, or alerts). Rewrite with full borders, background tints, or leading icons.
- **Don't** build identical card grids (icon + heading + text, repeated endlessly). Vary layout patterns; use tables, lists, or inline details where appropriate.
- **Don't** use modals as the first interaction pattern. Exhaust inline, progressive, and slide-out alternatives before blocking the user's context.
- **Don't** use em dashes in copy. Use commas, colons, semicolons, periods, or parentheses.
- **Don't** use neon accents, aggressive gradients, or "gamer aesthetic" visual language. Catalyst is infrastructure, not entertainment.
- **Don't** use Bootstrap-era dense chrome: excessive borders, every column in a data table, no whitespace rhythm.
- **Don't** use dark mode with purple gradients or any color combination that signals "AI tool."
- **Don't** duplicate headings. Every word earns its place; no restated titles or redundant intros.
