import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: '#dc2626', fontSize: '0.85rem', wordBreak: 'break-all' }}>
          <h3 style={{ margin: '0 0 8px' }}>エラーが発生しました</h3>
          <p><strong>{this.state.error.message}</strong></p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.75rem', background: '#fef2f2', padding: 12, borderRadius: 8 }}>
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
