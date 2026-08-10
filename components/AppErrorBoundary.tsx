import React from 'react';

interface State { error: Error | null }

interface Props {
  /**
   * The detached viewer is disposable — the user can just close the window and
   * reopen the image. The main window is not, so it gets a reload affordance
   * instead of instructions that only make sense for a viewer window.
   */
  variant?: 'app' | 'detached-viewer';
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren<Props>, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[AppErrorBoundary] Unhandled render error:', error, errorInfo.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const isDetachedViewer = this.props.variant === 'detached-viewer';

    return (
      <main className="flex h-screen items-center justify-center bg-gray-950 p-8 text-gray-100">
        <div className="max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <h1 className="text-lg font-semibold">
            {isDetachedViewer ? 'The image viewer stopped unexpectedly.' : 'Image MetaHub stopped unexpectedly.'}
          </h1>
          <p className="mt-2 text-sm text-gray-300">
            {isDetachedViewer
              ? 'Close this window and reopen the image from Image MetaHub.'
              : 'Reload the app to continue. Your library and settings are unaffected.'}
          </p>
          {this.state.error.message && (
            <p className="mt-3 break-words text-xs text-gray-500">{this.state.error.message}</p>
          )}
          {!isDetachedViewer && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:border-gray-500 hover:bg-gray-700"
            >
              Reload Image MetaHub
            </button>
          )}
        </div>
      </main>
    );
  }
}
