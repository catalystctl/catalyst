import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@/csync';
import { qk } from '../lib/queryKeys';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { serversApi } from '../services/api/servers';
import { notifyError, notifySuccess } from '../utils/notify';
import { useAuthStore } from '../stores/authStore';
import { reportSystemError } from '../services/api/systemErrors';
import type { ServerInvitePreview } from '../types/server';
import { Mail } from 'lucide-react';
import TabHeader from '../components/servers/tabs/TabHeader';
import ServerTabCard from '../components/servers/tabs/ServerTabCard';

function InvitesPage() {
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
 notifySuccess('Invite accepted');
 navigate('/servers');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.servers() });
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
 navigate('/servers');
 },
 onSettled: () => {
 queryClient.invalidateQueries({ queryKey: qk.servers() });
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
 <div className="mx-auto max-w-lg space-y-4">
 <TabHeader icon={Mail} title="Server Invite" description="Create your account to accept the invite. Your email is locked to the invite address." />
 <ServerTabCard>
 {invitePreview ? (
 <div className="rounded-lg border border-border/30 bg-surface-2 px-4 py-3 text-xs text-muted-foreground">
 <div className="text-muted-foreground">Server</div>
 <div className="text-sm font-semibold text-foreground">{invitePreview.serverName}</div>
 <div className="mt-2 text-muted-foreground">Permissions</div>
 <div className="text-xs text-foreground">{invitePreview.permissions.join(', ')}</div>
 </div>
 ) : null}
 <div className="mt-4 space-y-3 text-sm text-muted-foreground">
 <label className="block text-xs text-muted-foreground">
 Email
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={invitePreview?.email ?? ''}
 placeholder="invitee@example.com"
 disabled
 />
 </label>
 <label className="block text-xs text-muted-foreground">
 Username
 <input
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={registerUsername}
 onChange={(event) => setRegisterUsername(event.target.value)}
 placeholder="yourname"
 />
 </label>
 <label className="block text-xs text-muted-foreground">
 Password
 <input
 type="password"
 className="mt-1 w-full rounded-lg border border-border/40 bg-card px-3 py-2 text-sm text-foreground transition-all duration-300 focus:border-primary focus:outline-none"
 value={registerPassword}
 onChange={(event) => setRegisterPassword(event.target.value)}
 placeholder="••••••••"
 />
 </label>
 </div>
 <div className="mt-4 flex flex-wrap gap-2">
 <button
 className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
 onClick={() => registerMutation.mutate()}
 disabled={!token || !canRegister || registerMutation.isPending}
 >
 Create account & accept
 </button>
 <button
 className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground"
 onClick={() => navigate('/login', { state: { from: location } })}
 >
 Sign in instead
 </button>
 </div>
 </ServerTabCard>
 </div>
 );
 }

 return (
 <div className="mx-auto max-w-lg space-y-4">
 <TabHeader icon={Mail} title="Server Invite" description="Accept the invite to gain access to the server. You must be logged in with the invited email." />
 <ServerTabCard>
 <button
 className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all duration-300 hover:bg-primary/90 disabled:opacity-60"
 onClick={() => acceptMutation.mutate()}
 disabled={!token || acceptMutation.isPending || accepted}
 >
 Accept invite
 </button>
 </ServerTabCard>
 </div>
 );
}

export default InvitesPage;
