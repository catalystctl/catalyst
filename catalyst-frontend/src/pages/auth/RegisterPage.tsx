import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import type { RegisterSchema } from '../../validators/auth';
import { registerSchema } from '../../validators/auth';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

function RegisterPage() {
  const navigate = useNavigate();
  const { register: registerUser, isLoading, error } = useAuthStore();
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<RegisterSchema>({ resolver: zodResolver(registerSchema) });

  const passwordValue = watch('password', '');

  const onSubmit = async (values: RegisterSchema) => {
    try {
      await registerUser(values);
      setTimeout(() => {
        navigate('/servers');
      }, 100);
    } catch (err) {
      // Error is already in the store
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
      <div className="pointer-events-none fixed inset-0 bg-gradient-to-br from-primary/3 via-transparent to-violet-500/3" />
      <div className="relative w-full max-w-sm">
        <Card className="border-border shadow-surface-lg">
          <CardContent className="px-6 py-8">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Create account</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Start managing your infrastructure.
            </p>

            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <form className="mt-6 space-y-3" onSubmit={handleSubmit(onSubmit)}>
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="yourname"
                  {...register('username')}
                />
                {errors.username ? (
                  <p className="text-xs text-destructive">{errors.username.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  {...register('email')}
                />
                {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  {...register('password')}
                />
                <PasswordStrengthMeter password={passwordValue} />
                {errors.password ? (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                ) : null}
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading ? 'Creating…' : 'Create account'}
              </Button>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link
                to="/login"
                className="font-medium text-primary hover:text-primary-hover transition-colors"
              >
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default RegisterPage;
