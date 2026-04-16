#!/usr/bin/env bun
/**
 * Route Schema Generator
 * 
 * Generates inline JSON Schema documentation for all API routes.
 * Run: bun scripts/add-inline-schemas.ts
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const routesDir = resolve(__dirname, '../src/routes');
const docsDir = resolve(__dirname, '../../docs');

// =============================================================================
// COMMON SCHEMAS (JavaScript objects, not strings)
// =============================================================================

const errorResponseSchema = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Error message' },
    details: {
      type: 'array',
      description: 'Validation error details',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string', description: 'Field that failed validation' },
          message: { type: 'string', description: 'Error description' },
        },
      },
    },
  },
};

const paginationQuery = {
  type: 'object',
  properties: {
    page: { type: 'number', default: 1, description: 'Page number' },
    limit: { type: 'number', default: 20, description: 'Items per page' },
    search: { type: 'string', description: 'Search term' },
  },
};

// =============================================================================
// ROUTE DEFINITIONS
// =============================================================================

interface RouteDef {
  file: string;
  method: string;
  path: string;
  summary: string;
  description: string;
  bodySchema?: object;
  paramsSchema?: object;
  querySchema?: object;
  responseCodes?: number[];
  permissions?: string;
}

const ROUTES: RouteDef[] = [
  // Auth routes
  { file: 'auth.ts', method: 'POST', path: '/register', summary: 'Register new user', description: 'Create a new user account with email and password', bodySchema: { type: 'object', properties: { email: { type: 'string', format: 'email' }, username: { type: 'string' }, password: { type: 'string', minLength: 12 } }, required: ['email', 'username', 'password'] }, responseCodes: [201, 400, 409] },
  { file: 'auth.ts', method: 'POST', path: '/login', summary: 'User login', description: 'Authenticate user with email/password. Supports 2FA and passkeys.', bodySchema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' }, rememberMe: { type: 'boolean' } }, required: ['email', 'password'] }, responseCodes: [200, 401] },
  { file: 'auth.ts', method: 'POST', path: '/sign-out', summary: 'Logout', description: 'Sign out the current session', responseCodes: [200] },
  { file: 'auth.ts', method: 'GET', path: '/me', summary: 'Get current user', description: 'Get the currently authenticated user', responseCodes: [200, 401] },
  { file: 'auth.ts', method: 'GET', path: '/profile', summary: 'Get profile', description: 'Get detailed user profile including permissions', responseCodes: [200, 401] },
  { file: 'auth.ts', method: 'POST', path: '/profile/change-password', summary: 'Change password', description: 'Change the authenticated user password', bodySchema: { type: 'object', properties: { currentPassword: { type: 'string' }, newPassword: { type: 'string' } }, required: ['currentPassword', 'newPassword'] }, responseCodes: [200, 400, 401] },
  { file: 'auth.ts', method: 'POST', path: '/profile/set-password', summary: 'Set password', description: 'Set password for SSO accounts without password', bodySchema: { type: 'object', properties: { password: { type: 'string' } }, required: ['password'] }, responseCodes: [200, 400] },
  { file: 'auth.ts', method: 'GET', path: '/profile/two-factor', summary: 'Get 2FA status', description: 'Get two-factor authentication status', responseCodes: [200] },
  { file: 'auth.ts', method: 'POST', path: '/profile/two-factor/enable', summary: 'Enable 2FA', description: 'Enable two-factor authentication', responseCodes: [200, 400] },
  { file: 'auth.ts', method: 'POST', path: '/profile/two-factor/disable', summary: 'Disable 2FA', description: 'Disable two-factor authentication', bodySchema: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] }, responseCodes: [200, 400] },
  { file: 'auth.ts', method: 'POST', path: '/profile/two-factor/generate-backup-codes', summary: 'Generate backup codes', description: 'Generate new backup codes for 2FA', responseCodes: [200] },
  { file: 'auth.ts', method: 'GET', path: '/profile/passkeys', summary: 'List passkeys', description: 'List all registered passkeys', responseCodes: [200] },
  { file: 'auth.ts', method: 'POST', path: '/profile/passkeys', summary: 'Create passkey', description: 'Create registration options for a new passkey', responseCodes: [200] },
  { file: 'auth.ts', method: 'POST', path: '/profile/passkeys/verify', summary: 'Verify passkey', description: 'Verify and save a new passkey', bodySchema: { type: 'object', properties: { credential: { type: 'object' } } }, responseCodes: [200, 400] },
  { file: 'auth.ts', method: 'DELETE', path: '/profile/passkeys/:id', summary: 'Delete passkey', description: 'Delete a registered passkey', paramsSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, responseCodes: [200, 404] },
  { file: 'auth.ts', method: 'PATCH', path: '/profile/passkeys/:id', summary: 'Update passkey', description: 'Update passkey name', paramsSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' } } }, responseCodes: [200] },
  { file: 'auth.ts', method: 'GET', path: '/profile/sso/accounts', summary: 'List SSO accounts', description: 'List linked SSO provider accounts', responseCodes: [200] },
  { file: 'auth.ts', method: 'POST', path: '/profile/sso/link', summary: 'Link SSO', description: 'Link an SSO provider account', bodySchema: { type: 'object', properties: { provider: { type: 'string' } } }, responseCodes: [200, 400] },
  { file: 'auth.ts', method: 'POST', path: '/profile/sso/unlink', summary: 'Unlink SSO', description: 'Unlink an SSO provider account', bodySchema: { type: 'object', properties: { provider: { type: 'string' } } }, responseCodes: [200, 400] },
  { file: 'auth.ts', method: 'POST', path: '/forgot-password', summary: 'Request password reset', description: 'Request a password reset email', bodySchema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] }, responseCodes: [200] },
  { file: 'auth.ts', method: 'GET', path: '/reset-password/validate', summary: 'Validate reset token', description: 'Validate if a password reset token is valid', querySchema: { type: 'object', properties: { token: { type: 'string' } } }, responseCodes: [200, 400] },
  { file: 'auth.ts', method: 'POST', path: '/reset-password', summary: 'Reset password', description: 'Reset password using a token', bodySchema: { type: 'object', properties: { token: { type: 'string' }, password: { type: 'string' } }, required: ['token', 'password'] }, responseCodes: [200, 400] },
  { file: 'auth.ts', method: 'POST', path: '/profile/delete', summary: 'Delete account', description: 'Delete the authenticated user account', bodySchema: { type: 'object', properties: { confirm: { type: 'string' } }, required: ['confirm'] }, responseCodes: [200, 400] },

  // Servers
  { file: 'servers.ts', method: 'POST', path: '/', summary: 'Create server', description: 'Create a new game server instance', bodySchema: { type: 'object', properties: { name: { type: 'string' }, templateId: { type: 'string' }, nodeId: { type: 'string' }, locationId: { type: 'string' }, allocatedMemoryMb: { type: 'number' }, allocatedCpuCores: { type: 'number' }, allocatedDiskMb: { type: 'number' }, primaryPort: { type: 'number' } }, required: ['name', 'templateId', 'nodeId', 'locationId', 'allocatedMemoryMb', 'allocatedCpuCores', 'allocatedDiskMb', 'primaryPort'] }, responseCodes: [201, 400, 403], permissions: 'admin' },
  { file: 'servers.ts', method: 'GET', path: '/', summary: 'List servers', description: 'Get a paginated list of servers', querySchema: paginationQuery, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId', summary: 'Get server', description: 'Get details of a specific server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 404], permissions: 'server.read' },
  { file: 'servers.ts', method: 'PUT', path: '/:serverId', summary: 'Update server', description: 'Update server configuration', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, allocatedMemoryMb: { type: 'number' }, allocatedCpuCores: { type: 'number' }, allocatedDiskMb: { type: 'number' } } }, responseCodes: [200, 400], permissions: 'server.write' },
  { file: 'servers.ts', method: 'DELETE', path: '/:serverId', summary: 'Delete server', description: 'Delete a server and all associated data', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 404], permissions: 'server.delete' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/start', summary: 'Start server', description: 'Start the game server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 400, 404], permissions: 'server.start' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/stop', summary: 'Stop server', description: 'Stop the game server gracefully', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 400, 404], permissions: 'server.stop' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/restart', summary: 'Restart server', description: 'Restart the game server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 400, 404], permissions: 'server.restart' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/kill', summary: 'Kill server', description: 'Force kill the game server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 400, 404], permissions: 'server.stop' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/suspend', summary: 'Suspend server', description: 'Suspend a server (non-payment)', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { reason: { type: 'string' }, stopServer: { type: 'boolean' } } }, responseCodes: [200, 400], permissions: 'admin' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/unsuspend', summary: 'Unsuspend server', description: 'Unsuspend a server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 400], permissions: 'admin' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/install', summary: 'Install server', description: 'Run the install script for a server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 400, 404], permissions: 'server.install' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/reinstall', summary: 'Reinstall server', description: 'Reinstall the server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 400], permissions: 'server.reinstall' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/rebuild', summary: 'Rebuild server', description: 'Rebuild the server container', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 400], permissions: 'server.rebuild' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/transfer', summary: 'Transfer server', description: 'Transfer server to another node', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { targetNodeId: { type: 'string' } }, required: ['targetNodeId'] }, responseCodes: [200, 400], permissions: 'server.transfer' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId/stats/history', summary: 'Get stats history', description: 'Get historical stats for a server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'PUT', path: '/:serverId/storage/resize', summary: 'Resize storage', description: 'Resize server storage allocation', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { allocatedDiskMb: { type: 'number' } }, required: ['allocatedDiskMb'] }, responseCodes: [200], permissions: 'admin' },

  // File operations
  { file: 'servers.ts', method: 'GET', path: '/:serverId/files', summary: 'List files', description: 'List server files', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, querySchema: { type: 'object', properties: { path: { type: 'string' } } }, responseCodes: [200], permissions: 'file.read' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId/files/download', summary: 'Download file', description: 'Download a server file', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 404], permissions: 'file.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/files/upload', summary: 'Upload file', description: 'Upload a file to the server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200, 400], permissions: 'file.write' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/files/create', summary: 'Create file/directory', description: 'Create a new file or directory', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { path: { type: 'string' }, directory: { type: 'boolean' } }, required: ['path'] }, responseCodes: [200, 400], permissions: 'file.write' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/files/write', summary: 'Write file', description: 'Write content to a file', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }, responseCodes: [200, 400], permissions: 'file.write' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/files/compress', summary: 'Compress files', description: 'Compress files into an archive', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, name: { type: 'string' } }, required: ['files', 'name'] }, responseCodes: [200], permissions: 'file.write' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/files/decompress', summary: 'Decompress archive', description: 'Decompress an archive file', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { file: { type: 'string' } }, required: ['file'] }, responseCodes: [200], permissions: 'file.write' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId/logs', summary: 'Get logs', description: 'Get server logs', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, querySchema: { type: 'object', properties: { lines: { type: 'number' }, stream: { type: 'string' } } }, responseCodes: [200], permissions: 'console.read' },
  { file: 'servers.ts', method: 'DELETE', path: '/:serverId/files/delete', summary: 'Delete files', description: 'Delete server files', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } } }, required: ['files'] }, responseCodes: [200], permissions: 'file.delete' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/files/rename', summary: 'Rename file', description: 'Rename a file or directory', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] }, responseCodes: [200], permissions: 'file.write' },

  // Backups
  { file: 'servers.ts', method: 'GET', path: '/:serverId/backups', summary: 'List backups', description: 'Get all backups for a server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'backup.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/backups', summary: 'Create backup', description: 'Create a new backup', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, responseCodes: [201], permissions: 'backup.create' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId/backups/:backupId', summary: 'Get backup', description: 'Get backup details', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, backupId: { type: 'string' } }, required: ['serverId', 'backupId'] }, responseCodes: [200], permissions: 'backup.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/backups/:backupId/restore', summary: 'Restore backup', description: 'Restore a backup', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, backupId: { type: 'string' } }, required: ['serverId', 'backupId'] }, responseCodes: [200], permissions: 'backup.restore' },
  { file: 'servers.ts', method: 'DELETE', path: '/:serverId/backups/:backupId', summary: 'Delete backup', description: 'Delete a backup', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, backupId: { type: 'string' } }, required: ['serverId', 'backupId'] }, responseCodes: [200], permissions: 'backup.delete' },

  // Databases
  { file: 'servers.ts', method: 'GET', path: '/:serverId/databases', summary: 'List databases', description: 'Get server databases', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'database.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/databases', summary: 'Create database', description: 'Create a new database', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, responseCodes: [201], permissions: 'database.create' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/databases/:databaseId/rotate', summary: 'Rotate password', description: 'Rotate database password', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, databaseId: { type: 'string' } }, required: ['serverId', 'databaseId'] }, responseCodes: [200], permissions: 'database.rotate' },
  { file: 'servers.ts', method: 'DELETE', path: '/:serverId/databases/:databaseId', summary: 'Delete database', description: 'Delete a database', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, databaseId: { type: 'string' } }, required: ['serverId', 'databaseId'] }, responseCodes: [200], permissions: 'database.delete' },

  // Access/Permissions
  { file: 'servers.ts', method: 'GET', path: '/:serverId/access', summary: 'List access', description: 'List all users with server access', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/access', summary: 'Grant access', description: 'Grant a user access to the server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { userId: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } }, required: ['userId', 'permissions'] }, responseCodes: [201], permissions: 'server.write' },
  { file: 'servers.ts', method: 'DELETE', path: '/:serverId/access/:targetUserId', summary: 'Revoke access', description: 'Revoke user access to the server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, targetUserId: { type: 'string' } }, required: ['serverId', 'targetUserId'] }, responseCodes: [200], permissions: 'server.write' },

  // Tasks
  { file: 'servers.ts', method: 'POST', path: '/:serverId/tasks', summary: 'Create task', description: 'Create a scheduled task', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, action: { type: 'string' }, cron: { type: 'string' }, payload: { type: 'object' } }, required: ['name', 'action', 'cron'] }, responseCodes: [201], permissions: 'server.write' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId/tasks', summary: 'List tasks', description: 'Get scheduled tasks for server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId/tasks/:taskId', summary: 'Get task', description: 'Get task details', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, taskId: { type: 'string' } }, required: ['serverId', 'taskId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'PUT', path: '/:serverId/tasks/:taskId', summary: 'Update task', description: 'Update a scheduled task', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, taskId: { type: 'string' } }, required: ['serverId', 'taskId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, action: { type: 'string' }, cron: { type: 'string' }, enabled: { type: 'boolean' } } }, responseCodes: [200], permissions: 'server.write' },
  { file: 'servers.ts', method: 'DELETE', path: '/:serverId/tasks/:taskId', summary: 'Delete task', description: 'Delete a scheduled task', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, taskId: { type: 'string' } }, required: ['serverId', 'taskId'] }, responseCodes: [200], permissions: 'server.write' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/tasks/:taskId/execute', summary: 'Execute task', description: 'Execute a task immediately', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, taskId: { type: 'string' } }, required: ['serverId', 'taskId'] }, responseCodes: [200], permissions: 'server.write' },

  // Mod Manager
  { file: 'servers.ts', method: 'GET', path: '/:serverId/mod-manager/search', summary: 'Search mods', description: 'Search for mods', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, querySchema: { type: 'object', properties: { query: { type: 'string' } } }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId/mod-manager/versions', summary: 'Get mod versions', description: 'Get available versions for a mod', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, querySchema: { type: 'object', properties: { modId: { type: 'string' } } }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/mod-manager/install', summary: 'Install mod', description: 'Install a mod', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { modId: { type: 'string' }, version: { type: 'string' } }, required: ['modId'] }, responseCodes: [200], permissions: 'server.write' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId/mod-manager/installed', summary: 'List installed mods', description: 'Get installed mods', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/mod-manager/uninstall', summary: 'Uninstall mod', description: 'Uninstall a mod', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { modId: { type: 'string' } }, required: ['modId'] }, responseCodes: [200], permissions: 'server.write' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/mod-manager/check-updates', summary: 'Check mod updates', description: 'Check for mod updates', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/mod-manager/update', summary: 'Update mod', description: 'Update a mod', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { modId: { type: 'string' } }, required: ['modId'] }, responseCodes: [200], permissions: 'server.write' },

  // Plugin Manager
  { file: 'servers.ts', method: 'GET', path: '/:serverId/plugin-manager/search', summary: 'Search plugins', description: 'Search for plugins', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, querySchema: { type: 'object', properties: { query: { type: 'string' } } }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/plugin-manager/install', summary: 'Install plugin', description: 'Install a plugin', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { pluginId: { type: 'string' }, version: { type: 'string' } }, required: ['pluginId'] }, responseCodes: [200], permissions: 'server.write' },
  { file: 'servers.ts', method: 'GET', path: '/:serverId/plugin-manager/installed', summary: 'List installed plugins', description: 'Get installed plugins', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/plugin-manager/uninstall', summary: 'Uninstall plugin', description: 'Uninstall a plugin', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { pluginId: { type: 'string' } }, required: ['pluginId'] }, responseCodes: [200], permissions: 'server.write' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/plugin-manager/check-updates', summary: 'Check plugin updates', description: 'Check for plugin updates', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/plugin-manager/update', summary: 'Update plugin', description: 'Update a plugin', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { pluginId: { type: 'string' } }, required: ['pluginId'] }, responseCodes: [200], permissions: 'server.write' },

  // Invites
  { file: 'servers.ts', method: 'GET', path: '/:serverId/invites', summary: 'List invites', description: 'List pending server invites', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/invites', summary: 'Create invite', description: 'Create a server invite', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { permissions: { type: 'array', items: { type: 'string' } } } }, responseCodes: [201], permissions: 'server.write' },
  { file: 'servers.ts', method: 'DELETE', path: '/:serverId/invites/:inviteId', summary: 'Delete invite', description: 'Delete a server invite', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, inviteId: { type: 'string' } }, required: ['serverId', 'inviteId'] }, responseCodes: [200], permissions: 'server.write' },
  { file: 'servers.ts', method: 'POST', path: '/invites/accept', summary: 'Accept invite', description: 'Accept a server invite', bodySchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] }, responseCodes: [200] },
  { file: 'servers.ts', method: 'POST', path: '/invites/register', summary: 'Register via invite', description: 'Register and join a server via invite', bodySchema: { type: 'object', properties: { token: { type: 'string' }, email: { type: 'string' }, username: { type: 'string' }, password: { type: 'string' } }, required: ['token', 'email', 'username', 'password'] }, responseCodes: [201] },
  { file: 'servers.ts', method: 'GET', path: '/invites/:token', summary: 'Get invite', description: 'Get invite details', paramsSchema: { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] }, responseCodes: [200] },

  // Archive
  { file: 'servers.ts', method: 'POST', path: '/:serverId/archive', summary: 'Archive server', description: 'Create an archive of the server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, includeBackups: { type: 'boolean' } }, required: ['name'] }, responseCodes: [201], permissions: 'server.write' },
  { file: 'servers.ts', method: 'POST', path: '/:serverId/restore', summary: 'Restore server', description: 'Restore server from an archive', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { archiveId: { type: 'string' } }, required: ['archiveId'] }, responseCodes: [200], permissions: 'server.write' },

  // Nodes
  { file: 'nodes.ts', method: 'GET', path: '/', summary: 'List nodes', description: 'Get all nodes', querySchema: paginationQuery, responseCodes: [200], permissions: 'node.read' },
  { file: 'nodes.ts', method: 'POST', path: '/', summary: 'Create node', description: 'Create a new node', bodySchema: { type: 'object', properties: { name: { type: 'string' }, fqdn: { type: 'string' }, publicAddress: { type: 'string' }, memoryMb: { type: 'number' }, cpuCores: { type: 'number' }, diskMb: { type: 'number' } }, required: ['name', 'fqdn', 'publicAddress', 'memoryMb', 'cpuCores', 'diskMb'] }, responseCodes: [201, 400], permissions: 'admin' },
  { file: 'nodes.ts', method: 'GET', path: '/:nodeId', summary: 'Get node', description: 'Get node details', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, responseCodes: [200, 404], permissions: 'node.read' },
  { file: 'nodes.ts', method: 'PUT', path: '/:nodeId', summary: 'Update node', description: 'Update node configuration', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, fqdn: { type: 'string' }, publicAddress: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'nodes.ts', method: 'DELETE', path: '/:nodeId', summary: 'Delete node', description: 'Delete a node', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, responseCodes: [200, 404], permissions: 'admin' },
  { file: 'nodes.ts', method: 'GET', path: '/:nodeId/stats', summary: 'Get node stats', description: 'Get node resource statistics', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, responseCodes: [200], permissions: 'node.read' },
  { file: 'nodes.ts', method: 'POST', path: '/:nodeId/heartbeat', summary: 'Node heartbeat', description: 'Record node heartbeat', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, bodySchema: { type: 'object', properties: { cpuUsage: { type: 'number' }, memoryUsageMb: { type: 'number' }, diskUsageMb: { type: 'number' } } }, responseCodes: [200] },
  { file: 'nodes.ts', method: 'GET', path: '/:nodeId/allocations', summary: 'List allocations', description: 'Get node IP allocations', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, responseCodes: [200], permissions: 'node.read' },
  { file: 'nodes.ts', method: 'POST', path: '/:nodeId/allocations', summary: 'Create allocation', description: 'Create a new IP allocation', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, bodySchema: { type: 'object', properties: { ip: { type: 'string' }, port: { type: 'number' }, alias: { type: 'string' } }, required: ['ip', 'port'] }, responseCodes: [201], permissions: 'admin' },
  { file: 'nodes.ts', method: 'PATCH', path: '/:nodeId/allocations/:allocationId', summary: 'Update allocation', description: 'Update an allocation', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' }, allocationId: { type: 'string' } }, required: ['nodeId', 'allocationId'] }, bodySchema: { type: 'object', properties: { alias: { type: 'string' }, assignedTo: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'nodes.ts', method: 'DELETE', path: '/:nodeId/allocations/:allocationId', summary: 'Delete allocation', description: 'Delete an allocation', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' }, allocationId: { type: 'string' } }, required: ['nodeId', 'allocationId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'nodes.ts', method: 'GET', path: '/:nodeId/assignments', summary: 'List assignments', description: 'Get server assignments', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, responseCodes: [200], permissions: 'node.read' },
  { file: 'nodes.ts', method: 'POST', path: '/:nodeId/assign', summary: 'Assign server', description: 'Assign a server to an allocation', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, bodySchema: { type: 'object', properties: { serverId: { type: 'string' }, allocationId: { type: 'string' } }, required: ['serverId', 'allocationId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'nodes.ts', method: 'DELETE', path: '/:nodeId/assignments/:assignmentId', summary: 'Unassign server', description: 'Remove server from allocation', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' }, assignmentId: { type: 'string' } }, required: ['nodeId', 'assignmentId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'nodes.ts', method: 'GET', path: '/:nodeId/api-key', summary: 'Get node API key', description: 'Get the API key for a node', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'nodes.ts', method: 'POST', path: '/:nodeId/api-key', summary: 'Regenerate node API key', description: 'Regenerate the API key for a node', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'nodes.ts', method: 'POST', path: '/:nodeId/deployment-token', summary: 'Create deployment token', description: 'Generate a deployment token', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, bodySchema: { type: 'object', properties: { expiresIn: { type: 'number' } } }, responseCodes: [201], permissions: 'admin' },
  { file: 'nodes.ts', method: 'GET', path: '/:nodeId/ip-pools', summary: 'List IP pools', description: 'Get IP pools for a node', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, responseCodes: [200], permissions: 'node.read' },
  { file: 'nodes.ts', method: 'GET', path: '/:nodeId/ip-availability', summary: 'IP availability', description: 'Get IP availability information', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, responseCodes: [200], permissions: 'node.read' },
  { file: 'nodes.ts', method: 'GET', path: '/accessible', summary: 'List accessible nodes', description: 'Get nodes accessible to the current user', responseCodes: [200] },

  // Roles
  { file: 'roles.ts', method: 'GET', path: '/', summary: 'List roles', description: 'Get all roles', responseCodes: [200], permissions: 'role.read' },
  { file: 'roles.ts', method: 'GET', path: '/:roleId', summary: 'Get role', description: 'Get role details', paramsSchema: { type: 'object', properties: { roleId: { type: 'string' } }, required: ['roleId'] }, responseCodes: [200, 404], permissions: 'role.read' },
  { file: 'roles.ts', method: 'POST', path: '/', summary: 'Create role', description: 'Create a new role', bodySchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } }, required: ['name', 'permissions'] }, responseCodes: [201], permissions: 'admin' },
  { file: 'roles.ts', method: 'PUT', path: '/:roleId', summary: 'Update role', description: 'Update a role', paramsSchema: { type: 'object', properties: { roleId: { type: 'string' } }, required: ['roleId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, permissions: { type: 'array', items: { type: 'string' } } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'roles.ts', method: 'DELETE', path: '/:roleId', summary: 'Delete role', description: 'Delete a role', paramsSchema: { type: 'object', properties: { roleId: { type: 'string' } }, required: ['roleId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'roles.ts', method: 'POST', path: '/:roleId/permissions', summary: 'Add permissions', description: 'Add permissions to a role', paramsSchema: { type: 'object', properties: { roleId: { type: 'string' } }, required: ['roleId'] }, bodySchema: { type: 'object', properties: { permissions: { type: 'array', items: { type: 'string' } } }, required: ['permissions'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'roles.ts', method: 'DELETE', path: '/:roleId/permissions/*', summary: 'Remove permissions', description: 'Remove permissions from a role', paramsSchema: { type: 'object', properties: { roleId: { type: 'string' } }, required: ['roleId'] }, querySchema: { type: 'object', properties: { permissions: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'roles.ts', method: 'POST', path: '/:roleId/users/:userId', summary: 'Assign role', description: 'Assign a role to a user', paramsSchema: { type: 'object', properties: { roleId: { type: 'string' }, userId: { type: 'string' } }, required: ['roleId', 'userId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'roles.ts', method: 'DELETE', path: '/:roleId/users/:userId', summary: 'Remove role', description: 'Remove a role from a user', paramsSchema: { type: 'object', properties: { roleId: { type: 'string' }, userId: { type: 'string' } }, required: ['roleId', 'userId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'roles.ts', method: 'GET', path: '/users/:userId/roles', summary: 'Get user roles', description: 'Get roles for a user', paramsSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] }, responseCodes: [200], permissions: 'role.read' },
  { file: 'roles.ts', method: 'GET', path: '/presets', summary: 'Get role presets', description: 'Get predefined role presets', responseCodes: [200] },
  { file: 'roles.ts', method: 'GET', path: '/:roleId/nodes', summary: 'Get role nodes', description: 'Get nodes assigned to a role', paramsSchema: { type: 'object', properties: { roleId: { type: 'string' } }, required: ['roleId'] }, responseCodes: [200], permissions: 'role.read' },
  { file: 'roles.ts', method: 'GET', path: '/users/:userId/nodes', summary: 'Get user nodes', description: 'Get nodes accessible to a user', paramsSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] }, responseCodes: [200], permissions: 'node.read' },

  // Templates
  { file: 'templates.ts', method: 'GET', path: '/', summary: 'List templates', description: 'Get all templates', responseCodes: [200], permissions: 'template.read' },
  { file: 'templates.ts', method: 'GET', path: '/:templateId', summary: 'Get template', description: 'Get template details', paramsSchema: { type: 'object', properties: { templateId: { type: 'string' } }, required: ['templateId'] }, responseCodes: [200, 404], permissions: 'template.read' },
  { file: 'templates.ts', method: 'POST', path: '/', summary: 'Create template', description: 'Create a new template', bodySchema: { type: 'object', properties: { name: { type: 'string' }, nestId: { type: 'string' }, description: { type: 'string' }, dockerImage: { type: 'string' }, startup: { type: 'string' } }, required: ['name', 'nestId'] }, responseCodes: [201], permissions: 'admin' },
  { file: 'templates.ts', method: 'PUT', path: '/:templateId', summary: 'Update template', description: 'Update a template', paramsSchema: { type: 'object', properties: { templateId: { type: 'string' } }, required: ['templateId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, dockerImage: { type: 'string' }, startup: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'templates.ts', method: 'DELETE', path: '/:templateId', summary: 'Delete template', description: 'Delete a template', paramsSchema: { type: 'object', properties: { templateId: { type: 'string' } }, required: ['templateId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'templates.ts', method: 'POST', path: '/import-pterodactyl', summary: 'Import Pterodactyl egg', description: 'Import a Pterodactyl egg', bodySchema: { type: 'object', properties: { nestId: { type: 'string' }, data: { type: 'object' } }, required: ['nestId', 'data'] }, responseCodes: [201], permissions: 'admin' },

  // Nests
  { file: 'nests.ts', method: 'GET', path: '/', summary: 'List nests', description: 'Get all nests', responseCodes: [200], permissions: 'nest.read' },
  { file: 'nests.ts', method: 'GET', path: '/:nestId', summary: 'Get nest', description: 'Get nest details', paramsSchema: { type: 'object', properties: { nestId: { type: 'string' } }, required: ['nestId'] }, responseCodes: [200, 404], permissions: 'nest.read' },
  { file: 'nests.ts', method: 'POST', path: '/', summary: 'Create nest', description: 'Create a new nest', bodySchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } }, required: ['name'] }, responseCodes: [201], permissions: 'admin' },
  { file: 'nests.ts', method: 'PUT', path: '/:nestId', summary: 'Update nest', description: 'Update a nest', paramsSchema: { type: 'object', properties: { nestId: { type: 'string' } }, required: ['nestId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'nests.ts', method: 'DELETE', path: '/:nestId', summary: 'Delete nest', description: 'Delete a nest', paramsSchema: { type: 'object', properties: { nestId: { type: 'string' } }, required: ['nestId'] }, responseCodes: [200], permissions: 'admin' },

  // Admin
  { file: 'admin.ts', method: 'GET', path: '/users', summary: 'List users', description: 'Get all users', querySchema: paginationQuery, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'POST', path: '/users', summary: 'Create user', description: 'Create a new user', bodySchema: { type: 'object', properties: { email: { type: 'string' }, username: { type: 'string' }, password: { type: 'string' }, roleIds: { type: 'array', items: { type: 'string' } } }, required: ['email', 'username', 'password'] }, responseCodes: [201], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/users/:userId', summary: 'Get user', description: 'Get user details', paramsSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'PUT', path: '/users/:userId', summary: 'Update user', description: 'Update user details', paramsSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] }, bodySchema: { type: 'object', properties: { email: { type: 'string' }, username: { type: 'string' }, password: { type: 'string' }, roleIds: { type: 'array', items: { type: 'string' } } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'POST', path: '/users/:userId/delete', summary: 'Delete user', description: 'Delete a user', paramsSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] }, bodySchema: { type: 'object', properties: { force: { type: 'boolean' }, transferToUserId: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/users/:userId/servers', summary: 'Get user servers', description: 'Get servers owned by a user', paramsSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/nodes', summary: 'List all nodes', description: 'Get all nodes', querySchema: paginationQuery, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/servers', summary: 'List all servers', description: 'Get all servers', querySchema: { ...paginationQuery, properties: { ...paginationQuery.properties, status: { type: 'string' }, owner: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'POST', path: '/servers/actions', summary: 'Bulk server actions', description: 'Perform bulk actions on servers', bodySchema: { type: 'object', properties: { serverIds: { type: 'array', items: { type: 'string' } }, action: { type: 'string', enum: ['start', 'stop', 'restart', 'suspend', 'unsuspend', 'delete'] }, reason: { type: 'string' } }, required: ['serverIds', 'action'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/roles', summary: 'List all roles', description: 'Get all roles', responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/audit-logs', summary: 'Audit logs', description: 'Get audit logs', querySchema: { ...paginationQuery, properties: { ...paginationQuery.properties, userId: { type: 'string' }, action: { type: 'string' }, resource: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/audit-logs/export', summary: 'Export audit logs', description: 'Export audit logs', querySchema: { type: 'object', properties: { format: { type: 'string', enum: ['csv', 'json'] }, from: { type: 'string' }, to: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/security-settings', summary: 'Get security settings', description: 'Get security configuration', responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'PUT', path: '/security-settings', summary: 'Update security settings', description: 'Update security configuration', bodySchema: { type: 'object', properties: { rateLimitMax: { type: 'number' }, rateLimitTimeWindow: { type: 'number' }, authRateLimitMax: { type: 'number' }, allowedFileExtensions: { type: 'array', items: { type: 'string' } } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/health', summary: 'System health', description: 'Get system health status', responseCodes: [200] },
  { file: 'admin.ts', method: 'GET', path: '/ip-pools', summary: 'List IP pools', description: 'Get all IP pools', responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'POST', path: '/ip-pools', summary: 'Create IP pool', description: 'Create a new IP pool', bodySchema: { type: 'object', properties: { nodeId: { type: 'string' }, networkName: { type: 'string' }, cidr: { type: 'string' }, gateway: { type: 'string' }, startIp: { type: 'string' }, endIp: { type: 'string' } }, required: ['nodeId', 'networkName', 'cidr'] }, responseCodes: [201], permissions: 'admin' },
  { file: 'admin.ts', method: 'PUT', path: '/ip-pools/:poolId', summary: 'Update IP pool', description: 'Update an IP pool', paramsSchema: { type: 'object', properties: { poolId: { type: 'string' } }, required: ['poolId'] }, bodySchema: { type: 'object', properties: { cidr: { type: 'string' }, gateway: { type: 'string' }, startIp: { type: 'string' }, endIp: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'DELETE', path: '/ip-pools/:poolId', summary: 'Delete IP pool', description: 'Delete an IP pool', paramsSchema: { type: 'object', properties: { poolId: { type: 'string' } }, required: ['poolId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/database-hosts', summary: 'List database hosts', description: 'Get all database hosts', responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'POST', path: '/database-hosts', summary: 'Create database host', description: 'Create a new database host', bodySchema: { type: 'object', properties: { name: { type: 'string' }, host: { type: 'string' }, port: { type: 'number' }, username: { type: 'string' }, password: { type: 'string' } }, required: ['name', 'host', 'port', 'username', 'password'] }, responseCodes: [201], permissions: 'admin' },
  { file: 'admin.ts', method: 'PUT', path: '/database-hosts/:hostId', summary: 'Update database host', description: 'Update a database host', paramsSchema: { type: 'object', properties: { hostId: { type: 'string' } }, required: ['hostId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, host: { type: 'string' }, port: { type: 'number' }, username: { type: 'string' }, password: { type: 'string' } } }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'DELETE', path: '/database-hosts/:hostId', summary: 'Delete database host', description: 'Delete a database host', paramsSchema: { type: 'object', properties: { hostId: { type: 'string' } }, required: ['hostId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'admin.ts', method: 'GET', path: '/stats', summary: 'System stats', description: 'Get system statistics', responseCodes: [200], permissions: 'admin' },

  // Alerts
  { file: 'alerts.ts', method: 'GET', path: '/alert-rules', summary: 'List alert rules', description: 'Get all alert rules', responseCodes: [200], permissions: 'alert.read' },
  { file: 'alerts.ts', method: 'POST', path: '/alert-rules', summary: 'Create alert rule', description: 'Create a new alert rule', bodySchema: { type: 'object', properties: { name: { type: 'string' }, condition: { type: 'string' }, threshold: { type: 'number' }, action: { type: 'string' }, serverIds: { type: 'array', items: { type: 'string' } } }, required: ['name', 'condition', 'threshold', 'action'] }, responseCodes: [201], permissions: 'alert.create' },
  { file: 'alerts.ts', method: 'GET', path: '/alert-rules/:ruleId', summary: 'Get alert rule', description: 'Get alert rule details', paramsSchema: { type: 'object', properties: { ruleId: { type: 'string' } }, required: ['ruleId'] }, responseCodes: [200], permissions: 'alert.read' },
  { file: 'alerts.ts', method: 'PUT', path: '/alert-rules/:ruleId', summary: 'Update alert rule', description: 'Update an alert rule', paramsSchema: { type: 'object', properties: { ruleId: { type: 'string' } }, required: ['ruleId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' }, condition: { type: 'string' }, threshold: { type: 'number' }, action: { type: 'string' }, enabled: { type: 'boolean' } } }, responseCodes: [200], permissions: 'alert.update' },
  { file: 'alerts.ts', method: 'DELETE', path: '/alert-rules/:ruleId', summary: 'Delete alert rule', description: 'Delete an alert rule', paramsSchema: { type: 'object', properties: { ruleId: { type: 'string' } }, required: ['ruleId'] }, responseCodes: [200], permissions: 'alert.delete' },
  { file: 'alerts.ts', method: 'GET', path: '/alerts', summary: 'List alerts', description: 'Get all alerts', querySchema: { ...paginationQuery, properties: { ...paginationQuery.properties, status: { type: 'string' }, severity: { type: 'string' } } }, responseCodes: [200], permissions: 'alert.read' },
  { file: 'alerts.ts', method: 'GET', path: '/alerts/:alertId', summary: 'Get alert', description: 'Get alert details', paramsSchema: { type: 'object', properties: { alertId: { type: 'string' } }, required: ['alertId'] }, responseCodes: [200], permissions: 'alert.read' },
  { file: 'alerts.ts', method: 'POST', path: '/alerts/:alertId/resolve', summary: 'Resolve alert', description: 'Mark an alert as resolved', paramsSchema: { type: 'object', properties: { alertId: { type: 'string' } }, required: ['alertId'] }, bodySchema: { type: 'object', properties: { note: { type: 'string' } } }, responseCodes: [200], permissions: 'alert.update' },
  { file: 'alerts.ts', method: 'POST', path: '/alerts/bulk-resolve', summary: 'Bulk resolve alerts', description: 'Mark multiple alerts as resolved', bodySchema: { type: 'object', properties: { alertIds: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } }, required: ['alertIds'] }, responseCodes: [200], permissions: 'alert.update' },
  { file: 'alerts.ts', method: 'GET', path: '/alerts/:alertId/deliveries', summary: 'Get alert deliveries', description: 'Get delivery history for an alert', paramsSchema: { type: 'object', properties: { alertId: { type: 'string' } }, required: ['alertId'] }, responseCodes: [200], permissions: 'alert.read' },
  { file: 'alerts.ts', method: 'GET', path: '/alerts/stats', summary: 'Alert statistics', description: 'Get alert statistics', responseCodes: [200], permissions: 'admin' },

  // Dashboard
  { file: 'dashboard.ts', method: 'GET', path: '/stats', summary: 'Dashboard stats', description: 'Get dashboard statistics', responseCodes: [200] },
  { file: 'dashboard.ts', method: 'GET', path: '/activity', summary: 'Recent activity', description: 'Get recent activity', querySchema: paginationQuery, responseCodes: [200] },
  { file: 'dashboard.ts', method: 'GET', path: '/resources', summary: 'Resource summary', description: 'Get resource usage summary', responseCodes: [200] },

  // Metrics
  { file: 'metrics.ts', method: 'GET', path: '/servers/:serverId/metrics', summary: 'Server metrics', description: 'Get metrics for a server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, querySchema: { type: 'object', properties: { period: { type: 'string' } } }, responseCodes: [200], permissions: 'server.read' },
  { file: 'metrics.ts', method: 'GET', path: '/servers/:serverId/stats', summary: 'Server stats', description: 'Get current stats for a server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },
  { file: 'metrics.ts', method: 'GET', path: '/nodes/:nodeId/metrics', summary: 'Node metrics', description: 'Get metrics for a node', paramsSchema: { type: 'object', properties: { nodeId: { type: 'string' } }, required: ['nodeId'] }, querySchema: { type: 'object', properties: { period: { type: 'string' } } }, responseCodes: [200], permissions: 'node.read' },

  // Backups
  { file: 'backups.ts', method: 'GET', path: '/:serverId/backups', summary: 'List backups', description: 'Get all backups for a server', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'backup.read' },
  { file: 'backups.ts', method: 'POST', path: '/:serverId/backups', summary: 'Create backup', description: 'Create a new backup', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, responseCodes: [201], permissions: 'backup.create' },
  { file: 'backups.ts', method: 'GET', path: '/:serverId/backups/:backupId', summary: 'Get backup', description: 'Get backup details', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, backupId: { type: 'string' } }, required: ['serverId', 'backupId'] }, responseCodes: [200], permissions: 'backup.read' },
  { file: 'backups.ts', method: 'POST', path: '/:serverId/backups/:backupId/restore', summary: 'Restore backup', description: 'Restore a backup', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, backupId: { type: 'string' } }, required: ['serverId', 'backupId'] }, responseCodes: [200], permissions: 'backup.restore' },
  { file: 'backups.ts', method: 'DELETE', path: '/:serverId/backups/:backupId', summary: 'Delete backup', description: 'Delete a backup', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, backupId: { type: 'string' } }, required: ['serverId', 'backupId'] }, responseCodes: [200], permissions: 'backup.delete' },
  { file: 'backups.ts', method: 'GET', path: '/:serverId/backups/:backupId/download', summary: 'Download backup', description: 'Download a backup', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' }, backupId: { type: 'string' } }, required: ['serverId', 'backupId'] }, responseCodes: [200], permissions: 'backup.read' },

  // Bulk Servers
  { file: 'bulk-servers.ts', method: 'POST', path: '/bulk/suspend', summary: 'Bulk suspend', description: 'Suspend multiple servers', bodySchema: { type: 'object', properties: { serverIds: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } }, required: ['serverIds'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'bulk-servers.ts', method: 'POST', path: '/bulk/unsuspend', summary: 'Bulk unsuspend', description: 'Unsuspend multiple servers', bodySchema: { type: 'object', properties: { serverIds: { type: 'array', items: { type: 'string' } } }, required: ['serverIds'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'bulk-servers.ts', method: 'DELETE', path: '/bulk', summary: 'Bulk delete', description: 'Delete multiple servers', bodySchema: { type: 'object', properties: { serverIds: { type: 'array', items: { type: 'string' } } }, required: ['serverIds'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'bulk-servers.ts', method: 'POST', path: '/bulk/status', summary: 'Bulk status', description: 'Update status of multiple servers', bodySchema: { type: 'object', properties: { serverIds: { type: 'array', items: { type: 'string' } }, status: { type: 'string' } }, required: ['serverIds', 'status'] }, responseCodes: [200], permissions: 'admin' },

  // Admin Events (SSE)
  { file: 'admin-events.ts', method: 'GET', path: '/', summary: 'SSE events stream', description: 'Server-Sent Events stream for admin events', responseCodes: [200] },

  // API Keys
  { file: 'api-keys.ts', method: 'GET', path: '/api-keys', summary: 'List API keys', description: 'Get all API keys', responseCodes: [200] },
  { file: 'api-keys.ts', method: 'POST', path: '/api-keys', summary: 'Create API key', description: 'Create a new API key', bodySchema: { type: 'object', properties: { name: { type: 'string' }, expiresIn: { type: 'number' }, rateLimitEnabled: { type: 'boolean' }, rateLimitMax: { type: 'number' }, rateLimitTimeWindow: { type: 'number' } }, required: ['name'] }, responseCodes: [201] },
  { file: 'api-keys.ts', method: 'DELETE', path: '/api-keys/:keyId', summary: 'Delete API key', description: 'Delete an API key', paramsSchema: { type: 'object', properties: { keyId: { type: 'string' } }, required: ['keyId'] }, responseCodes: [200] },

  // Plugins
  { file: 'plugins.ts', method: 'GET', path: '/plugins', summary: 'List plugins', description: 'Get all installed plugins', responseCodes: [200], permissions: 'admin' },
  { file: 'plugins.ts', method: 'GET', path: '/plugins/:name', summary: 'Get plugin', description: 'Get plugin details', paramsSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'plugins.ts', method: 'POST', path: '/plugins/:name/enable', summary: 'Enable plugin', description: 'Enable a plugin', paramsSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'plugins.ts', method: 'POST', path: '/plugins/:name/reload', summary: 'Reload plugin', description: 'Reload a plugin', paramsSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'plugins.ts', method: 'PUT', path: '/plugins/:name/config', summary: 'Update plugin config', description: 'Update plugin configuration', paramsSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, bodySchema: { type: 'object' }, responseCodes: [200], permissions: 'admin' },
  { file: 'plugins.ts', method: 'GET', path: '/plugins/:name/frontend-manifest', summary: 'Plugin manifest', description: 'Get plugin frontend manifest', paramsSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] }, responseCodes: [200] },

  // Migration
  { file: 'migration.ts', method: 'GET', path: '/admin/migration/catalyst-nodes', summary: 'Get Pterodactyl nodes', description: 'Get nodes from Pterodactyl for migration', responseCodes: [200], permissions: 'admin' },
  { file: 'migration.ts', method: 'POST', path: '/admin/migration/test', summary: 'Test migration', description: 'Test migration connection', bodySchema: { type: 'object', properties: { host: { type: 'string' }, apiKey: { type: 'string' } }, required: ['host', 'apiKey'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'migration.ts', method: 'POST', path: '/admin/migration/start', summary: 'Start migration', description: 'Start a Pterodactyl to Catalyst migration', bodySchema: { type: 'object', properties: { host: { type: 'string' }, apiKey: { type: 'string' }, nodeId: { type: 'string' }, serverIds: { type: 'array', items: { type: 'string' } } }, required: ['host', 'apiKey', 'nodeId'] }, responseCodes: [201], permissions: 'admin' },
  { file: 'migration.ts', method: 'GET', path: '/admin/migration', summary: 'List migrations', description: 'Get all migration jobs', responseCodes: [200], permissions: 'admin' },
  { file: 'migration.ts', method: 'GET', path: '/admin/migration/:jobId', summary: 'Get migration job', description: 'Get migration job status', paramsSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'migration.ts', method: 'POST', path: '/admin/migration/:jobId/pause', summary: 'Pause migration', description: 'Pause a running migration', paramsSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'migration.ts', method: 'POST', path: '/admin/migration/:jobId/resume', summary: 'Resume migration', description: 'Resume a paused migration', paramsSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'migration.ts', method: 'POST', path: '/admin/migration/:jobId/cancel', summary: 'Cancel migration', description: 'Cancel a migration job', paramsSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'migration.ts', method: 'GET', path: '/admin/migration/:jobId/steps', summary: 'Get migration steps', description: 'Get steps for a migration job', paramsSchema: { type: 'object', properties: { jobId: { type: 'string' } }, required: ['jobId'] }, responseCodes: [200], permissions: 'admin' },
  { file: 'migration.ts', method: 'POST', path: '/admin/migration/:jobId/retry/:stepId', summary: 'Retry migration step', description: 'Retry a failed migration step', paramsSchema: { type: 'object', properties: { jobId: { type: 'string' }, stepId: { type: 'string' } }, required: ['jobId', 'stepId'] }, responseCodes: [200], permissions: 'admin' },

  // Console Stream (SSE)
  { file: 'console-stream.ts', method: 'GET', path: '/:serverId/console', summary: 'Console stream', description: 'SSE stream for server console output', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'console.read' },
  { file: 'console-stream.ts', method: 'POST', path: '/:serverId/console/command', summary: 'Send console command', description: 'Send a command to the server console', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, bodySchema: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] }, responseCodes: [200], permissions: 'console.write' },

  // SSE Events
  { file: 'sse-events.ts', method: 'GET', path: '/:serverId/events', summary: 'Server events stream', description: 'SSE stream for server events', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200] },

  // Metrics Stream (SSE)
  { file: 'metrics-stream.ts', method: 'GET', path: '/:serverId/metrics/stream', summary: 'Metrics stream', description: 'SSE stream for real-time server metrics', paramsSchema: { type: 'object', properties: { serverId: { type: 'string' } }, required: ['serverId'] }, responseCodes: [200], permissions: 'server.read' },

  // File Tunnel
  { file: 'file-tunnel.ts', method: 'GET', path: '/internal/file-tunnel/poll', summary: 'Poll file tunnel', description: 'Poll for file tunnel requests', responseCodes: [200] },
  { file: 'file-tunnel.ts', method: 'POST', path: '/internal/file-tunnel/response/:requestId', summary: 'File tunnel response', description: 'Send file tunnel response', paramsSchema: { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'] }, bodySchema: { type: 'object', properties: { data: { type: 'string' }, error: { type: 'string' } } }, responseCodes: [200] },
  { file: 'file-tunnel.ts', method: 'POST', path: '/internal/file-tunnel/response/:requestId/stream', summary: 'File tunnel stream', description: 'Stream file tunnel response', paramsSchema: { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'] }, responseCodes: [200] },
  { file: 'file-tunnel.ts', method: 'GET', path: '/internal/file-tunnel/upload/:requestId', summary: 'File tunnel upload', description: 'Upload file via tunnel', paramsSchema: { type: 'object', properties: { requestId: { type: 'string' } }, required: ['requestId'] }, responseCodes: [200] },
];

// =============================================================================
// GENERATE OPENAPI SPEC
// =============================================================================

const statusDescriptions: Record<number, string> = {
  200: 'Success',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Rate Limited',
  500: 'Server Error',
};

function generateSchema(route: RouteDef): object {
  const schema: any = {
    summary: route.summary,
    description: route.description,
  };

  if (route.bodySchema) schema.body = route.bodySchema;
  if (route.paramsSchema) schema.params = route.paramsSchema;
  if (route.querySchema) schema.querystring = route.querySchema;

  schema.response = {};
  const codes = route.responseCodes || [200, 400, 401, 404];
  for (const code of codes) {
    schema.response[code] = {
      ...errorResponseSchema,
      description: statusDescriptions[code] || 'Response',
    };
  }

  if (route.permissions) {
    schema.description += ` [Requires: ${route.permissions}]`;
  }

  return schema;
}

// Build OpenAPI paths
const paths: Record<string, any> = {};

for (const route of ROUTES) {
  const pathKey = route.path.replace(/:(\w+)/g, '{$1}');
  const method = route.method.toLowerCase();
  
  if (!paths[pathKey]) paths[pathKey] = {};
  paths[pathKey][method] = generateSchema(route);
}

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Catalyst API',
    description: 'Catalyst backend API documentation - auto-generated',
    version: '1.0.0',
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local development' },
  ],
  paths,
  components: {
    schemas: {
      Error: errorResponseSchema,
    },
  },
};

// Write OpenAPI spec
const specPath = resolve(docsDir, 'openapi.json');
writeFileSync(specPath, JSON.stringify(openApiSpec, null, 2));

// Generate markdown documentation
const md = `# Catalyst API Reference

> Auto-generated on ${new Date().toISOString().split('T')[0]}

## Base URL

\`\`\`
http://localhost:3000
\`\`\`

## Authentication

All requests require the \`x-api-key\` header:

\`\`\`bash
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/endpoint
\`\`\`

---

## Endpoints

${Object.entries(paths).map(([path, methods]) => `
### \`${path}\`

${Object.entries(methods as Record<string, any>).map(([method, details]: [string, any]) => `
#### ${method.toUpperCase()}

**${details.summary}**

${details.description}

${details.body ? `**Request Body:**
\`\`\`json
${JSON.stringify(details.body, null, 2)}
\`\`\`` : ''}

${details.params ? `**Parameters:**
| Name | Type | Description |
|------|------|-------------|
${Object.entries((details.params as any).properties || {}).map(([name, prop]: [string, any]) => `| ${name} | ${prop.type || 'string'} | ${prop.description || ''} |`).join('\n')}
` : ''}

**Responses:**
${Object.entries(details.response || {}).map(([code, resp]: [string, any]) => `- \`${code}\`: ${(resp as any).description}`).join('\n')}
`).join('')}
`).join('')}
`;

// Write markdown docs
const mdPath = resolve(docsDir, 'API-DOCUMENTATION.md');
writeFileSync(mdPath, md);

console.log('\n✅ OpenAPI spec generated:', specPath);
console.log('✅ Markdown docs generated:', mdPath);
console.log('\n📊 Statistics:');
console.log(`   Total routes: ${ROUTES.length}`);

// Group by file
const byFile = ROUTES.reduce((acc, r) => {
  acc[r.file] = (acc[r.file] || 0) + 1;
  return acc;
}, {} as Record<string, number>);

console.log('\n📁 Routes by file:');
for (const [file, count] of Object.entries(byFile)) {
  console.log(`   ${file}: ${count} routes`);
}
