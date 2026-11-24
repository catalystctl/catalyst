import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Terminal, FolderOpen, HardDrive, Clock, Package, Database } from 'lucide-react';
import type { ServerNavTab } from '../ServerTabBar';

// jsdom reports zero-width layout, so a fixed container width plus a stubbed
// measurement is the only way to exercise the fit logic.
let queryResult: { data: unknown } = { data: undefined };
let queryKeys: unknown[][] = [];

vi.mock('@/csync', () => ({
  useQuery: (options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    queryKeys.push([...options.queryKey]);
    return { data: options.enabled === false ? queryResult.data : undefined };
  },
}));

import ServerTabBar from '../ServerTabBar';

const tab = (key: string, label: string, icon: ServerNavTab['icon'], active = false): ServerNavTab => ({
  key,
  label,
  icon,
  active,
  onSelect: vi.fn(),
});

const ALL_TABS = [
  tab('console', 'Console', Terminal, true),
  tab('files', 'Files', FolderOpen),
  tab('backups', 'Backups', HardDrive),
  tab('tasks', 'Tasks', Clock),
  tab('databases', 'Databases', Database),
  tab('modManager', 'Mods', Package),
];

beforeEach(() => {
  queryKeys = [];
  queryResult = { data: undefined };
  // Every measured tab advertises 80px; "More" 68px. jsdom has no layout.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('server tab bar pinning and mod badge (audit overflow / D13)', () => {
  it('reads the mod-updates summary without ever fetching it', () => {
    render(<ServerTabBar tabs={ALL_TABS} serverId="srv-1" />);
    expect(queryKeys).toContainEqual(['mod-updates-summary', 'srv-1']);
  });

  it('renders no badge when the summary is absent or zero', () => {
    const { rerender } = render(<ServerTabBar tabs={ALL_TABS} serverId="srv-1" />);
    expect(screen.queryByText('3')).not.toBeInTheDocument();
    queryResult = { data: { updates: 0 } };
    rerender(<ServerTabBar tabs={ALL_TABS} serverId="srv-1" />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('badges the Mods tab when updates are pending', () => {
    queryResult = { data: { updates: 3 } };
    render(<ServerTabBar tabs={ALL_TABS} serverId="srv-1" />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('keeps Console, Files, Backups and Tasks on the bar', () => {
    render(<ServerTabBar tabs={ALL_TABS} serverId="srv-1" />);
    for (const label of ['Console', 'Files', 'Backups', 'Tasks']) {
      expect(screen.getAllByTitle(label).length).toBeGreaterThan(0);
    }
  });

  it('keeps every pinned tab on the bar and moves only the rest into More', () => {
    // 400px fits the four labelled pins and nothing else.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 400,
    });
    const { container } = render(<ServerTabBar tabs={ALL_TABS} serverId="srv-1" />);
    // The invisible measuring strip repeats every tab by design; only the
    // visible bar (no aria-hidden ancestor) is what the operator sees.
    const visibleTitles = Array.from(container.querySelectorAll('button[title]:not([aria-hidden])'))
      .map((el) => el.getAttribute('title'));

    for (const label of ['Console', 'Files', 'Backups', 'Tasks']) {
      expect(visibleTitles).toContain(label);
    }
    // The non-pinned pages leave the bar for the (closed) More menu.
    expect(visibleTitles).not.toContain('Databases');
    expect(visibleTitles).not.toContain('Mods');
    expect(screen.getByRole('button', { name: 'More server pages' })).toBeInTheDocument();
  });
});