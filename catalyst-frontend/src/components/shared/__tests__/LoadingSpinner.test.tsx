import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import LoadingSpinner from '../LoadingSpinner';
import { Skeleton } from '../Skeleton';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'Loading...' }) }));

describe('LoadingSpinner', () => {
  afterEach(cleanup);

  it('announces itself with a text label, not just a spinning div', () => {
    render(<LoadingSpinner />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading...');
    // Visible spinner is decorative; the sr-only span carries the words.
    expect(status.querySelector('.sr-only')).not.toBeNull();
    expect(status.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('accepts a caller-provided label', () => {
    render(<LoadingSpinner label="Loading servers" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading servers');
  });
});

describe('Skeleton', () => {
  afterEach(cleanup);

  it('is hidden from assistive technology', () => {
    const { container } = render(<Skeleton height={12} className="h-3 w-10" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});