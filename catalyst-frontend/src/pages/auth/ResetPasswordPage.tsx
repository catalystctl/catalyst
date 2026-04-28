import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../../services/api/auth';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getErrorMessage } from '../../utils/errors';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';
import { reportSystemError } from '../../services/api/systemErrors';
import { usePanelBranding } from '../../hooks/usePanelBranding';

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);
  const { panelName, logoUrl } = usePanelBranding();

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setIsValidating(false);
      return;
    }

    setIsValidating(true);
    authApi.validateResetToken(token)
      .then(() => setIsValid(true))
      .catch((err) => {
        reportSystemError({
          level: 'error',
          component: 'ResetPasswordPage',
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          metadata: { context: 'validateResetToken' },
        });
        setIsValid(false);
        notifyError('Invalid or expired reset link');
      })
      .finally(() => setIsValidating(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password.trim()) {
      notifyError('Please enter a new password');
      return;
    }

    if (password.length < 8) {
      notifyError('Password must be at least 8 characters');
      return;
    }

    if (password !== confirmPassword) {
      notifyError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.resetPassword(token, password);
      setIsReset(true);
      notifySuccess('Password reset successfully');
    } catch (error: unknown) {
      reportSystemError({
        level: 'error',
        component: 'ResetPasswordPage',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        metadata: { context: 'handleSubmit' },
      });
      notifyError(getErrorMessage(error, 'Failed to reset password'));
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
        <div className="w-full max-w-md rounded-xl border border-border bg-card px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
          <div className="flex flex-col items-center text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-border border-t-primary-600" />
            <p className="mt-4 text-sm text-muted-foreground dark:text-muted-foreground">
              Validating reset link...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!token || !isValid) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
        <div className="w-full max-w-md rounded-xl border border-border bg-card px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
          <div className="flex flex-col items-center text-center">
            <img src={logoUrl} alt={`${panelName} logo`} className="h-12 w-12" onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
          </div>
          <h1 className="mt-6 text-2xl font-semibold text-foreground ">
            Invalid link
          </h1>
          <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
            This password reset link is invalid or has expired. Please request a new one.
          </p>
          <div className="mt-6">
            <Link
              to="/forgot-password"
              className="block w-full rounded-lg bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90"
            >
              Request new reset link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
      <div className="w-full max-w-md rounded-xl border border-border bg-card px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
        <div className="flex flex-col items-center text-center">
          <img src={logoUrl} alt={`${panelName} logo`} className="h-12 w-12" onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
          <span className="mt-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground dark:text-muted-foreground">
            {panelName} Panel
          </span>
        </div>

        <h1 className="mt-6 text-2xl font-semibold text-foreground ">
          Reset your password
        </h1>
        <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
          Enter a new password for your account.
        </p>

        {isReset ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-success/20 bg-success/5 px-4 py-4 dark:border-success/20 dark:bg-success/50/10">
              <p className="text-sm text-success dark:text-success">
                Your password has been reset successfully. You can now log in with your new password.
              </p>
            </div>
            <Link
              to="/login"
              className="block w-full rounded-lg bg-primary px-4 py-2 text-center text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90"
            >
              Continue to login
            </Link>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="block text-sm text-muted-foreground dark:text-foreground" htmlFor="password">
                New password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:bg-surface-1 dark:text-foreground dark:hover:border-primary/30"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordStrengthMeter password={password} />
            </div>

            <div className="space-y-2">
              <label className="block text-sm text-muted-foreground dark:text-foreground" htmlFor="confirmPassword">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:bg-surface-1 dark:text-foreground dark:hover:border-primary/30"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-70"
              disabled={isLoading || (confirmPassword !== '' && password !== confirmPassword)}
            >
              {isLoading ? 'Resetting...' : 'Reset password'}
            </button>

            <div className="text-center">
              <Link
                to="/login"
                className="text-sm font-medium text-primary-600 transition-all duration-300 hover:text-primary dark:text-primary-400 dark:hover:text-primary-300"
              >
                Back to login
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ResetPasswordPage;
