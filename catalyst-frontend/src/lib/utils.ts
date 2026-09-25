import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge does not know the deck's custom type ramp: `text-micro`,
 * `text-mini` and `text-data` are not in its default theme, so it classifies
 * them as text *colours* and silently drops them when a real colour class such
 * as `text-muted-foreground` follows. Readouts then fell back to the inherited
 * 16px instead of 11-13px. Registering the sizes puts them in the font-size
 * group, where conflicts resolve last-wins as intended.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['micro', 'mini', 'data'] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
