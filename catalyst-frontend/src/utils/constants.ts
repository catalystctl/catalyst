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

/**
 * Localized label for a console stream filter. Stream ids come from the agent
 * (`stdout`, `stderr`, `system`, `stdin`); unknown streams render as-is.
 */
export function consoleStreamLabel(t: TFunction, stream: string): string {
  switch (stream) {
    case 'stdout':
      return t('servers:console.streams.stdout');
    case 'stderr':
      return t('servers:console.streams.stderr');
    case 'system':
      return t('servers:console.streams.system');
    case 'stdin':
      return t('servers:console.streams.stdin');
    default:
      return stream;
  }
}

/**
 * Localized label for a role name. Only the roles the installer seeds have a
 * translation; roles an administrator creates or renames render exactly as
 * stored, since that text is their own.
 */
export function roleLabel(t: TFunction, name: string): string {
  switch (name.toLowerCase()) {
    case 'administrator':
      return t('common:roles.administrator');
    case 'moderator':
      return t('common:roles.moderator');
    case 'user':
      return t('common:roles.user');
    default:
      return name;
  }
}

/** Localized label for a seeded role description; custom text renders as stored. */
export function roleDescriptionLabel(t: TFunction, description: string): string {
  switch (description.toLowerCase()) {
    case 'full system access':
      return t('common:roles.description.administrator');
    case 'limited management permissions':
      return t('common:roles.description.moderator');
    case 'standard user access':
      return t('common:roles.description.user');
    default:
      return description;
  }
}
