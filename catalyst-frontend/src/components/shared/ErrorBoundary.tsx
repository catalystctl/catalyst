import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { reportSystemError } from '../../services/api/systemErrors';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to future observability pipeline
    console.error('UI error boundary caught error', { error, info });
    reportSystemError({
      level: 'error',
      component: 'ReactErrorBoundary',
      message: error.message,
      stack: error.stack,
      metadata: { componentStack: info.componentStack },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-surface-2 px-4 text-center text-foreground transition-all duration-300 dark:bg-zinc-950 dark:text-zinc-100">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
            {this.state.message ?? 'Unexpected error encountered.'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, message: undefined })}
            className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-all duration-300 hover:bg-primary-500"
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
