import { describe, expect, it } from 'vitest';
import { hslChannelsToHex, paintXtermBackground, tokenValueToColor } from './xtermTheme';

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
    expect(tokenValueToColor('#0b0f14', '#fff')).toBe('#0b0f14');
    expect(tokenValueToColor('rgb(12, 12, 20)', '#fff')).toBe('rgb(12, 12, 20)');
    expect(tokenValueToColor('hsl(240 12% 9%)', '#fff')).toBe('hsl(240 12% 9%)');
  });

  it('falls back when the var is empty or unusable', () => {
    expect(tokenValueToColor('', '#0b0f14')).toBe('#0b0f14');
    expect(tokenValueToColor('   ', '#0b0f14')).toBe('#0b0f14');
    expect(tokenValueToColor('var(--something)', '#0b0f14')).toBe('#0b0f14');
  });

  it('does not treat a failed resolve as inherited canvastext white', () => {
    // The bug: probe inherited color-scheme:dark canvastext ≈ rgb(243,243,246)
    const bg = tokenValueToColor('', '#0b0f14');
    expect(bg).toBe('#0b0f14');
    expect(bg).not.toMatch(/243/);
  });

  it('does not treat a var() wrapper as a color', () => {
    expect(tokenValueToColor('var(--accent-teal)', '#14b8a6')).toBe('#14b8a6');
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
