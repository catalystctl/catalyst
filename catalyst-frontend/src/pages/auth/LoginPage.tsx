import { type BaseSyntheticEvent, useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

import { authApi } from '../../services/api/auth';
import type { LoginSchema } from '../../validators/auth';
import { loginSchema } from '../../validators/auth';
import { authClient } from '../../services/authClient';
import { reportSystemError } from '../../services/api/systemErrors';
import { notifyError } from '../../utils/notify';
import { getErrorMessage } from '../../utils/errors';
import { useThemeStore } from '../../stores/themeStore';
import { usePanelBranding } from '../../hooks/usePanelBranding';
import { BrandFooter } from '../../components/shared/BrandFooter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';

function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const verifyTwoFactor = useAuthStore((s) => s.verifyTwoFactor);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const setSession = useAuthStore((s) => s.setSession);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isReady = useAuthStore((s) => s.isReady);
  const [authStep, setAuthStep] = useState<'passkey' | 'totp' | null>(null);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [allowPasskeyFallback, setAllowPasskeyFallback] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [totpTrustDevice, setTotpTrustDevice] = useState(false);
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<LoginSchema>({ 
    resolver: zodResolver(loginSchema),
  });
  

  const location = useLocation();
  const [searchParams] = useSearchParams();
  const ssoError = searchParams.get('error');
  const ssoProvider = searchParams.get('provider');
  const from = (location.state as { from?: { pathname?: string } } | undefined)?.from?.pathname;

  // Redirect away from /login if already authenticated.
  // Only triggers once isReady is true (after init() completes) to avoid
  // racing with the initial session check.  The ref prevents re-triggering
  // on every re-render.
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (isAuthenticated && isReady && !redirectedRef.current) {
      redirectedRef.current = true;
      navigate(from || '/servers', { replace: true });
    }
  }, [isAuthenticated, isReady]);

  const syncPasskeySession = async () => {
    try {
      const { user } = await authApi.refresh();
      setSession({ user });
      return true;
    } catch (err) {
      reportSystemError({
        level: 'error',
        component: 'LoginPage',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'syncPasskeySession' },
      });
      return false;
    }
  };

  const applyPasskeySession = async (data?: any, _tokenOverride?: string | null) => {
    // Cookie-based auth: HttpOnly cookies are set by the backend.
    // No need to store tokens in localStorage/sessionStorage.
    if (data?.user) {
      setSession({ user: data.user });
      useAuthStore.setState({ isAuthenticated: true });
      await syncPasskeySession();
      return true;
    }

    return syncPasskeySession();
  };

  const onSubmit = async (values: LoginSchema, fallbackOverride?: boolean | BaseSyntheticEvent) => {
    const allowFallback =
      typeof fallbackOverride === 'boolean' ? fallbackOverride : allowPasskeyFallback;
    try {
      if (!values.email || !values.password) {
        setAuthStep('passkey');
        return;
      }
      localStorage.setItem('catalyst-remember-me', values.rememberMe ? 'true' : 'false');
      await login(
        { ...values, allowPasskeyFallback: Boolean(allowFallback) },
        allowFallback ? { forcePasskeyFallback: true } : undefined,
      );
      setTimeout(() => navigate(from || '/servers'), 100);
    } catch (err) {
      reportSystemError({
        level: 'error',
        component: 'LoginPage',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'onSubmit' },
      });
      const error = err as { code?: string };
      if (error.code === 'PASSKEY_REQUIRED') {
        setAuthStep('passkey');
        return;
      }
      if (error.code === 'TWO_FACTOR_REQUIRED') {
        setTotpError(null);
        setAuthStep('totp');
      }
    }
  };

  const handlePasskeySignIn = async () => {
    try {
      setPasskeySubmitting(true);
      await authClient.signIn.passkey({
        fetchOptions: {
          onError(context) {
            if (context.error?.code === 'AUTH_CANCELLED' || context.error?.name === 'AbortError')
              return;
            notifyError(context.error?.message || 'Passkey sign-in failed');
          },
          onSuccess(context) {
            const token = context.response?.headers?.get?.('set-auth-token') || null;
            void applyPasskeySession(context.data, token).then(() => {
              setAuthStep(null);
              setTimeout(() => navigate(from || '/servers'), 100);
            });
          },
        },
      });
    } catch (err: unknown) {
      reportSystemError({
        level: 'error',
        component: 'LoginPage',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'handlePasskeySignIn' },
      });
      const error = err as { name?: string };
      if (error?.name === 'AbortError') {
        setAuthStep('passkey');
        return;
      }
      notifyError('Passkey sign-in failed');
    } finally {
      setPasskeySubmitting(false);
    }
  };

  const handleProvider = async (providerId: 'whmcs' | 'paymenter') => {
    try {
      await authApi.signInWithProvider(providerId);
    } catch (err) {
      reportSystemError({
        level: 'error',
        component: 'LoginPage',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'handleProvider' },
      });
      return;
    }
  };

  const authProviders = useThemeStore((s) => s.themeSettings?.authProviders);
  const showWhmcs = authProviders?.whmcs ?? false;
  const showPaymenter = authProviders?.paymenter ?? false;
  const { panelName, logoUrl } = usePanelBranding();

  const handleTotpSubmit = async () => {
    if (!totpCode) {
      setTotpError('Enter a verification code');
      return;
    }
    setTotpSubmitting(true);
    setTotpError(null);
    try {
      await verifyTwoFactor({ code: totpCode, trustDevice: totpTrustDevice });
      setAuthStep(null);
      setTotpCode('');
      setTotpTrustDevice(false);
      setTimeout(() => navigate(from || '/servers'), 100);
    } catch (err: unknown) {
      reportSystemError({
        level: 'error',
        component: 'LoginPage',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'handleTotpSubmit' },
      });
      setTotpError(getErrorMessage(err, 'Two-factor verification failed'));
    } finally {
      setTotpSubmitting(false);
    }
  };

  return (
    <div className="app-shell relative flex min-h-screen items-center justify-center px-4 font-sans">
      <Card className="w-full max-w-md">
        <CardContent className="px-6 py-8">
          <div className="flex flex-col items-center text-center">
            <img src={logoUrl} alt={`${panelName} logo`} className="h-12 w-12" onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
            <span className="mt-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              {panelName} Panel
            </span>
          </div>
          <h1 className="mt-6 font-display text-2xl font-bold text-foreground">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to manage your servers.
          </p>

          {error && !authStep && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {ssoError === 'login_required' && !authStep && (
            <Alert className="mt-4 border-blue-500 bg-info/5 text-blue-900 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800">
              <AlertDescription>
                Please log in to your {ssoProvider === 'whmcs' ? 'WHMCS' : 'Paymenter'} account first, then click &quot;{ssoProvider === 'whmcs' ? 'Continue with WHMCS' : 'Continue with Paymenter'}&quot; again.
              </AlertDescription>
            </Alert>
          )}

          <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username webauthn"
                placeholder="you@example.com"
                {...register('email')}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium text-primary-600 transition-all duration-300 hover:text-primary dark:text-primary-400 dark:hover:text-primary-300"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                autoComplete="current-password webauthn"
                placeholder="••••••••"
                {...register('password')}
              />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>

            <Button 
              type="submit" 
              className="w-full" 
              disabled={isLoading || authStep === 'passkey'}
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </Button>

            <div className="flex items-center gap-2">
              <Controller
                name="rememberMe"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    id="rememberMe"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
              <Label htmlFor="rememberMe" className="text-sm font-normal">
                Remember me
              </Label>
            </div>
          </form>

          <div className="mt-4">
            <Button
              variant="outline"
              className="w-full"
              onClick={handlePasskeySignIn}
              disabled={passkeySubmitting}
            >
              {passkeySubmitting ? 'Waiting for passkey…' : 'Sign in with passkey'}
            </Button>
          </div>

          {(showWhmcs || showPaymenter) && (
            <div className="mt-6 space-y-2">
              {showWhmcs && (
                <Button variant="outline" className="w-full" onClick={() => handleProvider('whmcs')}>
                  Continue with WHMCS
                </Button>
              )}
              {showPaymenter && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => handleProvider('paymenter')}
                >
                  Continue with Paymenter
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={authStep === 'passkey'} onOpenChange={() => setAuthStep(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Passkey required</DialogTitle>
            <DialogDescription>
              This account requires a passkey. Use your saved passkey to continue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Button className="w-full" onClick={handlePasskeySignIn} disabled={passkeySubmitting}>
              {passkeySubmitting ? 'Waiting for passkey…' : 'Use passkey'}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setAllowPasskeyFallback(true);
                void handleSubmit((values) =>
                  onSubmit({ ...values, allowPasskeyFallback: true }, true),
                )();
              }}
              disabled={passkeySubmitting}
            >
              Use another way
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={authStep === 'totp'} onOpenChange={() => setAuthStep(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Two-factor verification</DialogTitle>
            <DialogDescription>
              Enter the code from your authenticator app or backup code.
            </DialogDescription>
          </DialogHeader>
          {totpError && (
            <Alert variant="destructive">
              <AlertDescription>{totpError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-3">
            <Input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="123456"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="trustDevice"
                checked={totpTrustDevice}
                onCheckedChange={(checked) => setTotpTrustDevice(checked as boolean)}
              />
              <Label htmlFor="trustDevice" className="text-sm font-normal">
                Trust this device for 30 days
              </Label>
            </div>
            <Button className="w-full" onClick={handleTotpSubmit} disabled={totpSubmitting}>
              {totpSubmitting ? 'Verifying…' : 'Verify'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <BrandFooter />
    </div>
  );
}

export default LoginPage;
