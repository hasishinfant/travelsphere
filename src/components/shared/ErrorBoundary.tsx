// Error boundary component
import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="page">
          <div className="surface empty-state error-boundary">
            <h3>Something went wrong</h3>
            <p>Sorry — an unexpected error stopped this page. Reloading usually fixes it.</p>
            {this.state.error && (
              <details className="notice" style={{ textAlign: 'left', width: '100%', maxWidth: 560, flexDirection: 'column' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 500 }}>Error details</summary>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, marginTop: 8 }}>
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
            <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;