/**
 * Action `<select>` options for the scheduled-task dialog. The `ns` option is
 * passed explicitly because this module has no `useTranslation` hook of its
 * own — without it the i18n extractor would file the keys under `common`.
 *
 * The parameter is i18next's own `TFunction` rather than a hand-written
 * `(key, options?) => string`: since i18next 27 the call signature is a tuple
 * union, so the structural type no longer accepts a real `t`.
 */
import type { TFunction } from 'i18next';

export const actionOptions = (
  t: TFunction,
): Array<{ value: 'restart' | 'start' | 'stop' | 'backup' | 'command'; label: string }> => [
  { value: 'restart', label: t('tasks.actions.restart', { ns: 'server-tabs' }) },
  { value: 'start', label: t('tasks.actions.start', { ns: 'server-tabs' }) },
  { value: 'stop', label: t('tasks.actions.stop', { ns: 'server-tabs' }) },
  { value: 'backup', label: t('tasks.actions.backup', { ns: 'server-tabs' }) },
  { value: 'command', label: t('tasks.actions.command', { ns: 'server-tabs' }) },
];
