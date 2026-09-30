import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { generatePalette } from '../../utils/generatePalette';

const post = vi.fn();
const get = vi.fn();
const previewColors = vi.fn();
const navigate = vi.fn();

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../stores/authStore', () => ({ useAuthStore: (select: (state: any) => unknown) => select({ init: vi.fn() }) }));
vi.mock('../../stores/themeStore', () => ({ useThemeStore: (select: (state: any) => unknown) => select({ previewColors, cancelPreview: vi.fn(), applyTheme: vi.fn(), setTheme: vi.fn() }) }));
vi.mock('../../hooks/useSetupStatus', () => ({ useSetupStatus: () => ({ recheck: vi.fn() }) }));
vi.mock('../../services/api/client', () => ({ default: { get: (...args: unknown[]) => get(...args), post: (...args: unknown[]) => post(...args) } }));
vi.mock('../../components/shared/LanguageSwitcher', () => ({ default: () => null }));
vi.mock('../../components/shared/BrandFooter', () => ({ BrandFooter: () => null }));

import SetupPage from './SetupPage';

function appearanceStep() {
  fireEvent.click(screen.getByRole('button', { name: 'common:actions.next' }));
  fireEvent.change(screen.getByLabelText('admin.email'), { target: { value: 'admin@example.com' } });
  fireEvent.change(screen.getByLabelText('admin.username'), { target: { value: 'admin' } });
  fireEvent.change(screen.getByLabelText('admin.password'), { target: { value: 'password123' } });
  fireEvent.change(screen.getByLabelText('admin.confirmPassword'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'common:actions.next' }));
}

describe('setup palette persistence', () => {
  beforeEach(() => {
    post.mockReset(); get.mockReset().mockResolvedValue({ setupRequired: true });
    previewColors.mockClear(); navigate.mockReset();
  });
  afterEach(cleanup);

  it('previews and persists the palette generated from seed and harmony', async () => {
    post.mockResolvedValue({ success: true });
    render(<SetupPage />);
    appearanceStep();
    fireEvent.change(screen.getByLabelText('appearance.seedColor'), { target: { value: '#3388cc' } });
    fireEvent.click(screen.getByRole('button', { name: 'harmony.triadic' }));
    const palette = generatePalette('#3388cc', 'triadic');
    await waitFor(() => expect(previewColors).toHaveBeenCalledWith(palette));
    expect(screen.getByText(palette.secondaryColor)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'submit.complete' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/setup/complete', expect.objectContaining({
      primaryColor: palette.primaryColor,
      secondaryColor: palette.secondaryColor,
      accentColor: palette.accentColor,
      metadata: { themeColors: palette.themeColors },
    })));
  });

  it('explains malformed seed and does not submit it', () => {
    render(<SetupPage />);
    appearanceStep();
    fireEvent.change(screen.getByLabelText('appearance.seedColor'), { target: { value: '#xyz' } });
    expect(screen.getByText('errors.seedColorInvalid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'submit.complete' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
