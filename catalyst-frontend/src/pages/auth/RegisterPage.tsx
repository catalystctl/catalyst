import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../stores/authStore';
import type { RegisterSchema } from '../../validators/auth';
import { createRegisterSchema } from '../../validators/auth';
import { reportSystemError } from '../../services/api/systemErrors';
import { describeError } from '../../utils/errors';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';
import { BrandFooter } from '../../components/shared/BrandFooter';
import { usePanelBranding } from '../../hooks/usePanelBranding';
import LanguageSwitcher from '../../components/shared/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import FieldError from '../../components/auth/FieldError';
import { showsDemoChrome } from '../../demo/isDemo';

/** One banner recipe shared by every auth card. */
const AUTH_BANNER_CLASS = 'rounded-sm border px-3 py-2.5 text-mini';

function RegisterPage() {
 const { t } = useTranslation(['auth', 'validation']);
 const navigate = useNavigate();
 const registerUser = useAuthStore((s) => s.register);
 const isLoading = useAuthStore((s) => s.isLoading);
 const error = useAuthStore((s) => s.error);
 const { panelName, logoUrl } = usePanelBranding();
 const resolver = useMemo(() => zodResolver(createRegisterSchema(t)), [t]);
 const {
 register,
 handleSubmit,
 watch,
 formState: { errors },
 } = useForm<RegisterSchema>({ resolver });

 const passwordValue = watch('password', '');

 const onSubmit = async (values: RegisterSchema) => {
 try {
 await registerUser(values);
 // Redirect on successful registration
 setTimeout(() => {
 navigate('/servers');
 }, 100);
 } catch (err) {
 reportSystemError({
 level: 'error',
 component: 'RegisterPage',
 message: describeError(err),
 stack: err instanceof Error ? err.stack : undefined,
 metadata: { context: 'onSubmit' },
 });
 // Error is already in the store
 }
 };

 return (
 <div className="app-shell relative flex min-h-[100dvh] items-center justify-center px-4 font-sans">
 <div className={`absolute right-4 z-20 ${showsDemoChrome ? 'top-[calc(2rem+1rem)]' : 'top-4'}`}>
 <LanguageSwitcher variant="compact" />
 </div>
 <div className="deck-panel w-full max-w-md">
 <div className="px-3 py-4 sm:px-4">
 <div className="flex items-start gap-2.5">
 <img src={logoUrl} alt={t('logoAlt', { panelName })} className="h-8 w-8 rounded-sm border border-border/70" onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
 <div className="min-w-0">
 <h1 className="font-display text-lg font-semibold tracking-tight text-foreground">{t('register.title')}</h1>
 <p className="type-meta mt-1">
 {t('register.subtitle')}
 </p>
 </div>
 </div>

 {error ? (
 <div role="alert" className={`mt-4 ${AUTH_BANNER_CLASS} border-danger/25 bg-danger/5 text-danger`}>
 {error}
 </div>
 ) : null}

 <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
 <div className="space-y-2">
 <Label htmlFor="username">{t('fields.username')}</Label>
 <Input
 id="username"
 type="text"
 autoComplete="username"
 placeholder={t('fields.usernamePlaceholder')}
 className={`h-8 rounded-sm text-mini${errors.username ? ' border-danger/50' : ''}`}
 aria-invalid={errors.username ? true : undefined}
 aria-describedby={errors.username ? 'username-error' : undefined}
 {...register('username')}
 />
 <FieldError id="username-error" message={errors.username?.message} />
 </div>

 <div className="space-y-2">
 <Label htmlFor="email">{t('fields.email')}</Label>
 <Input
 id="email"
 type="email"
 autoComplete="email"
 placeholder={t('fields.emailPlaceholder')}
 className={`h-8 rounded-sm text-mini${errors.email ? ' border-danger/50' : ''}`}
 aria-invalid={errors.email ? true : undefined}
 aria-describedby={errors.email ? 'email-error' : undefined}
 {...register('email')}
 />
 <FieldError id="email-error" message={errors.email?.message} />
 </div>

 <div className="space-y-2">
 <Label htmlFor="password">{t('fields.password')}</Label>
 <Input
 id="password"
 type="password"
 autoComplete="new-password"
 placeholder="••••••••"
 className={`h-8 rounded-sm text-mini${errors.password ? ' border-danger/50' : ''}`}
 aria-invalid={errors.password ? true : undefined}
 aria-describedby={errors.password ? 'password-error' : undefined}
 {...register('password')}
 />
 <PasswordStrengthMeter password={passwordValue} />
 <FieldError id="password-error" message={errors.password?.message} />
 </div>

 <Button type="submit" size="sm" className="h-8 w-full text-mini" disabled={isLoading}>
 {isLoading ? t('register.submitting') : t('register.submit')}
 </Button>
 </form>

 <p className="mt-4 text-center text-mini text-muted-foreground">
 {t('register.haveAccount')}{' '}
 <Link
 to="/login"
 className="inline-flex min-h-7 items-center font-medium text-primary transition-colors hover:text-primary/80"
 >
 {t('register.signInLink')}
 </Link>
 </p>
 </div>
 </div>
 <BrandFooter />
 </div>
 );
}

export default RegisterPage;
