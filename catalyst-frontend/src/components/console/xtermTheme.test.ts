import { describe, expect, it } from 'vitest';
import { hslChannelsToHex, paintXtermBackground, readCssVar, tokenValueToColor } from './xtermTheme';

describe('hslChannelsToHex', () => {
  it('converts dark card channels to a dark hex (not canvastext white)', () => {
    // .dark --card: 240 12% 9%
    const hex = hslChannelsToHex(240, 12, 9);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    expect(r).toBeLessThan(40);
    expect(g).toBeLessThan(40);
    expect(b).toBeLessThan(50);
  });

  it('converts dark foreground channels to a light hex', () => {
    // .dark --foreground: 240 10% 96%  → rgb(243, 243, 246) in the bug report
    const hex = hslChannelsToHex(240, 10, 96);
    const r = parseInt(hex.slice(1, 3), 16);
    expect(r).toBeGreaterThan(230);
  });
});

describe('tokenValueToColor', () => {
  it('wraps HSL channel tokens used by Catalyst CSS', () => {
    expect(tokenValueToColor('240 12% 9%', '#000')).toBe(hslChannelsToHex(240, 12, 9));
    expect(tokenValueToColor('  40 15% 98%  ', '#000')).toBe(hslChannelsToHex(40, 15, 98));
  });

  it('passes through already-complete colors', () => {
    expect(tokenValueToColor('#161a21', '#fff')).toBe('#161a21');
    expect(tokenValueToColor('rgb(12, 12, 20)', '#fff')).toBe('rgb(12, 12, 20)');
    expect(tokenValueToColor('hsl(240 12% 9%)', '#fff')).toBe('hsl(240 12% 9%)');
  });

  it('falls back when the var is empty or unusable', () => {
    expect(tokenValueToColor('', '#161a21')).toBe('#161a21');
    expect(tokenValueToColor('   ', '#161a21')).toBe('#161a21');
    expect(tokenValueToColor('var(--something)', '#161a21')).toBe('#161a21');
  });

  it('does not treat a failed resolve as inherited canvastext white', () => {
    // The bug: probe inherited color-scheme:dark canvastext ≈ rgb(243,243,246)
    const bg = tokenValueToColor('', '#161a21');
    expect(bg).toBe('#161a21');
    expect(bg).not.toMatch(/243/);
  });

  it('does not treat a var() wrapper as a color', () => {
    expect(tokenValueToColor('var(--signal-bright)', '#ff3d7f')).toBe('#ff3d7f');
  });

  it('rejects translucent channel tokens (xterm needs opaque colors)', () => {
    expect(tokenValueToColor('340 100% 62% / 0.16', '#ff3d7f')).toBe('#ff3d7f');
    expect(tokenValueToColor('340 100% 62% / 16%', '#ff3d7f')).toBe('#ff3d7f');
    // Fully opaque alpha still resolves.
    expect(tokenValueToColor('340 100% 62% / 1', '#ff3d7f')).toBe(hslChannelsToHex(340, 100, 62));
  });
});

describe('readCssVar', () => {
  it('follows chained var() hops', () => {
    const root = document.documentElement;
    root.style.setProperty('--xterm-hop-c', '10 20% 30%');
    root.style.setProperty('--xterm-hop-b', 'var(--xterm-hop-c)');
    root.style.setProperty('--xterm-hop-a', 'var(--xterm-hop-b)');
    try {
      expect(readCssVar('--xterm-hop-a')).toBe('10 20% 30%');
    } finally {
      root.style.removeProperty('--xterm-hop-a');
      root.style.removeProperty('--xterm-hop-b');
      root.style.removeProperty('--xterm-hop-c');
    }
  });

  it('stops after three hops so a long chain cannot hang the theme read', () => {
    const root = document.documentElement;
    root.style.setProperty('--xterm-cap-e', '10 20% 30%');
    root.style.setProperty('--xterm-cap-d', 'var(--xterm-cap-e)');
    root.style.setProperty('--xterm-cap-c', 'var(--xterm-cap-d)');
    root.style.setProperty('--xterm-cap-b', 'var(--xterm-cap-c)');
    root.style.setProperty('--xterm-cap-a', 'var(--xterm-cap-b)');
    try {
      // a→b→c→d resolves; the fourth hop to --xterm-cap-e is not followed.
      expect(readCssVar('--xterm-cap-a')).toBe('var(--xterm-cap-e)');
    } finally {
      root.style.removeProperty('--xterm-cap-a');
      root.style.removeProperty('--xterm-cap-b');
      root.style.removeProperty('--xterm-cap-c');
      root.style.removeProperty('--xterm-cap-d');
      root.style.removeProperty('--xterm-cap-e');
    }
  });
});

describe('paintXtermBackground', () => {
  it('paints host, viewport, and the xterm 6 scrollable overlay', () => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="xterm">
        <div class="xterm-viewport"></div>
        <div class="xterm-scrollable-element"></div>
      </div>
    `;
    paintXtermBackground(host, '#12121c');
    expect(host.style.backgroundColor).toBe('rgb(18, 18, 28)');
    expect((host.querySelector('.xterm') as HTMLElement).style.backgroundColor).toBe('rgb(18, 18, 28)');
    expect((host.querySelector('.xterm-viewport') as HTMLElement).style.backgroundColor).toBe(
      'rgb(18, 18, 28)',
    );
    expect((host.querySelector('.xterm-scrollable-element') as HTMLElement).style.backgroundColor).toBe(
      'rgb(18, 18, 28)',
    );
  });
});
