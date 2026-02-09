import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { serversApi } from '../services/api/servers';
import { notifyError, notifySuccess } from '../utils/notify';
import { useAuthStore } from '../stores/authStore';
import type { ServerInvitePreview } from '../types/server';

function InvitesPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, setSession } = useAuthStore();
  const [accepted, setAccepted] = useState(false);
  const [registerUsername, setRegisterUsername] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const { data: invitePreview } = useQuery<ServerInvitePreview>({
    queryKey: ['invite-preview', token],
    queryFn: async () => {
      const response = await serversApi.previewInvite(token ?? '');
      return response.data;
    },
    enabled: Boolean(token),
  });
  useEffect(() => {
    if (!invitePreview?.email) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRegisterUsername((current) => current || invitePreview.email.split('@')[0]);
  }, [invitePreview?.email]);

  const acceptMutation = useMutation({
    mutationFn: () => serversApi.acceptInvite(token ?? ''),
    onSuccess: () => {
      setAccepted(true);
      notifySuccess('Invite accepted');
      navigate('/servers');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to accept invite';
      notifyError(message);
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!token) throw new Error('Missing invite token');
      const response = await serversApi.registerInvite({
        token,
        username: registerUsername.trim(),
        password: registerPassword,
      });
      return response;
    },
    onSuccess: (response: any) => {
      if (response?.data?.userId) {
        setSession({
          user: {
            id: response.data.userId,
            email: response.data.email,
            username: response.data.username,
            role: 'user',
            permissions: response.data.permissions ?? [],
          },
        });
      }
      notifySuccess('Account created and invite accepted');
      navigate('/servers');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to accept invite';
      notifyError(message);
    },
  });

  const canRegister = useMemo(
    () => registerUsername.trim().length >= 3 && registerPassword.length >= 8,
    [registerPassword, registerUsername],
  );

  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white px-6 py-6 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Server Invite</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Create your account to accept the invite. Your email is locked to the invite address.
        </p>
        {invitePreview ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
            <div className="text-slate-500 dark:text-slate-400">Server</div>
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{invitePreview.serverName}</div>
            <div className="mt-2 text-slate-500 dark:text-slate-400">Permissions</div>
            <div className="text-xs text-slate-700 dark:text-slate-200">{invitePreview.permissions.join(', ')}</div>
          </div>
        ) : null}
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
          <label className="block text-xs text-slate-600 dark:text-slate-300">
            Email
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
              value={invitePreview?.email ?? ''}
              placeholder="invitee@example.com"
              disabled
            />
          </label>
          <label className="block text-xs text-slate-600 dark:text-slate-300">
            Username
            <input
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
              value={registerUsername}
              onChange={(event) => setRegisterUsername(event.target.value)}
              placeholder="yourname"
            />
          </label>
          <label className="block text-xs text-slate-600 dark:text-slate-300">
            Password
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400"
              value={registerPassword}
              onChange={(event) => setRegisterPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
            onClick={() => registerMutation.mutate()}
            disabled={!token || !canRegister || registerMutation.isPending}
          >
            Create account & accept
          </button>
          <button
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition-all duration-300 hover:border-primary-500 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-primary-500/30"
            onClick={() => navigate('/login', { state: { from: location } })}
          >
            Sign in instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white px-6 py-6 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-primary-500/30">
      <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Server Invite</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Accept the invite to gain access to the server. You must be logged in with the invited email.
      </p>
      <button
        className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-60"
        onClick={() => acceptMutation.mutate()}
        disabled={!token || acceptMutation.isPending || accepted}
      >
        Accept invite
      </button>
    </div>
  );
}

export default InvitesPage;
