import ServerTabCard from './ServerTabCard';

interface UserEntry {
  id: string;
  userId: string;
  user: { username: string; email: string };
  permissions: string[];
}

interface Invite {
  id: string;
  email: string;
  expiresAt: string;
}

interface Props {
  serverId: string;
  ownerId: string;

  // Invite
  inviteEmail: string;
  onInviteEmailChange: (email: string) => void;
  invitePreset: 'readOnly' | 'power' | 'full' | 'custom';
  onInvitePresetChange: (preset: 'readOnly' | 'power' | 'full' | 'custom') => void;
  invitePermissions: string[];
  onInvitePermissionsChange: (permissions: string[]) => void;
  permissionPresets: Record<string, string[]>;
  permissionOptions: string[];
  createInvitePending: boolean;
  onCreateInvite: () => void;

  // Access
  permissionsData: UserEntry[] | undefined;
  accessPermissions: Record<string, string[]>;
  onAccessPermissionsChange: (permissions: Record<string, string[]>) => void;
  saveAccessPending: boolean;
  onSaveAccess: (entry: UserEntry) => void;
  removeAccessPending: boolean;
  onRemoveAccess: (targetUserId: string) => void;

  // Invites
  invites: Invite[];
  cancelInvitePending: boolean;
  onCancelInvite: (inviteId: string) => void;
}

export default function ServerUsersTab({
  serverId,
  ownerId,
  inviteEmail,
  onInviteEmailChange,
  invitePreset,
  onInvitePresetChange,
  invitePermissions,
  onInvitePermissionsChange,
  permissionPresets,
  permissionOptions,
  createInvitePending,
  onCreateInvite,
  permissionsData,
  accessPermissions,
  onAccessPermissionsChange,
  saveAccessPending,
  onSaveAccess,
  removeAccessPending,
  onRemoveAccess,
  invites,
  cancelInvitePending,
  onCancelInvite,
}: Props) {
  return (
    <div className="space-y-4">
      {/* Invite user */}
      <ServerTabCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-foreground">Invite user</div>
            <div className="text-xs text-muted-foreground">
              Send an invite to grant access to this server.
            </div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-muted-foreground sm:grid-cols-3">
          <input
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
            value={inviteEmail}
            onChange={(event) => onInviteEmailChange(event.target.value)}
            placeholder="user@example.com"
          />
          <select
            className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none dark:focus:border-primary-400"
            value={invitePreset}
            onChange={(event) =>
              onInvitePresetChange(
                event.target.value as 'readOnly' | 'power' | 'full' | 'custom',
              )
            }
          >
            <option value="readOnly">Read-only</option>
            <option value="power">Power user</option>
            <option value="full">Full access</option>
            <option value="custom">Custom</option>
          </select>
          <button
            type="button"
            className="rounded-md bg-primary-600 px-3 py-2 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={onCreateInvite}
            disabled={!inviteEmail.trim() || createInvitePending}
          >
            Send invite
          </button>
        </div>
        {invitePreset === 'custom' ? (
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            {permissionOptions.map((perm) => (
              <label key={perm} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border bg-card text-primary-600"
                  checked={invitePermissions.includes(perm)}
                  onChange={(event) => {
                    onInvitePermissionsChange(
                      event.target.checked
                        ? [...invitePermissions, perm]
                        : invitePermissions.filter((p) => p !== perm),
                    );
                  }}
                />
                {perm}
              </label>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-xs text-muted-foreground">
            {permissionPresets[invitePreset]?.join(', ') ||
              'No preset loaded.'}
          </div>
        )}
      </ServerTabCard>

      {/* Active access */}
      <ServerTabCard>
        <div className="text-sm font-semibold text-foreground">Active access</div>
        <div className="mt-4 space-y-3 text-xs text-muted-foreground">
          {permissionsData?.length ? (
            permissionsData.map((entry) => (
              <div
                key={entry.id}
                className="rounded-lg border border-border bg-surface-2 px-4 py-3 transition-all duration-300 hover:border-primary/30"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {entry.user.username}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {entry.user.email}
                    </div>
                  </div>
                  {entry.userId !== ownerId ? (
                    <button
                      type="button"
                      className="rounded-md border border-danger/30 px-2 py-1 text-[10px] font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                      onClick={() => onRemoveAccess(entry.userId)}
                      disabled={removeAccessPending}
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="rounded-full border border-border px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                      Owner
                    </span>
                  )}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  {permissionOptions.map((perm) => (
                    <label key={`${entry.id}-${perm}`} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border bg-card text-primary-600"
                        checked={(
                          accessPermissions[entry.userId] ?? entry.permissions
                        ).includes(perm)}
                        onChange={(event) => {
                          if (entry.userId === ownerId) return;
                          const next = new Set(
                            accessPermissions[entry.userId] ?? entry.permissions,
                          );
                          if (event.target.checked) {
                            next.add(perm);
                          } else {
                            next.delete(perm);
                          }
                          onAccessPermissionsChange({
                            ...accessPermissions,
                            [entry.userId]: Array.from(next),
                          });
                        }}
                        disabled={entry.userId === ownerId}
                      />
                      {perm}
                    </label>
                  ))}
                </div>
                {entry.userId !== ownerId ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="rounded-md bg-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                      onClick={() => onSaveAccess(entry)}
                      disabled={saveAccessPending}
                    >
                      Save permissions
                    </button>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-surface-2 px-6 py-6 text-center text-xs text-muted-foreground/50">
              No additional users yet.
            </div>
          )}
        </div>
      </ServerTabCard>

      {/* Pending invites */}
      <ServerTabCard>
        <div className="text-sm font-semibold text-foreground">
          Pending invites
        </div>
        <div className="mt-4 space-y-2 text-xs text-muted-foreground">
          {invites.length ? (
            invites.map((invite) => (
              <div
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2 transition-all duration-300 hover:border-primary/30"
              >
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {invite.email}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Expires {new Date(invite.expiresAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-danger/30 px-2 py-1 text-[10px] font-semibold text-danger transition-all duration-300 hover:border-danger/50"
                  onClick={() => onCancelInvite(invite.id)}
                  disabled={cancelInvitePending}
                >
                  Cancel
                </button>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-surface-2 px-6 py-6 text-center text-xs text-muted-foreground/50">
              No pending invites.
            </div>
          )}
        </div>
      </ServerTabCard>
    </div>
  );
}
