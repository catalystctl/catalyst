/**
 * Regression tests for issue #362: the plugin settings dialog froze fields that
 * had a plugin.json default or a stored value, and Save wrote the plugin.json
 * default for every untouched key (wiping stored keys such as `apiKey`).
 *
 * The dialog must show the stored value until a field is edited, then the edit,
 * and Save must send only the edited fields.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@/csync';

const apiMocks = vi.hoisted(() => ({
  fetchPluginDetails: vi.fn(),
  updatePluginConfig: vi.fn(),
}));

vi.mock('../../../plugins/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../plugins/api')>();
  return {
    ...actual,
    fetchPluginDetails: apiMocks.fetchPluginDetails,
    updatePluginConfig: apiMocks.updatePluginConfig,
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { PluginSettingsModal } from '../PluginsPage';

// A subset of the ai-assistant manifest, with stored values that differ from
// the plugin.json defaults so the test can tell which one the dialog shows.
const pluginDetails = {
  name: 'ai-assistant',
  displayName: 'AI Assistant',
  configSchema: {
    provider: {
      type: 'select',
      default: 'openai-completions',
      label: 'Provider',
      options: [
        { label: 'OpenAI Chat Completions', value: 'openai-completions' },
        { label: 'OpenAI Responses API', value: 'openai-responses' },
        { label: 'Anthropic Messages API', value: 'anthropic-messages' },
      ],
    },
    apiKey: {
      type: 'password',
      default: '',
      label: 'API Key',
    },
    model: {
      type: 'string',
      default: 'gpt-4o-mini',
      label: 'Model',
    },
    allowFileWrites: {
      type: 'boolean',
      default: false,
      label: 'Allow File Writes',
    },
    maxToolIterations: {
      type: 'number',
      default: 6,
      label: 'Max Tool Iterations',
    },
  },
  config: {
    provider: 'openai-responses',
    apiKey: 'sk-stored-secret',
    model: 'gpt-4o-mini',
    allowFileWrites: false,
    maxToolIterations: 9,
  },
};

function renderModal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PluginSettingsModal pluginName="ai-assistant" open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe('PluginSettingsModal', () => {
  beforeEach(() => {
    apiMocks.fetchPluginDetails.mockResolvedValue(pluginDetails);
    apiMocks.updatePluginConfig.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows stored values, keeps edits on screen and saves only edited fields', async () => {
    renderModal();

    // Stored values are shown, not the plugin.json defaults.
    const iterations = await screen.findByRole('spinbutton');
    expect(iterations).toHaveValue(9);
    const provider = screen.getByRole('combobox');
    expect(provider).toHaveValue('openai-responses');
    expect(screen.getByDisplayValue('sk-stored-secret')).toBeInTheDocument();

    // Number: type "1" then "0" over the selected value.
    fireEvent.change(iterations, { target: { value: '1' } });
    expect(iterations).toHaveValue(1);
    fireEvent.change(iterations, { target: { value: '10' } });
    expect(iterations).toHaveValue(10);

    // Checkbox.
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Text.
    const model = screen.getByDisplayValue('gpt-4o-mini');
    fireEvent.change(model, { target: { value: 'abc' } });
    expect(model).toHaveValue('abc');

    // Dropdown.
    fireEvent.change(provider, { target: { value: 'anthropic-messages' } });
    expect(provider).toHaveValue('anthropic-messages');

    // Untouched secret is still shown as stored.
    expect(screen.getByDisplayValue('sk-stored-secret')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(apiMocks.updatePluginConfig).toHaveBeenCalledTimes(1));
    expect(apiMocks.updatePluginConfig).toHaveBeenCalledWith('ai-assistant', {
      maxToolIterations: 10,
      allowFileWrites: true,
      model: 'abc',
      provider: 'anthropic-messages',
    });
  });

  it('sends no fields when nothing was edited, so stored values are not reset', async () => {
    renderModal();
    await screen.findByRole('spinbutton');

    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(apiMocks.updatePluginConfig).toHaveBeenCalledTimes(1));
    expect(apiMocks.updatePluginConfig).toHaveBeenCalledWith('ai-assistant', {});
  });
});
