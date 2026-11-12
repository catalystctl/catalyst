import { describe, it, expect, vi, beforeEach } from 'vitest';

const getThemeSettingsMock = vi.fn();

vi.mock('../../services/api/admin', () => ({
  adminApi: {
    getThemeSettings: (...args: unknown[]) => getThemeSettingsMock(...args),
  },
}));

import { loadAdminCustomCss } from '../admin-custom-css';

/** Build an ApiError-shaped rejection the way services/api/client.ts raises one. */
function apiError(status: number): Error & { status: number } {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe('loadAdminCustomCss', () => {
  beforeEach(() => {
    getThemeSettingsMock.mockReset();
  });

  it('applies the stored custom CSS and reports success', async () => {
    getThemeSettingsMock.mockResolvedValue({ customCss: ':root{--x:1}' });
    const applyCss = vi.fn();

    const outcome = await loadAdminCustomCss(applyCss);

    expect(applyCss).toHaveBeenCalledWith(':root{--x:1}');
    expect(outcome).toEqual({ status: 'applied', customCss: ':root{--x:1}' });
  });

  it('does not apply anything when no custom CSS is stored, and still reports success', async () => {
    getThemeSettingsMock.mockResolvedValue({});
    const applyCss = vi.fn();

    const outcome = await loadAdminCustomCss(applyCss);

    expect(applyCss).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'applied', customCss: undefined });
  });

  it('reports a 403 as its own forbidden outcome, not as a success', async () => {
    getThemeSettingsMock.mockRejectedValue(apiError(403));
    const applyCss = vi.fn();

    const outcome = await loadAdminCustomCss(applyCss);

    expect(applyCss).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'forbidden' });
  });

  it('reports any other failure as failed and keeps the error for the caller', async () => {
    const failure = apiError(500);
    getThemeSettingsMock.mockRejectedValue(failure);
    const applyCss = vi.fn();

    const outcome = await loadAdminCustomCss(applyCss);

    expect(applyCss).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: 'failed', error: failure });
  });

  it('reports a failure raised while applying the CSS instead of swallowing it', async () => {
    getThemeSettingsMock.mockResolvedValue({ customCss: 'body{color:red}' });
    const applyFailure = new Error('style element unavailable');
    const applyCss = vi.fn(() => {
      throw applyFailure;
    });

    const outcome = await loadAdminCustomCss(applyCss);

    expect(outcome).toEqual({ status: 'failed', error: applyFailure });
  });
});
