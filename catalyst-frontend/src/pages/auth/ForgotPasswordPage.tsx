import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../../services/api/auth';
import { notifyError, notifySuccess } from '../../utils/notify';
import { getErrorMessage } from '../../utils/errors';
import { reportSystemError } from '../../services/api/systemErrors';
import { usePanelBranding } from '../../hooks/usePanelBranding';
import { BrandFooter } from '../../components/shared/BrandFooter';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ForgotPasswordPage() {
 const [email, setEmail] = useState('');
 const [isLoading, setIsLoading] = useState(false);
 const [isSubmitted, setIsSubmitted] = useState(false);
 const { panelName, logoUrl } = usePanelBranding();

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
 reportSystemError({
 level: 'error',
 component: 'ForgotPasswordPage',
 message: error instanceof Error ? error.message : String(error),
 stack: error instanceof Error ? error.stack : undefined,
 metadata: { context: 'handleSubmit' },
 });
 notifyError(getErrorMessage(error, 'Failed to send reset email'));
 } finally {
 setIsLoading(false);
 }
 };

 return (
 <div className="app-shell relative flex min-h-screen items-center justify-center px-4 font-sans">
 <Card className="w-full max-w-md border-border/80 bg-card/90 shadow-elevated">
 <CardContent className="px-6 py-8 sm:px-8">
 <div className="flex flex-col items-center text-center">
 <img src={logoUrl} alt={`${panelName} logo`} className="h-12 w-12" onError={(e) => { (e.target as HTMLImageElement).src = '/logo.png'; }} />
 <span className="mt-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
 {panelName} Panel
 </span>
 </div>

 <h1 className="mt-6 text-2xl font-semibold text-foreground">
 Forgot password?
 </h1>
 <p className="mt-2 text-sm text-muted-foreground">
 Enter your email address and we'll send you a link to reset your password.
 </p>

 {isSubmitted ? (
 <div className="mt-6 space-y-4">
 <div className="rounded-lg border border-success/20 bg-success/5 px-4 py-4">
 <p className="text-sm text-success">
 If an account exists with that email address, we've sent a password reset link.
 Please check your inbox (and spam folder).
 </p>
 </div>
 <Button asChild className="w-full">
 <Link to="/login">Back to login</Link>
 </Button>
 </div>
 ) : (
 <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
 <div className="space-y-2">
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

 <Button type="submit" className="w-full" disabled={isLoading}>
 {isLoading ? 'Sending...' : 'Send reset link'}
 </Button>

 <div className="text-center">
 <Link
 to="/login"
 className="text-sm font-medium text-primary transition-colors hover:text-primary/80"
 >
 Back to login
 </Link>
 </div>
 </form>
 )}
 </CardContent>
 </Card>
 <BrandFooter />
 </div>
 );
}

export default ForgotPasswordPage;
