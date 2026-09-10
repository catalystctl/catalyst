import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@/csync';
import { authApi } from '../../services/api/auth';
import { notifyError, notifySuccess } from '../../utils/notify';
import { describeError } from '../../utils/errors';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';
import LanguageSwitcher from '../../components/shared/LanguageSwitcher';
import { reportSystemError } from '../../services/api/systemErrors';
import { usePanelBranding } from '../../hooks/usePanelBranding';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ResetPasswordPage() {
 const { t } = useTranslation('auth');
 const [searchParams] = useSearchParams();
 const token = searchParams.get('token') || '';

 const [password, setPassword] = useState('');
 const [confirmPassword, setConfirmPassword] = useState('');
 const [isLoading, setIsLoading] = useState(false);
 const [isReset, setIsReset] = useState(false);
 const { panelName, logoUrl } = usePanelBranding();

 const {
 isLoading: tokenValidating,
 isSuccess: tokenValid,
 isError: tokenInvalid,
 } = useQuery({
 queryKey: ['resetToken', token],
 queryFn: async () => {
 if (!token) throw new Error('No token');
 await authApi.validateResetToken(token);
 return true;
 },
 enabled: Boolean(token),
 retry: false,
 });

 const isValidating = Boolean(token) && tokenValidating;
 const isValid = tokenValid;

 // Notify once when token is invalid
 useEffect(() => {
 if (tokenInvalid) {
 notifyError(t('resetPassword.invalidLinkToast'));
 }
 }, [tokenInvalid, t]);

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();

 if (!password.trim()) {
 notifyError(t('resetPassword.passwordRequired'));
 return;
 }

 if (password.length < 8) {
 notifyError(t('resetPassword.passwordTooShort', { min: 8 }));
 return;
 }

 if (password !== confirmPassword) {
 notifyError(t('resetPassword.passwordMismatch'));
 return;
 }

 setIsLoading(true);
 try {
 await authApi.resetPassword(token, password);
 setIsReset(true);
 notifySuccess(t('resetPassword.successToast'));
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'ResetPasswordPage',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'handleSubmit' },
 });
 notifyError(error);
 } finally {
 setIsLoading(false);
 }
 };

 if (isValidating) {
 return (
 <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
 <Card className="w-full max-w-md border-border/80 bg-card/90 shadow-elevated">
        <CardContent className="px-3 py-4 sm:px-4">
          <div className="flex flex-col items-center text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
            <p className="type-meta mt-3">{t('resetPassword.validating')}</p>
          </div>
 </CardContent>
 </Card>
 </div>
 );
 }

 if (!token || !isValid) {
 return (
 <div className="app-shell relative flex min-h-screen items-center justify-center px-4 font-sans">
 <div className="absolute right-4 top-4 z-20">
 <LanguageSwitcher variant="compact" />
 </div>
 <Card className="w-full max-w-md border-border/80 bg-card/90 shadow-elevated">
        <CardContent className="px-3 py-4 sm:px-4">
          <div className="flex items-start gap-2.5">
            <img src={logoUrl} alt={t('logoAlt', { panelName })} className="h-8 w-8 rounded-md border border-border/70" onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-tight text-foreground">{t('resetPassword.invalidTitle')}</h1>
              <p className="type-meta mt-0.5">
                {t('resetPassword.invalidDescription')}
              </p>
            </div>
          </div>
 <div className="mt-6">
 <Button asChild className="w-full">
 <Link to="/forgot-password">{t('resetPassword.requestNew')}</Link>
 </Button>
 </div>
 </CardContent>
 </Card>
 </div>
 );
 }

 return (
 <div className="app-shell relative flex min-h-screen items-center justify-center px-4 font-sans">
 <div className="absolute right-4 top-4 z-20">
 <LanguageSwitcher variant="compact" />
 </div>
 <Card className="w-full max-w-md border-border/80 bg-card/90 shadow-elevated">
        <CardContent className="px-3 py-4 sm:px-4">
          <div className="flex items-start gap-2.5">
            <img src={logoUrl} alt={t('logoAlt', { panelName })} className="h-8 w-8 rounded-md border border-border/70" onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-tight text-foreground">{t('resetPassword.title')}</h1>
              <p className="type-meta mt-0.5">{t('resetPassword.subtitle')}</p>
            </div>
          </div>

 {isReset ? (
 <div className="mt-6 space-y-4">
 <div className="rounded-lg border border-success/20 bg-success/5 px-4 py-4">
 <p className="text-sm text-success">
 {t('resetPassword.success')}
 </p>
 </div>
 <Button asChild className="w-full">
 <Link to="/login">{t('resetPassword.continueToLogin')}</Link>
 </Button>
 </div>
 ) : (
 <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
 <div className="space-y-2">
 <Label htmlFor="password">{t('resetPassword.newPassword')}</Label>
 <Input
 id="password"
 type="password"
 autoComplete="new-password"
 placeholder="••••••••"
 value={password}
 onChange={(e) => setPassword(e.target.value)}
 />
 <PasswordStrengthMeter password={password} />
 </div>

 <div className="space-y-2">
 <Label htmlFor="confirmPassword">{t('resetPassword.confirmPassword')}</Label>
 <Input
 id="confirmPassword"
 type="password"
 autoComplete="new-password"
 placeholder="••••••••"
 value={confirmPassword}
 onChange={(e) => setConfirmPassword(e.target.value)}
 />
 {confirmPassword && password !== confirmPassword && (
 <p className="text-xs text-destructive">{t('resetPassword.passwordMismatch')}</p>
 )}
 </div>

 <Button
 type="submit"
 className="w-full"
 disabled={isLoading || (confirmPassword !== '' && password !== confirmPassword)}
 >
 {isLoading ? t('resetPassword.submitting') : t('resetPassword.submit')}
 </Button>

 <div className="text-center">
 <Link
 to="/login"
 className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
 >
 {t('resetPassword.backToLogin')}
 </Link>
 </div>
 </form>
 )}
 </CardContent>
 </Card>
 </div>
 );
}

export default ResetPasswordPage;
