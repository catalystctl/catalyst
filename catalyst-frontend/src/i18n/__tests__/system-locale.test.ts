import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import i18n from '../index';
import { LOCALE_STORAGE_KEY, detectDeviceLocale, setSystemDefaultLocale } from '../config';
import { bootstrapSystemLocale } from '../system-locale';

function mockLocaleEndpoint(payload: unknown, init: { ok?: boolean; fail?: boolean } = {}) {
  const fetchMock = vi.fn(async () => {
    if (init.fail) throw new Error('offline');
    return {
      ok: init.ok ?? true,
      json: async () => payload,
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('instance default language', () => {
  beforeEach(() => {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    setSystemDefaultLocale(null);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    setSystemDefaultLocale(null);
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    await i18n.changeLanguage('en');
  });

  it('applies the instance language before the first render', async () => {
    mockLocaleEndpoint({ data: { defaultLocale: 'zh-CN' } });

    await bootstrapSystemLocale();

    expect(detectDeviceLocale()).toBe('zh-CN');
    expect(i18n.resolvedLanguage).toBe('zh-CN');
  });

  it('outranks the browser preference but not an explicit device choice', async () => {
    mockLocaleEndpoint({ data: { defaultLocale: 'zh-CN' } });
    await bootstrapSystemLocale();
    expect(detectDeviceLocale()).toBe('zh-CN');

    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    expect(detectDeviceLocale()).toBe('en');
  });

  it('skips the request when this device already picked a language', async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    const fetchMock = mockLocaleEndpoint({ data: { defaultLocale: 'zh-CN' } });

    await bootstrapSystemLocale();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(detectDeviceLocale()).toBe('en');
  });

  it('keeps the device language when the endpoint is unavailable', async () => {
    mockLocaleEndpoint(null, { fail: true });

    await bootstrapSystemLocale();

    expect(detectDeviceLocale()).toBe('en');
  });

  it('ignores a language the panel cannot render', async () => {
    mockLocaleEndpoint({ data: { defaultLocale: 'de' } });

    await bootstrapSystemLocale();

    expect(detectDeviceLocale()).toBe('en');
  });

  it('ignores a malformed response', async () => {
    mockLocaleEndpoint({ success: true });

    await bootstrapSystemLocale();

    expect(detectDeviceLocale()).toBe('en');
  });
});
