import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react';
import UploadProgressIndicator from './UploadProgressIndicator';
import {
  useUploadStore,
  resetUploadStoreForTests,
} from '../../stores/uploadStore';

describe('UploadProgressIndicator', () => {
  beforeEach(() => {
    resetUploadStoreForTests();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing without sessions', () => {
    const { container } = render(<UploadProgressIndicator />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows active upload with percentage and byte counts', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/mods/big.jar', name: 'big.jar', total: 1000 },
    ]);
    useUploadStore.getState().setFileProgress(id, 0, 250, 1000);

    render(<UploadProgressIndicator />);

    expect(screen.getByText('Uploading 1/1')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText(/250/)).toBeInTheDocument();
  });

  it('hides percentage when total size is unknown', () => {
    useUploadStore.getState().beginSession([
      { path: '/mods/big.jar', name: 'big.jar' },
    ]);

    render(<UploadProgressIndicator />);

    expect(screen.getByText('Uploading 1/1')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('shows completion state once every file is done', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
      { path: '/b.jar', name: 'b.jar', total: 10 },
    ]);
    useUploadStore.getState().setFileDone(id, 0);
    useUploadStore.getState().setFileDone(id, 1);

    render(<UploadProgressIndicator />);

    expect(screen.getByText('Upload complete')).toBeInTheDocument();
  });

  it('shows error state with the error message', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
    ]);
    useUploadStore.getState().setFileError(id, 0, 'Upload failed: 413');

    render(<UploadProgressIndicator />);

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByText('Upload failed: 413')).toBeInTheDocument();
  });

  it('cancels an active session via the abort controller', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
    ]);
    const controller = new AbortController();
    useUploadStore.getState().registerAbort(id, controller);

    render(<UploadProgressIndicator />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));

    expect(controller.signal.aborted).toBe(true);
    expect(useUploadStore.getState().sessions[0].status).toBe('active');
  });

  it('dismisses a finished session via the dismiss button', () => {
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
    ]);
    useUploadStore.getState().markSessionDone(id);

    render(<UploadProgressIndicator />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(useUploadStore.getState().sessions).toHaveLength(0);
  });

  it('auto-dismisses done sessions after the TTL', () => {
    vi.useFakeTimers();
    const id = useUploadStore.getState().beginSession([
      { path: '/a.jar', name: 'a.jar', total: 10 },
    ]);
    useUploadStore.getState().markSessionDone(id);

    render(<UploadProgressIndicator />);
    expect(useUploadStore.getState().sessions).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(useUploadStore.getState().sessions).toHaveLength(0);
  });

  it('gives long uploads a full TTL before dismissing on completion', () => {
    vi.useFakeTimers();
    const id = useUploadStore.getState().beginSession([
      { path: '/big.jar', name: 'big.jar', total: 1e9 },
    ]);
    // Simulate a 10-minute upload, then completion.
    vi.advanceTimersByTime(10 * 60 * 1000);
    useUploadStore.getState().setFileProgress(id, 0, 1e9, 1e9);
    useUploadStore.getState().setFileDone(id, 0);

    render(<UploadProgressIndicator />);
    expect(screen.getByText('Upload complete')).toBeInTheDocument();

    // Still visible shortly after completing (would have been instantly
    // dismissed if TTL were measured from session start).
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('Upload complete')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(useUploadStore.getState().sessions).toHaveLength(0);
  });
});
