import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useProfile, useProfileSsoAccounts } from '../hooks/useProfile';
import { type Passkey, profileApi } from '../services/api/profile';
import { notifyError, notifySuccess } from '../utils/notify';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

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
      if (!editingPasskeyId) return;
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

      <Card>
        <CardContent className="px-6 py-5">
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
              <Badge variant="outline">2FA {profile?.twoFactorEnabled ? 'enabled' : 'disabled'}</Badge>
              <Badge variant="outline">Password {profile?.hasPassword ? 'set' : 'unset'}</Badge>
              {profile?.createdAt && (
                <Badge variant="outline">Joined {new Date(profile.createdAt).toLocaleDateString()}</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Password</CardTitle>
              <CardDescription>Update or set your account password.</CardDescription>
            </CardHeader>
            <CardContent>
              {profile?.hasPassword ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                  />
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password"
                  />
                  <Button
                    onClick={() => changePasswordMutation.mutate()}
                    disabled={!currentPassword || !newPassword || changePasswordMutation.isPending}
                  >
                    Update password
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    type="password"
                    value={setPasswordValue}
                    onChange={(e) => setSetPasswordValue(e.target.value)}
                    placeholder="Set a new password"
                    className="flex-1"
                  />
                  <Button
                    onClick={() => setPasswordMutation.mutate()}
                    disabled={!setPasswordValue || setPasswordMutation.isPending}
                  >
                    Set password
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Two-factor authentication</CardTitle>
              <CardDescription>{profile?.twoFactorEnabled ? '2FA is enabled' : '2FA is disabled'}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  type="password"
                  value={twoFactorPassword}
                  onChange={(e) => setTwoFactorPassword(e.target.value)}
                  placeholder="Confirm password"
                  className="flex-1"
                />
                {profile?.twoFactorEnabled ? (
                  <Button
                    variant="outline"
                    onClick={() => disableTwoFactorMutation.mutate()}
                    disabled={!twoFactorPassword || disableTwoFactorMutation.isPending}
                  >
                    Disable 2FA
                  </Button>
                ) : (
                  <Button
                    onClick={() => enableTwoFactorMutation.mutate()}
                    disabled={!twoFactorPassword || enableTwoFactorMutation.isPending}
                  >
                    Enable 2FA
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => generateBackupCodesMutation.mutate()}
                  disabled={!twoFactorPassword || generateBackupCodesMutation.isPending}
                >
                  Generate backup codes
                </Button>
              </div>
              {backupCodes.length > 0 && (
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
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Passkeys</CardTitle>
              <CardDescription>Add hardware-backed sign-in methods for faster access.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  value={passkeyName}
                  onChange={(e) => setPasskeyName(e.target.value)}
                  placeholder="Passkey name (optional)"
                  className="flex-1"
                />
                <Button onClick={() => addPasskeyMutation.mutate()} disabled={addPasskeyMutation.isPending}>
                  Add passkey
                </Button>
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
                        <Input
                          value={editingPasskeyName}
                          onChange={(e) => setEditingPasskeyName(e.target.value)}
                          className="h-8 w-auto"
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
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>SSO accounts</CardTitle>
              <CardDescription>Manage linked billing or panel providers.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {availableProviders.map((provider) => (
                  <Button key={provider} variant="outline" onClick={() => linkSsoMutation.mutate(provider)}>
                    Link {provider.toUpperCase()}
                  </Button>
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
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={twoFactorModalOpen} onOpenChange={setTwoFactorModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set up authenticator</DialogTitle>
            <DialogDescription>
              Scan the QR code in your authenticator app to finish enabling TOTP.
            </DialogDescription>
          </DialogHeader>
          {qrValue && (
            <img
              src={qrValue}
              alt="TOTP QR code"
              className="w-full rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
            />
          )}
          {twoFactorSetup?.otpAuthUrl && (
            <a
              href={twoFactorSetup.otpAuthUrl}
              className="block text-xs font-medium text-primary-600 hover:text-primary-500"
            >
              Open in authenticator app
            </a>
          )}
          {twoFactorSetup?.secret && (
            <div className="text-xs text-slate-600 dark:text-slate-300">
              Manual code: <span className="font-semibold">{twoFactorSetup.secret}</span>
            </div>
          )}
          {twoFactorSetup?.backupCodes?.length && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <div className="font-semibold text-slate-700 dark:text-slate-200">Backup codes</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                {twoFactorSetup.backupCodes.map((code) => (
                  <span key={code} className="rounded bg-white px-2 py-1 dark:bg-slate-800">
                    {code}
                  </span>
                ))}
              </div>
            </div>
          )}
          <Button
            onClick={() => {
              setTwoFactorModalOpen(false);
              setTwoFactorSetup(null);
            }}
          >
            Done
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProfilePage;
