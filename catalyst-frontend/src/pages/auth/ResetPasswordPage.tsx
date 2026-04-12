import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../../services/api/auth';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getErrorMessage } from '../../utils/errors';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [isValid, setIsValid] = useState(false);

  useEffect(() => {
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
      notifyError(getErrorMessage(error, 'Failed to reset password'));
    } finally {
      setIsLoading(false);
    }
  };

  if (isValidating) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
        <div className="relative w-full max-w-sm">
          <Card className="border-border shadow-surface-lg">
            <CardContent className="px-6 py-8">
              <div className="flex flex-col items-center text-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-surface-3 border-t-primary" />
                <p className="mt-4 text-sm text-muted-foreground">
                  Validating reset link...
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!token || !isValid) {
    return (
      <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
        <div className="relative w-full max-w-sm">
          <Card className="border-border shadow-surface-lg">
            <CardContent className="px-6 py-8">
              <div className="flex flex-col items-center text-center">
                <img src="/logo.png" alt="Catalyst logo" className="h-10 w-10 rounded-lg" />
              </div>
              <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground">
                Invalid link
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                This password reset link is invalid or has expired. Please request a new one.
              </p>
              <div className="mt-6">
                <Link to="/forgot-password">
                  <Button className="w-full">
                    Request new reset link
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-primary/3 via-transparent to-violet-500/3" />
      <div className="relative w-full max-w-sm">
        <Card className="border-border shadow-surface-lg">
          <CardContent className="px-6 py-8">
            <div className="flex flex-col items-center text-center">
              <img src="/logo.png" alt="Catalyst logo" className="h-10 w-10 rounded-lg" />
              <span className="mt-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Catalyst Panel
              </span>
            </div>

            <h1 className="mt-6 text-xl font-bold tracking-tight text-foreground">
              Reset your password
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter a new password for your account.
            </p>

            {isReset ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                  <p className="text-sm text-emerald-500">
                    Your password has been reset successfully. You can now log in with your new password.
                  </p>
                </div>
                <Link to="/login">
                  <Button className="w-full">
                    Continue to login
                  </Button>
                </Link>
              </div>
            ) : (
              <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
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

                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-xs text-destructive">Passwords do not match</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading || (confirmPassword !== '' && password !== confirmPassword)}
                >
                  {isLoading ? 'Resetting...' : 'Reset password'}
                </Button>

                <div className="text-center">
                  <Link
                    to="/login"
                    className="text-sm font-medium text-primary hover:text-primary-hover transition-colors"
                  >
                    Back to login
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default ResetPasswordPage;
