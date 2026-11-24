/**
 * ApiKeysPage — the row "Copy" button copies the key id (audit A6).
 *
 * The secret is shown once, at creation; the masked `sk_live…` prefix next to
 * the button is display-only. Copying that prefix produced a useless string, so
 * the button now copies the id and says so in its label/tooltip.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const apiKeys = [
  {
    id: 'cmf3ax9k10000abcdefghijkl',
    name: 'Billing',
    prefix: 'sk_live',
    start: 'sk_live_abc',
    enabled: true,
    expiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastRequest: null,
    requestCount: 3,
    rateLimitMax: 100,
    rateLimitTimeWindow: 60000,
    permissions: ['server.read'],
    allPermissions: false,
    metadata: null,
  },
];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
  Trans: ({ children }: { children?: unknown }) => children,
}));
vi.mock('@/csync', () => ({
  useQuery: () => ({ data: [], isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }));
vi.mock('../../hooks/useApiKeys', () => ({
  useApiKeys: () => ({ data: apiKeys, isLoading: false, isError: false, refetch: vi.fn() }),
  useDeleteApiKey: () => ({ mutate: vi.fn(), isPending: false }),
  usePermissionsCatalog: () => ({
    data: [
      {
        id: 'servers',
        label: 'Servers',
        description: '',
        permissions: [{ value: 'server.read', label: 'View servers' }],
      },
    ],
  }),
}));
vi.mock('../../hooks/useNodes', () => ({ useNodes: () => ({ data: [] }) }));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { user: { permissions: string[] } }) => unknown) =>
    selector({ user: { permissions: ['*'] } }),
}));
vi.mock('../../components/apikeys/CreateApiKeyDialog', () => ({
  CreateApiKeyDialog: () => null,
}));
vi.mock('../../components/apikeys/EditApiKeyDialog', () => ({
  EditApiKeyDialog: () => null,
}));
vi.mock('@/components/shared/LastUpdated', () => ({ default: () => null }));

import { ApiKeysPage } from '../ApiKeysPage';

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(cleanup);

const renderPage = () =>
  render(
    <MemoryRouter>
      <ApiKeysPage />
    </MemoryRouter>,
  );

describe('ApiKeysPage — copy key id', () => {
  it('labels the copy control as copying the key id, not the masked prefix', () => {
    renderPage();
    const button = screen.getByRole('button', { name: 'apiKeys.row.copyId' });
    expect(button).toHaveAttribute('title', 'apiKeys.row.copyId');
  });

  it('writes the key id to the clipboard', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'apiKeys.row.copyId' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('cmf3ax9k10000abcdefghijkl');
    // The mutable prefix must never be handed to the clipboard again.
    expect(writeText).not.toHaveBeenCalledWith('sk_live_abc');
  });

  it('uses the sibling action-button hit target (h-8), not the old h-6', () => {
    renderPage();
    const button = screen.getByRole('button', { name: 'apiKeys.row.copyId' });
    expect(button.className).toContain('h-8');
    expect(button.className).toContain('w-8');
    expect(button.className).not.toContain('h-6');
  });
});
