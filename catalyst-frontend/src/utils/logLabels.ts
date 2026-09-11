import type { TFunction } from 'i18next';

/**
 * Display labels for the audit log and system error pages.
 *
 * The stored values are stable identifiers (`server.start`, `ApiClient`),
 * so each one is mapped through a literal switch: the extraction tooling
 * sees every key, and values the panel does not own (plugin actions, exports
 * from other programs that were fed into the log) render unchanged.
 */

/** `server.bulk_delete` -> `Server Bulk Delete`; used for unknown actions. */
export function prettifyAction(action: string): string {
  return action
    .split(/[._]/g)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Localized label for an audit action key. */
export function auditActionLabel(t: TFunction, action: string): string {
  switch (action) {
    case 'agent.config_update':
      return t('admin-access:audit.actions.agentConfigUpdate');
    case 'agent.restart':
      return t('admin-access:audit.actions.agentRestart');
    case 'agent.update':
      return t('admin-access:audit.actions.agentUpdate');
    case 'api_key.create':
      return t('admin-access:audit.actions.apiKeyCreate');
    case 'api_key.delete':
      return t('admin-access:audit.actions.apiKeyDelete');
    case 'api_key.update':
      return t('admin-access:audit.actions.apiKeyUpdate');
    case 'auth_lockout.delete':
      return t('admin-access:audit.actions.authLockoutDelete');
    case 'cancel-install':
      return t('admin-access:audit.actions.cancelInstall');
    case 'command':
      return t('admin-access:audit.actions.command');
    case 'config_updated':
      return t('admin-access:audit.actions.configUpdated');
    case 'database.create':
      return t('admin-access:audit.actions.databaseCreate');
    case 'database.delete':
      return t('admin-access:audit.actions.databaseDelete');
    case 'database.host.create':
      return t('admin-access:audit.actions.databaseHostCreate');
    case 'database.host.delete':
      return t('admin-access:audit.actions.databaseHostDelete');
    case 'database.host.update':
      return t('admin-access:audit.actions.databaseHostUpdate');
    case 'database.rotate':
      return t('admin-access:audit.actions.databaseRotate');
    case 'file.chmod':
      return t('admin-access:audit.actions.fileChmod');
    case 'file.delete':
      return t('admin-access:audit.actions.fileDelete');
    case 'file.rename':
      return t('admin-access:audit.actions.fileRename');
    case 'file.write':
      return t('admin-access:audit.actions.fileWrite');
    case 'kill':
      return t('admin-access:audit.actions.kill');
    case 'login_failed':
      return t('admin-access:audit.actions.loginFailed');
    case 'login_success':
      return t('admin-access:audit.actions.loginSuccess');
    case 'mod_manager.install':
      return t('admin-access:audit.actions.modManagerInstall');
    case 'mod_manager.settings.update':
      return t('admin-access:audit.actions.modManagerSettingsUpdate');
    case 'mod_manager.uninstall':
      return t('admin-access:audit.actions.modManagerUninstall');
    case 'node.created.wildcard_warning':
      return t('admin-access:audit.actions.nodeCreatedWildcardWarning');
    case 'node.unassign':
      return t('admin-access:audit.actions.nodeUnassign');
    case 'node.unassign_wildcard':
      return t('admin-access:audit.actions.nodeUnassignWildcard');
    case 'oidc_config.update':
      return t('admin-access:audit.actions.oidcConfigUpdate');
    case 'permissions_updated':
      return t('admin-access:audit.actions.permissionsUpdated');
    case 'plugin_manager.install':
      return t('admin-access:audit.actions.pluginManagerInstall');
    case 'plugin_manager.uninstall':
      return t('admin-access:audit.actions.pluginManagerUninstall');
    case 'read':
      return t('admin-access:audit.actions.read');
    case 'reloaded':
      return t('admin-access:audit.actions.reloaded');
    case 'restart':
      return t('admin-access:audit.actions.restart');
    case 'role.create':
      return t('admin-access:audit.actions.roleCreate');
    case 'role.delete':
      return t('admin-access:audit.actions.roleDelete');
    case 'role.permission.add':
      return t('admin-access:audit.actions.rolePermissionAdd');
    case 'role.permission.remove':
      return t('admin-access:audit.actions.rolePermissionRemove');
    case 'role.update':
      return t('admin-access:audit.actions.roleUpdate');
    case 'security.settings.update':
      return t('admin-access:audit.actions.securitySettingsUpdate');
    case 'server.access.remove':
      return t('admin-access:audit.actions.serverAccessRemove');
    case 'server.access.update':
      return t('admin-access:audit.actions.serverAccessUpdate');
    case 'server.archive':
      return t('admin-access:audit.actions.serverArchive');
    case 'server.bulk_delete':
      return t('admin-access:audit.actions.serverBulkDelete');
    case 'server.bulk_suspend':
      return t('admin-access:audit.actions.serverBulkSuspend');
    case 'server.bulk_unsuspend':
      return t('admin-access:audit.actions.serverBulkUnsuspend');
    case 'server.cancel-install':
      return t('admin-access:audit.actions.serverCancelInstall');
    case 'server.clone':
      return t('admin-access:audit.actions.serverClone');
    case 'server.delete':
      return t('admin-access:audit.actions.serverDelete');
    case 'server.import':
      return t('admin-access:audit.actions.serverImport');
    case 'server.invite':
      return t('admin-access:audit.actions.serverInvite');
    case 'server.invite.accept':
      return t('admin-access:audit.actions.serverInviteAccept');
    case 'server.invite.cancel':
      return t('admin-access:audit.actions.serverInviteCancel');
    case 'server.invite.regenerate':
      return t('admin-access:audit.actions.serverInviteRegenerate');
    case 'server.kill':
      return t('admin-access:audit.actions.serverKill');
    case 'server.restart':
      return t('admin-access:audit.actions.serverRestart');
    case 'server.restore':
      return t('admin-access:audit.actions.serverRestore');
    case 'server.start':
      return t('admin-access:audit.actions.serverStart');
    case 'server.stop':
      return t('admin-access:audit.actions.serverStop');
    case 'server.storage.resize':
      return t('admin-access:audit.actions.serverStorageResize');
    case 'server.suspend':
      return t('admin-access:audit.actions.serverSuspend');
    case 'server.transfer_ownership':
      return t('admin-access:audit.actions.serverTransferOwnership');
    case 'server.unsuspend':
      return t('admin-access:audit.actions.serverUnsuspend');
    case 'server.variables_updated':
      return t('admin-access:audit.actions.serverVariablesUpdated');
    case 'smtp_update':
      return t('admin-access:audit.actions.smtpUpdate');
    case 'start':
      return t('admin-access:audit.actions.start');
    case 'stop':
      return t('admin-access:audit.actions.stop');
    case 'theme_settings.update':
      return t('admin-access:audit.actions.themeSettingsUpdate');
    case 'uninstalled':
      return t('admin-access:audit.actions.uninstalled');
    case 'user.role.assign':
      return t('admin-access:audit.actions.userRoleAssign');
    case 'user.role.remove':
      return t('admin-access:audit.actions.userRoleRemove');
    case 'user_ban':
      return t('admin-access:audit.actions.userBan');
    case 'user_create':
      return t('admin-access:audit.actions.userCreate');
    case 'user_delete':
      return t('admin-access:audit.actions.userDelete');
    case 'user_email_verified':
      return t('admin-access:audit.actions.userEmailVerified');
    case 'user_login':
      return t('admin-access:audit.actions.userLogin');
    case 'user_passkeys_wiped':
      return t('admin-access:audit.actions.userPasskeysWiped');
    case 'user_sso_unlinked':
      return t('admin-access:audit.actions.userSsoUnlinked');
    case 'user_unban':
      return t('admin-access:audit.actions.userUnban');
    case 'user_update':
      return t('admin-access:audit.actions.userUpdate');
    default:
      break;
  }

  // `node.assign.<target>` / `node.assign_wildcard.<target>` carry the
  // assignment target in the key itself.
  const assignment = /^node\.assign(_wildcard)?\.(user|role)$/.exec(action);
  if (assignment) {
    const label = assignment[2] === 'user'
      ? t('admin-access:audit.targets.user')
      : t('admin-access:audit.targets.role');
    return assignment[1]
      ? t('admin-access:audit.actionAssignWildcard', { target: label })
      : t('admin-access:audit.actionAssign', { target: label });
  }

  return prettifyAction(action);
}

/** Localized label for an audit resource value. */
export function auditResourceLabel(t: TFunction, resource: string): string {
  switch (resource) {
    case 'alert':
      return t('admin-access:audit.resources.alert');
    case 'apiKeys':
      return t('admin-access:audit.resources.apikeys');
    case 'apikey':
      return t('admin-access:audit.resources.apikey');
    case 'auditLogs':
      return t('admin-access:audit.resources.auditlogs');
    case 'auth':
      return t('admin-access:audit.resources.auth');
    case 'auth_lockout':
      return t('admin-access:audit.resources.authLockout');
    case 'backup':
      return t('admin-access:audit.resources.backup');
    case 'credentials':
      return t('admin-access:audit.resources.credentials');
    case 'database':
      return t('admin-access:audit.resources.database');
    case 'database_host':
      return t('admin-access:audit.resources.databaseHost');
    case 'invite':
      return t('admin-access:audit.resources.invite');
    case 'node':
      return t('admin-access:audit.resources.node');
    case 'oidc_config':
      return t('admin-access:audit.resources.oidcConfig');
    case 'role':
      return t('admin-access:audit.resources.role');
    case 'security':
      return t('admin-access:audit.resources.security');
    case 'server':
      return t('admin-access:audit.resources.server');
    case 'session':
      return t('admin-access:audit.resources.session');
    case 'smtp':
      return t('admin-access:audit.resources.smtp');
    case 'system':
      return t('admin-access:audit.resources.system');
    case 'template':
      return t('admin-access:audit.resources.template');
    case 'user':
      return t('admin-access:audit.resources.user');
    default:
      return resource;
  }
}

/** Localized label for a detail field in the audit log view. */
export function auditDetailLabel(t: TFunction, key: string): string {
  switch (key) {
    case 'accentColor':
      return t('admin-access:audit.detailLabels.accentColor');
    case 'after':
      return t('admin-access:audit.detailLabels.after');
    case 'agentCleanup':
      return t('admin-access:audit.detailLabels.agentCleanup');
    case 'allPermissions':
      return t('admin-access:audit.detailLabels.allPermissions');
    case 'allocatedCpuCores':
      return t('admin-access:audit.detailLabels.allocatedCpuCores');
    case 'allocatedDiskMb':
      return t('admin-access:audit.detailLabels.allocatedDiskMb');
    case 'allocatedMemoryMb':
      return t('admin-access:audit.detailLabels.allocatedMemoryMb');
    case 'assignmentId':
      return t('admin-access:audit.detailLabels.assignmentId');
    case 'before':
      return t('admin-access:audit.detailLabels.before');
    case 'bulk':
      return t('admin-access:audit.detailLabels.bulk');
    case 'bulkAction':
      return t('admin-access:audit.detailLabels.bulkAction');
    case 'changes':
      return t('admin-access:audit.detailLabels.changes');
    case 'containerId':
      return t('admin-access:audit.detailLabels.containerId');
    case 'count':
      return t('admin-access:audit.detailLabels.count');
    case 'curseforgeConfigured':
      return t('admin-access:audit.detailLabels.curseforgeConfigured');
    case 'customCss':
      return t('admin-access:audit.detailLabels.customCss');
    case 'defaultTheme':
      return t('admin-access:audit.detailLabels.defaultTheme');
    case 'email':
      return t('admin-access:audit.detailLabels.email');
    case 'enabledThemes':
      return t('admin-access:audit.detailLabels.enabledThemes');
    case 'engine':
      return t('admin-access:audit.detailLabels.engine');
    case 'expiresAt':
      return t('admin-access:audit.detailLabels.expiresAt');
    case 'faviconUrl':
      return t('admin-access:audit.detailLabels.faviconUrl');
    case 'force':
      return t('admin-access:audit.detailLabels.force');
    case 'from':
      return t('admin-access:audit.detailLabels.from');
    case 'host':
      return t('admin-access:audit.detailLabels.host');
    case 'ip':
      return t('admin-access:audit.detailLabels.ip');
    case 'ipAddress':
      return t('admin-access:audit.detailLabels.ipAddress');
    case 'isPrimary':
      return t('admin-access:audit.detailLabels.isPrimary');
    case 'logoUrl':
      return t('admin-access:audit.detailLabels.logoUrl');
    case 'maxConnections':
      return t('admin-access:audit.detailLabels.maxConnections');
    case 'maxMessages':
      return t('admin-access:audit.detailLabels.maxMessages');
    case 'message':
      return t('admin-access:audit.detailLabels.message');
    case 'metadata':
      return t('admin-access:audit.detailLabels.metadata');
    case 'modrinthConfigured':
      return t('admin-access:audit.detailLabels.modrinthConfigured');
    case 'name':
      return t('admin-access:audit.detailLabels.name');
    case 'networkMode':
      return t('admin-access:audit.detailLabels.networkMode');
    case 'newOwnerEmail':
      return t('admin-access:audit.detailLabels.newOwnerEmail');
    case 'newOwnerId':
      return t('admin-access:audit.detailLabels.newOwnerId');
    case 'newOwnerUsername':
      return t('admin-access:audit.detailLabels.newOwnerUsername');
    case 'newStatus':
      return t('admin-access:audit.detailLabels.newStatus');
    case 'nodeAddress':
      return t('admin-access:audit.detailLabels.nodeAddress');
    case 'nodeId':
      return t('admin-access:audit.detailLabels.nodeId');
    case 'nodeName':
      return t('admin-access:audit.detailLabels.nodeName');
    case 'nodeOnline':
      return t('admin-access:audit.detailLabels.nodeOnline');
    case 'outcome':
      return t('admin-access:audit.detailLabels.outcome');
    case 'ownerId':
      return t('admin-access:audit.detailLabels.ownerId');
    case 'panelName':
      return t('admin-access:audit.detailLabels.panelName');
    case 'path':
      return t('admin-access:audit.detailLabels.path');
    case 'permissionCount':
      return t('admin-access:audit.detailLabels.permissionCount');
    case 'permissions':
      return t('admin-access:audit.detailLabels.permissions');
    case 'pool':
      return t('admin-access:audit.detailLabels.pool');
    case 'port':
      return t('admin-access:audit.detailLabels.port');
    case 'powerResult':
      return t('admin-access:audit.detailLabels.powerResult');
    case 'previousOwnerId':
      return t('admin-access:audit.detailLabels.previousOwnerId');
    case 'previousStatus':
      return t('admin-access:audit.detailLabels.previousStatus');
    case 'previousSuspensionReason':
      return t('admin-access:audit.detailLabels.previousSuspensionReason');
    case 'previousVersion':
      return t('admin-access:audit.detailLabels.previousVersion');
    case 'primaryColor':
      return t('admin-access:audit.detailLabels.primaryColor');
    case 'primaryIp':
      return t('admin-access:audit.detailLabels.primaryIp');
    case 'primaryPort':
      return t('admin-access:audit.detailLabels.primaryPort');
    case 'providers':
      return t('admin-access:audit.detailLabels.providers');
    case 'publicAddress':
      return t('admin-access:audit.detailLabels.publicAddress');
    case 'reason':
      return t('admin-access:audit.detailLabels.reason');
    case 'replyTo':
      return t('admin-access:audit.detailLabels.replyTo');
    case 'requestId':
      return t('admin-access:audit.detailLabels.requestId');
    case 'requireTls':
      return t('admin-access:audit.detailLabels.requireTls');
    case 'roleId':
      return t('admin-access:audit.detailLabels.roleId');
    case 'scope':
      return t('admin-access:audit.detailLabels.scope');
    case 'secondaryColor':
      return t('admin-access:audit.detailLabels.secondaryColor');
    case 'secure':
      return t('admin-access:audit.detailLabels.secure');
    case 'serverId':
      return t('admin-access:audit.detailLabels.serverId');
    case 'serverName':
      return t('admin-access:audit.detailLabels.serverName');
    case 'serverUuid':
      return t('admin-access:audit.detailLabels.serverUuid');
    case 'size':
      return t('admin-access:audit.detailLabels.size');
    case 'slug':
      return t('admin-access:audit.detailLabels.slug');
    case 'source':
      return t('admin-access:audit.detailLabels.source');
    case 'status':
      return t('admin-access:audit.detailLabels.status');
    case 'stopServer':
      return t('admin-access:audit.detailLabels.stopServer');
    case 'success':
      return t('admin-access:audit.detailLabels.success');
    case 'suspendedAt':
      return t('admin-access:audit.detailLabels.suspendedAt');
    case 'suspensionReason':
      return t('admin-access:audit.detailLabels.suspensionReason');
    case 'targetId':
      return t('admin-access:audit.detailLabels.targetId');
    case 'targetType':
      return t('admin-access:audit.detailLabels.targetType');
    case 'targetVersion':
      return t('admin-access:audit.detailLabels.targetVersion');
    case 'tasksDisabled':
      return t('admin-access:audit.detailLabels.tasksDisabled');
    case 'tasksReEnabled':
      return t('admin-access:audit.detailLabels.tasksReEnabled');
    case 'templateId':
      return t('admin-access:audit.detailLabels.templateId');
    case 'templateName':
      return t('admin-access:audit.detailLabels.templateName');
    case 'timestamp':
      return t('admin-access:audit.detailLabels.timestamp');
    case 'updatedCount':
      return t('admin-access:audit.detailLabels.updatedCount');
    case 'updatedKeys':
      return t('admin-access:audit.detailLabels.updatedKeys');
    case 'userAgent':
      return t('admin-access:audit.detailLabels.userAgent');
    case 'userId':
      return t('admin-access:audit.detailLabels.userId');
    case 'username':
      return t('admin-access:audit.detailLabels.username');
    case 'uuid':
      return t('admin-access:audit.detailLabels.uuid');
    case 'value':
      return t('admin-access:audit.detailLabels.value');
    case 'version':
      return t('admin-access:audit.detailLabels.version');
    case 'warning':
      return t('admin-access:audit.detailLabels.warning');
    case 'wasRunning':
      return t('admin-access:audit.detailLabels.wasRunning');
    case 'wildcard':
      return t('admin-access:audit.detailLabels.wildcard');
    default:
      return key;
  }
}

/** Localized label for a system error component. */
export function systemErrorComponentLabel(t: TFunction, component: string): string {
  switch (component) {
    case 'AdminRoutes':
      return t('admin-system:systemErrors.components.adminroutes');
    case 'AlertService':
      return t('admin-system:systemErrors.components.alertservice');
    case 'ApiAuth':
      return t('admin-system:systemErrors.components.apiauth');
    case 'ApiClient':
      return t('admin-system:systemErrors.components.apiclient');
    case 'ApiConsole':
      return t('admin-system:systemErrors.components.apiconsole');
    case 'ApiFiles':
      return t('admin-system:systemErrors.components.apifiles');
    case 'ApiKeyRoutes':
      return t('admin-system:systemErrors.components.apikeyroutes');
    case 'ApiProfile':
      return t('admin-system:systemErrors.components.apiprofile');
    case 'App':
      return t('admin-system:systemErrors.components.app');
    case 'AuditMiddleware':
      return t('admin-system:systemErrors.components.auditmiddleware');
    case 'AuditRetention':
      return t('admin-system:systemErrors.components.auditretention');
    case 'Auth':
      return t('admin-system:systemErrors.components.auth');
    case 'AuthHooks':
      return t('admin-system:systemErrors.components.authhooks');
    case 'AuthRetention':
      return t('admin-system:systemErrors.components.authretention');
    case 'AuthRoutes':
      return t('admin-system:systemErrors.components.authroutes');
    case 'AuthStore:login':
      return t('admin-system:systemErrors.components.authstoreLogin');
    case 'AuthStore:refresh':
      return t('admin-system:systemErrors.components.authstoreRefresh');
    case 'AuthStore:register':
      return t('admin-system:systemErrors.components.authstoreRegister');
    case 'AuthStore:verify2FA':
      return t('admin-system:systemErrors.components.authstoreVerify2FA');
    case 'AutoUpdater':
      return t('admin-system:systemErrors.components.autoupdater');
    case 'BackupRetention':
      return t('admin-system:systemErrors.components.backupretention');
    case 'BackupRoutes':
      return t('admin-system:systemErrors.components.backuproutes');
    case 'BackupSection':
      return t('admin-system:systemErrors.components.backupsection');
    case 'BackupService':
      return t('admin-system:systemErrors.components.backupservice');
    case 'Bootstrap':
      return t('admin-system:systemErrors.components.bootstrap');
    case 'CloneFiles':
      return t('admin-system:systemErrors.components.clonefiles');
    case 'ConsoleStream':
      return t('admin-system:systemErrors.components.consolestream');
    case 'CreateTaskModal':
      return t('admin-system:systemErrors.components.createtaskmodal');
    case 'EditApiKeyDialog':
      return t('admin-system:systemErrors.components.editapikeydialog');
    case 'FileManager':
      return t('admin-system:systemErrors.components.filemanager');
    case 'FileTunnel':
      return t('admin-system:systemErrors.components.filetunnel');
    case 'FileTunnelRoutes':
      return t('admin-system:systemErrors.components.filetunnelroutes');
    case 'ForgotPasswordPage':
      return t('admin-system:systemErrors.components.forgotpasswordpage');
    case 'GlobalWindowError':
      return t('admin-system:systemErrors.components.globalwindowerror');
    case 'HTTP':
      return t('admin-system:systemErrors.components.http');
    case 'Index':
      return t('admin-system:systemErrors.components.index');
    case 'InvitesPage':
      return t('admin-system:systemErrors.components.invitespage');
    case 'LogRetention':
      return t('admin-system:systemErrors.components.logretention');
    case 'LoginPage':
      return t('admin-system:systemErrors.components.loginpage');
    case 'MetricsRetention':
      return t('admin-system:systemErrors.components.metricsretention');
    case 'MigrationRoutes':
      return t('admin-system:systemErrors.components.migrationroutes');
    case 'MigrationService':
      return t('admin-system:systemErrors.components.migrationservice');
    case 'NodeAssignmentModal':
      return t('admin-system:systemErrors.components.nodeassignmentmodal');
    case 'NodeAssignmentsSelector':
      return t('admin-system:systemErrors.components.nodeassignmentsselector');
    case 'NodeDetailsPage':
      return t('admin-system:systemErrors.components.nodedetailspage');
    case 'NodeRoutes':
      return t('admin-system:systemErrors.components.noderoutes');
    case 'NodeService':
      return t('admin-system:systemErrors.components.nodeservice');
    case 'PathValidation':
      return t('admin-system:systemErrors.components.pathvalidation');
    case 'PluginApi':
      return t('admin-system:systemErrors.components.pluginapi');
    case 'PluginGateway':
      return t('admin-system:systemErrors.components.plugingateway');
    case 'PluginLoader':
      return t('admin-system:systemErrors.components.pluginloader');
    case 'PluginProvider':
      return t('admin-system:systemErrors.components.pluginprovider');
    case 'PluginSecurity':
      return t('admin-system:systemErrors.components.pluginsecurity');
    case 'PluginTaskScheduler':
      return t('admin-system:systemErrors.components.plugintaskscheduler');
    case 'PluginValidator':
      return t('admin-system:systemErrors.components.pluginvalidator');
    case 'PluginWebSocket':
      return t('admin-system:systemErrors.components.pluginwebsocket');
    case 'Process':
      return t('admin-system:systemErrors.components.process');
    case 'ReactErrorBoundary':
      return t('admin-system:systemErrors.components.reacterrorboundary');
    case 'Redis':
      return t('admin-system:systemErrors.components.redis');
    case 'RegisterPage':
      return t('admin-system:systemErrors.components.registerpage');
    case 'ResetPasswordPage':
      return t('admin-system:systemErrors.components.resetpasswordpage');
    case 'ServerAdminTab':
      return t('admin-system:systemErrors.components.serveradmintab');
    case 'ServerConfigurationTab':
      return t('admin-system:systemErrors.components.serverconfigurationtab');
    case 'ServerDetailsPage':
      return t('admin-system:systemErrors.components.serverdetailspage');
    case 'ServerModManagerTab':
      return t('admin-system:systemErrors.components.servermodmanagertab');
    case 'ServerPluginManagerTab':
      return t('admin-system:systemErrors.components.serverpluginmanagertab');
    case 'ServerRoutes':
      return t('admin-system:systemErrors.components.serverroutes');
    case 'ServerSettingsTab':
      return t('admin-system:systemErrors.components.serversettingstab');
    case 'ServerStorageResize':
      return t('admin-system:systemErrors.components.serverstorageresize');
    case 'SetupPage':
      return t('admin-system:systemErrors.components.setuppage');
    case 'SetupRoutes':
      return t('admin-system:systemErrors.components.setuproutes');
    case 'StatRetention':
      return t('admin-system:systemErrors.components.statretention');
    case 'StuckBackupStateWatchdog':
      return t('admin-system:systemErrors.components.stuckbackupstatewatchdog');
    case 'SystemErrorLogger':
      return t('admin-system:systemErrors.components.systemerrorlogger');
    case 'TaskScheduler':
      return t('admin-system:systemErrors.components.taskscheduler');
    case 'TemplateCreateModal':
      return t('admin-system:systemErrors.components.templatecreatemodal');
    case 'TemplateEditModal':
      return t('admin-system:systemErrors.components.templateeditmodal');
    case 'UnhandledRejection':
      return t('admin-system:systemErrors.components.unhandledrejection');
    case 'WebSocketGateway':
      return t('admin-system:systemErrors.components.websocketgateway');
    case 'WebhookService':
      return t('admin-system:systemErrors.components.webhookservice');
    case 'backend':
      return t('admin-system:systemErrors.components.backend');
    case 'backup':
      return t('admin-system:systemErrors.components.backup');
    case 'configFormats':
      return t('admin-system:systemErrors.components.configformats');
    case 'form':
      return t('admin-system:systemErrors.components.form');
    case 'frontend':
      return t('admin-system:systemErrors.components.frontend');
    case 'loader':
      return t('admin-system:systemErrors.components.loader');
    case 'plugin-api':
      return t('admin-system:systemErrors.components.pluginApi');
    case 'useAuthInit':
      return t('admin-system:systemErrors.components.useauthinit');
    case 'useFileManager':
      return t('admin-system:systemErrors.components.usefilemanager');
    case 'useNodes':
      return t('admin-system:systemErrors.components.usenodes');
    case 'useServer':
      return t('admin-system:systemErrors.components.useserver');
    case 'useServerDatabases':
      return t('admin-system:systemErrors.components.useserverdatabases');
    case 'useServerMetricsHistory':
      return t('admin-system:systemErrors.components.useservermetricshistory');
    case 'useSseConsole':
      return t('admin-system:systemErrors.components.usesseconsole');
    case 'useTasks':
      return t('admin-system:systemErrors.components.usetasks');
    case 'useTemplates':
      return t('admin-system:systemErrors.components.usetemplates');
    default:
      break;
  }

  // React Query mutations report as `Mutation:<component>`.
  if (component.startsWith('Mutation:')) {
    return t('admin-system:systemErrors.componentMutation', { name: component.slice('Mutation:'.length) });
  }

  // The node agent reports as `agent:<part>` (install jobs append an id).
  if (component.startsWith('agent:')) {
    const rest = component.slice('agent:'.length);
    const [part, ...tail] = rest.split(':');
    const suffix = tail.length > 0 ? `:${tail.join(':')}` : '';
    switch (part) {
      case 'install_server':
        return t('admin-system:systemErrors.agentParts.installServer') + suffix;
      case 'message_handler':
        return t('admin-system:systemErrors.agentParts.messageHandler') + suffix;
      case 'sftp_server':
        return t('admin-system:systemErrors.agentParts.sftpServer') + suffix;
      case 'websocket':
        return t('admin-system:systemErrors.agentParts.websocket') + suffix;
      default:
        return component;
    }
  }

  return component;
}

/** Localized label for a system error metadata key. */
export function systemErrorMetadataLabel(t: TFunction, key: string): string {
  switch (key) {
    case 'action':
      return t('admin-system:systemErrors.metadataKeys.action');
    case 'attempts':
      return t('admin-system:systemErrors.metadataKeys.attempts');
    case 'clientId':
      return t('admin-system:systemErrors.metadataKeys.clientId');
    case 'code':
      return t('admin-system:systemErrors.metadataKeys.code');
    case 'command':
      return t('admin-system:systemErrors.metadataKeys.command');
    case 'component':
      return t('admin-system:systemErrors.metadataKeys.component');
    case 'componentStack':
      return t('admin-system:systemErrors.metadataKeys.componentStack');
    case 'context':
      return t('admin-system:systemErrors.metadataKeys.context');
    case 'count':
      return t('admin-system:systemErrors.metadataKeys.count');
    case 'duration':
      return t('admin-system:systemErrors.metadataKeys.duration');
    case 'email':
      return t('admin-system:systemErrors.metadataKeys.email');
    case 'error':
      return t('admin-system:systemErrors.metadataKeys.error');
    case 'errorCode':
      return t('admin-system:systemErrors.metadataKeys.errorCode');
    case 'file':
      return t('admin-system:systemErrors.metadataKeys.file');
    case 'host':
      return t('admin-system:systemErrors.metadataKeys.host');
    case 'ip':
      return t('admin-system:systemErrors.metadataKeys.ip');
    case 'kind':
      return t('admin-system:systemErrors.metadataKeys.kind');
    case 'method':
      return t('admin-system:systemErrors.metadataKeys.method');
    case 'mutationKey':
      return t('admin-system:systemErrors.metadataKeys.mutationKey');
    case 'nodeId':
      return t('admin-system:systemErrors.metadataKeys.nodeId');
    case 'path':
      return t('admin-system:systemErrors.metadataKeys.path');
    case 'plugin':
      return t('admin-system:systemErrors.metadataKeys.plugin');
    case 'pluginName':
      return t('admin-system:systemErrors.metadataKeys.pluginName');
    case 'port':
      return t('admin-system:systemErrors.metadataKeys.port');
    case 'provider':
      return t('admin-system:systemErrors.metadataKeys.provider');
    case 'reportedLevel':
      return t('admin-system:systemErrors.metadataKeys.reportedLevel');
    case 'requestId':
      return t('admin-system:systemErrors.metadataKeys.requestId');
    case 'serverId':
      return t('admin-system:systemErrors.metadataKeys.serverId');
    case 'size':
      return t('admin-system:systemErrors.metadataKeys.size');
    case 'sourceComponent':
      return t('admin-system:systemErrors.metadataKeys.sourceComponent');
    case 'stack':
      return t('admin-system:systemErrors.metadataKeys.stack');
    case 'status':
      return t('admin-system:systemErrors.metadataKeys.status');
    case 'statusCode':
      return t('admin-system:systemErrors.metadataKeys.statusCode');
    case 'type':
      return t('admin-system:systemErrors.metadataKeys.type');
    case 'url':
      return t('admin-system:systemErrors.metadataKeys.url');
    case 'userAgent':
      return t('admin-system:systemErrors.metadataKeys.userAgent');
    case 'userId':
      return t('admin-system:systemErrors.metadataKeys.userId');
    default:
      return key;
  }
}

/**
 * Localized text for a stored error message.
 *
 * Messages the panel produces are translated: exact strings it reports and the
 * shapes its own code and the node agent emit (timeouts, failed requests,
 * container and file-system errors, plugin loading, JavaScript runtime errors).
 * Where a message carries a detail, the prefix is translated and the recorded
 * remainder is kept verbatim, so the entry stays traceable to the code. Anything
 * else — driver output, stack text, exporter errors — is shown exactly as it was
 * recorded.
 */
export function systemErrorMessage(t: TFunction, message: string): string {
  switch (message) {
    // Unauthorized
    case "Unauthorized":
      return t('admin-system:systemErrors.messages.unauthorized');
    // Forbidden
    case "Forbidden":
      return t('admin-system:systemErrors.messages.forbidden');
    // Network error
    case "Network Error":
      return t('admin-system:systemErrors.messages.networkError');
    // Network error
    case "Failed to fetch":
      return t('admin-system:systemErrors.messages.networkError');
    // Boot loading timed out, continuing without blocking on init
    case "Boot loading timed out, continuing without blocking on init":
      return t('admin-system:systemErrors.messages.bootTimedOut');
    // Invalid or expired token
    case "Invalid or expired token":
      return t('admin-system:systemErrors.messages.invalidToken');
    // Failed to reset password
    case "Failed to reset password":
      return t('admin-system:systemErrors.messages.resetPasswordFailed');
    // Failed to load sessions
    case "Failed to load sessions":
      return t('admin-system:systemErrors.messages.loadSessionsFailed');
    // Missing server ID
    case "Missing server id":
      return t('admin-system:systemErrors.messages.missingServerId');
    // Missing ID
    case "Missing id":
      return t('admin-system:systemErrors.messages.missingId');
    // Please select a target
    case "Please select a target":
      return t('admin-system:systemErrors.messages.selectTarget');
    // Retention count must be 0 or more
    case "Retention count must be 0 or more":
      return t('admin-system:systemErrors.messages.retentionCountInvalid');
    // Retention days must be 0 or more
    case "Retention days must be 0 or more":
      return t('admin-system:systemErrors.messages.retentionDaysInvalid');
    // S3 bucket is required
    case "S3 bucket is required":
      return t('admin-system:systemErrors.messages.s3BucketRequired');
    // S3 region is required
    case "S3 region is required":
      return t('admin-system:systemErrors.messages.s3RegionRequired');
    // S3 access key ID is required
    case "S3 access key ID is required":
      return t('admin-system:systemErrors.messages.s3AccessKeyRequired');
    // S3 secret access key is required
    case "S3 secret access key is required":
      return t('admin-system:systemErrors.messages.s3SecretKeyRequired');
    // SFTP host is required
    case "SFTP host is required":
      return t('admin-system:systemErrors.messages.sftpHostRequired');
    // SFTP username is required
    case "SFTP username is required":
      return t('admin-system:systemErrors.messages.sftpUsernameRequired');
    // SFTP password or private key is required
    case "SFTP password or private key is required":
      return t('admin-system:systemErrors.messages.sftpCredentialRequired');
    // SFTP port must be between 1 and 65535
    case "SFTP port must be between 1 and 65535":
      return t('admin-system:systemErrors.messages.sftpPortInvalid');
    // The docker CLI is not available in the backend container (spawn docker ENOENT). Use a backend image that includes docker-cli and mount /var/run/docker.sock.
    case "docker CLI is not available in the backend container (spawn docker ENOENT). Use a backend image that includes docker-cli and mount /var/run/docker.sock.":
      return t('admin-system:systemErrors.messages.dockerCliMissing');
    // Validation failed
    case "Validation failed":
      return t('admin-system:systemErrors.messages.validationFailed');
    // Invalid credentials
    case "Invalid credentials":
      return t('admin-system:systemErrors.messages.invalidCredentials');
    // Server is suspended
    case "Server is suspended":
      return t('admin-system:systemErrors.messages.serverSuspended');
    // Node is offline
    case "Node is offline":
      return t('admin-system:systemErrors.messages.nodeOffline');
    // Agent did not respond to ping
    case "Agent did not respond to ping":
      return t('admin-system:systemErrors.messages.agentPingUnreachable');
    // Agent offline during delete — container/data cleanup will be skipped
    case "Agent offline during delete — container/data cleanup will be skipped":
      return t('admin-system:systemErrors.messages.agentOfflineDuringDelete');
    // Failed to request logs from agent
    case "Failed to request logs from agent":
      return t('admin-system:systemErrors.messages.requestLogsFailed');
    // Failed to retrieve agent config
    case "Failed to retrieve agent config":
      return t('admin-system:systemErrors.messages.agentConfigFailed');
    // Failed to send resize command to agent
    case "Failed to send resize command to agent":
      return t('admin-system:systemErrors.messages.resizeCommandFailed');
    // Failed to link SSO account
    case "Failed to link SSO account":
      return t('admin-system:systemErrors.messages.linkSsoFailed');
    // Failed to load SSO accounts
    case "Failed to load SSO accounts":
      return t('admin-system:systemErrors.messages.loadSsoAccountsFailed');
    // Failed to load passkeys
    case "Failed to load passkeys":
      return t('admin-system:systemErrors.messages.loadPasskeysFailed');
    default:
      break;
  }

  const requestFailed = /^Request failed \((\d{3})\)$/.exec(message);
  if (requestFailed) return t('admin-system:systemErrors.messages.requestFailed', { status: requestFailed[1] });

  const requestTimedOut = /^Request timed out after (\d+)ms: (\S+) (.+)$/.exec(message);
  if (requestTimedOut) return t('admin-system:systemErrors.messages.requestTimedOut', { ms: requestTimedOut[1], method: requestTimedOut[2], url: requestTimedOut[3] });

  const pluginManifestRead = /^Failed to read\/validate plugin manifest: ([\s\S]*)$/.exec(message);
  if (pluginManifestRead) return t('admin-system:systemErrors.messages.pluginManifestRead', { detail: pluginManifestRead[1] });

  const pluginManifestInvalid = /^Manifest validation error: ([\s\S]*)$/.exec(message);
  if (pluginManifestInvalid) return t('admin-system:systemErrors.messages.pluginManifestInvalid', { detail: pluginManifestInvalid[1] });

  const cannotReadProperty = /^Cannot read properties of (undefined|null) \(reading '([^']+)'\)$/.exec(message);
  if (cannotReadProperty) return t('admin-system:systemErrors.messages.cannotReadProperty', { target: cannotReadProperty[1], property: cannotReadProperty[2] });

  const cannotSetProperty = /^Cannot set properties of (undefined|null) \(setting '([^']+)'\)$/.exec(message);
  if (cannotSetProperty) return t('admin-system:systemErrors.messages.cannotSetProperty', { target: cannotSetProperty[1], property: cannotSetProperty[2] });

  const notDefined = /^(.+) is not defined$/.exec(message);
  if (notDefined) return t('admin-system:systemErrors.messages.notDefined', { name: notDefined[1] });

  const notAFunction = /^(.+) is not a function$/.exec(message);
  if (notAFunction) return t('admin-system:systemErrors.messages.notAFunction', { name: notAFunction[1] });

  const mutationFailed = /^Mutation failed: ([\s\S]*)$/.exec(message);
  if (mutationFailed) return t('admin-system:systemErrors.messages.mutationFailed', { detail: mutationFailed[1] });

  const agentNotConnected = /^Agent (\S+) not connected$/.exec(message);
  if (agentNotConnected) return t('admin-system:systemErrors.messages.agentNotConnected', { id: agentNotConnected[1] });

  const nodeStatusUpdateFailed = /^Failed to update node status on disconnect: (\S+)$/.exec(message);
  if (nodeStatusUpdateFailed) return t('admin-system:systemErrors.messages.nodeStatusUpdateFailed', { id: nodeStatusUpdateFailed[1] });

  const containerError = /^Container error: ([\s\S]*)$/.exec(message);
  if (containerError) return t('admin-system:systemErrors.messages.containerError', { detail: containerError[1] });

  const fileSystemError = /^File system error: ([\s\S]*)$/.exec(message);
  if (fileSystemError) return t('admin-system:systemErrors.messages.fileSystemError', { detail: fileSystemError[1] });

  const sftpStartFailed = /^SFTP server failed to start: ([\s\S]*)$/.exec(message);
  if (sftpStartFailed) return t('admin-system:systemErrors.messages.sftpStartFailed', { detail: sftpStartFailed[1] });

  const webSocketProtocolError = /^WebSocket protocol error: ([\s\S]*)$/.exec(message);
  if (webSocketProtocolError) return t('admin-system:systemErrors.messages.webSocketProtocolError', { detail: webSocketProtocolError[1] });

  const pluginLoadFailed = /^Failed to load plugin: ([\s\S]*)$/.exec(message);
  if (pluginLoadFailed) return t('admin-system:systemErrors.messages.pluginLoadFailed', { detail: pluginLoadFailed[1] });

  const moduleLoadFailed = /^Failed to fetch dynamically imported module: ([\s\S]*)$/.exec(message);
  if (moduleLoadFailed) return t('admin-system:systemErrors.messages.moduleLoadFailed', { url: moduleLoadFailed[1] });

  const minimumDisk = /^This egg needs at least (\d+) MB of disk\b/.exec(message);
  if (minimumDisk) return t('admin-system:systemErrors.messages.minimumDisk', { minDiskMb: minimumDisk[1] });

  return message;
}
