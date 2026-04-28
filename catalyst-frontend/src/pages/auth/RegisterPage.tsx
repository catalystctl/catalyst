import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import type { RegisterSchema } from '../../validators/auth';
import { registerSchema } from '../../validators/auth';
import { reportSystemError } from '../../services/api/systemErrors';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';

function RegisterPage() {
  const navigate = useNavigate();
  const registerUser = useAuthStore((s) => s.register);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
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
      // Redirect on successful registration
      setTimeout(() => {
        navigate('/servers');
      }, 100);
    } catch (err) {
      reportSystemError({
        level: 'error',
        component: 'RegisterPage',
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        metadata: { context: 'onSubmit' },
      });
      // Error is already in the store
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
      <div className="w-full max-w-md rounded-xl border border-border bg-card px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
        <h1 className="text-2xl font-semibold text-foreground ">Create account</h1>
        <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
          Start managing your infrastructure.
        </p>

        {error ? (
          <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10/60 px-4 py-3 text-sm text-destructive dark:border-destructive/20 dark:bg-destructive/50/10 dark:text-destructive">
            {error}
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="block text-sm text-muted-foreground dark:text-foreground" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              type="text"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:bg-surface-1 dark:text-foreground dark:hover:border-primary/30"
              placeholder="yourname"
              {...register('username')}
            />
            {errors.username ? (
              <p className="text-xs text-destructive">{errors.username.message}</p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-muted-foreground dark:text-foreground" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:bg-surface-1 dark:text-foreground dark:hover:border-primary/30"
              placeholder="you@example.com"
              {...register('email')}
            />
            {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
          </div>

          <div className="space-y-2">
            <label className="block text-sm text-muted-foreground dark:text-foreground" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:bg-surface-1 dark:text-foreground dark:hover:border-primary/30"
              placeholder="••••••••"
              {...register('password')}
            />
            <PasswordStrengthMeter password={passwordValue} />
            {errors.password ? (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            ) : null}
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-70"
            disabled={isLoading}
          >
            {isLoading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground dark:text-muted-foreground">
          Already have an account?{' '}
          <Link
            to="/login"
            className="font-medium text-primary-600 transition-all duration-300 hover:text-primary dark:text-primary-400 dark:hover:text-primary-300"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

export default RegisterPage;
