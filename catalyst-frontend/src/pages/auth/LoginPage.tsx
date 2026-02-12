import { type BaseSyntheticEvent, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { authApi } from '../../services/api/auth';
import type { LoginSchema } from '../../validators/auth';
import { loginSchema } from '../../validators/auth';
import { authClient } from '../../services/authClient';
import { notifyError } from '../../utils/notify';

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
    formState: { errors },
  } = useForm<LoginSchema>({ resolver: zodResolver(loginSchema) });

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
    // Extract token from session if not provided as override
    const token = tokenOverride || data?.session?.token || null;
    
    console.log('[LoginPage] applyPasskeySession called', {
      hasData: !!data,
      hasTokenOverride: !!tokenOverride,
      hasSessionToken: !!data?.session?.token,
      extractedToken: token ? 'yes' : 'no',
      dataKeys: data ? Object.keys(data) : [],
      hasUser: !!data?.user,
      fullData: data,
    });
    
    if (token) {
      const rememberMe = localStorage.getItem('catalyst-remember-me') === 'true';
      if (rememberMe) {
        localStorage.setItem('catalyst-auth-token', token);
        sessionStorage.removeItem('catalyst-session-token');
      } else {
        sessionStorage.setItem('catalyst-session-token', token);
        localStorage.removeItem('catalyst-auth-token');
      }
      console.log('[LoginPage] Token saved to storage', { rememberMe, tokenLength: token.length });
      
      // CRITICAL: Set token in Zustand store immediately so WebSocket can use it
      useAuthStore.setState({ token });
      console.log('[LoginPage] Token set in Zustand store');
    }
    
    if (data?.user) {
      // Now set the session with user and authenticated status
      setSession({ user: data.user });
      useAuthStore.setState({ isAuthenticated: true });
      console.log('[LoginPage] User session and authentication status set');
      return true;
    }
    
    console.log('[LoginPage] No user in data, calling syncPasskeySession');
    return syncPasskeySession();
  };

  const onSubmit = async (
    values: LoginSchema,
    fallbackOverride?: boolean | BaseSyntheticEvent,
  ) => {
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
      // Redirect on successful login
      setTimeout(() => {
        navigate(from || '/servers');
      }, 100);
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
            if (context.error?.code === 'AUTH_CANCELLED' || context.error?.name === 'AbortError') {
              return;
            }
            notifyError(context.error?.message || 'Passkey sign-in failed');
          },
          onSuccess(context) {
            const token = context.response?.headers?.get?.('set-auth-token') || null;
            console.log('[LoginPage] Passkey onSuccess', {
              hasData: !!context.data,
              hasToken: !!token,
              contextData: context.data,
            });
            void applyPasskeySession(context.data, token).then(() => {
              setAuthStep(null);
              setTimeout(() => {
                navigate(from || '/servers');
              }, 100);
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
    if (passkeyAutoFillAttempted.current) {
      return;
    }
    if (!PublicKeyCredential?.isConditionalMediationAvailable) {
      return;
    }
    void PublicKeyCredential.isConditionalMediationAvailable().then((isAvailable) => {
      if (!isAvailable) return;
      passkeyAutoFillAttempted.current = true;
      return authClient.signIn.passkey({
        autoFill: true,
        fetchOptions: {
          onError(context) {
            if (context.error?.code === 'AUTH_CANCELLED' || context.error?.name === 'AbortError') {
              return;
            }
            notifyError(context.error?.message || 'Passkey sign-in failed');
          },
          onSuccess(context) {
            const token = context.response?.headers?.get?.('set-auth-token') || null;
            void applyPasskeySession(context.data, token).then(() => {
              setAuthStep(null);
              setAllowPasskeyFallback(false);
              setTimeout(() => {
                navigate(from || '/servers');
              }, 100);
            });
          },
        },
        })
        .catch((err: any) => {
          if (err?.code === 'AUTH_CANCELLED' || err?.name === 'AbortError') {
            return;
          }
        })
        .finally(() => {
          setPasskeySubmitting(false);
        });
    });
  }, []);

  const handleProvider = async (providerId: 'whmcs' | 'paymenter') => {
    try {
      await authApi.signInWithProvider(providerId);
    } catch {
      // handled by redirect plugin
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
      await verifyTwoFactor({
        code: totpCode,
        trustDevice: totpTrustDevice,
        rememberMe: lastRememberMe,
      });
      setAuthStep(null);
      setTotpCode('');
      setTotpTrustDevice(false);
      setTimeout(() => {
        navigate(from || '/servers');
      }, 100);
    } catch (err: any) {
      setTotpError(err?.response?.data?.message || err?.message || 'Two-factor verification failed');
    } finally {
      setTotpSubmitting(false);
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col items-center text-center">
          <img src="/logo.png" alt="Catalyst logo" className="h-12 w-12" />
          <span className="mt-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Catalyst Panel
          </span>
        </div>
        <h1 className="mt-6 text-2xl font-semibold text-slate-900 dark:text-white">Welcome back</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Sign in to manage your servers.
        </p>

        {error && !authStep ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-100/60 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </div>
        ) : null}
        {authStep === 'passkey' ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Passkey required</h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                This account requires a passkey. Use your saved passkey to continue.
              </p>
              <button
                type="button"
                className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-70"
                onClick={handlePasskeySignIn}
                disabled={passkeySubmitting}
              >
                {passkeySubmitting ? 'Waiting for passkey…' : 'Use passkey'}
              </button>
              <button
                type="button"
                className="mt-3 w-full text-sm font-medium text-slate-600 transition-all duration-300 hover:text-primary-600 dark:text-slate-300 dark:hover:text-primary-400"
                onClick={() => {
                  setAllowPasskeyFallback(true);
                  void handleSubmit((values) =>
                    onSubmit({ ...values, allowPasskeyFallback: true }, true),
                  )();
                }}
                disabled={passkeySubmitting}
              >
                Use another way
              </button>
            </div>
          </div>
        ) : null}
        {authStep === 'totp' ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white px-6 py-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Two-factor verification
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Enter the code from your authenticator app or backup code.
              </p>
              {totpError ? (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-100/60 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
                  {totpError}
                </div>
              ) : null}
              <div className="mt-4 space-y-3">
                <input
                  type="text"
                  value={totpCode}
                  onChange={(event) => setTotpCode(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                  placeholder="123456"
                />
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={totpTrustDevice}
                    onChange={(event) => setTotpTrustDevice(event.target.checked)}
                  />
                  Trust this device for 30 days
                </label>
              </div>
              <button
                type="button"
                className="mt-4 w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-70"
                onClick={handleTotpSubmit}
                disabled={totpSubmitting}
              >
                {totpSubmitting ? 'Verifying…' : 'Verify'}
              </button>
            </div>
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="block text-sm text-slate-600 dark:text-slate-300" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username webauthn"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              placeholder="you@example.com"
              {...register('email')}
            />
            {errors.email ? <p className="text-xs text-red-400">{errors.email.message}</p> : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm text-slate-600 dark:text-slate-300" htmlFor="password">
                Password
              </label>
              <Link
                to="/forgot-password"
                className="text-xs font-medium text-primary-600 transition-all duration-300 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password webauthn"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
              placeholder="••••••••"
              {...register('password')}
            />
            {errors.password ? (
              <p className="text-xs text-red-400">{errors.password.message}</p>
            ) : null}
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-70"
            disabled={isLoading || authStep === 'passkey'}
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" className="rounded border-slate-300" {...register('rememberMe')} />
            Remember me
          </label>
        </form>

        <div className="mt-4">
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-700 dark:text-slate-200"
            onClick={handlePasskeySignIn}
            disabled={passkeySubmitting}
          >
            {passkeySubmitting ? 'Waiting for passkey…' : 'Sign in with passkey'}
          </button>
        </div>

        <div className="mt-6 space-y-2">
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-700 dark:text-slate-200"
            onClick={() => handleProvider('whmcs')}
          >
            Continue with WHMCS
          </button>
          <button
            type="button"
            className="w-full rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-all duration-300 hover:border-primary-500 dark:border-slate-700 dark:text-slate-200"
            onClick={() => handleProvider('paymenter')}
          >
            Continue with Paymenter
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
