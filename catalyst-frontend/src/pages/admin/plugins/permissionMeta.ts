/**
 * Client-side mirror of backend `PERMISSION_INFO` labels (safety.ts).
 * Used for human-readable capability wording in consent and permission UIs.
 * Unknown tokens fall back to the raw token — plugins may declare new scopes.
 */
export const PERMISSION_LABELS: Record<string, string> = {
  '*': 'Full access to all panel data scopes',
  'server.read': 'View details of all servers',
  'server.write': 'Change server status (suspend / resume)',
  'user.read': 'View user accounts (names, emails, roles)',
  'user.write': 'Modify whitelisted user fields (no role changes)',
  'admin.read': 'Surface admin-level information in its routes',
  'admin.write': 'Register API routes that change admin settings',
  'plugin.rpc': 'Call APIs exposed by other installed plugins',
};

export function permissionLabel(token: string): string {
  return PERMISSION_LABELS[token] ?? token;
}
