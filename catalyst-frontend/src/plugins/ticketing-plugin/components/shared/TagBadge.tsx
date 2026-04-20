import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { X, Tag } from 'lucide-react';
import { TAG_COLORS } from '../../constants';
import type { Tag as TagType } from '../../types';

interface TagBadgeProps {
  tag: TagType;
  onRemove?: (id: string) => void;
  size?: 'sm' | 'md';
}

export function TagBadge({ tag, onRemove, size = 'sm' }: TagBadgeProps) {
  const colorClass = TAG_COLORS.find((c) => c.name.toLowerCase() === tag.color?.toLowerCase())
    || TAG_COLORS[0];

  return (
    <Badge
      variant="secondary"
      className={cn(
        'gap-1 border',
        colorClass.value,
        size === 'md' && 'px-2.5 py-0.5 text-xs'
      )}
    >
      <Tag className="h-3 w-3" />
      {tag.name}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(tag.id); }}
          className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </Badge>
  );
}

// Simple tag badge for ticket rows (just string)
interface SimpleTagBadgeProps {
  name: string;
  color?: string;
}

export function SimpleTagBadge({ name, color }: SimpleTagBadgeProps) {
  const colorClass = color
    ? TAG_COLORS.find((c) => c.name.toLowerCase() === color?.toLowerCase())?.value
    : undefined;

  return (
    <Badge
      variant="secondary"
      className={cn('gap-1 text-[10px]', colorClass)}
    >
      {name}
    </Badge>
  );
}
