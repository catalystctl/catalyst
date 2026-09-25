import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@/csync';
import { qk } from '../lib/queryKeys';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { serversApi } from '../services/api/servers';
import { notifyError, notifySuccess } from '../utils/notify';
import { useAuthStore } from '../stores/authStore';
import { reportSystemError } from '../services/api/systemErrors';
import type { ServerInvitePreview } from '../types/server';
import ServerTabCard from '../components/servers/tabs/ServerTabCard';
import { BracketLabel } from '../components/deck/primitives';

const INPUT_CLASS =
  'mt-1 h-8 w-full rounded-sm border border-border/60 bg-background/40 px-2.5 text-mini text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary focus:ring-1 focus:ring-primary/40';

function InvitesPage() {
  const { t } = useTranslation('auth');
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);
  const { data: invitePreview } = useQuery<ServerInvitePreview>({
    queryKey: qk.invitePreview(token ?? ''),
    queryFn: async () => {
      const response = await serversApi.previewInvite(token ?? '');
      return response.data;
    },
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const [registerUsername, setRegisterUsername] = useState('');
  const [prevEmail, setPrevEmail] = useState(invitePreview?.email);
  if (invitePreview?.email && invitePreview.email !== prevEmail) {
    setPrevEmail(invitePreview.email);
    setRegisterUsername((current) => current || invitePreview.email.split('@')[0]);
  }
  const [registerPassword, setRegisterPassword] = useState('');

  const acceptMutation = useMutation({
    mutationFn: () => serversApi.acceptInvite(token ?? ''),
    onSuccess: () => {
      setAccepted(true);
      notifySuccess(t('invite.acceptedToast'));
      navigate('/servers');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.servers() });
    },
    onError: (error: any) => {
      notifyError(error);
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
      notifySuccess(t('invite.accountCreatedToast'));
      navigate('/servers');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: qk.servers() });
    },
    onError: (error: any) => {
      notifyError(error);
    },
  });

  const canRegister = useMemo(
    () => registerUsername.trim().length >= 3 && registerPassword.length >= 8,
    [registerPassword, registerUsername],
  );

  /** Deck header — bracket label + display title, no card frame. */
  const header = (description: string) => (
    <header className="flex min-w-0 flex-col gap-1">
      <BracketLabel>{t('invite.serverLabel')}</BracketLabel>
      <h1 className="font-display text-lg font-semibold leading-none tracking-tight text-foreground">
        {t('invite.title')}
      </h1>
      <p className="type-meta">{description}</p>
    </header>
  );

  if (!isAuthenticated) {
    return (
      <div className="mx-auto w-full max-w-lg space-y-3">
        {header(t('invite.registerDescription'))}
        <ServerTabCard>
          {invitePreview ? (
            <div className="rounded-sm border border-border/50 px-3 py-2">
              <div className="type-overline">{t('invite.serverLabel')}</div>
              <div className="font-display text-data font-semibold tracking-tight text-foreground">
                {invitePreview.serverName}
              </div>
              <div className="type-overline mt-2">{t('invite.permissions')}</div>
              <div className="font-mono text-micro tabular-nums text-muted-foreground">
                {invitePreview.permissions.join(', ')}
              </div>
            </div>
          ) : null}
          <div className="mt-3 space-y-3">
            <label className="block type-overline">
              {t('fields.email')}
              <input
                className={INPUT_CLASS}
                value={invitePreview?.email ?? ''}
                placeholder={t('invite.emailPlaceholder')}
                disabled
              />
            </label>
            <label className="block type-overline">
              {t('fields.username')}
              <input
                className={INPUT_CLASS}
                value={registerUsername}
                onChange={(event) => setRegisterUsername(event.target.value)}
                placeholder={t('fields.usernamePlaceholder')}
              />
            </label>
            <label className="block type-overline">
              {t('fields.password')}
              <input
                type="password"
                autoComplete="new-password"
                className={INPUT_CLASS}
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                placeholder="••••••••"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="h-8 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              onClick={() => registerMutation.mutate()}
              disabled={!token || !canRegister || registerMutation.isPending}
            >
              {t('invite.createAccount')}
            </button>
            <button
              className="h-8 rounded-sm border border-border/60 px-3 text-mini font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground"
              onClick={() => navigate('/login', { state: { from: location } })}
            >
              {t('invite.signInInstead')}
            </button>
          </div>
        </ServerTabCard>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-3">
      {header(t('invite.signedInDescription'))}
      <ServerTabCard>
        <button
          className="h-8 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          onClick={() => acceptMutation.mutate()}
          disabled={!token || acceptMutation.isPending || accepted}
        >
          {t('invite.accept')}
        </button>
      </ServerTabCard>
    </div>
  );
}

export default InvitesPage;
