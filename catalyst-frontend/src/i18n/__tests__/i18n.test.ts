import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import i18n from '../index';
import { matchLocaleTag, isSupportedLocale, LOCALE_STORAGE_KEY, detectDeviceLocale } from '../config';
import { getLocalizedErrorMessage, getApiErrorCode, getApiErrorParams, getLocalizedFieldErrors } from '../api-errors';
import { formatDate, formatTime, formatRelativeTime, formatTimeSince } from '../format';
import { consoleStreamLabel, roleDescriptionLabel, roleLabel } from '../../utils/constants';

describe('locale matching', () => {
  it('accepts exact and regional tags', () => {
    expect(matchLocaleTag('en')).toBe('en');
    expect(matchLocaleTag('en-US')).toBe('en');
    expect(matchLocaleTag('fr')).toBe('fr');
    expect(matchLocaleTag('fr-FR')).toBe('fr');
    expect(matchLocaleTag('fr-CA')).toBe('fr');
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
    expect(isSupportedLocale('fr')).toBe(true);
    expect(isSupportedLocale('de')).toBe(false);
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

    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'fr');
    expect(detectDeviceLocale()).toBe('fr');
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

    await i18n.changeLanguage('fr');
    expect(getLocalizedErrorMessage(error)).toBe('Le serveur demandé est introuvable.');
  });

  it('prefers the catalog text when the server message looks internal', () => {
    const error = {
      response: {
        data: {
          code: 'SERVER_CREATE_FAILED',
          error: 'PrismaClientKnownRequestError\nInvalid `prisma.server.create()` invocation',
        },
      },
    };
    expect(getLocalizedErrorMessage(error)).toBe('Failed to create the server.');
  });

  it('maps fetch failures to the network error text', async () => {
    expect(getLocalizedErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'A network error occurred. Check your connection and try again.',
    );
    await i18n.changeLanguage('zh-CN');
    expect(getLocalizedErrorMessage(new TypeError('Failed to fetch'))).toBe('网络错误，请检查网络连接后重试。');
    await i18n.changeLanguage('fr');
    expect(getLocalizedErrorMessage(new TypeError('Failed to fetch'))).toBe(
      'Une erreur réseau est survenue. Vérifiez votre connexion et réessayez.',
    );
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
    await i18n.changeLanguage('fr');
    expect(getLocalizedErrorMessage(error)).toBe('Le téléversement dépasse la taille maximale de 512 MB.');
  });

  it('reads params attached directly to the thrown error', () => {
    const error = Object.assign(new Error('invalid'), { code: 'FILE_TOO_LARGE', params: { maxMb: 8 } });
    expect(getApiErrorParams(error)).toEqual({ maxMb: 8 });
  });

  it('names the offending field instead of a bare "Invalid request body"', async () => {
    // The regression this guards: validateRequestBody answered with only
    // { error: 'Invalid request body' }, so a schema/client mismatch was
    // undiagnosable from the panel. The field path and reason now ride along.
    const error = {
      response: {
        data: {
          code: 'VALIDATION_ERROR',
          error: 'Invalid request body',
          details: [
            { field: 'environment.SEED', message: 'Too big', code: 'VALIDATION_TOO_LONG', params: { max: 4096 } },
          ],
        },
      },
    };
    expect(getLocalizedErrorMessage(error)).toBe(
      'Invalid request body: environment.SEED: Must be at most 4096 characters',
    );
    await i18n.changeLanguage('zh-CN');
    expect(getLocalizedErrorMessage(error)).toContain('environment.SEED');
    await i18n.changeLanguage('en');
  });

  it('caps the field list so a large payload does not fill the toast', () => {
    const details = Array.from({ length: 5 }, (_, index) => ({
      field: `environment.VAR_${index}`,
      code: 'VALIDATION_TOO_LONG',
      params: { max: 4096 },
    }));
    const message = getLocalizedErrorMessage({
      response: { data: { code: 'VALIDATION_ERROR', error: 'Invalid request body', details } },
    });
    expect(message).toContain('environment.VAR_0');
    expect(message).not.toContain('environment.VAR_3');
    expect(message.endsWith('(+2)')).toBe(true);
  });

  it('leaves messages without details untouched', () => {
    const error = { response: { data: { code: 'SERVER_NOT_FOUND', error: 'Server not found' } } };
    expect(getLocalizedErrorMessage(error)).toBe('Server not found');
  });

  it('translates field-level validation codes and keeps unknown fields as sent', async () => {
    const error = {
      response: {
        data: {
          code: 'VALIDATION_ERROR',
          error: 'Invalid request parameters',
          details: [
            { field: 'password', message: 'Too short', code: 'VALIDATION_TOO_SHORT', params: { min: 12 } },
            { field: 'memoryMb', message: 'Too small', code: 'VALIDATION_TOO_SMALL', params: { min: 512 } },
            { field: 'engine', message: 'engine must be one of: java, bedrock' },
          ],
        },
      },
    };
    expect(getLocalizedFieldErrors(error)).toEqual([
      { field: 'password', message: 'Must be at least 12 characters' },
      { field: 'memoryMb', message: 'Must be at least 512' },
      { field: 'engine', message: 'engine must be one of: java, bedrock' },
    ]);
    await i18n.changeLanguage('zh-CN');
    const zh = getLocalizedFieldErrors(error);
    expect(zh[0].message).toBe('至少需要 12 个字符');
    // Numeric bounds must not claim to be about characters.
    expect(zh[1].message).toBe('不能小于 512');
    expect(zh[2].message).toBe('engine must be one of: java, bedrock');
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
    await i18n.changeLanguage('fr');
    expect(i18n.t('language.label')).toBe('Langue');
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

  describe('formatTimeSince (elapsed only)', () => {
    const base = new Date('2026-01-01T12:00:00Z');

    it('clamps a future timestamp to "now" instead of rendering a countdown', () => {
      // Server clock 24s ahead of the browser — the reported "Started in 24
      // seconds". The event already happened; the skew is not the user's news.
      expect(formatTimeSince(new Date('2026-01-01T12:00:24Z'), base)).toBe('now');
      expect(formatTimeSince(new Date('2026-01-01T12:05:00Z'), base)).toBe('now');
    });

    it('floors the unit so an age is never overstated', () => {
      // 59.6s must not read "60 seconds ago".
      expect(formatTimeSince(new Date('2026-01-01T11:59:00.400Z'), base)).toBe('59 seconds ago');
      // 89.7s is still "1 minute ago", not "2 minutes ago".
      expect(formatTimeSince(new Date('2026-01-01T11:58:30.300Z'), base)).toBe('1 minute ago');
    });

    it('renders ordinary elapsed readings', () => {
      expect(formatTimeSince(base, base)).toBe('now');
      expect(formatTimeSince(new Date('2026-01-01T11:59:57Z'), base)).toBe('3 seconds ago');
      expect(formatTimeSince(new Date('2026-01-01T09:00:00Z'), base)).toBe('3 hours ago');
      expect(formatTimeSince(new Date('2025-12-30T12:00:00Z'), base)).toBe('2 days ago');
    });

    it('localizes and returns "" for unparseable input', () => {
      expect(formatTimeSince(new Date('2026-01-01T09:00:00Z'), base)).toBe('3 hours ago');
      // `Intl.RelativeTimeFormat.format(NaN)` throws, so the guard matters.
      expect(formatTimeSince('not a date', base)).toBe('');
      expect(formatTimeSince('', base)).toBe('');
    });

    it('localizes the elapsed reading', async () => {
      await i18n.changeLanguage('zh-CN');
      expect(formatTimeSince(new Date('2026-01-01T09:00:00Z'), base)).toBe('3小时前');
      expect(formatTimeSince(new Date('2026-01-01T12:00:24Z'), base)).toBe('现在');
      await i18n.changeLanguage('fr');
      expect(formatTimeSince(new Date('2026-01-01T09:00:00Z'), base)).toBe('il y a 3 heures');
    });
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
