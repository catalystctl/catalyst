import { describe, expect, it, vi } from 'vitest';

// The renderers read panel settings from the DB; only that lookup is stubbed.
vi.mock('../../db.js', () => ({
  prisma: {
    themeSettings: {
      findUnique: vi.fn().mockResolvedValue({ panelName: 'Catalyst' }),
    },
  },
}));

const { renderResetPasswordEmail, renderVerifyEmail, renderWelcomeEmail } = await import('../emails.js');
const { translate, translatorFor } = await import('../translate.js');
const { resolveUserLocale, isSupportedLocale } = await import('../locales.js');

describe('backend i18n locale resolution', () => {
  it('accepts supported locales and rejects everything else', () => {
    expect(isSupportedLocale('en')).toBe(true);
    expect(isSupportedLocale('zh-CN')).toBe(true);
    expect(isSupportedLocale('zh-TW')).toBe(false);
    expect(isSupportedLocale(undefined)).toBe(false);
  });

  it('reads the locale out of stored user preferences', () => {
    expect(resolveUserLocale({ locale: 'zh-CN' })).toBe('zh-CN');
    expect(resolveUserLocale({ locale: 'de' })).toBe('en');
    expect(resolveUserLocale({})).toBe('en');
    expect(resolveUserLocale(null)).toBe('en');
  });
});

describe('backend i18n translate', () => {
  it('interpolates parameters', () => {
    expect(translate('en', 'welcome.subject', { panelName: 'Catalyst' })).toBe('Welcome to Catalyst');
  });

  it('renders Chinese for zh-CN', () => {
    expect(translate('zh-CN', 'welcome.subject', { panelName: 'Catalyst' })).toBe('欢迎使用 Catalyst');
  });

  it('leaves unknown parameters untouched and falls back to the key', () => {
    expect(translatorFor('en')('welcome.subject')).toBe('Welcome to {{panelName}}');
    expect(translatorFor('en')('does.not.exist')).toBe('does.not.exist');
  });
});

describe('localized account emails', () => {
  it('renders the password reset email in the recipient locale', () => {
    const en = renderResetPasswordEmail({
      locale: 'en',
      panelName: 'Catalyst',
      userName: 'Ada',
      url: 'https://panel.example/reset?token=abc',
    });
    expect(en.subject).toBe('Reset your Catalyst password');
    expect(en.html).toContain('Hello Ada,');
    expect(en.text).toContain('https://panel.example/reset?token=abc');

    const zh = renderResetPasswordEmail({
      locale: 'zh-CN',
      panelName: 'Catalyst',
      userName: '张三',
      url: 'https://panel.example/reset?token=abc',
    });
    expect(zh.subject).toBe('重置您的 Catalyst 密码');
    expect(zh.html).toContain('张三');
    expect(zh.text).toContain('重置');
  });

  it('renders the verification email in the recipient locale', () => {
    expect(renderVerifyEmail({ locale: 'zh-CN', panelName: 'Catalyst', userName: '张三', url: 'https://x/y' }).subject)
      .toBe('验证您的 Catalyst 邮箱');
    expect(renderVerifyEmail({ locale: 'en', panelName: 'Catalyst', userName: 'Ada', url: 'https://x/y' }).subject)
      .toBe('Verify your Catalyst email');
  });

  it('renders the welcome email in the recipient locale and defaults to English', () => {
    const zh = renderWelcomeEmail({ locale: 'zh-CN', panelName: 'Catalyst', username: 'zhangsan' });
    expect(zh.subject).toBe('欢迎使用 Catalyst');
    expect(zh.html).toContain('zhangsan');

    const fallback = renderWelcomeEmail({ panelName: 'Catalyst', username: 'ada' });
    expect(fallback.subject).toBe('Welcome to Catalyst');
  });

  it('keeps URLs raw in the text part and escapes them in HTML', () => {
    const url = 'https://panel.example/reset?token=abc&callbackURL=/dashboard?a=1&b=2';
    const rendered = renderResetPasswordEmail({
      locale: 'en',
      panelName: 'Catalyst',
      userName: 'Ada',
      url,
    });
    // The plain-text part is copy-pasted into a browser, so it must stay raw.
    expect(rendered.text).toContain(url);
    expect(rendered.text).not.toContain('&amp;');
    expect(rendered.html).toContain('&amp;callbackURL');
  });

  it('keeps names raw in subject and text, escaping only the HTML body', () => {
    const rendered = renderWelcomeEmail({
      locale: 'en',
      panelName: 'R&D Panel',
      username: "Ada O'Hara",
    });
    expect(rendered.subject).toBe('Welcome to R&D Panel');
    expect(rendered.text).toContain("Ada O'Hara");
    expect(rendered.html).toContain('R&amp;D Panel');
    expect(rendered.html).toContain('Ada O&#39;Hara');
  });

  it('escapes user-controlled values in HTML bodies', () => {
    const rendered = renderWelcomeEmail({
      locale: 'en',
      panelName: 'Catalyst',
      username: '<script>alert(1)</script>',
    });
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
  });
});
