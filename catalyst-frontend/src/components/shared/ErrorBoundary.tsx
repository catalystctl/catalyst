import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { reportReactError } from '../../lib/error-reporter';
import { BracketLabel } from '../deck/primitives';

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

/** Function component wrapper: the boundary itself cannot use hooks. */
function ErrorFallback({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const { t } = useTranslation('common');

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="deck-panel w-full max-w-md overflow-hidden border-danger/30">
        <div className="flex items-start gap-2.5 border-b border-border/50 bg-surface-1/40 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
          <div className="min-w-0">
            <BracketLabel tone="alarm">{t('errorBoundary.title')}</BracketLabel>
            <p className="type-meta mt-1">
              {message ?? t('errorBoundary.message')}
            </p>
          </div>
        </div>
        <div className="px-3 py-2">
          <button
            type="button"
            onClick={onRetry}
            className="pressable flex h-8 items-center rounded-sm bg-primary px-3 font-display text-mini font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('errorBoundary.retry')}
          </button>
        </div>
      </div>
    </div>
  );
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
      return <ErrorFallback message={this.state.message} onRetry={this.handleRetry} />;
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
