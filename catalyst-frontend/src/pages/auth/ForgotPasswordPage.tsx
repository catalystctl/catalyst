import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../services/api/auth';
import { notifyError, notifySuccess } from '../../utils/notify';
import { describeError } from '../../utils/errors';
import { reportSystemError } from '../../services/api/systemErrors';
import { usePanelBranding } from '../../hooks/usePanelBranding';
import { BrandFooter } from '../../components/shared/BrandFooter';
import LanguageSwitcher from '../../components/shared/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** One banner recipe shared by every auth card. */
const AUTH_BANNER_CLASS = 'rounded-sm border px-3 py-2.5 text-mini';

function ForgotPasswordPage() {
 const { t } = useTranslation('auth');
 const [email, setEmail] = useState('');
 const [isLoading, setIsLoading] = useState(false);
 const [isSubmitted, setIsSubmitted] = useState(false);
 const { panelName, logoUrl } = usePanelBranding();

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();

 if (!email.trim()) {
 notifyError(t('forgotPassword.emailRequired'));
 return;
 }

 setIsLoading(true);
 try {
 await authApi.forgotPassword(email.trim());
 setIsSubmitted(true);
 notifySuccess(t('forgotPassword.sentToast'));
 } catch (error: unknown) {
 reportSystemError({
 level: 'error',
 component: 'ForgotPasswordPage',
 message: describeError(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'handleSubmit' },
 });
 notifyError(error);
 } finally {
 setIsLoading(false);
 }
 };

 return (
 <div className="app-shell relative flex min-h-[100dvh] items-center justify-center px-4 font-sans">
 <div className="absolute right-4 top-4 z-20">
 <LanguageSwitcher variant="compact" />
 </div>
 <div className="deck-panel w-full max-w-md">
 <div className="px-3 py-4 sm:px-4">
 <div className="flex items-start gap-2.5">
 <img src={logoUrl} alt={t('logoAlt', { panelName })} className="h-8 w-8 rounded-sm border border-border/70" onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
 <div className="min-w-0">
 <h1 className="font-display text-lg font-semibold tracking-tight text-foreground">{t('forgotPassword.title')}</h1>
 <p className="type-meta mt-1">
 {t('forgotPassword.subtitle')}
 </p>
 </div>
 </div>

 {isSubmitted ? (
 <div className="mt-6 space-y-4">
 <div role="alert" className={`${AUTH_BANNER_CLASS} border-success/25 bg-success/5 text-success`}>
 <p className="text-mini text-success">
 {t('forgotPassword.success')}
 </p>
 </div>
 <Button asChild size="sm" className="h-8 w-full text-mini">
 <Link to="/login">{t('forgotPassword.backToLogin')}</Link>
 </Button>
 </div>
 ) : (
 <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
 <div className="space-y-2">
 <Label htmlFor="email">{t('fields.emailAddress')}</Label>
 <Input
 id="email"
 type="email"
 autoComplete="email"
 placeholder={t('fields.emailPlaceholder')}
 value={email}
 onChange={(e) => setEmail(e.target.value)}
 className="h-8 rounded-sm text-mini"
 />
 </div>

 <Button type="submit" size="sm" className="h-8 w-full text-mini" disabled={isLoading}>
 {isLoading ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
 </Button>

 <div className="text-center">
 <Link
 to="/login"
 className="inline-flex min-h-7 items-center text-mini font-medium text-primary transition-colors hover:text-primary/80"
 >
 {t('forgotPassword.backToLogin')}
 </Link>
 </div>
 </form>
 )}
 </div>
 </div>
 <BrandFooter />
 </div>
 );
}

export default ForgotPasswordPage;
