import type { ErrorInfo, ReactNode } from 'react';
import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { reportReactError } from '../../lib/error-reporter';
import { queryClient } from '../../lib/queryClient';
import { BracketLabel } from '../deck/primitives';
import { buttonVariants } from '../ui/button';

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

/**
 * In-place failure panel.
 *
 * `min-h-screen` used to replace the whole viewport, which threw away the
 * sidebar and every way back — a crash in one page's render looked like a dead
 * app. This fills the content area instead, so navigation survives and the
 * boundary's retry actually has somewhere to go.
 */
function ErrorFallback({ message, onRetry }: { message?: string; onRetry: () => void }) {
  const { t } = useTranslation('common');

  return (
    <div className="flex min-h-[50dvh] flex-1 items-center justify-center px-4 py-8">
      <div className="deck-panel w-full max-w-md overflow-hidden border-danger/30">
        <div className="flex items-start gap-2.5 border-b border-border/50 bg-surface-1/40 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0">
            <BracketLabel tone="alarm">{t('errorBoundary.title')}</BracketLabel>
            <p className="type-meta mt-1">
              {message ?? t('errorBoundary.message')}
            </p>
          </div>
        </div>
        <div className="px-3 py-3">
          <button
            type="button"
            onClick={onRetry}
            className={buttonVariants({ variant: 'default', size: 'sm' })}
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

  /**
   * Clearing the error alone re-renders the children against the SAME cache
   * state that broke them, so the retry usually crashed again immediately.
   * Drop the error and re-fetch everything active: a transient bad payload is
   * replaced, a genuine render bug still surfaces.
   */
  private handleRetry = () => {
    this.setState({ hasError: false, message: undefined });
    // `invalidateQueries` already re-fetches every active observer by default;
    // the broken cache entry is what usually causes the crash, so a redraw
    // against the same data would simply fail again.
    void queryClient.invalidateQueries({}, { refetchType: 'all' });
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
