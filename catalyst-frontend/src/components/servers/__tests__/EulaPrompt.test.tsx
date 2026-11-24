import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const respondEula = vi.fn();
const startServer = vi.fn();

vi.mock('../../../services/api/servers', () => ({
  serversApi: {
    respondEula: (...args: unknown[]) => respondEula(...args),
    start: (...args: unknown[]) => startServer(...args),
  },
}));
vi.mock('../../../utils/notify', () => ({ notifyError: vi.fn(), notifySuccess: vi.fn() }));

import EulaPrompt from '../EulaPrompt';
import EulaModal from '../EulaModal';
import { peekPendingEula, setPendingEula, consumePendingEula } from '../../../hooks/useEulaStore';

beforeEach(() => {
  respondEula.mockReset().mockResolvedValue({ success: true });
  startServer.mockReset().mockResolvedValue({ success: true });
  consumePendingEula('srv-1');
  consumePendingEula('srv-2');
});
afterEach(cleanup);

describe('global EULA prompt (audit D10)', () => {
  it('renders nothing until a prompt is pending', () => {
    render(<EulaPrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the prompt for a server whose start happened elsewhere', async () => {
    setPendingEula('srv-2', { message: 'Minecraft EULA text' });
    render(<EulaPrompt />);
    expect(await screen.findByText('Minecraft EULA text')).toBeInTheDocument();
  });

  it('treats dismissing the dialog as neutral: no decline is posted', async () => {
    setPendingEula('srv-1', { message: 'Minecraft EULA text' });
    render(<EulaPrompt />);
    await screen.findByText('Minecraft EULA text');

    // The close (X) button inside the dialog chrome is the dismiss affordance.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByText('Minecraft EULA text')).not.toBeInTheDocument());
    expect(respondEula).not.toHaveBeenCalled();
    expect(startServer).not.toHaveBeenCalled();
    // The store entry is dropped so the same prompt does not reopen by itself.
    expect(peekPendingEula('srv-1')).toBeNull();
  });

  it('posts accepted:true and then starts the server from the explicit Accept', async () => {
    setPendingEula('srv-1', { message: 'Minecraft EULA text' });
    render(<EulaPrompt />);
    await screen.findByText('Minecraft EULA text');
    fireEvent.click(screen.getByRole('button', { name: 'I Agree' }));
    await waitFor(() => expect(respondEula).toHaveBeenCalledWith('srv-1', true));
    await waitFor(() => expect(startServer).toHaveBeenCalledWith('srv-1'));
  });

  it('posts accepted:false only from the explicit Decline button', async () => {
    setPendingEula('srv-1', { message: 'Minecraft EULA text' });
    render(<EulaPrompt />);
    await screen.findByText('Minecraft EULA text');
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(respondEula).toHaveBeenCalledWith('srv-1', false));
    expect(startServer).not.toHaveBeenCalled();
  });

  it('dismissing the modal itself calls onDismiss rather than onDecline', () => {
    const onDecline = vi.fn();
    const onDismiss = vi.fn();
    render(<EulaModal eulaText="text" onAccept={vi.fn()} onDecline={onDecline} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDecline).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('a modal without an onDismiss handler still never declines on close', () => {
    const onDecline = vi.fn();
    render(<EulaModal eulaText="text" onAccept={vi.fn()} onDecline={onDecline} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onDecline).not.toHaveBeenCalled();
  });
});