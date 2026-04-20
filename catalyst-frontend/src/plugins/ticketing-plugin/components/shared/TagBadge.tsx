import { Badge, cn, X } from '../../../plugin-ui';

interface TagBadgeProps {
  name: string;
  color: string;
  onRemove?: () => void;
  className?: string;
}

/**
 * Derives a low-opacity background from a hex color string.
 * Falls back to a zinc-based background for invalid colors.
 */
function tagBg(color: string): string {
  try {
    const hex = color.replace('#', '');
    if (hex.length !== 6) return 'bg-zinc-500/15';
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, 0.12)`;
  } catch {
    return 'bg-zinc-500/15';
  }
}

export function TagBadge({ name, color, onRemove, className }: TagBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'inline-flex items-center gap-1 border-transparent px-2 py-0.5 text-xs font-medium',
        className,
      )}
      style={{
        backgroundColor: tagBg(color),
        color: color,
      }}
    >
      {name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded-sm opacity-60 transition-opacity hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}
