/**
 * NodeCreateModal — single-screen editor.
 *
 * The create flow used to be a 3-step wizard (location → details → deploy).
 * It is now one numbered-section screen with a summary aside; the only
 * "step" left is the post-create deploy view that replaces the form in the
 * same dialog. These tests pin the single-screen structure, the submit-time
 * validation that replaced the per-step gating, and the preserved
 * create → deploy flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const h = vi.hoisted(() => ({
  create: vi.fn(),
  deploymentToken: vi.fn(),
}));

vi.mock('../../../services/api/locations', () => ({
  locationsApi: {
    list: vi.fn().mockResolvedValue([{ id: 'loc-1', name: 'US East', description: 'Virginia' }]),
  },
}));

vi.mock('../../../services/api/nodes', () => ({
  nodesApi: { create: h.create, deploymentToken: h.deploymentToken },
}));

vi.mock('../../../utils/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}));

import { queryClient } from '../../../lib/queryClient';
import { QueryClientProvider } from '../../../csync';
import NodeCreateModal from '../NodeCreateModal';

function renderModal() {
  return render(
    <QueryClientProvider client={queryClient}>
      <NodeCreateModal />
    </QueryClientProvider>,
  );
}

function openModal() {
  renderModal();
  fireEvent.click(screen.getByRole('button', { name: 'Register Node' }));
}

/** The location-manager return flow, which pre-selects a created location. */
function returnFromLocations(createdId = 'loc-1') {
  fireEvent(
    window,
    new CustomEvent('catalyst:return-to-node-create', { detail: { createdId } }),
  );
}

function fillRequiredTextFields() {
  fireEvent.change(screen.getByPlaceholderText('production-1'), {
    target: { value: 'edge-1' },
  });
  fireEvent.change(screen.getByPlaceholderText('node1.example.com'), {
    target: { value: 'node1.example.com' },
  });
  fireEvent.change(screen.getByPlaceholderText('203.0.113.10 or 2001:db8::1'), {
    target: { value: '203.0.113.10' },
  });
}

beforeEach(() => {
  h.create.mockResolvedValue({ id: 'node-1' });
  h.deploymentToken.mockResolvedValue({
    deployUrl: 'https://deploy.example/script',
    deploymentToken: 'tok',
    apiKey: 'key-123',
    expiresAt: '2026-12-01T00:00:00.000Z',
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.clearAllMocks();
});

describe('NodeCreateModal', () => {
  it('renders every section on one screen with the summary aside', () => {
    openModal();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // No wizard controls survive.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    expect(screen.queryByText('Deploy')).toBeNull();

    // All five numbered sections render at once.
    expect(screen.getByText('Node details')).toBeInTheDocument();
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('Capacity')).toBeInTheDocument();
    expect(screen.getAllByText('Advanced agent paths').length).toBe(2);
    expect(screen.getAllByText('Location').length).toBeGreaterThanOrEqual(2);

    // The aside mirrors the untouched form; requirements are listed up front.
    expect(screen.getAllByText('n/a').length).toBeGreaterThan(0);
    const strip = screen.getByRole('status');
    expect(
      within(strip).getByText('Complete these requirements before continuing:'),
    ).toBeInTheDocument();
    for (const field of ['Name', 'Location', 'Hostname', 'Public address']) {
      expect(within(strip).getByText(field)).toBeInTheDocument();
    }
  });

  it('keeps submit disabled until the formerly step-gated fields are valid', () => {
    openModal();

    const register = screen.getByRole('button', { name: 'Register node' });
    expect(register).toBeDisabled();

    fillRequiredTextFields();
    // Still blocked: no location chosen, and the strip no longer names the rest.
    expect(register).toBeDisabled();
    const strip = screen.getByRole('status');
    expect(within(strip).getByText('Location')).toBeInTheDocument();
    expect(within(strip).queryByText('Name')).toBeNull();

    returnFromLocations();
    expect(register).toBeEnabled();
  });

  it('creates the node and shows the deploy script in the same dialog', async () => {
    openModal();
    returnFromLocations();
    fillRequiredTextFields();

    fireEvent.click(screen.getByRole('button', { name: 'Register node' }));

    await waitFor(() =>
      expect(h.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'edge-1',
          locationId: 'loc-1',
          hostname: 'node1.example.com',
          publicAddress: '203.0.113.10',
          maxMemoryMb: 16384,
          maxCpuCores: 8,
          sftpPort: 2022,
        }),
      ),
    );

    // The form is replaced by the deploy view, script included.
    expect(await screen.findByText('Node registered successfully')).toBeInTheDocument();
    expect(screen.getByText(/key-123/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register node' })).toBeNull();

    await waitFor(() => expect(h.deploymentToken).toHaveBeenCalledWith('node-1'));
  });

  it('resets the form after closing so reopening starts clean', () => {
    openModal();
    fireEvent.change(screen.getByPlaceholderText('production-1'), {
      target: { value: 'edge-1' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Register Node' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('production-1')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Register node' })).toBeDisabled();
  });
});
