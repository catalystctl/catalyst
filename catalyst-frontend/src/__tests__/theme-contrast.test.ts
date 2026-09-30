import { describe, expect, it } from 'vitest';
import { contrastForeground } from '../stores/themeStore';

describe('custom theme foreground contrast', () => {
  it('uses dark text on bright and saturated colors', () => {
    expect(contrastForeground('#00aa00')).toBe('0 0% 9%');
    expect(contrastForeground('#ff0000')).toBe('0 0% 9%');
    expect(contrastForeground('#ffadad')).toBe('0 0% 9%');
  });

  it('uses white text on dark custom danger and brand colors', () => {
    expect(contrastForeground('#54001a')).toBe('0 0% 100%');
    expect(contrastForeground('#252b35')).toBe('0 0% 100%');
  });
});
