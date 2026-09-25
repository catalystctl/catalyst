import { BracketLabel } from '../../deck/primitives';

interface SectionDividerProps {
  title: string;
}

/**
 * Section divider for blocks within a tab. Uses the deck bracket label, not an
 * overline closed by a hairline rule.
 */
export default function SectionDivider({ title }: SectionDividerProps) {
  return (
    <h3 className="mb-3">
      <BracketLabel tone="muted">{title}</BracketLabel>
    </h3>
  );
}
