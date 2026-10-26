# Theme standardization guide

The `zinc-*` → theme-variable migration is complete: no `zinc-*` Tailwind class
remains in `catalyst-frontend/src`. This guide exists so new code stays
theme-aware. The theme is applied by `src/stores/themeStore.ts`
(`applyThemeToDOM`) and the variables are declared in `src/styles/globals.css`.

## Use these classes

| Instead of a palette literal | Use |
|---|---|
| backgrounds | `bg-background`, `bg-card`, `bg-surface-0` … `bg-surface-3`, `bg-muted`, `bg-popover` |
| text | `text-foreground` (primary), `text-muted-foreground` (secondary), `text-card-foreground`, `text-popover-foreground` |
| borders / dividers / focus | `border-border`, `divide-border`, `ring-ring` |
| status | `bg-success` / `text-success`, `-warning`, `-danger`, `-info` |

Rule of thumb: darkest neutral → `surface-0`, each lighter step → `surface-1…3`;
text 100–300 → `foreground`, 400–600 → `muted-foreground`. Keep opacity
suffixes (`bg-surface-2/50`) and `dark:` prefixes as they were.

## Variables set by `applyThemeToDOM`

`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`,
`--popover-foreground`, `--border`, `--input`, `--muted`, `--muted-foreground`,
`--surface-0`, `--surface-1`, `--surface-2`, `--surface-3`, `--primary`,
`--primary-foreground`, `--accent`, `--ring`, `--radius`, `--success`,
`--warning`, `--danger`, `--info`.

## Keep as-is

- `dark:` prefixes — the variables already switch with the `.dark` class.
- Decorative gradients/blurs and `shadow-*` colours — not part of the theme.
- `ThemeSettingsPage.tsx` — it is the settings UI, not themed content.
- Console colours (`.chl-*`, `src/components/console/xtermTheme.ts`).
- Status badges and indicators — use the semantic colours, not surfaces.

For new surfaces use the deck primitives (`src/components/deck/primitives.tsx`)
and the `.deck-panel` / `.deck-rows` classes rather than composing panels by hand.
