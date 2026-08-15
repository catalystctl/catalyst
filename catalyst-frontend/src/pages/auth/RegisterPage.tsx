import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import type { RegisterSchema } from '../../validators/auth';
import { registerSchema } from '../../validators/auth';
import { reportSystemError } from '../../services/api/systemErrors';
import { PasswordStrengthMeter } from '../../components/shared/PasswordStrengthMeter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function RegisterPage() {
 const navigate = useNavigate();
 const registerUser = useAuthStore((s) => s.register);
 const isLoading = useAuthStore((s) => s.isLoading);
 const error = useAuthStore((s) => s.error);
 const resolver = useMemo(() => zodResolver(registerSchema), []);
 const {
 register,
 handleSubmit,
 watch,
 formState: { errors },
 } = useForm<RegisterSchema>({ resolver });

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
 <Card className="w-full max-w-md border-border/80 bg-card/90 shadow-elevated">
 <CardContent className="px-3 py-4 sm:px-4">
 <h1 className="text-sm font-semibold tracking-tight text-foreground">Create account</h1>
 <p className="type-meta mt-0.5">
 Start managing your infrastructure.
 </p>

 {error ? (
 <div className="mt-4 rounded-lg border border-destructive/20 bg-destructive/10/60 px-4 py-3 text-sm text-destructive">
 {error}
 </div>
 ) : null}

 <form className="mt-6 space-y-4" onSubmit={handleSubmit(onSubmit)}>
 <div className="space-y-2">
 <Label htmlFor="username">Username</Label>
 <Input
 id="username"
 type="text"
 autoComplete="username"
 placeholder="yourname"
 {...register('username')}
 />
 {errors.username ? (
 <p className="text-xs text-destructive">{errors.username.message}</p>
 ) : null}
 </div>

 <div className="space-y-2">
 <Label htmlFor="email">Email</Label>
 <Input
 id="email"
 type="email"
 autoComplete="email"
 placeholder="you@example.com"
 {...register('email')}
 />
 {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
 </div>

 <div className="space-y-2">
 <Label htmlFor="password">Password</Label>
 <Input
 id="password"
 type="password"
 autoComplete="new-password"
 placeholder="••••••••"
 {...register('password')}
 />
 <PasswordStrengthMeter password={passwordValue} />
 {errors.password ? (
 <p className="text-xs text-destructive">{errors.password.message}</p>
 ) : null}
 </div>

 <Button type="submit" className="w-full" disabled={isLoading}>
 {isLoading ? 'Creating…' : 'Create account'}
 </Button>
 </form>

 <p className="mt-4 text-center text-sm text-muted-foreground">
 Already have an account?{' '}
 <Link
 to="/login"
 className="font-medium text-primary transition-colors hover:text-primary/80"
 >
 Sign in
 </Link>
 </p>
 </CardContent>
 </Card>
 </div>
 );
}

export default RegisterPage;
