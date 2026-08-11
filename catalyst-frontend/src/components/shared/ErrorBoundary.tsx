import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { reportSystemError } from '../../services/api/systemErrors';

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
    reportSystemError({
      level: 'error',
      component: 'ReactErrorBoundary',
      message: error.message,
      stack: error.stack,
      metadata: { componentStack: info.componentStack },
    });
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
        <div className="flex min-h-screen flex-col items-center justify-center bg-surface-2 px-4 text-center text-foreground">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {this.state.message ?? 'Unexpected error encountered.'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all duration-300 hover:bg-primary/90"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
