import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { authApi } from '../../services/api/auth';
import { notifyError, notifySuccess } from '../../utils/notify';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);

  // Validate token on mount
  useState(() => {
    if (!token) {
      setIsValidating(false);
      return;
    }

    setIsValidating(true);
    authApi.validateResetToken(token)
      .then(() => setIsValid(true))
      .catch(() => {
        setIsValid(false);
        notifyError('Invalid or expired reset link');
      })
      .finally(() => setIsValidating(false));
  });

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
    } catch (error: any) {
      const message = error?.response?.data?.error || 'Failed to reset password';
      notifyError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col items-center text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-slate-200 border-t-primary-600" />
            <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">
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
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col items-center text-center">
            <img src="/logo.png" alt="Catalyst logo" className="h-12 w-12" />
          </div>
          <h1 className="mt-6 text-2xl font-semibold text-slate-900 dark:text-white">
            Invalid link
          </h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            This password reset link is invalid or has expired. Please request a new one.
          </p>
          <div className="mt-6">
            <Link
              to="/forgot-password"
              className="block w-full rounded-lg bg-primary-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
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
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col items-center text-center">
          <img src="/logo.png" alt="Catalyst logo" className="h-12 w-12" />
          <span className="mt-2 text-sm font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Catalyst Panel
          </span>
        </div>

        <h1 className="mt-6 text-2xl font-semibold text-slate-900 dark:text-white">
          Reset your password
        </h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
          Enter a new password for your account.
        </p>

        {isReset ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-4 dark:border-emerald-500/20 dark:bg-emerald-500/10">
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                Your password has been reset successfully. You can now log in with your new password.
              </p>
            </div>
            <Link
              to="/login"
              className="block w-full rounded-lg bg-primary-600 px-4 py-2 text-center text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
            >
              Continue to login
            </Link>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="block text-sm text-slate-600 dark:text-slate-300" htmlFor="password">
                New password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordStrengthMeter password={password} />
            </div>

            <div className="space-y-2">
              <label className="block text-sm text-slate-600 dark:text-slate-300" htmlFor="confirmPassword">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-primary-400 dark:hover:border-primary-500/30"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-rose-500">Passwords do not match</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-70"
              disabled={isLoading || (confirmPassword !== '' && password !== confirmPassword)}
            >
              {isLoading ? 'Resetting...' : 'Reset password'}
            </button>

            <div className="text-center">
              <Link
                to="/login"
                className="text-sm font-medium text-primary-600 transition-all duration-300 hover:text-primary-500 dark:text-primary-400 dark:hover:text-primary-300"
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
