import React, { Component, ErrorInfo, ReactNode } from 'react';
import { reportSystemError } from '../services/api/systemErrors';

interface Props {
  children: ReactNode;
  pluginName: string;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary that catches and handles errors from plugin components.
 *
 * Usage:
 * ```tsx
 * <PluginErrorBoundary pluginName="my-plugin">
 *   <MyPluginComponent />
 * </PluginErrorBoundary>
 * ```
 */
class PluginErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[Plugin:${this.props.pluginName}] Error:`, error, errorInfo);

    // Report to monitoring (fire-and-forget)
    reportSystemError({
      level: 'error',
      component: `plugin:${this.props.pluginName}`,
      message: error.message,
      stack: error.stack,
      metadata: {
        pluginName: this.props.pluginName,
        componentStack: errorInfo.componentStack,
      },
    }).catch(() => {});

    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
          <h3 className="mb-2 text-lg font-semibold text-destructive">
            ⚠️ Plugin Error: {this.props.pluginName}
          </h3>
          <p className="mb-4 text-sm text-muted-foreground">
            {this.state.error?.message || 'An unexpected error occurred in this plugin.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PluginErrorBoundary;
