import { describe, expect, it } from 'vitest';
import { suggestNextFreePort } from '../createAllocationPorts';

describe('next free port suggestion (create-server dead end)', () => {
  it('starts a fresh pool at the usual game port', () => {
    expect(suggestNextFreePort([])).toBe(25565);
  });

  it('continues after the highest registered port', () => {
    expect(suggestNextFreePort([{ port: 25565 }, { port: 25567 }])).toBe(25568);
  });

  it('skips ports already taken by a pending selection', () => {
    expect(suggestNextFreePort([{ port: 25565 }], [25566])).toBe(25567);
  });

  it('clamps at the top of the port range instead of overflowing', () => {
    expect(suggestNextFreePort([{ port: 65535 }])).toBe(65535);
  });

  it('ignores non-numeric ports rather than producing NaN', () => {
    expect(suggestNextFreePort([{ port: Number.NaN }])).toBe(25565);
  });
});