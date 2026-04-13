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
  const { verifyTwoFactor, isLoading, error } = useAuthStore();
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
      <div className="w-full max-w-md rounded-xl border border-border bg-white px-6 py-8 shadow-surface-light dark:shadow-surface-dark transition-all duration-300 dark:border-border dark:bg-surface-1">
        <h1 className="text-2xl font-semibold text-foreground dark:text-white">Two-factor verification</h1>
        <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
          Enter the code from your authenticator app or backup code.
        </p>

        {error ? (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-100/60 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
            {error}
          </div>
        ) : null}

        <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <label className="block text-sm text-muted-foreground dark:text-zinc-300" htmlFor="code">
              Verification code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-foreground transition-all duration-300 focus:border-primary-500 focus:outline-none hover:border-primary-500 dark:border-border dark:bg-surface-1 dark:text-zinc-200 dark:focus:border-primary-400 dark:hover:border-primary/30"
              placeholder="123456"
              {...register('code')}
            />
            {errors.code ? <p className="text-xs text-red-400">{errors.code.message}</p> : null}
          </div>

          <label className="flex items-center gap-2 text-sm text-muted-foreground dark:text-zinc-300">
            <input type="checkbox" className="rounded border-border" {...register('trustDevice')} />
            Trust this device for 30 days
          </label>

          <button
            type="submit"
            className="w-full rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500 disabled:opacity-70"
            disabled={isLoading}
          >
            {isLoading ? 'Verifying…' : 'Verify'}
          </button>
          {returnTo ? (
            <button
              type="button"
              className="w-full rounded-lg border border-border px-4 py-2 text-sm font-semibold text-muted-foreground transition-all duration-300 hover:border-primary-500 hover:text-foreground dark:border-border dark:text-zinc-300 dark:hover:border-primary/30"
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
