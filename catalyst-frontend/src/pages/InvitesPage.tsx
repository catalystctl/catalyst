import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { serversApi } from '../services/api/servers';
import { notifyError, notifySuccess } from '../utils/notify';
import { useAuthStore } from '../stores/authStore';
import { reportSystemError } from '../services/api/systemErrors';
import type { ServerInvitePreview } from '../types/server';

function InvitesPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();
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
    refetchInterval: 10000,
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
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      navigate('/servers');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Failed to accept invite';
      notifyError(message);
    },
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!token) {
        reportSystemError({ level: 'error', component: 'InvitesPage', message: 'Missing invite token', metadata: { context: 'register mutation' } });
        throw new Error('Missing invite token');
      }
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
      queryClient.invalidateQueries({ queryKey: ['servers'] });
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
      <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-border bg-card px-6 py-6 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary dark:border-border dark:bg-surface-1 dark:hover:border-primary/30">
        <h1 className="text-2xl font-semibold text-foreground ">Server Invite</h1>
        <p className="text-sm text-muted-foreground dark:text-muted-foreground">
          Create your account to accept the invite. Your email is locked to the invite address.
        </p>
        {invitePreview ? (
          <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-xs text-muted-foreground dark:border-border dark:bg-surface-0/60 dark:text-foreground">
            <div className="text-muted-foreground dark:text-muted-foreground">Server</div>
            <div className="text-sm font-semibold text-foreground dark:text-foreground">{invitePreview.serverName}</div>
            <div className="mt-2 text-muted-foreground dark:text-muted-foreground">Permissions</div>
            <div className="text-xs text-foreground dark:text-foreground">{invitePreview.permissions.join(', ')}</div>
          </div>
        ) : null}
        <div className="space-y-3 text-sm text-muted-foreground dark:text-foreground">
          <label className="block text-xs text-muted-foreground dark:text-foreground">
            Email
            <input
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none dark:border-border dark:bg-surface-1 dark:text-foreground "
              value={invitePreview?.email ?? ''}
              placeholder="invitee@example.com"
              disabled
            />
          </label>
          <label className="block text-xs text-muted-foreground dark:text-foreground">
            Username
            <input
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none dark:border-border dark:bg-surface-1 dark:text-foreground "
              value={registerUsername}
              onChange={(event) => setRegisterUsername(event.target.value)}
              placeholder="yourname"
            />
          </label>
          <label className="block text-xs text-muted-foreground dark:text-foreground">
            Password
            <input
              type="password"
              className="mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none dark:border-border dark:bg-surface-1 dark:text-foreground "
              value={registerPassword}
              onChange={(event) => setRegisterPassword(event.target.value)}
              placeholder="••••••••"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
            onClick={() => registerMutation.mutate()}
            disabled={!token || !canRegister || registerMutation.isPending}
          >
            Create account & accept
          </button>
          <button
            className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground dark:border-border dark:text-foreground dark:hover:border-primary/30"
            onClick={() => navigate('/login', { state: { from: location } })}
          >
            Sign in instead
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 rounded-xl border border-border bg-card px-6 py-6 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 hover:border-primary dark:border-border dark:bg-surface-1 dark:hover:border-primary/30">
      <h1 className="text-2xl font-semibold text-foreground ">Server Invite</h1>
      <p className="text-sm text-muted-foreground dark:text-muted-foreground">
        Accept the invite to gain access to the server. You must be logged in with the invited email.
      </p>
      <button
        className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
        onClick={() => acceptMutation.mutate()}
        disabled={!token || acceptMutation.isPending || accepted}
      >
        Accept invite
      </button>
    </div>
  );
}

export default InvitesPage;
