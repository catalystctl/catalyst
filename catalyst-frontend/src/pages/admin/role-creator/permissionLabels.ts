import type { TFunction } from 'i18next';

/**
 * Localized display label for a permission value.
 *
 * The backend catalog ships English labels; the panel translates permission
 * names instead, so every value gets its own key under
 * `roles.permissionLabels`. A value the catalog does not know (plugin-provided)
 * falls back to the label the backend sent, then to a title-cased identifier.
 */
export function formatPermission(
  t: TFunction<'admin-access'>,
  perm: string,
  backendLabel?: string,
): string {
  switch (perm) {
    case 'server.read': return t('roles.permissionLabels.serverRead');
    case 'server.create': return t('roles.permissionLabels.serverCreate');
    case 'server.start': return t('roles.permissionLabels.serverStart');
    case 'server.stop': return t('roles.permissionLabels.serverStop');
    case 'server.kill': return t('roles.permissionLabels.serverKill');
    case 'server.delete': return t('roles.permissionLabels.serverDelete');
    case 'server.suspend': return t('roles.permissionLabels.serverSuspend');
    case 'server.transfer': return t('roles.permissionLabels.serverTransfer');
    case 'server.schedule': return t('roles.permissionLabels.serverSchedule');
    case 'server.update': return t('roles.permissionLabels.serverUpdate');
    case 'server.install': return t('roles.permissionLabels.serverInstall');
    case 'server.reinstall': return t('roles.permissionLabels.serverReinstall');
    case 'server.rebuild': return t('roles.permissionLabels.serverRebuild');
    case 'server.clone': return t('roles.permissionLabels.serverClone');
    case 'server.network': return t('roles.permissionLabels.serverNetwork');
    case 'server.storage': return t('roles.permissionLabels.serverStorage');
    case 'server.archive': return t('roles.permissionLabels.serverArchive');
    case 'server.migrate': return t('roles.permissionLabels.serverMigrate');
    case 'node.read': return t('roles.permissionLabels.nodeRead');
    case 'node.create': return t('roles.permissionLabels.nodeCreate');
    case 'node.update': return t('roles.permissionLabels.nodeUpdate');
    case 'node.delete': return t('roles.permissionLabels.nodeDelete');
    case 'node.view_stats': return t('roles.permissionLabels.nodeViewStats');
    case 'node.manage_allocation': return t('roles.permissionLabels.nodeManageAllocation');
    case 'node.assign': return t('roles.permissionLabels.nodeAssign');
    case 'node.server_manage': return t('roles.permissionLabels.nodeServerManage');
    case 'node.agent_control': return t('roles.permissionLabels.nodeAgentControl');
    case 'location.read': return t('roles.permissionLabels.locationRead');
    case 'location.create': return t('roles.permissionLabels.locationCreate');
    case 'location.update': return t('roles.permissionLabels.locationUpdate');
    case 'location.delete': return t('roles.permissionLabels.locationDelete');
    case 'template.read': return t('roles.permissionLabels.templateRead');
    case 'template.create': return t('roles.permissionLabels.templateCreate');
    case 'template.update': return t('roles.permissionLabels.templateUpdate');
    case 'template.delete': return t('roles.permissionLabels.templateDelete');
    case 'user.read': return t('roles.permissionLabels.userRead');
    case 'user.create': return t('roles.permissionLabels.userCreate');
    case 'user.update': return t('roles.permissionLabels.userUpdate');
    case 'user.delete': return t('roles.permissionLabels.userDelete');
    case 'user.ban': return t('roles.permissionLabels.userBan');
    case 'user.unban': return t('roles.permissionLabels.userUnban');
    case 'user.set_roles': return t('roles.permissionLabels.userSetRoles');
    case 'role.read': return t('roles.permissionLabels.roleRead');
    case 'role.create': return t('roles.permissionLabels.roleCreate');
    case 'role.update': return t('roles.permissionLabels.roleUpdate');
    case 'role.delete': return t('roles.permissionLabels.roleDelete');
    case 'backup.read': return t('roles.permissionLabels.backupRead');
    case 'backup.create': return t('roles.permissionLabels.backupCreate');
    case 'backup.delete': return t('roles.permissionLabels.backupDelete');
    case 'backup.restore': return t('roles.permissionLabels.backupRestore');
    case 'backup.download': return t('roles.permissionLabels.backupDownload');
    case 'file.read': return t('roles.permissionLabels.fileRead');
    case 'file.write': return t('roles.permissionLabels.fileWrite');
    case 'console.read': return t('roles.permissionLabels.consoleRead');
    case 'console.write': return t('roles.permissionLabels.consoleWrite');
    case 'database.create': return t('roles.permissionLabels.databaseCreate');
    case 'database.read': return t('roles.permissionLabels.databaseRead');
    case 'database.delete': return t('roles.permissionLabels.databaseDelete');
    case 'database.rotate': return t('roles.permissionLabels.databaseRotate');
    case 'alert.read': return t('roles.permissionLabels.alertRead');
    case 'alert.create': return t('roles.permissionLabels.alertCreate');
    case 'alert.update': return t('roles.permissionLabels.alertUpdate');
    case 'alert.delete': return t('roles.permissionLabels.alertDelete');
    case 'admin.read': return t('roles.permissionLabels.adminRead');
    case 'admin.write': return t('roles.permissionLabels.adminWrite');
    case 'apikey.manage': return t('roles.permissionLabels.apikeyManage');
    case 'apikey.read': return t('roles.permissionLabels.apikeyRead');
    case 'apikey.write': return t('roles.permissionLabels.apikeyWrite');
    case 'mods.manage': return t('roles.permissionLabels.modsManage');
    case 'plugins.manage': return t('roles.permissionLabels.pluginsManage');
    case 'migration.manage': return t('roles.permissionLabels.migrationManage');
    case 'update.trigger': return t('roles.permissionLabels.updateTrigger');
    case 'diagnostics.download': return t('roles.permissionLabels.diagnosticsDownload');
    default:
      return backendLabel ?? perm.split('.').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' › ');
  }
}

/**
 * Localized label for a built-in permission preset. Keys come from the backend
 * (`PERMISSION_PRESETS`); a preset an operator added under a new key keeps the
 * label the backend sent.
 */
export function presetLabel(
  t: TFunction<'admin-access'>,
  key: string,
  backendLabel?: string,
): string {
  switch (key) {
    case 'administrator': return t('roles.presets.administrator');
    case 'moderator': return t('roles.presets.moderator');
    case 'user': return t('roles.presets.user');
    case 'support': return t('roles.presets.support');
    default: return backendLabel ?? key;
  }
}
