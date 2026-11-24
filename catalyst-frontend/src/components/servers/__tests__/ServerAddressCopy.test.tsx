import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const notifySuccess = vi.fn();
const notifyError = vi.fn();
const writeText = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../../utils/notify', () => ({
  notifySuccess: (...args: unknown[]) => notifySuccess(...args),
  notifyError: (...args: unknown[]) => notifyError(...args),
}));

import ServerAddressCopy from '../ServerAddressCopy';

afterEach(() => {
  cleanup();
  notifySuccess.mockReset();
  notifyError.mockReset();
  writeText.mockReset();
});

/** Install a clipboard whose writeText settles the way the test needs it to. */
const installClipboard = (settle: () => Promise<void>) => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (...args: unknown[]) => {
        writeText(...args);
        return settle();
      },
    },
  });
};

describe('click-to-copy server address (audit D8)', () => {
  it('copies host:port, reports it, and does not bubble to the row', async () => {
    installClipboard(() => Promise.resolve());
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <ServerAddressCopy host="10.0.0.5" port={25565} />
      </div>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('10.0.0.5:25565');
    expect(button).toHaveAttribute('aria-label', 'details.copyAddressLabel');
    fireEvent.click(button);
    expect(writeText).toHaveBeenCalledWith('10.0.0.5:25565');
    // The row's own click (navigate to the server) must not fire.
    expect(onRowClick).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('details.copiedAddress'));
  });

  it('reports a blocked clipboard instead of failing silently', async () => {
    installClipboard(() => Promise.reject(new Error('denied')));
    render(<ServerAddressCopy host="10.0.0.5" port={25565} />);
    fireEvent.click(screen.getByRole('button'));
    await vi.waitFor(() => expect(notifyError).toHaveBeenCalledWith('details.copyFailed'));
  });

  it('falls back to a dash for a missing half rather than "undefined"', () => {
    render(<ServerAddressCopy host="10.0.0.5" port={undefined} />);
    expect(screen.getByRole('button')).toHaveTextContent('10.0.0.5:—');
  });
});