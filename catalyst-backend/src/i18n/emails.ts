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
  const panelName = escapeHtml(args.panelName);
  const userName = escapeHtml(args.userName);
  const url = escapeHtml(args.url);
  return {
    subject: t('resetPassword.subject', { panelName }),
    html: `<p>${t('resetPassword.greeting', { name: userName })}</p><p>${t('resetPassword.instruction')}</p><p><a href="${url}">${t('resetPassword.linkLabel')}</a></p>`,
    text: t('resetPassword.text', { url }),
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
  const panelName = escapeHtml(args.panelName);
  const userName = escapeHtml(args.userName);
  const url = escapeHtml(args.url);
  return {
    subject: t('verifyEmail.subject', { panelName }),
    html: `<p>${t('verifyEmail.greeting', { name: userName })}</p><p>${t('verifyEmail.instruction')}</p><p><a href="${url}">${t('verifyEmail.linkLabel')}</a></p>`,
    text: t('verifyEmail.text', { url }),
  };
}

/** Account-created welcome email, rendered in the recipient's locale. */
export function renderWelcomeEmail(args: {
  locale?: SupportedLocale;
  panelName: string;
  username: string;
}): RenderedEmail {
  const t = translatorFor(args.locale ?? DEFAULT_LOCALE);
  const panelName = escapeHtml(args.panelName);
  const username = escapeHtml(args.username);
  return {
    subject: t('welcome.subject', { panelName }),
    html: `<p>${t('welcome.greeting', { panelName, username })}</p><p>${t('welcome.created')}</p><p>${t('welcome.next')}</p>`,
    text: t('welcome.text', { panelName, username }),
  };
}
