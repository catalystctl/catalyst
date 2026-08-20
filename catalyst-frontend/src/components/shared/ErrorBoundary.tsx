import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportReactError } from '../../lib/error-reporter';

interface Props {
  children: ReactNode;
  /** Soft boundary: inline fallback instead of full-screen takeover */
  fallback?: ReactNode;
  /** When this changes, clear the error (e.g. route / tab key) */
  resetKey?: string | number | null;
}

interface State {
  hasError: boolean;
  message?: string;
  lastResetKey?: string | number | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, lastResetKey: props.resetKey };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, message: error.message };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey !== state.lastResetKey) {
      return {
        hasError: false,
        message: undefined,
        lastResetKey: props.resetKey,
      };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error boundary caught error', { error, info });
    reportReactError(error, info);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: undefined });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
        return (
          <div className="flex min-h-screen items-center justify-center bg-background px-4">
            <div className="w-full max-w-md overflow-hidden rounded-lg border border-danger/25 bg-danger/5">
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-danger/30 bg-danger/10 text-danger">
                  <AlertTriangle className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-sm font-semibold tracking-tight text-foreground">Something went wrong</h1>
                  <p className="type-meta mt-0.5">
                    {this.state.message ?? 'Unexpected error encountered.'}
                  </p>
                </div>
              </div>
              <div className="border-t border-border/40 px-3 py-2">
                <button
                  type="button"
                  onClick={this.handleRetry}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
