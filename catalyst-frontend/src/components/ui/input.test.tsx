import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Input } from './input';

afterEach(cleanup);

describe('Input component', () => {
  it('renders with default size', () => {
    render(<Input placeholder="Enter text" />);
    const input = screen.getByPlaceholderText('Enter text');
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass('h-9');
  });

  it('applies dense size variant', () => {
    render(<Input size="dense" placeholder="Compact input" />);
    const input = screen.getByPlaceholderText('Compact input');
    expect(input).toHaveClass('h-7', 'px-2.5', 'text-mini');
  });

  it('accepts different input types', () => {
    const { rerender } = render(<Input type="text" aria-label="Text input" />);
    expect(screen.getByLabelText('Text input')).toHaveAttribute('type', 'text');

    rerender(<Input type="password" aria-label="Password input" />);
    expect(screen.getByLabelText('Password input')).toHaveAttribute('type', 'password');

    rerender(<Input type="email" aria-label="Email input" />);
    expect(screen.getByLabelText('Email input')).toHaveAttribute('type', 'email');

    rerender(<Input type="number" aria-label="Number input" />);
    expect(screen.getByLabelText('Number input')).toHaveAttribute('type', 'number');
  });

  it('handles value changes', () => {
    const handleChange = vi.fn();
    render(<Input onChange={handleChange} placeholder="Type here" />);
    const input = screen.getByPlaceholderText('Type here');
    fireEvent.change(input, { target: { value: 'test value' } });
    expect(handleChange).toHaveBeenCalled();
    expect(input).toHaveValue('test value');
  });

  it('respects disabled state', () => {
    const handleChange = vi.fn();
    render(<Input onChange={handleChange} disabled placeholder="Disabled" />);
    const input = screen.getByPlaceholderText('Disabled');
    expect(input).toBeDisabled();
    // Disabled inputs still fire onChange in React testing, but users cannot interact with them
    expect(input).toHaveAttribute('disabled');
  });

  it('applies custom className', () => {
    render(<Input className="custom-input-class" aria-label="Custom input" />);
    expect(screen.getByLabelText('Custom input')).toHaveClass('custom-input-class');
  });

  it('renders placeholder text', () => {
    render(<Input placeholder="Search..." />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('supports controlled input', () => {
    const { rerender } = render(<Input value="initial" onChange={() => {}} aria-label="Controlled" />);
    expect(screen.getByLabelText('Controlled')).toHaveValue('initial');

    rerender(<Input value="updated" onChange={() => {}} aria-label="Controlled" />);
    expect(screen.getByLabelText('Controlled')).toHaveValue('updated');
  });

  it('supports ref forwarding', () => {
    const ref = vi.fn();
    render(<Input ref={ref} aria-label="Ref input" />);
    expect(ref).toHaveBeenCalled();
  });

  it('applies focus-visible styles', () => {
    render(<Input aria-label="Focus test" />);
    const input = screen.getByLabelText('Focus test');
    expect(input).toHaveClass('focus-visible:outline-none', 'focus-visible:ring-2', 'focus-visible:ring-primary');
  });

  it('renders file input correctly', () => {
    render(<Input type="file" aria-label="File input" />);
    const input = screen.getByLabelText('File input');
    expect(input).toHaveAttribute('type', 'file');
  });

  it('applies disabled opacity', () => {
    render(<Input disabled aria-label="Disabled input" />);
    expect(screen.getByLabelText('Disabled input')).toHaveClass('disabled:opacity-50');
  });
});
