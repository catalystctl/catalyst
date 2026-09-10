import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import DownloadProgressIndicator from './DownloadProgressIndicator';
import {
  useDownloadStore,
  resetDownloadStoreForTests,
} from '../../stores/downloadStore';

describe('DownloadProgressIndicator', () => {
  beforeEach(() => {
    resetDownloadStoreForTests();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing without sessions', () => {
    const { container } = render(<DownloadProgressIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows active download with percentage and byte counts', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/mods/big.jar', name: 'big.jar', total: 1000 },
    ]);
    useDownloadStore.getState().setFileProgress(id, 0, 250, 1000);

    render(<DownloadProgressIndicator />);

    expect(screen.getByText('Downloading 1/1')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
  });

  it('hides percentage when total size is unknown', () => {
    useDownloadStore.getState().beginSession([
      { path: '/mods/big.jar', name: 'big.jar' },
    ]);

    render(<DownloadProgressIndicator />);

    expect(screen.getByText('Downloading 1/1')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('shows completion state once every file is done', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
      { path: '/b.jar', name: 'b.jar', total: 10 },
    ]);
    useDownloadStore.getState().setFileDone(id, 0);
    useDownloadStore.getState().setFileDone(id, 1);

    render(<DownloadProgressIndicator />);

    expect(screen.getByText('Download complete')).toBeInTheDocument();
  });

  it('shows error state with the error message', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
    ]);
    useDownloadStore.getState().setFileError(id, 0, 'Download failed: 404');

    render(<DownloadProgressIndicator />);

    expect(screen.getByText('Download failed')).toBeInTheDocument();
    expect(screen.getByText('Download failed: 404')).toBeInTheDocument();
  });

  it('cancels an active session via the abort controller', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
    ]);
    const controller = new AbortController();
    useDownloadStore.getState().registerAbort(id, controller);

    render(<DownloadProgressIndicator />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));

    expect(controller.signal.aborted).toBe(true);
    expect(useDownloadStore.getState().sessions[0].status).toBe('active');
  });

  it('dismisses a finished session via the dismiss button', () => {
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
    ]);
    useDownloadStore.getState().markSessionDone(id);

    render(<DownloadProgressIndicator />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(useDownloadStore.getState().sessions).toHaveLength(0);
  });

  it('auto-dismisses done sessions after the TTL', () => {
    vi.useFakeTimers();
    const id = useDownloadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
    ]);
    useDownloadStore.getState().markSessionDone(id);

    render(<DownloadProgressIndicator />);
    expect(useDownloadStore.getState().sessions).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(useDownloadStore.getState().sessions).toHaveLength(0);
  });

  it('gives long downloads a full TTL before dismissing on completion', () => {
    vi.useFakeTimers();
    const id = useDownloadStore.getState().beginSession([
      { path: '/big.jar', name: 'big.jar', total: 1e9 },
    ]);
    // Simulate a 10-minute download, then completion.
    vi.advanceTimersByTime(10 * 60 * 1000);
    useDownloadStore.getState().setFileProgress(id, 0, 1e9, 1e9);
    useDownloadStore.getState().setFileDone(id, 0);

    render(<DownloadProgressIndicator />);
    expect(screen.getByText('Download complete')).toBeInTheDocument();

    // Still visible shortly after completing (would have been instantly
    // dismissed if TTL were measured from session start).
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Download complete')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(useDownloadStore.getState().sessions).toHaveLength(0);
  });
});
