/**
 * Action `<select>` options for the scheduled-task dialog. The `ns` option is
 * passed explicitly because this module has no `useTranslation` hook of its
 * own — without it the i18n extractor would file the keys under `common`.
 */
export const actionOptions = (
  t: (key: string, options?: Record<string, unknown>) => string,
): Array<{ value: 'restart' | 'start' | 'stop' | 'backup' | 'command'; label: string }> => [
  { value: 'restart', label: t('tasks.actions.restart', { ns: 'server-tabs' }) },
  { value: 'start', label: t('tasks.actions.start', { ns: 'server-tabs' }) },
  { value: 'stop', label: t('tasks.actions.stop', { ns: 'server-tabs' }) },
  { value: 'backup', label: t('tasks.actions.backup', { ns: 'server-tabs' }) },
  { value: 'command', label: t('tasks.actions.command', { ns: 'server-tabs' }) },
];
