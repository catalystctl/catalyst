import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  resendVerification: vi.fn(),
  notifySuccess: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  useLocation: () => ({ state: undefined }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams()],
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    login: mocks.login,
    verifyTwoFactor: vi.fn(),
    isLoading: false,
    error: 'errors.EMAIL_VERIFICATION_REQUIRED',
    setSession: vi.fn(),
    isAuthenticated: false,
    isReady: true,
  }),
}));
vi.mock('../../stores/themeStore', () => ({
  useThemeStore: (selector: (state: unknown) => unknown) => selector({ themeSettings: {} }),
}));
vi.mock('../../services/api/auth', () => ({
  authApi: {
    getOAuthProviders: vi.fn().mockResolvedValue([]),
    refresh: vi.fn(),
  },
}));
vi.mock('../../services/api/profile', () => ({
  profileApi: { resendVerification: mocks.resendVerification },
}));
vi.mock('../../services/api/systemErrors', () => ({ reportSystemError: vi.fn() }));
vi.mock('../../utils/notify', () => ({
  notifyError: vi.fn(),
  notifySuccess: mocks.notifySuccess,
}));
vi.mock('../../hooks/usePanelBranding', () => ({
  usePanelBranding: () => ({ panelName: 'Catalyst', logoUrl: '/logo.png' }),
}));
vi.mock('../../hooks/useSetupStatus', () => ({
  useSetupStatus: () => ({ setupRequired: false, isLoading: false }),
}));
vi.mock('../../components/shared/BrandFooter', () => ({ BrandFooter: () => null }));
vi.mock('../../components/shared/LanguageSwitcher', () => ({ default: () => null }));
vi.mock('../../demo/isDemo', () => ({ showsDemoChrome: false }));

import LoginPage from '../auth/LoginPage';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  mocks.login.mockRejectedValue({
    response: { data: { code: 'EMAIL_VERIFICATION_REQUIRED' } },
  });
  mocks.resendVerification.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('LoginPage email verification', () => {
  it('shows the verification error from the API response and resends the email', async () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText('fields.email'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('fields.password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'login.submit' }));

    const resendButton = await screen.findByRole('button', { name: 'login.resendVerification' });
    expect(screen.getByText('login.emailVerificationRequired')).toBeInTheDocument();
    expect(screen.queryByText('errors.EMAIL_VERIFICATION_REQUIRED')).not.toBeInTheDocument();

    fireEvent.click(resendButton);

    await waitFor(() => {
      expect(mocks.resendVerification).toHaveBeenCalledWith('user@example.com');
      expect(mocks.notifySuccess).toHaveBeenCalledWith('login.verificationEmailSent');
    });
  });
});
