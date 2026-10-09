import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Badge } from './badge';

afterEach(cleanup);

describe('Badge component', () => {
  it('renders with default variant', () => {
    render(<Badge>Default badge</Badge>);
    expect(screen.getByText('Default badge')).toBeInTheDocument();
  });

  it('applies variant styles correctly', () => {
    const { rerender } = render(<Badge variant="default">Default</Badge>);
    expect(screen.getByText('Default')).toHaveClass('bg-primary/12', 'text-primary');

    rerender(<Badge variant="secondary">Secondary</Badge>);
    expect(screen.getByText('Secondary')).toHaveClass('bg-surface-2');

    rerender(<Badge variant="destructive">Destructive</Badge>);
    expect(screen.getByText('Destructive')).toHaveClass('bg-danger/12', 'text-danger');

    rerender(<Badge variant="outline">Outline</Badge>);
    expect(screen.getByText('Outline')).toHaveClass('border-border/80');
  });

  it('accepts custom className', () => {
    render(<Badge className="custom-badge">Custom</Badge>);
    expect(screen.getByText('Custom')).toHaveClass('custom-badge');
  });

  it('renders as a div by default', () => {
    const { container } = render(<Badge>Div badge</Badge>);
    expect(container.querySelector('div')).toBeInTheDocument();
  });

  it('renders children correctly', () => {
    render(
      <Badge>
        <span>Icon</span> Badge with icon
      </Badge>
    );
    expect(screen.getByText('Icon')).toBeInTheDocument();
    expect(screen.getByText(/Badge with icon/)).toBeInTheDocument();
  });
});
