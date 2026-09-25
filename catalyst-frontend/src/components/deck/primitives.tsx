import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Deck primitives — the "Server Browser" identity layer.
 * See docs/design/deck-identity.md. These replace generic Card/CardHeader
 * composition on the panel's flagship surfaces: square corners, zebra rows,
 * a live activity cluster, and a bracket section label instead of an overline
 * closed by a long hairline.
 */

/** Section device: filled square + letterspaced display label. */
export function BracketLabel({
  children,
  tone = 'signal',
  className,
}: {
  children: ReactNode;
  tone?: 'signal' | 'muted' | 'hazard' | 'alarm';
  className?: string;
}) {
  const toneClass =
    tone === 'muted'
      ? 'deck-label--muted'
      : tone === 'hazard'
        ? 'deck-label--hazard'
        : tone === 'alarm'
          ? 'deck-label--alarm'
          : '';
  return <span className={cn('deck-label', toneClass, className)}>{children}</span>;
}

// Only abnormal load earns colour; healthy values stay neutral so the eye is
// not pulled by fifteen bars per screen.
const toneBar = (value: number) =>
  value >= 90 ? 'bg-danger' : value >= 75 ? 'bg-warning' : 'bg-muted-foreground/45';

/**
 * ActivityBars — the signature element: five discrete bars showing a live
 * 0-100 reading. Discrete bars (not a smooth meter) are the server-browser
 * gesture and stay legible at dense row heights.
 */
export function ActivityBars({
  value,
  bars = 3,
  className,
  tone = 'severity',
}: {
  value: number | null;
  bars?: number;
  className?: string;
  /**
   * `severity` colours by load (≥75 warning, ≥90 danger) — correct for CPU/RAM.
   * `state` fills with the success hue — correct for "how much of the fleet is
   * up", where 100% is good rather than alarming.
   */
  tone?: 'severity' | 'state';
}) {
  const v = value == null ? 0 : Math.min(100, Math.max(0, value));
  const filled = value == null ? 0 : Math.max(v > 0 ? 1 : 0, Math.round((v / 100) * bars));
  const fill = tone === 'state' ? 'bg-success' : toneBar(v);
  return (
    <span className={cn('inline-flex items-end gap-[2px]', className)} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'w-[2px] rounded-[1px]',
            i === 0 ? 'h-[3px]' : i === 1 ? 'h-[5px]' : 'h-[7px]',
            i < filled ? fill : 'bg-surface-3',
          )}
        />
      ))}
    </span>
  );
}

/** Segmented readout — mono, tabular, fixed width so columns line up. */
export function Segmented({
  children,
  className,
  muted,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        'whitespace-nowrap font-mono text-micro tabular-nums',
        muted ? 'text-muted-foreground' : 'text-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Live status LED. Crisp ring, no blur glow. */
export function StatusLed({
  tone,
  pulse = false,
  className,
}: {
  tone: 'go' | 'hazard' | 'alarm' | 'idle' | 'info';
  pulse?: boolean;
  className?: string;
}) {
  const color =
    tone === 'go'
      ? 'bg-success'
      : tone === 'hazard'
        ? 'bg-warning'
        : tone === 'alarm'
          ? 'bg-danger'
          : tone === 'info'
            ? 'bg-info'
            : 'bg-surface-3';
  return (
    <span className={cn('relative flex h-2 w-2 shrink-0', className)} aria-hidden>
      {pulse && (
        <span className={cn('deck-led-pulse absolute inline-flex h-full w-full rounded-full', color)} />
      )}
      <span className={cn('led relative', color)} />
    </span>
  );
}

const GAME_HUES: { match: RegExp; hue: string; glyph: string }[] = [
  { match: /minecraft|paper|spigot|bukkit|fabric|forge|purpur/i, hue: 'var(--game-minecraft)', glyph: 'MC' },
  { match: /counter-?strike|cs2|csgo|cs16|counterstrike/i, hue: 'var(--game-cs)', glyph: 'CS' },
  { match: /rust/i, hue: 'var(--game-rust)', glyph: 'RU' },
  { match: /ark/i, hue: 'var(--game-ark)', glyph: 'AR' },
  { match: /valheim/i, hue: 'var(--game-valheim)', glyph: 'VH' },
];

/**
 * GameChip — per-game identity colour. This is where the panel gets its
 * colour variety: not one brand hue, but the games' own hues. Never used for
 * surfaces, only for these small glyph chips.
 */
export function GameChip({ game, className }: { game?: string | null; className?: string }) {
  const label = game ?? '';
  const found = GAME_HUES.find((g) => g.match.test(label));
  const hue = found?.hue ?? 'var(--game-generic)';
  const glyph = found?.glyph ?? (label ? label.slice(0, 2).toUpperCase() : '··');
  const title = label || undefined;
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-4 min-w-[1.35rem] items-center justify-center rounded-sm px-0.5',
        'font-display text-micro font-semibold',
        className,
      )}
      style={{
        color: `hsl(${hue})`,
        backgroundColor: `hsl(${hue} / 0.10)`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} / 0.28)`,
      }}
    >
      {glyph}
    </span>
  );
}

/** Dense metric cluster used inside a browser row. */
export function MetricCluster({
  label,
  value,
  display,
  className,
}: {
  label: string;
  value: number | null;
  display: string;
  className?: string;
}) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="shrink-0 type-overline w-8">
        {label}
      </span>
      <ActivityBars value={value} />
      <Segmented muted={value == null} className="min-w-[3.25rem] text-right">
        {display}
      </Segmented>
    </span>
  );
}

/** Square-cornered panel wrapper for the deck. */
export function DeckPanel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('deck-panel', className)}>{children}</div>;
}

/** Zebra row container; direct children become browser rows. */
export function DeckRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('deck-rows', className)}>{children}</div>;
}
