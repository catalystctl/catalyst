import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useProfile, useProfileSsoAccounts } from '../hooks/useProfile';
import { type Passkey, profileApi } from '../services/api/profile';
import { notifyError, notifySuccess } from '../utils/notify';

function ProfilePage() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useProfile();
  const { data: ssoAccounts } = useProfileSsoAccounts();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [setPasswordValue, setSetPasswordValue] = useState('');
  const [twoFactorPassword, setTwoFactorPassword] = useState('');
  const [passkeyName, setPasskeyName] = useState('');
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [editingPasskeyId, setEditingPasskeyId] = useState<string | null>(null);
  const [editingPasskeyName, setEditingPasskeyName] = useState('');
  const [twoFactorModalOpen, setTwoFactorModalOpen] = useState(false);
  const [twoFactorSetup, setTwoFactorSetup] = useState<{
    qrCode?: string;
    secret?: string;
    otpAuthUrl?: string;
    backupCodes?: string[];
  } | null>(null);
  const qrValue =
    twoFactorSetup?.qrCode ||
    (twoFactorSetup?.otpAuthUrl
      ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(
          twoFactorSetup.otpAuthUrl,
        )}`
      : undefined);

  const refreshPasskeys = useCallback(async () => {
    try {
      const list = await profileApi.listPasskeys();
      setPasskeys(list);
    } catch {
      setPasskeys([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPasskeys().catch(() => undefined);
  }, [profile?.id, refreshPasskeys]);

  const availableProviders = useMemo(() => ['whmcs', 'paymenter'], []);

  const changePasswordMutation = useMutation({
    mutationFn: () =>
      profileApi.changePassword({
        currentPassword,
        newPassword,
      }),
    onSuccess: () => {
      notifySuccess('Password updated');
      setCurrentPassword('');
      setNewPassword('');
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || error?.message || 'Failed to update password');
    },
  });

  const setPasswordMutation = useMutation({
    mutationFn: () => profileApi.setPassword({ newPassword: setPasswordValue }),
    onSuccess: () => {
      notifySuccess('Password set');
      setSetPasswordValue('');
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || error?.message || 'Failed to set password');
    },
  });

  const enableTwoFactorMutation = useMutation({
    mutationFn: () => profileApi.enableTwoFactor({ password: twoFactorPassword }),
    onSuccess: (data: any) => {
      const payload = data?.data ?? data;
      const codes = payload?.backupCodes || [];
      setBackupCodes(codes);
      setTwoFactorSetup({
        qrCode: payload?.qrCode || payload?.qr || payload?.qrImage,
        secret: payload?.secret,
        otpAuthUrl: payload?.totpURI || payload?.otpAuthUrl || payload?.otpauthUrl,
        backupCodes: codes,
      });
      setTwoFactorModalOpen(true);
      notifySuccess('Two-factor enabled');
      setTwoFactorPassword('');
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || error?.message || 'Failed to enable two-factor');
    },
  });

  const disableTwoFactorMutation = useMutation({
    mutationFn: () => profileApi.disableTwoFactor({ password: twoFactorPassword }),
    onSuccess: () => {
      notifySuccess('Two-factor disabled');
      setTwoFactorPassword('');
      setBackupCodes([]);
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || error?.message || 'Failed to disable two-factor');
    },
  });

  const generateBackupCodesMutation = useMutation({
    mutationFn: () => profileApi.generateBackupCodes({ password: twoFactorPassword }),
    onSuccess: (data: any) => {
      const codes = data?.data?.backupCodes || data?.backupCodes || [];
      setBackupCodes(codes);
      notifySuccess('Backup codes generated');
      setTwoFactorPassword('');
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || error?.message || 'Failed to generate backup codes');
    },
  });

  const addPasskeyMutation = useMutation({
    mutationFn: () => profileApi.createPasskey({ name: passkeyName || undefined }),
    onSuccess: async () => {
      notifySuccess('Passkey added');
      setPasskeyName('');
      await refreshPasskeys();
    },
    onError: (error: any) => {
      notifyError(error?.message || 'Failed to add passkey');
    },
  });

  const deletePasskeyMutation = useMutation({
    mutationFn: (id: string) => profileApi.deletePasskey(id),
    onSuccess: async () => {
      notifySuccess('Passkey removed');
      await refreshPasskeys();
    },
    onError: (error: any) => {
      notifyError(error?.message || 'Failed to remove passkey');
    },
  });

  const updatePasskeyMutation = useMutation({
    mutationFn: async () => {
      if (!editingPasskeyId) {
        return;
      }
      return profileApi.updatePasskey(editingPasskeyId, editingPasskeyName);
    },
    onSuccess: async () => {
      notifySuccess('Passkey updated');
      setEditingPasskeyId(null);
      setEditingPasskeyName('');
      await refreshPasskeys();
    },
    onError: (error: any) => {
      notifyError(error?.message || 'Failed to update passkey');
    },
  });

  const linkSsoMutation = useMutation({
    mutationFn: (providerId: string) => profileApi.linkSso(providerId),
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || error?.message || 'Failed to link SSO');
    },
  });

  const unlinkSsoMutation = useMutation({
    mutationFn: (payload: { providerId: string; accountId?: string }) =>
      profileApi.unlinkSso(payload.providerId, payload.accountId),
    onSuccess: () => {
      notifySuccess('SSO unlinked');
      queryClient.invalidateQueries({ queryKey: ['profile-sso-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
    onError: (error: any) => {
      notifyError(error?.response?.data?.error || error?.message || 'Failed to unlink SSO');
    },
  });

  if (isLoading) {
    return <div className="text-sm text-slate-600 dark:text-slate-300">Loading profile...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Profile</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Manage your account security, sign-in methods, and linked providers.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              {(profile?.username?.slice(0, 2) || profile?.email?.slice(0, 2) || 'U').toUpperCase()}
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">
                {profile?.username || 'Catalyst User'}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{profile?.email}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-800">
              2FA {profile?.twoFactorEnabled ? 'enabled' : 'disabled'}
            </span>
            <span className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-800">
              Password {profile?.hasPassword ? 'set' : 'unset'}
            </span>
            {profile?.createdAt ? (
              <span className="rounded-full border border-slate-200 px-3 py-1 dark:border-slate-800">
                Joined {new Date(profile.createdAt).toLocaleDateString()}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Password</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">Update or set your account password.</p>
              </div>
            </div>
            {profile?.hasPassword ? (
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Current password"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                />
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="New password"
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                />
                <button
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => changePasswordMutation.mutate()}
                  disabled={!currentPassword || !newPassword || changePasswordMutation.isPending}
                >
                  Update password
                </button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <input
                  type="password"
                  value={setPasswordValue}
                  onChange={(event) => setSetPasswordValue(event.target.value)}
                  placeholder="Set a new password"
                  className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                />
                <button
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => setPasswordMutation.mutate()}
                  disabled={!setPasswordValue || setPasswordMutation.isPending}
                >
                  Set password
                </button>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Two-factor authentication
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {profile?.twoFactorEnabled ? '2FA is enabled' : '2FA is disabled'}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                type="password"
                value={twoFactorPassword}
                onChange={(event) => setTwoFactorPassword(event.target.value)}
                placeholder="Confirm password"
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              />
              {profile?.twoFactorEnabled ? (
                <button
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => disableTwoFactorMutation.mutate()}
                  disabled={!twoFactorPassword || disableTwoFactorMutation.isPending}
                >
                  Disable 2FA
                </button>
              ) : (
                <button
                  className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                  onClick={() => enableTwoFactorMutation.mutate()}
                  disabled={!twoFactorPassword || enableTwoFactorMutation.isPending}
                >
                  Enable 2FA
                </button>
              )}
              <button
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                onClick={() => generateBackupCodesMutation.mutate()}
                disabled={!twoFactorPassword || generateBackupCodesMutation.isPending}
              >
                Generate backup codes
              </button>
            </div>
            {backupCodes.length > 0 ? (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                <div className="font-semibold text-slate-700 dark:text-slate-200">Backup codes</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  {backupCodes.map((code) => (
                    <span key={code} className="rounded bg-white px-2 py-1 dark:bg-slate-800">
                      {code}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {twoFactorModalOpen ? (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
                <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Set up authenticator</h2>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    Scan the QR code in your authenticator app to finish enabling TOTP.
                  </p>
                  {qrValue ? (
                    <img
                      src={qrValue}
                      alt="TOTP QR code"
                      className="mt-4 w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
                    />
                  ) : null}
                  {twoFactorSetup?.otpAuthUrl ? (
                    <a
                      href={twoFactorSetup.otpAuthUrl}
                      className="mt-3 block text-xs font-medium text-primary-600 hover:text-primary-500"
                    >
                      Open in authenticator app
                    </a>
                  ) : null}
                  {twoFactorSetup?.secret ? (
                    <div className="mt-3 text-xs text-slate-600 dark:text-slate-300">
                      Manual code: <span className="font-semibold">{twoFactorSetup.secret}</span>
                    </div>
                  ) : null}
                  {twoFactorSetup?.backupCodes?.length ? (
                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                      <div className="font-semibold text-slate-700 dark:text-slate-200">Backup codes</div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        {twoFactorSetup.backupCodes.map((code) => (
                          <span key={code} className="rounded bg-white px-2 py-1 dark:bg-slate-800">
                            {code}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
                    onClick={() => {
                      setTwoFactorModalOpen(false);
                      setTwoFactorSetup(null);
                    }}
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Passkeys</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Add hardware-backed sign-in methods for faster access.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                value={passkeyName}
                onChange={(event) => setPasskeyName(event.target.value)}
                placeholder="Passkey name (optional)"
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              />
              <button
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
                onClick={() => addPasskeyMutation.mutate()}
                disabled={addPasskeyMutation.isPending}
              >
                Add passkey
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {passkeys.length === 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">No passkeys registered.</div>
              ) : (
                passkeys.map((passkey) => (
                  <div
                    key={passkey.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
                  >
                    {editingPasskeyId === passkey.id ? (
                      <input
                        value={editingPasskeyName}
                        onChange={(event) => setEditingPasskeyName(event.target.value)}
                        className="rounded border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                      />
                    ) : (
                      <span>{passkey.name || 'Unnamed passkey'}</span>
                    )}
                    <div className="flex items-center gap-2">
                      {editingPasskeyId === passkey.id ? (
                        <button
                          className="text-xs font-semibold text-primary-600 hover:text-primary-500"
                          onClick={() => updatePasskeyMutation.mutate()}
                          disabled={!editingPasskeyName}
                        >
                          Save
                        </button>
                      ) : (
                        <button
                          className="text-xs font-semibold text-primary-600 hover:text-primary-500"
                          onClick={() => {
                            setEditingPasskeyId(passkey.id);
                            setEditingPasskeyName(passkey.name || '');
                          }}
                        >
                          Rename
                        </button>
                      )}
                      <button
                        className="text-xs font-semibold text-rose-500 hover:text-rose-400"
                        onClick={() => deletePasskeyMutation.mutate(passkey.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">SSO accounts</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Manage linked billing or panel providers.
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {availableProviders.map((provider) => (
                <button
                  key={provider}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-800 dark:text-slate-300 dark:hover:border-primary-500/30"
                  onClick={() => linkSsoMutation.mutate(provider)}
                >
                  Link {provider.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {(ssoAccounts ?? []).filter((account) => account.providerId !== 'credential').length === 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">No SSO accounts linked.</div>
              ) : (
                (ssoAccounts ?? [])
                  .filter((account) => account.providerId !== 'credential')
                  .map((account) => (
                    <div
                      key={account.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-200"
                    >
                      <span>
                        {account.providerId.toUpperCase()} • {account.accountId}
                      </span>
                      <button
                        className="text-xs font-semibold text-rose-500 hover:text-rose-400"
                        onClick={() =>
                          unlinkSsoMutation.mutate({ providerId: account.providerId, accountId: account.accountId })
                        }
                      >
                        Unlink
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ProfilePage;
