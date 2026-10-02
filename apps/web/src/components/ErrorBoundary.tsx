/**
 * @nexora/app-web — the root error boundary.
 *
 * If a page throws while rendering, the person sees what happened and a way
 * back, instead of a blank screen. Nothing is retried silently.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

import { ErrorState } from './ErrorState.js';

interface State {
  failed: boolean;
}

/** Catches render errors below it and shows the standard error state. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('A page failed to render', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <ErrorState
        title="This page could not be shown"
        message="Something went wrong while drawing the page. Reloading usually fixes it."
        onRetry={() => window.location.reload()}
      />
    );
  }
}
