import ServerTabCard from './ServerTabCard';
import TabHeader from './TabHeader';
import SectionHeader from './SectionHeader';
import TabEmptyState from './TabEmptyState';
import { Users, UserPlus, ShieldCheck, Mail } from 'lucide-react';

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
  permissionsData: UserEntry[] | undefined;
  accessPermissions: Record<string, string[]>;
  onAccessPermissionsChange: (permissions: Record<string, string[]>) => void;
  saveAccessPending: boolean;
  onSaveAccess: (entry: UserEntry) => void;
  removeAccessPending: boolean;
  onRemoveAccess: (targetUserId: string) => void;
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
      <TabHeader
        icon={Users}
        title="Users & Access"
        description="Manage who can access this server and their permissions."
      />

      {/* ── Invite ── */}
      <ServerTabCard>
        <SectionHeader icon={UserPlus} title="Invite user" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input
            className="rounded-md border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
            value={inviteEmail}
            onChange={(e) => onInviteEmailChange(e.target.value)}
            placeholder="user@example.com"
          />
          <select
            className="rounded-md border border-border/40 bg-card px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
            value={invitePreset}
            onChange={(e) =>
              onInvitePresetChange(e.target.value as 'readOnly' | 'power' | 'full' | 'custom')
            }
          >
            <option value="readOnly">Read-only</option>
            <option value="power">Power user</option>
            <option value="full">Full access</option>
            <option value="custom">Custom</option>
          </select>
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-[0_0_6px_-1px_hsl(var(--primary)/0.2)] transition-all hover:bg-primary/90 disabled:opacity-50"
            onClick={onCreateInvite}
            disabled={!inviteEmail.trim() || createInvitePending}
          >
            Send invite
          </button>
        </div>
        {invitePreset === 'custom' && (
          <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {permissionOptions.map((perm) => (
              <label key={perm} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border/40 bg-card text-primary-600"
                  checked={invitePermissions.includes(perm)}
                  onChange={(e) =>
                    onInvitePermissionsChange(
                      e.target.checked
                        ? [...invitePermissions, perm]
                        : invitePermissions.filter((p) => p !== perm),
                    )
                  }
                />
                <span className="font-mono text-[10px]">{perm}</span>
              </label>
            ))}
          </div>
        )}
      </ServerTabCard>

      {/* ── Active access ── */}
      <ServerTabCard>
        <SectionHeader icon={ShieldCheck} title="Active access" />
        <div className="space-y-2">
          {permissionsData?.length ? (
            permissionsData.map((entry) => (
              <div
                key={entry.id}
                className="group relative rounded-lg border border-border/30 px-4 py-3 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
              >
                <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">
                      {entry.user.username}
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground/50">
                      {entry.user.email}
                    </div>
                  </div>
                  {entry.userId === ownerId ? (
                    <span className="rounded border border-primary/15 bg-primary/5 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                      Owner
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="rounded-md border border-danger/20 px-2 py-1 text-[10px] font-medium text-danger transition-all hover:border-danger/40 hover:bg-danger/5 disabled:opacity-50"
                      onClick={() => onRemoveAccess(entry.userId)}
                      disabled={removeAccessPending}
                    >
                      Remove
                    </button>
                  )}
                </div>

                {entry.userId !== ownerId && (
                  <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {permissionOptions.map((perm) => (
                      <label key={`${entry.id}-${perm}`} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5 rounded border-border/40 bg-card text-primary-600"
                          checked={(accessPermissions[entry.userId] ?? entry.permissions).includes(perm)}
                          onChange={(e) => {
                            if (entry.userId === ownerId) return;
                            const next = new Set(accessPermissions[entry.userId] ?? entry.permissions);
                            if (e.target.checked) next.add(perm);
                            else next.delete(perm);
                            onAccessPermissionsChange({
                              ...accessPermissions,
                              [entry.userId]: Array.from(next),
                            });
                          }}
                          disabled={entry.userId === ownerId}
                        />
                        <span className="font-mono text-[10px]">{perm}</span>
                      </label>
                    ))}
                  </div>
                )}

                {entry.userId !== ownerId && (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="rounded-md bg-primary px-3 py-1 text-[10px] font-semibold text-primary-foreground shadow-[0_0_6px_-1px_hsl(var(--primary)/0.15)] transition-all hover:bg-primary/90 disabled:opacity-50"
                      onClick={() => onSaveAccess(entry)}
                      disabled={saveAccessPending}
                    >
                      Save permissions
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <TabEmptyState
              title="No additional users"
              description="Invite someone above to grant them access."
            />
          )}
        </div>
      </ServerTabCard>

      {/* ── Pending invites ── */}
      <ServerTabCard>
        <SectionHeader icon={Mail} title="Pending invites" />
        <div className="space-y-1.5">
          {invites.length ? (
            invites.map((invite) => (
              <div
                key={invite.id}
                className="group relative flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/30 px-3 py-2 transition-all duration-150 hover:border-primary/20 hover:bg-primary/[0.02]"
              >
                <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary/0 transition-colors duration-150 group-hover:bg-primary/50" />
                <div>
                  <div className="text-xs font-medium text-foreground">{invite.email}</div>
                  <div className="font-mono text-[10px] tabular-nums text-muted-foreground/40">
                    Expires {new Date(invite.expiresAt).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-md border border-danger/20 px-2 py-0.5 text-[10px] font-medium text-danger transition-all hover:border-danger/40 hover:bg-danger/5 disabled:opacity-50"
                  onClick={() => onCancelInvite(invite.id)}
                  disabled={cancelInvitePending}
                >
                  Cancel
                </button>
              </div>
            ))
          ) : (
            <TabEmptyState
              title="No pending invites"
              description="Invites will appear here after you send them."
            />
          )}
        </div>
      </ServerTabCard>
    </div>
  );
}
