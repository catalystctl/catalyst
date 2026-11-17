/**
 * The retry screen for a boot session probe that never settled must not trap a
 * signed-out user away from the sign-in form: `/api/auth/me` alone can be
 * broken while `/api/auth/login` still works.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

vi.mock('../hooks/useAuthInit', () => ({ useAuthInit: () => {} }));
vi.mock('../hooks/useStreamRecovery', () => ({ useStreamRecovery: () => {} }));
vi.mock('../hooks/useSetupStatus', () => ({
  useSetupStatus: () => ({
    setupRequired: false,
    isLoading: false,
    unreachable: false,
    error: null,
    recheck: () => {},
  }),
}));
vi.mock('../services/api/theme', () => ({
  themeApi: { getPublicSettings: vi.fn(async () => ({ customCss: '' })) },
}));
vi.mock('../services/api/auth', () => ({
  authApi: { getOAuthProviders: vi.fn(async () => []) },
}));
// The real provider pulls in the plugin loader's `@plugins` import glob, which
// vitest cannot resolve; the gate under test does not depend on it.
vi.mock('../plugins/PluginProvider', () => ({
  PluginProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// jsdom has no ResizeObserver and the login card's primitives touch it.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import i18n from '../i18n';
import App from '../App';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App session-check retry screen', () => {
  beforeEach(() => {
    useAuthStore.setState({
      isReady: true,
      isAuthenticated: false,
      user: null,
      sessionCheckFailed: true,
      isRefreshing: false,
    });
  });

  afterEach(() => {
    cleanup();
    useAuthStore.setState({ sessionCheckFailed: false, isReady: false });
  });

  it('shows the retry screen for app routes', () => {
    renderAt('/dashboard');
    expect(screen.getByText(i18n.t('sessionCheck.failed'))).toBeInTheDocument();
  });

  it('offers a way to the sign-in form', async () => {
    renderAt('/dashboard');
    fireEvent.click(await screen.findByRole('link'));
    await waitFor(() => expect(document.querySelector('input#email')).not.toBeNull());
  });
});
