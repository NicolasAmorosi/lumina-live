import { Component, type ErrorInfo, type ReactNode } from "react";

type ErrorBoundaryProps = {
  children: ReactNode;
  /** Rendered instead of `children` once something has thrown. Receives the
   *  error and a reset that clears the boundary and retries the subtree. */
  fallback: (state: { error: Error; reset: () => void }) => ReactNode;
  /** Side effects a caught error has to trigger — closing the modal this
   *  boundary wraps, raising a toast, answering main's pending close
   *  decision. It runs from `componentDidCatch`, which is the commit phase:
   *  the one place a boundary may do this. Doing it from `fallback` would be
   *  a side effect during render, which React is free to run twice. */
  onError?: ((error: Error) => void) | undefined;
};

type ErrorBoundaryState = { error: Error | null };

/**
 * Last line of defence for the control window.
 *
 * Without one, a single render-time throw anywhere in the tree unmounts the
 * whole app and leaves a blank window — which, during a service, is
 * indistinguishable from a crash and offers the operator nothing to do about
 * it. Neither reloading the page nor restarting loses anything durable (the
 * schedule is saved in SQLite, what's live is replayed from main's snapshot),
 * so recovery is genuinely cheap and worth offering.
 *
 * A class on purpose: `componentDidCatch`/`getDerivedStateFromError` have no
 * hook equivalent.
 *
 * It does NOT catch async failures — a rejected promise never passes through
 * React's render. Those are handled separately (see `install-global-error-handlers`).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[renderer] uncaught render error", error, info.componentStack);
    this.props.onError?.(error instanceof Error ? error : new Error(String(error)));
  }

  private readonly reset = () => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (error) return this.props.fallback({ error, reset: this.reset });
    return this.props.children;
  }
}
