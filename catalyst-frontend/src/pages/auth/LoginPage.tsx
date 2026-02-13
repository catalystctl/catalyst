import { type BaseSyntheticEvent, useEffect, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../services/api/auth';
import type { LoginSchema } from '../../validators/auth';
import { loginSchema } from '../../validators/auth';
import { authClient } from '../../services/authClient';
import { notifyError } from '../../utils/notify';
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
  const { login, verifyTwoFactor, isLoading, error, setSession } = useAuthStore();
  const [authStep, setAuthStep] = useState<'passkey' | 'totp' | null>(null);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [allowPasskeyFallback, setAllowPasskeyFallback] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [totpTrustDevice, setTotpTrustDevice] = useState(false);
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [lastRememberMe, setLastRememberMe] = useState<boolean | undefined>(undefined);
  const passkeyAutoFillAttempted = useRef(false);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<LoginSchema>({ 
    resolver: zodResolver(loginSchema),
  });
  

  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string } } | undefined)?.from?.pathname;

  const syncPasskeySession = async () => {
    try {
      const { user } = await authApi.refresh();
      setSession({ user });
      return true;
    } catch {
      return false;
    }
  };

  const applyPasskeySession = async (data?: any, tokenOverride?: string | null) => {
    const token = tokenOverride || data?.session?.token || null;

    if (token) {
      const rememberMe = localStorage.getItem('catalyst-remember-me') === 'true';
      if (rememberMe) {
        localStorage.setItem('catalyst-auth-token', token);
        sessionStorage.removeItem('catalyst-session-token');
      } else {
        sessionStorage.setItem('catalyst-session-token', token);
        localStorage.removeItem('catalyst-auth-token');
      }
      useAuthStore.setState({ token });
    }

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
      setLastRememberMe(values.rememberMe);
    } catch (err) {
      if ((err as any).code === 'PASSKEY_REQUIRED') {
        setAuthStep('passkey');
        return;
      }
      if ((err as any).code === 'TWO_FACTOR_REQUIRED') {
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
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setAuthStep('passkey');
        return;
      }
      notifyError('Passkey sign-in failed');
    } finally {
      setPasskeySubmitting(false);
    }
  };

  useEffect(() => {
    if (passkeyAutoFillAttempted.current) return;
    if (
      typeof window === 'undefined' ||
      !window.PublicKeyCredential?.isConditionalMediationAvailable
    )
      return;
    void window.PublicKeyCredential.isConditionalMediationAvailable().then((isAvailable) => {
      if (!isAvailable) return;
      passkeyAutoFillAttempted.current = true;
      return authClient.signIn
        .passkey({
          autoFill: true,
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
                setAllowPasskeyFallback(false);
                setTimeout(() => navigate(from || '/servers'), 100);
              });
            },
          },
        })
        .catch((err: any) => {
          if (err?.code === 'AUTH_CANCELLED' || err?.name === 'AbortError') return;
        })
        .finally(() => setPasskeySubmitting(false));
    });
  }, []);

  const handleProvider = async (providerId: 'whmcs' | 'paymenter') => {
    try {
      await authApi.signInWithProvider(providerId);
    } catch {
      return;
    }
  };

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
    } catch (err: any) {
      setTotpError(
        err?.response?.data?.message || err?.message || 'Two-factor verification failed',
      );
    } finally {
      setTotpSubmitting(false);
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
      <Card className="w-full max-w-md">
        <CardContent className="px-6 py-8">
          <div className="flex flex-col items-center text-center">
            <img src="/logo.png" alt="Catalyst logo" className="h-12 w-12" />
            <span className="mt-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Catalyst Panel
            </span>
          </div>
          <h1 className="mt-6 text-2xl font-semibold text-slate-900 dark:text-white">
            Welcome back
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Sign in to manage your servers.
          </p>

          {error && !authStep && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>{error}</AlertDescription>
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
              {errors.email && <p className="text-xs text-red-400">{errors.email.message}</p>}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs font-medium text-primary-600 transition-all duration-300 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
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
              {errors.password && <p className="text-xs text-red-400">{errors.password.message}</p>}
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

          <div className="mt-6 space-y-2">
            <Button variant="outline" className="w-full" onClick={() => handleProvider('whmcs')}>
              Continue with WHMCS
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => handleProvider('paymenter')}
            >
              Continue with Paymenter
            </Button>
          </div>
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
    </div>
  );
}

export default LoginPage;
