import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@/csync';
import { qk } from '../lib/queryKeys';
import { useLocation, useNavigate, useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { serversApi } from '../services/api/servers';
import { notifyError, notifySuccess } from '../utils/notify';
import { useAuthStore } from '../stores/authStore';
import { reportSystemError } from '../services/api/systemErrors';
import { getLocalizedErrorMessage } from '../i18n/api-errors';
import type { ServerInvitePreview } from '../types/server';
import ServerTabCard from '../components/servers/tabs/ServerTabCard';
import TabEmptyState from '../components/servers/tabs/TabEmptyState';
import TabLoadingState from '../components/servers/tabs/TabLoadingState';
import { BracketLabel } from '../components/deck/primitives';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function InvitesPage() {
  const { t } = useTranslation('auth');
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setSession = useAuthStore((s) => s.setSession);
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);
  const {
    data: invitePreview,
    isLoading: isPreviewLoading,
    isError: isPreviewError,
    error: previewError,
  } = useQuery<ServerInvitePreview>({
    queryKey: qk.invitePreview(token ?? ''),
    queryFn: async () => {
      const response = await serversApi.previewInvite(token ?? '');
      return response.data;
    },
    enabled: Boolean(token),
    staleTime: 60_000,
    // An unusable token should surface as the invalid-invite state promptly
    // rather than sitting in the preview spinner through retry backoff.
    retry: false,
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
    if (!token || isPreviewError) {
      return (
        <div className="mx-auto w-full max-w-lg space-y-3">
          {header(t('invite.registerDescription'))}
          <ServerTabCard>
            <TabEmptyState
              title={getLocalizedErrorMessage(previewError, 'INVITE_NOT_FOUND')}
              action={
                <Button asChild variant="outline" size="sm" className="h-8 text-mini">
                  <Link to="/login">{t('invite.signInInstead')}</Link>
                </Button>
              }
            />
          </ServerTabCard>
        </div>
      );
    }

    if (isPreviewLoading) {
      return (
        <div className="mx-auto w-full max-w-lg space-y-3">
          {header(t('invite.registerDescription'))}
          <ServerTabCard>
            <TabLoadingState rows={3} />
          </ServerTabCard>
        </div>
      );
    }

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
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t('fields.email')}</Label>
              <Input
                id="invite-email"
                className="h-8 bg-background/40 text-mini"
                value={invitePreview?.email ?? ''}
                placeholder={t('invite.emailPlaceholder')}
                disabled
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-username">{t('fields.username')}</Label>
              <Input
                id="invite-username"
                className="h-8 bg-background/40 text-mini"
                value={registerUsername}
                onChange={(event) => setRegisterUsername(event.target.value)}
                placeholder={t('fields.usernamePlaceholder')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-password">{t('fields.password')}</Label>
              <Input
                id="invite-password"
                type="password"
                autoComplete="new-password"
                className="h-8 bg-background/40 text-mini"
                value={registerPassword}
                onChange={(event) => setRegisterPassword(event.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="h-8 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              onClick={() => registerMutation.mutate()}
              disabled={!canRegister || registerMutation.isPending}
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
        {!token || isPreviewError ? (
          <TabEmptyState title={getLocalizedErrorMessage(previewError, 'INVITE_NOT_FOUND')} />
        ) : isPreviewLoading ? (
          <TabLoadingState rows={3} />
        ) : (
          <div className="space-y-3">
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
            <button
              className="h-8 rounded-sm bg-primary px-3 text-mini font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
              onClick={() => acceptMutation.mutate()}
              disabled={acceptMutation.isPending || accepted}
            >
              {t('invite.accept')}
            </button>
          </div>
        )}
      </ServerTabCard>
    </div>
  );
}

export default InvitesPage;
