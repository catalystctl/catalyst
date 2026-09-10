import type { TFunction } from 'i18next';

/**
 * Localized label for a server status value.
 *
 * Uses a switch instead of a status->key map so every translation key is a
 * literal in the source: the extraction tooling can see the keys, and no key is
 * built dynamically. Unknown statuses (plugin-provided states) render as-is.
 */
export function serverStatusLabel(t: TFunction, status: string): string {
  switch (status) {
    case 'stopped':
      return t('common:status.stopped');
    case 'installing':
      return t('common:status.installing');
    case 'starting':
      return t('common:status.starting');
    case 'running':
      return t('common:status.running');
    case 'stopping':
      return t('common:status.stopping');
    case 'crashed':
      return t('common:status.crashed');
    case 'transferring':
      return t('common:status.transferring');
    case 'cloning':
      return t('common:status.cloning');
    case 'suspended':
      return t('common:status.suspended');
    case 'restoring':
      return t('common:status.restoring');
    case 'creating_backup':
      return t('common:status.creatingBackup');
    case 'archived':
      return t('common:status.archived');
    case 'error':
      return t('common:status.error');
    default:
      return status;
  }
}
