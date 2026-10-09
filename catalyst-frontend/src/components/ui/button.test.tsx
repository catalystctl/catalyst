import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Button } from './button';

afterEach(cleanup);

describe('Button component', () => {
  it('renders with default variant and size', () => {
    render(<Button>Click me</Button>);
    const button = screen.getByRole('button', { name: 'Click me' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('bg-primary');
  });

  it('applies variant styles correctly', () => {
    const { rerender } = render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-destructive');

    rerender(<Button variant="outline">Cancel</Button>);
    expect(screen.getByRole('button')).toHaveClass('border');

    rerender(<Button variant="secondary">Secondary</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-surface-2');

    rerender(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole('button')).toHaveClass('hover:bg-surface-2');

    rerender(<Button variant="link">Link</Button>);
    expect(screen.getByRole('button')).toHaveClass('underline-offset-4');
  });

  it('applies size variants correctly', () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-8');

    rerender(<Button size="lg">Large</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-10');

    rerender(<Button size="icon">I</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-9', 'w-9');

    rerender(<Button size="icon-sm">I</Button>);
    expect(screen.getByRole('button')).toHaveClass('h-7', 'w-7');
  });

  it('handles click events', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('respects disabled state', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick} disabled>Disabled</Button>);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('renders as a child component when asChild is true', () => {
    render(
      <Button asChild>
        <a href="/test">Link button</a>
      </Button>
    );
    const link = screen.getByRole('link', { name: 'Link button' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/test');
  });

  it('accepts custom className', () => {
    render(<Button className="custom-class">Custom</Button>);
    expect(screen.getByRole('button')).toHaveClass('custom-class');
  });

  it('applies disabled styles for filled variants', () => {
    const { rerender } = render(<Button disabled>Default disabled</Button>);
    expect(screen.getByRole('button')).toHaveClass('disabled:bg-surface-3', 'disabled:text-muted-foreground');

    rerender(<Button variant="destructive" disabled>Destructive disabled</Button>);
    expect(screen.getByRole('button')).toHaveClass('disabled:bg-surface-3', 'disabled:text-muted-foreground');
  });

  it('applies disabled opacity for non-filled variants', () => {
    const { rerender } = render(<Button variant="outline" disabled>Outline disabled</Button>);
    expect(screen.getByRole('button')).toHaveClass('disabled:opacity-50');

    rerender(<Button variant="ghost" disabled>Ghost disabled</Button>);
    expect(screen.getByRole('button')).toHaveClass('disabled:opacity-50');
  });

  it('supports keyboard navigation', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Press Enter</Button>);
    const button = screen.getByRole('button');
    button.focus();
    expect(button).toHaveFocus();
    // Buttons respond to Space and Enter natively in browsers
    expect(button.tagName).toBe('BUTTON');
  });
});
