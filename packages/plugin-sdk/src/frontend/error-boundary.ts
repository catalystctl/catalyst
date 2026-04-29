/**
 * React error boundary specifically for plugin components.
 * Catches render errors, shows a fallback UI, and reports the error.
 * Zero Node.js dependencies.
 */

import React from 'react';
import type { PluginErrorFallbackProps } from './types.js';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  pluginName: string;
  /**
   * Custom fallback component or React node.
   * If a component is passed, it receives PluginErrorFallbackProps.
   * If a React node is passed, it is rendered directly.
   */
  fallback?: React.ComponentType<PluginErrorFallbackProps> | React.ReactNode;
  /** Optional callback invoked when an error is caught. */
  onError?: (error: Error) => void;
}

export class PluginErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error(`[Plugin:${this.props.pluginName}] Render error:`, error);
    try {
      fetch('/api/system-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: 'error',
          component: this.props.pluginName,
          message: error.message,
          stack: error.stack,
        }),
      }).catch(() => {});
    } catch { /* silently ignore reporting failures */ }
    this.props.onError?.(error);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          const Fallback = this.props.fallback as React.ComponentType<PluginErrorFallbackProps>;
          return React.createElement(Fallback, {
            pluginName: this.props.pluginName,
            error: this.state.error!,
            resetError: this.handleReset,
          });
        }
        return this.props.fallback;
      }

      return React.createElement('div', {
        style: {
          padding: '1.5rem',
          border: '1px solid #f87171',
          borderRadius: '0.5rem',
          backgroundColor: 'rgba(127, 29, 29, 0.12)',
          color: '#fca5a5',
          textAlign: 'center',
        },
      },
        React.createElement('h3', {
          style: { margin: '0 0 0.5rem 0', fontWeight: 600 },
        }, `⚠️ Plugin Error: ${this.props.pluginName}`),
        React.createElement('p', {
          style: { margin: 0, fontSize: '0.875rem' },
        }, this.state.error?.message || 'An unexpected error occurred'),
        React.createElement('button', {
          onClick: this.handleReset,
          style: {
            marginTop: '0.75rem',
            padding: '0.375rem 0.75rem',
            borderRadius: '0.375rem',
            border: '1px solid #f87171',
            background: 'transparent',
            color: '#fca5a5',
            cursor: 'pointer',
          },
        }, 'Try Again'),
      );
    }

    return this.props.children;
  }
}
