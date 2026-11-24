import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import i18n from '../../i18n';
import type { TemplateVariable } from '../../types/template';

import TemplateVariablesList from './TemplateVariablesList';

/**
 * New keys are not in the catalog yet (the coordinator runs the extract pass),
 * so a missing key resolves to itself. Resolving through i18n keeps these
 * assertions valid before *and* after extraction.
 */
const tt = (key: string) => i18n.t(key, { ns: 'templates' });
const tc = (key: string) => i18n.t(key, { ns: 'common' });

const variables: TemplateVariable[] = [
  {
    name: 'SERVER_MEMORY',
    description: 'Memory limit',
    default: '1024',
    required: true,
    input: 'number',
  },
  {
    name: 'GAMEMODE',
    description: 'World mode',
    default: 'survival',
    required: false,
    input: 'select',
    rules: ['in:survival,creative'],
  },
  {
    name: 'EULA',
    default: '0',
    required: false,
    input: 'checkbox',
    trueValue: '1',
    falseValue: '0',
  },
];

describe('TemplateVariablesList inline edit (D18)', () => {
  afterEach(cleanup);

  it('renders no edit affordance without an onSave handler (read-only)', () => {
    render(<TemplateVariablesList variables={variables} />);
    expect(screen.queryByRole('button', { name: tt('variables.edit') })).not.toBeInTheDocument();
    expect(screen.getByText('SERVER_MEMORY')).toBeInTheDocument();
  });

  it('edits one variable and saves only that entry with the others untouched', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TemplateVariablesList variables={variables} onSave={onSave} />);

    const pencils = screen.getAllByRole('button', { name: tt('variables.edit') });
    expect(pencils).toHaveLength(3);
    fireEvent.click(pencils[1]);

    // A `select` variable renders a select seeded with the current value.
    const select = screen.getByRole('combobox');
    expect(select).toHaveValue('survival');
    fireEvent.change(select, { target: { value: 'creative' } });
    fireEvent.click(screen.getByRole('button', { name: tc('actions.save') }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({ ...variables[1], default: 'creative' });
    // The row closes back to its read-only form after a successful save.
    await waitFor(() =>
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument(),
    );
  });

  it('renders a text input for a select variable with no enumerated options', () => {
    render(
      <TemplateVariablesList
        variables={[{ ...variables[1], rules: [], options: [] }]}
        onSave={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: tt('variables.edit') }));
    const field = screen.getByRole('textbox');
    expect(field).toHaveValue('survival');
  });

  it('writes the checkbox true/false sentinels for a boolean variable', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<TemplateVariablesList variables={variables} onSave={onSave} />);

    fireEvent.click(screen.getAllByRole('button', { name: tt('variables.edit') })[2]);
    const checkbox = screen.getByRole('checkbox', { name: tt('variables.value') });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: tc('actions.save') }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].default).toBe('1');
  });

  it('keeps the row open when the save fails so the value can be retried', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('nope'));
    render(<TemplateVariablesList variables={variables} onSave={onSave} />);

    fireEvent.click(screen.getAllByRole('button', { name: tt('variables.edit') })[0]);
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '2048' } });
    fireEvent.click(screen.getByRole('button', { name: tc('actions.save') }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('spinbutton')).toHaveValue(2048);
    expect(input).toBeInTheDocument();
  });

  it('cancels without calling the API', () => {
    const onSave = vi.fn();
    render(<TemplateVariablesList variables={variables} onSave={onSave} />);

    fireEvent.click(screen.getAllByRole('button', { name: tt('variables.edit') })[0]);
    fireEvent.click(screen.getByRole('button', { name: tc('actions.cancel') }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });
});
