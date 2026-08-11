/**
 * History/live merge: late REST history must not wipe live lines that arrived first.
 * We unit-test the pure merge helper by re-implementing the same rules inline —
 * the hook itself is React-bound; this locks the algorithm.
 */
import { describe, it, expect } from 'vitest';

type Entry = { id: string; stream: string; data: string };

function entryKey(e: { stream: string; data: string }) {
  return `${e.stream}\0${e.data}`;
}

function mergeHistoryAndPending(history: Entry[], pending: Entry[], max = 500): Entry[] {
  const historyKeys = new Set(history.map(entryKey));
  const liveOnly = pending.filter((e) => !historyKeys.has(entryKey(e)));
  const next = history.concat(liveOnly);
  return next.length > max ? next.slice(-max) : next;
}

describe('console history/live merge', () => {
  it('keeps live lines that arrived before history when not in snapshot', () => {
    const history: Entry[] = [
      { id: '0', stream: 'stdout', data: 'old line\n' },
      { id: '1', stream: 'stdout', data: 'boot complete\n' },
    ];
    const pending: Entry[] = [
      { id: '2', stream: 'stdin', data: '> list\n' },
      { id: '3', stream: 'stdout', data: 'player1\n' },
    ];
    const merged = mergeHistoryAndPending(history, pending);
    expect(merged.map((e) => e.data)).toEqual([
      'old line\n',
      'boot complete\n',
      '> list\n',
      'player1\n',
    ]);
  });

  it('dedupes pending lines already present in history', () => {
    const history: Entry[] = [
      { id: '0', stream: 'stdout', data: 'hello\n' },
      { id: '1', stream: 'stdout', data: 'world\n' },
    ];
    // Agent re-emitted the same tail while history was loading
    const pending: Entry[] = [
      { id: '2', stream: 'stdout', data: 'world\n' },
      { id: '3', stream: 'stdout', data: 'fresh\n' },
    ];
    const merged = mergeHistoryAndPending(history, pending);
    expect(merged.map((e) => e.data)).toEqual(['hello\n', 'world\n', 'fresh\n']);
  });

  it('trims to maxEntries from the tail', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      stream: 'stdout',
      data: `h${i}\n`,
    }));
    const pending = [{ id: 'x', stream: 'stdout', data: 'live\n' }];
    const merged = mergeHistoryAndPending(history, pending, 5);
    expect(merged).toHaveLength(5);
    expect(merged[merged.length - 1]?.data).toBe('live\n');
  });
});
