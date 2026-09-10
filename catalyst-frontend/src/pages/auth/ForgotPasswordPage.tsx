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
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
 <div className="app-shell relative flex min-h-screen items-center justify-center px-4 font-sans">
 <div className="absolute right-4 top-4 z-20">
 <LanguageSwitcher variant="compact" />
 </div>
 <Card className="w-full max-w-md border-border/80 bg-card/90 shadow-elevated">
 <CardContent className="px-3 py-4 sm:px-4">
 <div className="flex items-start gap-2.5">
 <img src={logoUrl} alt={t('logoAlt', { panelName })} className="h-8 w-8 rounded-md border border-border/70" onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
 <div className="min-w-0">
 <h1 className="text-sm font-semibold tracking-tight text-foreground">{t('forgotPassword.title')}</h1>
 <p className="type-meta mt-0.5">
 {t('forgotPassword.subtitle')}
 </p>
 </div>
 </div>

 {isSubmitted ? (
 <div className="mt-6 space-y-4">
 <div className="rounded-lg border border-success/20 bg-success/5 px-4 py-4">
 <p className="text-sm text-success">
 {t('forgotPassword.success')}
 </p>
 </div>
 <Button asChild className="w-full">
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
 />
 </div>

 <Button type="submit" className="w-full" disabled={isLoading}>
 {isLoading ? t('forgotPassword.submitting') : t('forgotPassword.submit')}
 </Button>

 <div className="text-center">
 <Link
 to="/login"
 className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
 >
 {t('forgotPassword.backToLogin')}
 </Link>
 </div>
 </form>
 )}
 </CardContent>
 </Card>
 <BrandFooter />
 </div>
 );
}

export default ForgotPasswordPage;
