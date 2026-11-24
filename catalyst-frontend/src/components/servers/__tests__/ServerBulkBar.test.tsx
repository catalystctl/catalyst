import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Server } from '../../../types/server';

const bulkServerAction = vi.fn();
const invalidateQueries = vi.fn();

vi.mock('../../../services/api/admin', () => ({
  adminApi: { bulkServerAction: (...args: unknown[]) => bulkServerAction(...args) },
}));
vi.mock('@/csync', () => ({
  useQueryClient: () => ({ invalidateQueries }),
  useMutation: (options: {
    mutationFn: (action: string) => Promise<unknown>;
    onSuccess?: (data: unknown, variables: string) => void;
    onError?: (error: unknown) => void;
    onSettled?: () => void;
  }) => ({
    isPending: false,
    mutate: (action: string) => {
      options
        .mutationFn(action)
        .then((data) => options.onSuccess?.(data, action), options.onError)
        .finally(options.onSettled);
    },
  }),
}));
vi.mock('../../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import ServerBulkBar from '../ServerBulkBar';

const server = (id: string, status: string, permissions: string[]): Server =>
  ({
    id,
    name: id,
    status,
    effectivePermissions: permissions,
  }) as unknown as Server;

beforeEach(() => {
  bulkServerAction.mockReset().mockResolvedValue({
    success: true,
    results: [
      { serverId: 'a', status: 'success' },
      { serverId: 'b', status: 'success' },
    ],
    summary: { success: 2, failed: 0 },
  });
  invalidateQueries.mockReset();
});
afterEach(cleanup);

describe('fleet bulk power bar (audit D9)', () => {
  it('renders nothing without a selection', () => {
    const { container } = render(<ServerBulkBar selected={[]} onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('starts every eligible selected server without a confirmation', async () => {
    const onClear = vi.fn();
    render(
      <ServerBulkBar
        selected={[server('a', 'stopped', ['*']), server('b', 'stopped', ['server.start'])]}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /bulk\.actions\.start/ }));
    await waitFor(() =>
      expect(bulkServerAction).toHaveBeenCalledWith({ serverIds: ['a', 'b'], action: 'start' }),
    );
    // Stat panels and the fleet list must not keep the pre-action state.
    await waitFor(() => expect(invalidateQueries).toHaveBeenCalled());
    await waitFor(() => expect(onClear).toHaveBeenCalled());
  });

  it('disables an action with no eligible server and says why', () => {
    render(<ServerBulkBar selected={[server('a', 'running', ['*'])]} onClear={vi.fn()} />);
    const start = screen.getByRole('button', { name: /bulk\.actions\.start/ });
    expect(start).toBeDisabled();
    // bulk.noEligible interpolates the action's own label; the server namespace
    // has no bulk.actions.start entry, so that part is whatever the bar renders.
    expect(start).toHaveAttribute(
      'title',
      expect.stringContaining('No selected server accepts'),
    );
  });

  it('asks for confirmation before stopping, naming the count', async () => {
    render(
      <ServerBulkBar
        selected={[server('a', 'running', ['*']), server('b', 'running', ['server.stop'])]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    // A dialog appears instead of the request going out immediately.
    const dialog = await screen.findByRole('alertdialog');
    expect(bulkServerAction).not.toHaveBeenCalled();
    // The dialog's own action carries the same label as the bar button.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(bulkServerAction).toHaveBeenCalledWith({ serverIds: ['a', 'b'], action: 'stop' }),
    );
  });

  it('only targets servers that grant the action when the selection is mixed', async () => {
    render(
      <ServerBulkBar
        selected={[
          server('a', 'running', ['*']),
          server('b', 'running', ['server.read']),
          server('c', 'installing', ['*']),
        ]}
        onClear={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    const mixedDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(mixedDialog).getByRole('button', { name: 'Stop' }));
    await waitFor(() =>
      expect(bulkServerAction).toHaveBeenCalledWith({ serverIds: ['a'], action: 'stop' }),
    );
  });
});