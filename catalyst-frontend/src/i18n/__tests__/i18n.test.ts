import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import i18n from '../index';
import { matchLocaleTag, isSupportedLocale, LOCALE_STORAGE_KEY, detectDeviceLocale } from '../config';
import { getLocalizedErrorMessage, getApiErrorCode, getApiErrorParams, getLocalizedFieldErrors } from '../api-errors';
import { formatDate, formatTime, formatRelativeTime } from '../format';
import { consoleStreamLabel, roleDescriptionLabel, roleLabel } from '../../utils/constants';

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
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('extracts the backend error code from the response body', () => {
    const error = { response: { data: { code: 'SERVER_NOT_FOUND', error: 'Server not found' } } };
    expect(getApiErrorCode(error)).toBe('SERVER_NOT_FOUND');
  });

  it('keeps the specific server message for English readers', () => {
    // One code covers many messages (VALIDATION_ERROR alone spans over a
    // hundred), so English keeps the server's wording rather than the generic
    // catalog text.
    const error = { response: { data: { code: 'VALIDATION_ERROR', error: 'Password must be at least 8 characters' } } };
    expect(getLocalizedErrorMessage(error)).toBe('Password must be at least 8 characters');
  });

  it('translates a coded error for other locales', async () => {
    await i18n.changeLanguage('zh-CN');
    const error = { response: { data: { code: 'SERVER_NOT_FOUND', error: 'Server not found' } } };
    expect(getLocalizedErrorMessage(error)).toBe('找不到请求的服务器。');
  });

  it('falls back to the catalog text when the server sent no message', () => {
    const error = { response: { data: { code: 'SERVER_NOT_FOUND' } } };
    expect(getLocalizedErrorMessage(error)).toBe('The requested server could not be found.');
  });

  it('falls back to the server message for unknown codes', () => {
    const error = { response: { data: { code: 'SOME_NEW_CODE', error: 'Fresh server message' } } };
    expect(getLocalizedErrorMessage(error)).toBe('Fresh server message');
  });

  it('interpolates params from the shipped catalog', async () => {
    // No server message, so the catalog text is what the user sees.
    const error = { response: { data: { code: 'FILE_TOO_LARGE', params: { maxMb: 512 } } } };
    expect(getLocalizedErrorMessage(error)).toBe('Upload exceeds the maximum size of 512MB.');
    await i18n.changeLanguage('zh-CN');
    expect(getLocalizedErrorMessage(error)).toBe('上传大小超过 512MB 的上限。');
  });

  it('reads params attached directly to the thrown error', () => {
    const error = Object.assign(new Error('invalid'), { code: 'FILE_TOO_LARGE', params: { maxMb: 8 } });
    expect(getApiErrorParams(error)).toEqual({ maxMb: 8 });
  });

  it('translates field-level validation codes and keeps unknown fields as sent', async () => {
    const error = {
      response: {
        data: {
          code: 'VALIDATION_ERROR',
          error: 'Invalid request parameters',
          details: [
            { field: 'password', message: 'Too short', code: 'VALIDATION_TOO_SMALL', params: { min: 12 } },
            { field: 'engine', message: 'engine must be one of: java, bedrock' },
          ],
        },
      },
    };
    expect(getLocalizedFieldErrors(error)).toEqual([
      { field: 'password', message: 'Must be at least 12 characters' },
      { field: 'engine', message: 'engine must be one of: java, bedrock' },
    ]);
    await i18n.changeLanguage('zh-CN');
    expect(getLocalizedFieldErrors(error)[0].message).toBe('至少 12 个字符');
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

describe('value-to-key label helpers', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('translates seeded role names and passes custom ones through', async () => {
    expect(roleLabel(i18n.t, 'Administrator')).toBe('Administrator');
    expect(roleDescriptionLabel(i18n.t, 'Full system access')).toBe('Full system access');

    await i18n.changeLanguage('zh-CN');
    expect(roleLabel(i18n.t, 'Administrator')).toBe('管理员');
    expect(roleLabel(i18n.t, 'moderator')).toBe('协管员');
    expect(roleDescriptionLabel(i18n.t, 'Limited management permissions')).toBe('具有受限的管理权限');
    // Renamed or plugin-provided roles keep their stored text.
    expect(roleLabel(i18n.t, 'Server Owner')).toBe('Server Owner');
    expect(roleDescriptionLabel(i18n.t, 'Runs the EU cluster')).toBe('Runs the EU cluster');
  });

  it('translates console stream names and passes unknown streams through', async () => {
    expect(consoleStreamLabel(i18n.t, 'system')).toBe('system');
    await i18n.changeLanguage('zh-CN');
    expect(consoleStreamLabel(i18n.t, 'stdout')).toBe('标准输出');
    expect(consoleStreamLabel(i18n.t, 'stderr')).toBe('标准错误');
    expect(consoleStreamLabel(i18n.t, 'custom-stream')).toBe('custom-stream');
  });
});

describe('date and time formatting', () => {
  const value = new Date('2026-01-02T03:04:05Z');

  it('accepts explicit component options without conflicting with the style defaults', () => {
    // Intl rejects mixing dateStyle/timeStyle with component options.
    expect(() => formatDate(value, { month: 'short', day: 'numeric', timeZone: 'UTC' })).not.toThrow();
    expect(() => formatTime(value, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })).not.toThrow();
  });

  it('applies the style defaults when only non-component options are given', () => {
    expect(formatDate(value, { timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(value),
    );
    expect(formatTime(value, { timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat('en', { timeStyle: 'short', timeZone: 'UTC' }).format(value),
    );
  });
});
