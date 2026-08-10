import React from 'react';

interface State { error: Error | null }

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex h-screen items-center justify-center bg-gray-950 p-8 text-gray-100">
        <div className="max-w-lg rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <h1 className="text-lg font-semibold">The image viewer stopped unexpectedly.</h1>
          <p className="mt-2 text-sm text-gray-300">Close this window and reopen the image from Image MetaHub.</p>
        </div>
      </main>
    );
  }
}
