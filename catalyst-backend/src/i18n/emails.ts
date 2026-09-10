import { translatorFor } from './translate.js';
import { DEFAULT_LOCALE, type SupportedLocale } from './locales.js';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Password-reset email, rendered in the recipient's locale. */
export function renderResetPasswordEmail(args: {
  locale?: SupportedLocale;
  panelName: string;
  userName: string;
  url: string;
}): RenderedEmail {
  const t = translatorFor(args.locale ?? DEFAULT_LOCALE);
  // Only the HTML body needs escaping; subjects and the text part carry the
  // raw values so links and names stay copy-pasteable.
  return {
    subject: t('resetPassword.subject', { panelName: args.panelName }),
    html:
      `<p>${escapeHtml(t('resetPassword.greeting', { name: args.userName }))}</p>` +
      `<p>${escapeHtml(t('resetPassword.instruction'))}</p>` +
      `<p><a href="${escapeHtml(args.url)}">${escapeHtml(t('resetPassword.linkLabel'))}</a></p>`,
    text: t('resetPassword.text', { url: args.url }),
  };
}

/** Email-verification email, rendered in the recipient's locale. */
export function renderVerifyEmail(args: {
  locale?: SupportedLocale;
  panelName: string;
  userName: string;
  url: string;
}): RenderedEmail {
  const t = translatorFor(args.locale ?? DEFAULT_LOCALE);
  return {
    subject: t('verifyEmail.subject', { panelName: args.panelName }),
    html:
      `<p>${escapeHtml(t('verifyEmail.greeting', { name: args.userName }))}</p>` +
      `<p>${escapeHtml(t('verifyEmail.instruction'))}</p>` +
      `<p><a href="${escapeHtml(args.url)}">${escapeHtml(t('verifyEmail.linkLabel'))}</a></p>`,
    text: t('verifyEmail.text', { url: args.url }),
  };
}

/** Account-created welcome email, rendered in the recipient's locale. */
export function renderWelcomeEmail(args: {
  locale?: SupportedLocale;
  panelName: string;
  username: string;
}): RenderedEmail {
  const t = translatorFor(args.locale ?? DEFAULT_LOCALE);
  return {
    subject: t('welcome.subject', { panelName: args.panelName }),
    html:
      `<p>${escapeHtml(t('welcome.greeting', { panelName: args.panelName, username: args.username }))}</p>` +
      `<p>${escapeHtml(t('welcome.created'))}</p>` +
      `<p>${escapeHtml(t('welcome.next'))}</p>`,
    text: t('welcome.text', { panelName: args.panelName, username: args.username }),
  };
}
