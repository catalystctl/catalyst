import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import i18n from '../index';
import { matchLocaleTag, isSupportedLocale, LOCALE_STORAGE_KEY, detectDeviceLocale } from '../config';
import { getLocalizedErrorMessage, getApiErrorCode } from '../api-errors';
import { formatRelativeTime } from '../format';

describe('locale matching', () => {
  it('accepts exact and regional tags', () => {
    expect(matchLocaleTag('en')).toBe('en');
    expect(matchLocaleTag('en-US')).toBe('en');
    expect(matchLocaleTag('zh-CN')).toBe('zh-CN');
    expect(matchLocaleTag('zh-Hans-CN')).toBe('zh-CN');
    expect(matchLocaleTag('zh')).toBe('zh-CN');
  });

  it('does not serve a mismatched writing system', () => {
    expect(matchLocaleTag('zh-TW')).toBeUndefined();
    expect(matchLocaleTag('de')).toBeUndefined();
  });

  it('validates supported codes', () => {
    expect(isSupportedLocale('zh-CN')).toBe(true);
    expect(isSupportedLocale('fr')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });
});

describe('device locale detection', () => {
  afterEach(() => {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
  });

  it('prefers the stored selection', () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh-CN');
    expect(detectDeviceLocale()).toBe('zh-CN');
  });

  it('falls back to the browser languages', () => {
    window.localStorage.removeItem(LOCALE_STORAGE_KEY);
    expect(detectDeviceLocale()).toBe('en');
  });
});

describe('api error translation', () => {
  it('extracts the backend error code from the response body', () => {
    const error = { response: { data: { code: 'SERVER_NOT_FOUND', error: 'Server not found' } } };
    expect(getApiErrorCode(error)).toBe('SERVER_NOT_FOUND');
  });

  it('prefers a known code translation', () => {
    const error = { response: { data: { code: 'SERVER_NOT_FOUND', error: 'Server not found' } } };
    expect(getLocalizedErrorMessage(error)).toBe('The requested server could not be found.');
  });

  it('falls back to the server message for unknown codes', () => {
    const error = { response: { data: { code: 'SOME_NEW_CODE', error: 'Fresh server message' } } };
    expect(getLocalizedErrorMessage(error)).toBe('Fresh server message');
  });
});

describe('catalog loading', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders strings in the active locale', async () => {
    expect(i18n.t('language.label')).toBe('Language');
    await i18n.changeLanguage('zh-CN');
    expect(i18n.t('language.label')).toBe('语言');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('formats relative time per locale', async () => {
    const base = new Date('2026-01-01T12:00:00Z');
    const threeDaysLater = new Date('2026-01-04T12:00:00Z');
    expect(formatRelativeTime(threeDaysLater, base)).toBe('in 3 days');
    await i18n.changeLanguage('zh-CN');
    expect(formatRelativeTime(threeDaysLater, base)).toBe('3天后');
  });

  it('falls back to English for missing and placeholder keys', async () => {
    i18n.addResourceBundle('en', 'fallback-test', { greeting: 'Hello there' }, true, true);
    i18n.addResourceBundle('zh-CN', 'fallback-test', { greeting: '' }, true, true);
    await i18n.changeLanguage('zh-CN');

    // An empty string is a translator placeholder, not a translation.
    expect(i18n.t('greeting', { ns: 'fallback-test' })).toBe('Hello there');

    i18n.addResourceBundle('en', 'fallback-test', { onlyEnglish: 'Only English' }, true, true);
    expect(i18n.t('onlyEnglish', { ns: 'fallback-test' })).toBe('Only English');
  });
});
