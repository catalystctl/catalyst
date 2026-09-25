# Catalyst — "Server Browser" identity

Design contract for the panel's visual language. Written after an audit with
`npx impeccable detect` plus the Anthropic *frontend-design* skill process
(ground → tokens → signature → anti-default critique → build).

## The subject

Catalyst runs **game servers**. Its users are server owners and hosts who know
one interface better than any dashboard: the **in-game server browser** — the
list of servers with ping bars, player counts, map names and tick rates. That
is the native vocabulary of this audience, and no control panel uses it.

## The lane (and what we refuse)

The skill names three looks that AI design clusters around and says not to
spend free choices on them:

1. warm cream + serif + terracotta,
2. near-black + acid green,
3. broadsheet hairlines.

Our previous pass landed inside 1 and 3 (warm graphite + copper, overline labels
closed by long hairline rules), which is why it still read as templated. The
`impeccable` detector also flags **purple gradients** and **cyan-on-dark** as top
tells, and caught us shipping a `border-l-2` "side tab" — the single most
recognizable AI-generated-UI tell.

Refused: warm-copper, cream/serif/terracotta, acid-green-on-black, cyan-on-dark,
purple gradients, long hairline section rules, rounded-lg card stacks, icon tiles.

## The idea

**A server browser, not a dashboard.** The panel is a deck: a rack cabinet with
a browser bolted to the front. Identity comes from *game* colour, not from one
brand hue — status colours stay semantic.

## Tokens

Chassis (tinted cool graphite — never pure black, never pure white):

| token | value | use |
|---|---|---|
| `--ink` | `#0E1116` | app background |
| `--panel` | `#161A21` | raised surface |
| `--panel-2` | `#1D222B` | second surface / row stripe |
| `--edge` | `#2B323D` | borders, grid lines |
| `--chalk` | `#E9EDF2` | primary text |
| `--dust` | `#939DAC` | secondary text, labels |

Signal (interactive only): `--signal` `#FF3D7F` (arcade magenta), `--signal-deep` `#C81E5C`.

Status (state only): `--go` `#3FCF8E`, `--hazard` `#FFB020`, `--alarm` `#FF5A5A`,
`--info` `#6FA8FF`.

Game identity (small glyph chips only, never surfaces): Minecraft `#4FAE5A`,
Counter-Strike `#E8A33D`, Rust `#C4553B`, ARK `#3FA9A0`, Valheim `#7C9CC4`,
generic `#8A93A0`.

Shape: `--radius` drops to **4px**; rows are square-cornered and striped.

## Type roles

| role | family | use |
|---|---|---|
| display | **Oxanium Variable** | wordmark, page titles, nav, numeral readouts |
| prose | DM Sans | paragraphs, help text |
| data | JetBrains Mono | ids, addresses, ports, sizes, counts |

Documented ramp (replaces ad-hoc `text-[10px]`/`text-[11px]` literals):
`--text-micro` 11px, `--text-mini` 12px, `--text-data` 13px, exposed as
`.text-micro`, `.text-mini`, `.text-data`.

## Signature element

**The activity cluster** — a live player-count sparkline (`PlayerBars`, five
bars scaled to capacity) beside a segmented count (`6/20`) and a `PingMeter`.
It appears on every server row and again in the top marquee. That cluster, not
a colour, is what makes the panel recognisable.

## Structure

- **Cabinet rail** (56px, always narrow, never expands): icon buttons with a
  magenta LED active marker, fleet heartbeat LED at the top, user/logout pinned
  to the bottom. Labels live in the marquee, not the rail.
- **Marquee**: horizontal strip carrying wordmark, breadcrumb, fleet status
  cluster and search — the game-launcher gesture.
- **Fleet = browser rows**: zebra-striped, one row per server, columns
  LED/status · name + game glyph · players (bars + count) · map · tick/ping ·
  actions. **No cards on this surface.** Keyboard hints in the footer.
- **Section device**: bracket labels (`[ FLEET ]` — small filled square +
  letterspaced display label). Not overline + hairline.
- Panels are 1px-edged, 4px radius, flat; no glows, no gradients.

## Non-negotiables

- Every colour still flows through the HSL tokens so admins can re-hue at
  runtime; identity must survive a re-hue because it lives in structure, type
  and the signature cluster.
- i18n discipline unchanged: no literal copy, keys through the extractor.
- Plugin-facing primitives keep their props/variants.
