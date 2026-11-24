import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * "Clear console" wipes up to 2000 lines of output and used to do it on one
 * click from both the toolbar and the overflow menu. It now confirms first —
 * the audit's rule is "confirm irreversible, undo-toast reversible", and a
 * cleared buffer has no undo.
 */

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

vi.mock('../../components/console/XtermConsole', () => ({
  default: () => <div data-testid="xterm" />,
}));

vi.mock('../../services/storage/localStorage', () => ({
  storage: { get: () => undefined, set: vi.fn() },
}));

import ServerConsoleTab from './ServerConsoleTab';

const renderTab = () => {
  const props = {
    liveMetrics: null,
    liveDiskUsageMb: 0,
    liveDiskTotalMb: 0,
    isConnected: true,
    canSend: true,
    entries: [{ stream: 'stdout', data: 'hello', id: '1' }],
    send: vi.fn(),
    clearConsole: vi.fn(),
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  };
  render(<ServerConsoleTab {...(props as unknown as React.ComponentProps<typeof ServerConsoleTab>)} />);
  return props;
};

describe('ServerConsoleTab clear confirmation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('asks before destroying the buffer', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'console.tab.clearConsole' }));
    expect(props.clearConsole).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    // The dialog reports how much output is at stake.
    expect(screen.getByText(/console\.tab\.clearConfirmMessage/)).toBeTruthy();
  });

  it('clears once confirmed', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'console.tab.clearConsole' }));
    fireEvent.click(screen.getByRole('button', { name: 'console.tab.clearConsole' }));
    expect(props.clearConsole).toHaveBeenCalledTimes(1);
  });

  it('keeps the output when cancelled', () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'console.tab.clearConsole' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:actions.cancel' }));
    expect(props.clearConsole).not.toHaveBeenCalled();
  });
});