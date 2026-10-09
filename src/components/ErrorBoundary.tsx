import { Component, type ReactNode } from 'react';
import { routerBasename } from '../lib/appUrl';

/**
 * Last line of defence: if a screen crashes (a bug, a damaged record, or a new version replacing an old
 * file), show a calm page instead of a blank one. Stored trips are never touched by a crash.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('TripNest screen error:', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="container" role="alert">
        <div className="card">
          <h1>Something went wrong</h1>
          <p>Your trips are safe: they are stored on this device and this error did not change them. Reloading usually fixes it.</p>
          <div className="row">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
            <a className="btn" href={`${routerBasename()}/trips`}>Go to my trips</a>
          </div>
          <details>
            <summary>Technical details</summary>
            <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{this.state.error.message}</pre>
          </details>
        </div>
      </main>
    );
  }
}
