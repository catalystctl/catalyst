import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import Combobox from './combobox';

afterEach(cleanup);

describe('Combobox accessibility', () => {
  const options = [
    { value: 'first', label: 'First node' },
    { value: 'second', label: 'Second node' },
  ];

  it('keeps a stable accessible label when the selected value changes', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Combobox value="" onChange={onChange} options={options} ariaLabel="Node" placeholder="Choose node" />,
    );
    expect(screen.getByRole('combobox', { name: 'Node' })).toBeInTheDocument();
    rerender(<Combobox value="second" onChange={onChange} options={options} ariaLabel="Node" placeholder="Choose node" />);
    expect(screen.getByRole('combobox', { name: 'Node' })).toHaveTextContent('Second node');
  });

  it('gives the list a stable label and represents the selected option', () => {
    render(<Combobox value="second" onChange={vi.fn()} options={options} ariaLabel="Node" searchPlaceholder="Search nodes" />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Node' }));
    expect(screen.getByRole('listbox', { name: 'Node' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Second node' })).toHaveAttribute('aria-selected', 'true');
  });
});
