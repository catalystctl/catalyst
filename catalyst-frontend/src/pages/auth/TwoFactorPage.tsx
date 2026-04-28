import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { useAuthStore } from '../../stores/authStore';

const twoFactorSchema = z.object({
  code: z.string().min(6),
  trustDevice: z.boolean().optional(),
});

type TwoFactorSchema = z.infer<typeof twoFactorSchema>;

function TwoFactorPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const verifyTwoFactor = useAuthStore((s) => s.verifyTwoFactor);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TwoFactorSchema>({ resolver: zodResolver(twoFactorSchema) });

  const state = location.state as
    | { from?: { pathname?: string }; rememberMe?: boolean; returnTo?: string }
    | undefined;
  const from = state?.from?.pathname;
  const returnTo = state?.returnTo;

  const onSubmit = async (values: TwoFactorSchema) => {
    try {
      await verifyTwoFactor({
        code: values.code,
        trustDevice: values.trustDevice,
      });
      setTimeout(() => {
        navigate(from || '/servers');
      }, 100);
    } catch {
      // Error handled by store
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center px-4 font-sans">
      <div className="w-full max-w-md rounded-xl border border-border bg-card px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
        <h1 className="text-2xl font-semibold text-foreground ">Two-factor verification</h1>
        <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
          Enter the code from your authenticator app or backup code.
        </p>

        {error ? (
          <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10/60 px-4 py-3 text-sm text-destructive dark:border-destructive/20 dark:bg-destructive/50/10 dark:text-destructive">
            {error}
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="block text-sm text-muted-foreground dark:text-foreground" htmlFor="code">
              Verification code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-foreground transition-all duration-300 focus:border-primary focus:outline-none hover:border-primary dark:border-border dark:bg-surface-1 dark:text-foreground dark:hover:border-primary/30"
              placeholder="123456"
              {...register('code')}
            />
            {errors.code ? <p className="text-xs text-destructive">{errors.code.message}</p> : null}
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground dark:text-foreground">
            <input type="checkbox" className="rounded border-border" {...register('trustDevice')} />
            Trust this device for 30 days
          </label>

          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary/90 disabled:opacity-70"
            disabled={isLoading}
          >
            {isLoading ? 'Verifying…' : 'Verify'}
          </button>
          {returnTo ? (
            <button
              type="button"
              className="w-full rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary hover:text-foreground dark:border-border dark:text-foreground dark:hover:border-primary/30"
              onClick={() => navigate(returnTo, { replace: true, state: { from: location.state?.from } })}
            >
              Use passkey instead
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}

export default TwoFactorPage;
