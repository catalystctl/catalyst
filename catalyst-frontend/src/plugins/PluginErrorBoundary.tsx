import { Component, ErrorInfo, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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

function PluginErrorFallback({
 pluginName,
 message,
 onRetry,
}: {
 pluginName: string;
 message?: string;
 onRetry: () => void;
}) {
 const { t } = useTranslation('plugins');
 return (
 <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
 <h3 className="mb-2 text-lg font-semibold text-destructive">
 {t('errorBoundary.title', { name: pluginName })}
 </h3>
 <p className="mb-4 text-sm text-muted-foreground">
 {message || t('errorBoundary.message')}
 </p>
 <button
 onClick={onRetry}
 className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
 >
 {t('errorBoundary.tryAgain')}
 </button>
 </div>
 );
}

/**
 * React Error Boundary that catches and handles errors from plugin components.
 *
 * Usage:
 * ```tsx
 * <PluginErrorBoundary pluginName="my-plugin">
 * <MyPluginComponent />
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
 <PluginErrorFallback
 pluginName={this.props.pluginName}
 message={this.state.error?.message}
 onRetry={() => this.setState({ hasError: false, error: null })}
 />
 );
 }

 return this.props.children;
 }
}

export default PluginErrorBoundary;
