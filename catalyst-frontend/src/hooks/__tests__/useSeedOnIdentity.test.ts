import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSeedOnIdentity } from '../useSeedOnIdentity';

describe('useSeedOnIdentity', () => {
  it('seeds once per identity, not on every re-render', () => {
    const seed = vi.fn();
    const { rerender } = renderHook(
      ({ id }: { id: string }) => useSeedOnIdentity(id, seed),
      { initialProps: { id: 'srv-1' } },
    );
    expect(seed).toHaveBeenCalledTimes(1);

    // Live metrics produce a new server object every 400 ms; the component
    // re-renders but must not re-seed.
    rerender({ id: 'srv-1' });
    rerender({ id: 'srv-1' });
    expect(seed).toHaveBeenCalledTimes(1);

    // Switching server re-seeds.
    rerender({ id: 'srv-2' });
    expect(seed).toHaveBeenCalledTimes(2);
  });

  it('waits for the identity and seeds when it arrives', () => {
    const seed = vi.fn();
    const { rerender } = renderHook(
      ({ id }: { id: string | undefined }) => useSeedOnIdentity(id, seed),
      { initialProps: { id: undefined as string | undefined } },
    );
    expect(seed).not.toHaveBeenCalled();
    rerender({ id: 'srv-1' });
    expect(seed).toHaveBeenCalledTimes(1);
  });

  it('re-seeds after the form is re-activated (modal re-open)', () => {
    const seed = vi.fn();
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) =>
        useSeedOnIdentity('srv-1', seed, { active }),
      { initialProps: { active: false } },
    );
    expect(seed).not.toHaveBeenCalled();

    rerender({ active: true });
    expect(seed).toHaveBeenCalledTimes(1);
    rerender({ active: true });
    expect(seed).toHaveBeenCalledTimes(1);

    rerender({ active: false });
    rerender({ active: true });
    expect(seed).toHaveBeenCalledTimes(2);
  });

  it('uses the latest seed closure without re-running it', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ seed }: { seed: () => void }) => useSeedOnIdentity('srv-1', seed),
      { initialProps: { seed: first } },
    );
    expect(first).toHaveBeenCalledTimes(1);
    rerender({ seed: second });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
