import type { ComponentType } from 'react';
import { BracketLabel } from '../../deck/primitives';

/**
 * Canonical section header used inside ServerTabCard.
 * Every tab section uses this — no other section-header pattern should exist.
 *
 * The deck section device: a bracket label (filled square + letterspaced
 * display label), not an overline closed by a long hairline. `icon` is still
 * accepted as a deprecated no-op so call sites (and plugin pages) keep
 * compiling.
 */
export default function SectionHeader({
  title,
  description,
  accent = 'primary',
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  accent?: 'primary' | 'warning' | 'danger';
}) {
  const tone =
    accent === 'danger' ? 'alarm' : accent === 'warning' ? 'hazard' : 'signal';

  return (
    <div className="mb-3">
      <BracketLabel tone={tone}>{title}</BracketLabel>
      {description && <p className="type-meta mt-1">{description}</p>}
    </div>
  );
}
