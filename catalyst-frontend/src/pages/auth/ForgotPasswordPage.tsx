import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../../services/api/auth';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getErrorMessage } from '../../utils/errors';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim()) {
      notifyError('Please enter your email address');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.forgotPassword(email.trim());
      setIsSubmitted(true);
      notifySuccess('Password reset email sent');
    } catch (error: unknown) {
      notifyError(getErrorMessage(error, 'Failed to send reset email'));
    } finally {
      setIsLoading(false);
    }
  };

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
              Forgot password?
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Enter your email address and we'll send you a link to reset your password.
            </p>

            {isSubmitted ? (
              <div className="mt-6 space-y-4">
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                  <p className="text-sm text-emerald-500">
                    If an account exists with that email address, we've sent a password reset link.
                    Please check your inbox (and spam folder).
                  </p>
                </div>
                <Link to="/login">
                  <Button className="w-full">
                    Back to login
                  </Button>
                </Link>
              </div>
            ) : (
              <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? 'Sending...' : 'Send reset link'}
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

export default ForgotPasswordPage;
