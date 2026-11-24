import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@/csync';
import { queryClient } from '../../../lib/queryClient';
import ErrorBoundary from '../ErrorBoundary';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../lib/error-reporter', () => ({ reportReactError: vi.fn() }));

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error('render exploded');
  return <p>recovered</p>;
}

describe('ErrorBoundary', () => {
  afterEach(cleanup);

  it('keeps the shell: the fallback is an in-place panel, not a full-viewport takeover', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <div data-testid="shell-sidebar" />
        <ErrorBoundary>
          <Boom explode />
        </ErrorBoundary>
      </QueryClientProvider>,
    );
    expect(screen.getByText('errorBoundary.title')).toBeInTheDocument();
    // No min-h-screen: the page content area still owns the layout.
    expect(container.querySelector('.min-h-screen')).toBeNull();
    expect(document.querySelector('[data-testid="shell-sidebar"]')).not.toBeNull();
    vi.restoreAllMocks();
  });

  it('re-fetches active queries when retrying instead of redrawing stale data', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <Boom explode />
        </ErrorBoundary>
      </QueryClientProvider>,
    );
    screen.getByRole('button', { name: 'errorBoundary.retry' }).click();
    expect(invalidate).toHaveBeenCalledWith({}, { refetchType: 'all' });
    invalidate.mockRestore();
    vi.restoreAllMocks();
  });

  it('clears the error and renders children again after a retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let explode = true;
    function Toggle() {
      return <Boom explode={explode} />;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <Toggle />
        </ErrorBoundary>
      </QueryClientProvider>,
    );
    explode = false;
    screen.getByRole('button', { name: 'errorBoundary.retry' }).click();
    expect(await screen.findByText('recovered')).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});