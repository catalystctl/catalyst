# Theme Standardization Guide

## Goal
Replace all hardcoded `zinc-*` Tailwind color classes in pages and components with theme-aware CSS variable-based classes. The ThemeSettingsPage controls these variables via the theme store (`themeStore.ts`), so using theme-aware classes ensures the admin panel responds to theme customization.

## CSS Variables (set by themeStore.applyThemeToDOM)

| Variable | Purpose |
|----------|---------|
| `--background` | Main page background |
| `--foreground` | Primary text color |
| `--card` | Card/panel backgrounds |
| `--card-foreground` | Text on cards |
| `--border` | Borders and dividers |
| `--input` | Input borders |
| `--muted` | Muted backgrounds |
| `--muted-foreground` | Secondary/muted text |
| `--surface-0` | Base surface (same as background) |
| `--surface-1` | Elevated surface 1 |
| `--surface-2` | Elevated surface 2 |
| `--surface-3` | Elevated surface 3 |
| `--primary` | Primary brand color |
| `--primary-foreground` | Text on primary |
| `--accent` | Accent color |
| `--ring` | Focus ring color |
| `--radius` | Border radius |
| `--success` | Success/success-muted |
| `--warning` | Warning/warning-muted |
| `--danger` | Danger/destructive |
| `--info` | Info/info-muted |
| `--popover` | Popover background |
| `--popover-foreground` | Popover text |

## Tailwind Classes to Use (theme-aware)

### Backgrounds
```
bg-background    → --background
bg-card          → --card
bg-surface-0     → --surface-0
bg-surface-1     → --surface-1
bg-surface-2     → --surface-2
bg-surface-3     → --surface-3
bg-muted         → --muted
bg-popover       → --popover
```

### Text
```
text-foreground        → --foreground (primary text)
text-card-foreground   → --card-foreground
text-muted-foreground  → --muted-foreground (secondary/muted text)
text-primary           → --primary
text-primary-foreground → --primary-foreground
```

### Borders
```
border-border  → --border
divide-border  → --border
ring-ring      → --ring
```

### Semantic
```
bg-success / text-success
bg-warning / text-warning
bg-danger / text-danger
bg-info / text-info
```

## ZINC → THEME MAPPING

### Background Replacement
```
bg-zinc-950      → bg-surface-0
bg-zinc-900      → bg-surface-1
bg-zinc-800      → bg-surface-2
bg-zinc-700      → bg-surface-3
bg-zinc-900/50   → bg-surface-1/50
bg-zinc-800/50   → bg-surface-2/50
bg-zinc-800/30   → bg-surface-2/30
hover:bg-zinc-800/50  → hover:bg-surface-2/50
hover:bg-zinc-800/30  → hover:bg-surface-2/30
```

### Text Replacement
```
text-zinc-100    → text-foreground
text-zinc-200    → text-foreground
text-zinc-300    → text-foreground
text-zinc-400    → text-muted-foreground
text-zinc-500    → text-muted-foreground
text-zinc-600    → text-muted-foreground
text-zinc-700    → text-muted-foreground
text-zinc-800    → text-foreground
text-zinc-900    → text-foreground
hover:text-zinc-300  → hover:text-foreground
hover:text-zinc-600  → hover:text-muted-foreground
```

### Border / Divider Replacement
```
border-zinc-700       → border-border
border-zinc-700/50    → border-border/50
border-zinc-800       → border-border
border-zinc-800/50    → border-border/50
border-zinc-900       → border-border
divide-zinc-700       → divide-border
divide-zinc-800       → divide-border
divide-zinc-800/50    → divide-border/50
```

### Ring / Focus
```
ring-zinc-700    → ring-border
focus:ring-zinc-500  → focus:ring-ring
focus:border-zinc-500 → focus:border-primary (or focus:border-ring)
```

### Placeholder
```
placeholder:text-zinc-400  → placeholder:text-muted-foreground
placeholder:text-zinc-500  → placeholder:text-muted-foreground
```

## PATTERNS TO PRESERVE
- Keep `dark:` prefix if the original had `dark:` prefix — the theme variables auto-switch with `.dark` class
- For text that needs explicit light/dark differentiation: use `text-foreground` (auto-switches) instead of separate `text-zinc-* dark:text-zinc-*`
- Decorative gradients with `slate-*` or `zinc-*` in blur/glow effects can stay as-is (they're decorative)
- ThemeSettingsPage.tsx itself can keep zinc — it's the settings UI, not themed content
- Status badges and semantic indicators should use semantic colors (success/danger/warning/info)
- Console-specific colors (`.chl-*` classes) should stay as-is
- `gray-750`, `gray-850`, `gray-950` — check context. Replace with surface colors if structural, keep if decorative

## IMPORTANT NOTES
1. `zinc-*` in `shadow-*` utilities doesn't need to change (shadow opacity is independent)
2. `from-zinc-*` and `to-zinc-*` in gradients should be replaced with surface or foreground as appropriate
3. `opacity-*` on zinc colors is fine, just map the base color
4. For icon colors, use `text-muted-foreground` instead of `text-zinc-400/500`
5. If a component has BOTH `text-zinc-300` and `text-zinc-400` for hierarchy, use `text-foreground` and `text-muted-foreground` respectively
6. When in doubt, prefer simple mapping (zinc-100..300 → foreground, zinc-400..600 → muted-foreground)
